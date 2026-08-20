import {
  looksLikeProviderErrorSurface,
  looksLikeProviderLoginGate,
  looksLikeProviderVerificationGate,
} from '../llm/provider-surface-classifier';

export type ProviderOutputIntegrityKind =
  | 'complete_answer'
  | 'tool_call'
  // Persisted diagnostic compatibility; current classification never emits it.
  | 'short_intent'
  | 'truncated'
  | 'error_page'
  | 'login_required'
  | 'empty'
  | 'incomplete_answer'
  | 'mixed-tool-protocol';

export interface ProviderOutputIntegrity {
  kind: ProviderOutputIntegrityKind;
  okForSettlement: boolean;
  toolCallCount: number;
  hasAnswerEvidence: boolean;
  reason: string;
}

export interface ProviderOutputObservation {
  readonly toolCallCount?: number;
  readonly incompleteToolProtocol?: boolean;
  readonly mixedToolProtocol?: boolean;
}

export function classifyProviderOutputIntegrity(
  text: string | undefined,
  observation: ProviderOutputObservation = {},
): ProviderOutputIntegrity {
  const raw = String(text ?? '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return buildProviderIntegrity('empty', 0, false, 'provider returned an empty response');
  }

  if (observation.mixedToolProtocol) {
    return buildProviderIntegrity(
      'mixed-tool-protocol',
      0,
      false,
      'provider response combines incompatible tool serialization dialects',
    );
  }

  const toolCallCount = Math.max(0, Math.trunc(observation.toolCallCount ?? 0));

  if (isStructuralCorruptionSentinel(trimmed) || observation.incompleteToolProtocol) {
    return buildProviderIntegrity('truncated', toolCallCount, false, 'provider response appears truncated');
  }

  if (toolCallCount > 0) {
    return buildProviderIntegrity('tool_call', toolCallCount, false, 'provider requested tool execution');
  }

  if (looksLikeProviderLoginGate(trimmed) || looksLikeProviderVerificationGate(trimmed)) {
    return buildProviderIntegrity('login_required', 0, false, 'provider returned a login or captcha page');
  }

  if (looksLikeProviderErrorSurface(trimmed)) {
    return buildProviderIntegrity('error_page', 0, false, 'provider returned an error page');
  }

  // Codex turn protocol: a structurally valid assistant message is itself a
  // terminal delivery. Semantic adequacy belongs to the model prompt/evals;
  // local settlement must not depend on language, answer length, or keywords.
  return buildProviderIntegrity('complete_answer', 0, true, 'provider returned a complete assistant message');
}

function isStructuralCorruptionSentinel(text: string): boolean {
  return /^RESPONSE_CORRUPTED:[^:\n]+(?::[\s\S]*)?$/i.test(text)
    || /^(?:ERR_STREAM_PREMATURE_CLOSE|STREAM_TRUNCATED)$/i.test(text);
}

export function isProviderOutputFatal(kind: ProviderOutputIntegrityKind): boolean {
  return kind === 'empty'
    || kind === 'truncated'
    || kind === 'error_page'
    || kind === 'login_required'
    || kind === 'incomplete_answer'
    || kind === 'mixed-tool-protocol';
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
    case 'mixed-tool-protocol':
      return 'Provider 在同一回复中混用了不兼容的工具协议，已阻止执行。';
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
