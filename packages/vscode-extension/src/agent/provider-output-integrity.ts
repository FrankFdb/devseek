import { hasReadOnlyAnswerEvidence } from './completion-evidence';
import { hasIncompleteFakeToolCallProtocol, parseFakeToolCalls } from './fake-tool-parser';
import { isolateModelToolRequestText } from './model-tool-protocol-adapter';
import {
  containsDevSeekInternalToolTranscript,
  containsProviderAuthoredToolTranscript,
} from './provider-authored-transcript-recovery';
import { normalizeStructuredToolEnvelope } from './structured-tool-envelope-normalizer';
import {
  looksLikeProviderErrorSurface,
  looksLikeProviderLoginGate,
  looksLikeProviderVerificationGate,
} from '../llm/provider-surface-classifier';

export type ProviderOutputIntegrityKind =
  | 'complete_answer'
  | 'tool_call'
  | 'short_intent'
  | 'truncated'
  | 'error_page'
  | 'login_required'
  | 'empty'
  | 'incomplete_answer';

export interface ProviderOutputIntegrity {
  kind: ProviderOutputIntegrityKind;
  okForSettlement: boolean;
  toolCallCount: number;
  hasAnswerEvidence: boolean;
  reason: string;
}

const TRUNCATED_RE = /(?:RESPONSE_CORRUPTED|TRUNCATED|stream.*(?:closed|ended)|ERR_STREAM_PREMATURE_CLOSE|finish_reason["']?\s*:\s*["']?length)/i;
const SHORT_INTENT_RE = /(?:我(?:来|将|会|再|先|继续)|让我|现在我|接下来|下一步|I(?:'ll| will| need to)|let me|next I).{0,100}(?:查看|读取|搜索|检查|分析|了解|打开|确认|生成|输出|整理|形成|look|read|search|inspect|check|analy[sz]e|generate|produce|write)/i;
const CONCRETE_CONCLUSION_RE = /(?:结论|依据|原因|问题|风险|建议|对策|方案|任务拆解|验证结果|已完成|修改了|创建了|summary|conclusion|evidence|recommendation|implemented|changed)/i;

export function classifyProviderOutputIntegrity(text: string | undefined): ProviderOutputIntegrity {
  const raw = normalizeStructuredToolEnvelope(String(text ?? ''));
  const trimmed = raw.trim();
  if (!trimmed) {
    return buildProviderIntegrity('empty', 0, false, 'provider returned an empty response');
  }

  const toolCallCount = countProviderToolCalls(trimmed);
  if (toolCallCount === 0 && containsDevSeekInternalToolTranscript(trimmed)) {
    return buildProviderIntegrity(
      'incomplete_answer',
      0,
      false,
      'provider response contains DevSeek internal tool transcript instead of executable evidence',
    );
  }

  if (TRUNCATED_RE.test(trimmed) || looksLikeTruncatedToolProtocol(trimmed, toolCallCount)) {
    return buildProviderIntegrity('truncated', toolCallCount, false, 'provider response appears truncated');
  }

  if (toolCallCount > 0) {
    return buildProviderIntegrity('tool_call', toolCallCount, false, 'provider requested tool execution');
  }

  if (containsProviderAuthoredToolTranscript(trimmed)) {
    return buildProviderIntegrity(
      'incomplete_answer',
      0,
      false,
      'provider response contains provider-authored tool-result transcript instead of executable evidence',
    );
  }

  if (looksLikeProviderLoginGate(trimmed) || looksLikeProviderVerificationGate(trimmed)) {
    return buildProviderIntegrity('login_required', 0, false, 'provider returned a login or captcha page');
  }

  if (looksLikeProviderErrorSurface(trimmed)) {
    return buildProviderIntegrity('error_page', 0, false, 'provider returned an error page');
  }

  const hasAnswerEvidence = hasReadOnlyAnswerEvidence(trimmed) || looksLikeConcreteAnswer(trimmed);
  if (looksLikeShortIntent(trimmed, hasAnswerEvidence)) {
    return buildProviderIntegrity('short_intent', 0, false, 'provider emitted intent text without a tool call or answer');
  }

  if (hasAnswerEvidence) {
    return buildProviderIntegrity('complete_answer', 0, true, 'provider response contains answer evidence');
  }

  return buildProviderIntegrity('incomplete_answer', 0, false, 'provider response lacks answer evidence');
}

export function isProviderOutputFatal(kind: ProviderOutputIntegrityKind): boolean {
  return kind === 'empty' || kind === 'truncated' || kind === 'error_page' || kind === 'login_required';
}

export function describeProviderOutputIntegrity(kind: ProviderOutputIntegrityKind): string {
  switch (kind) {
    case 'empty':
      return 'Provider 返回空响应。';
    case 'truncated':
      return 'Provider 响应疑似被截断。';
    case 'error_page':
      return 'Provider 返回错误页或服务异常内容。';
    case 'login_required':
      return 'Provider 返回登录/验证码/会话失效页面。';
    case 'tool_call':
      return 'Provider 返回工具调用，必须先执行工具并收集证据。';
    case 'short_intent':
      return 'Provider 只返回了短意图，没有可执行工具调用或结论。';
    case 'complete_answer':
      return 'Provider 返回了可结算回答。';
    case 'incomplete_answer':
      return 'Provider 回答缺少可结算结论证据。';
  }
}

function buildProviderIntegrity(
  kind: ProviderOutputIntegrityKind,
  toolCallCount: number,
  hasAnswerEvidence: boolean,
  reason: string,
): ProviderOutputIntegrity {
  return {
    kind,
    okForSettlement: kind === 'complete_answer',
    toolCallCount,
    hasAnswerEvidence,
    reason,
  };
}

function countProviderToolCalls(text: string): number {
  const isolated = isolateModelToolRequestText(text).text;
  return parseFakeToolCalls(isolated).length;
}

function looksLikeShortIntent(text: string, hasAnswerEvidence: boolean): boolean {
  if (hasAnswerEvidence) return false;
  if (text.length <= 160 && SHORT_INTENT_RE.test(text)) return true;
  return text.length <= 80 && !CONCRETE_CONCLUSION_RE.test(text);
}

function looksLikeConcreteAnswer(text: string): boolean {
  if (text.length < 120) return false;
  return CONCRETE_CONCLUSION_RE.test(text);
}

function looksLikeTruncatedToolProtocol(text: string, toolCallCount = countProviderToolCalls(text)): boolean {
  const isolated = isolateModelToolRequestText(text).text;
  if (hasIncompleteFakeToolCallProtocol(isolated)) return true;
  const bracketStart = text.lastIndexOf('[TOOL:');
  if (bracketStart >= 0 && bracketStart > text.length - 240) {
    const tail = text.slice(bracketStart);
    if (parseFakeToolCalls(tail).length > 0) return false;
    if (!/\}\s*\]?\s*$/.test(tail)) return true;
  }
  const fencedStart = text.lastIndexOf('```');
  return toolCallCount === 0
    && fencedStart >= 0
    && (text.match(/```/g)?.length ?? 0) % 2 === 1
    && fencedStart > text.length - 400;
}
