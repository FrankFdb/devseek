import type { ChatMessage } from '../llm/types';
import { canAgentRecoverDeepSeekStreamError } from '@devseek-netai/shared';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { TextToolProtocolSession } from './text-tool-protocol';
import {
  buildReplaceInFileRecoveryPrompt,
  buildTextToolEnvelopeRecoveryPrompt,
} from './tool-protocol-prompt';

export interface AgentProviderFailure {
  status: string;
  reason: string;
  rawMessage: string;
  recoverable: boolean;
}

export interface AgentProviderRecoveryPromptInput {
  userPrompt: string;
  failure: AgentProviderFailure;
  recoveryAttempt: number;
  maxRecoveryAttempts: number;
  promptRequiresTools: boolean;
  currentTodos: readonly TodoItem[];
  readEvidencePaths: readonly string[];
  writtenFiles: readonly WrittenFileEvidence[];
  terminalEvidence: readonly TerminalEvidence[];
  textToolProtocol: TextToolProtocolSession;
  partialResponseLength?: number;
}

export interface AgentProviderRecoveryDisplay {
  title: string;
  detail: string;
  activityLabel: string;
}

const RECOVERABLE_RESPONSE_CORRUPTION_STATUSES = new Set([
  'empty',
  'truncated',
  'incomplete_answer',
  'mixed-tool-protocol',
  'unclosed-markdown-fence',
  'incomplete-tool-block',
  'invalid-tool-block',
  'out-of-envelope-tool-block',
  'incomplete-assistant-intent',
  'invalid-json-response',
  'stream-timeout',
  'prompt-submit-failed',
]);

export function parseAgentProviderFailure(error: unknown): AgentProviderFailure | undefined {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const match = /^RESPONSE_CORRUPTED:([^:\n]+):([\s\S]*)$/i.exec(rawMessage.trim());
  if (!match) {
    if (/^PROMPT_SUBMIT_FAILED:/i.test(rawMessage.trim())) {
      return {
        status: 'prompt-submit-failed',
        reason: rawMessage.trim(),
        rawMessage,
        recoverable: true,
      };
    }
    return undefined;
  }
  const status = match[1].trim();
  const reason = match[2].trim();
  return {
    status,
    reason,
    rawMessage,
    recoverable: isRecoverableAgentProviderCorruption(status, reason),
  };
}

function isRecoverableAgentProviderCorruption(status: string, reason: string): boolean {
  const normalizedStatus = status.toLowerCase();
  if (RECOVERABLE_RESPONSE_CORRUPTION_STATUSES.has(normalizedStatus)) {
    return true;
  }
  if (normalizedStatus !== 'stream-error') {
    return false;
  }
  const category = reason.split(':', 1)[0].trim();
  return canAgentRecoverDeepSeekStreamError(category);
}

export function canRecoverAgentProviderFailure(
  failure: AgentProviderFailure | undefined,
  recoveryAttempt: number,
  maxRecoveryAttempts: number,
): failure is AgentProviderFailure {
  return Boolean(failure?.recoverable && recoveryAttempt < maxRecoveryAttempts);
}

export function describeAgentProviderRecoveryForUser(
  failure: AgentProviderFailure,
  recoveryAttempt: number,
  maxRecoveryAttempts: number,
): AgentProviderRecoveryDisplay {
  const step = `${recoveryAttempt}/${maxRecoveryAttempts}`;
  const isSubmitFailure = failure.status.toLowerCase() === 'prompt-submit-failed';
  const isToolProtocolFailure = failure.status.toLowerCase().endsWith('tool-block');
  const resetProviderSession = shouldResetProviderSessionForRecovery(failure);
  return {
    title: isSubmitFailure
      ? `Provider 请求未送达，正在安全重试（${step}）`
      : isToolProtocolFailure
        ? `Provider 工具请求未通过协议门禁，正在安全重试（${step}）`
      : `Provider 响应被截断，正在安全续跑（${step}）`,
    detail: [
      isSubmitFailure
        ? '上一轮请求没有被网页确认接收，DevSeek 已保留已完成工具事实并准备重新提交。'
        : isToolProtocolFailure
          ? '上一轮结构化动作没有通过当前工具授权协议，DevSeek 已隔离且未执行，并准备要求模型安全重发。'
        : '上一轮模型回复没有通过完整性门禁，DevSeek 已阻止执行其中任何未验证内容。',
      `类型：${failure.status}`,
      failure.reason ? `原因：${failure.reason}` : '',
      resetProviderSession ? '本次恢复将重建模型会话，并只基于已验证的任务事实继续。' : '',
      '正在基于已落盘/已执行的任务事实要求模型分批继续。',
    ].filter(Boolean).join('\n'),
    activityLabel: resetProviderSession
      ? `重建模型会话，安全恢复 ${step}`
      : isSubmitFailure
        ? `请求未送达，安全重试 ${step}`
        : isToolProtocolFailure
          ? `工具请求未授权，安全重试 ${step}`
          : `响应被截断，安全续跑 ${step}`,
  };
}

export function buildAgentProviderRecoveryPrompt(input: AgentProviderRecoveryPromptInput): ChatMessage {
  const readPaths = summarizeList(input.readEvidencePaths, 12);
  const writtenPaths = summarizeList(input.writtenFiles.map(file => file.path), 12);
  const terminalFacts = summarizeList(
    input.terminalEvidence.map(evidence => `${evidence.ok ? 'ok' : 'failed'}: ${evidence.command}`),
    6,
  );
  const todos = summarizeList(
    input.currentTodos.map(todo => `${todo.status}: ${todo.title}`),
    8,
  );
  const failureStatus = input.failure.status.toLowerCase();
  const unresolvedToolAction = failureStatus.endsWith('tool-block');
  const sideEffectLine = unresolvedToolAction
    ? '上一轮包含未解决的结构化动作；必须通过当前授权信封安全重发，不能把已有只读证据当作任务完成。'
    : input.promptRequiresTools
    ? '当前任务需要真实工具证据；不得只输出说明、计划或自然语言完成摘要。'
    : '当前任务可以只读分析，但最终必须给出完整结论和依据。';
  const finalAttempt = input.recoveryAttempt >= input.maxRecoveryAttempts;
  const readLimitLine = finalAttempt
    ? '- 这是最后一次恢复：只能输出最小下一步。最多 3 个只读工具或 1 个写入工具；不能重新做全量项目探索。'
    : '- 恢复轮必须小步推进：最多 6 个只读工具；如需写入，最多 1 个写入工具，content 控制在 6000 字符以内。';
  const resetProviderSession = shouldResetProviderSessionForRecovery(input.failure);
  const toolSerializationLine = failureStatus === 'incomplete-tool-block'
    && input.writtenFiles.length > 0
    ? buildReplaceInFileRecoveryPrompt(input.textToolProtocol)
    : failureStatus === 'incomplete-tool-block'
      || failureStatus === 'invalid-tool-block'
      || failureStatus === 'out-of-envelope-tool-block'
      ? buildTextToolEnvelopeRecoveryPrompt(input.textToolProtocol)
      : '';

  return {
    role: 'user',
    content: [
      '【系统恢复】上一轮 Provider 回复未通过完整性门禁，DevSeek 已阻止执行损坏内容。',
      `失败类型：${input.failure.status}`,
      input.failure.reason ? `失败原因：${input.failure.reason}` : '',
      input.partialResponseLength ? `已丢弃未信任的部分响应：约 ${input.partialResponseLength} 字符。` : '',
      '',
      '请不要引用、续写或执行上一轮损坏文本；这是从运行账本重建的最小恢复上下文。',
      `原始用户任务：${truncateSingleLine(input.userPrompt, 800)}`,
      `已读取证据：${readPaths || '暂无'}`,
      `已写入文件：${writtenPaths || '暂无'}`,
      `终端/验证证据：${terminalFacts || '暂无'}`,
      `当前 Todo：${todos || '暂无'}`,
      '',
      '恢复要求：',
      `- ${sideEffectLine}`,
      resetProviderSession ? '- 本轮会重建 Provider 会话：必须沿用当前消息历史和下列已验证事实继续，不得要求用户重新发送需求。' : '',
      '- 先用 manage_todo_list 校正当前步骤；未完成项保持 in-progress 或 not-started。',
      '- 不要重复已读取路径、相同 list_dir、相同 grep_search 或相同 file_search；如确实缺少内容，只读取更精确的新文件或行范围。',
      '- 需要上下文时，只输出具体 read_file/list_dir/grep_search/file_search/只读 run_terminal 工具调用，不要同时输出长篇分析。',
      '- 需要创建或修改文件时，只使用 create_file 或 replace_in_file；大产物先写最小骨架，再分轮补充。',
      toolSerializationLine,
      readLimitLine,
      '- 不要在自然语言里粘贴大段 Markdown/源码代码块，不要一次性输出长报告；大产物分多轮通过工具落盘。',
      '- 正式既有工程任务必须继续沿既有入口、边界、线程/事件、消息协议和构建验证证据推进，不能降级成孤立 demo。',
      `- 这是第 ${input.recoveryAttempt}/${input.maxRecoveryAttempts} 次安全续跑；完成前必须有真实写盘/验证证据，完成摘要只能引用真实工具结果。`,
    ].filter(Boolean).join('\n'),
  };
}

export function shouldResetProviderSessionForRecovery(failure: AgentProviderFailure | undefined): boolean {
  const status = failure?.status?.toLowerCase();
  return Boolean(failure?.recoverable && status && (
    RECOVERABLE_RESPONSE_CORRUPTION_STATUSES.has(status)
    || status === 'stream-error'
  ));
}

function summarizeList(values: readonly string[], limit: number): string {
  const clean = values.map(value => String(value || '').trim()).filter(Boolean);
  if (clean.length === 0) return '';
  const shown = clean.slice(0, limit);
  const suffix = clean.length > shown.length ? `；另有 ${clean.length - shown.length} 项` : '';
  return `${shown.join('；')}${suffix}`;
}

function truncateSingleLine(text: string, maxChars: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 80)}...[已截断 ${clean.length - maxChars + 80} 字符]`;
}
