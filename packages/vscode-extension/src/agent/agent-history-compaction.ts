import {
  CODING_CONTEXT_COMPACTION_VERSION,
  redactCodingSecretsInText,
  renderCodingContextCompactionReceipt,
  type CodingContextCompactionReceipt,
} from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import { projectProviderNativeTextToolResponse } from '../llm/provider-native-text-tools';
import type { FakeTool } from './fake-tool-parser';
import {
  findFirstAuthorizedTextToolEnvelopeStart,
  parseAuthorizedTextToolCalls,
  stripAuthorizedTextToolEnvelopes,
  type TextToolProtocolSession,
} from './text-tool-protocol';

const MAX_TOOL_SUMMARIES = 14;
const EXECUTED_TOOL_SUMMARY_MARKER = '[DevSeek 已执行工具请求摘要]';
const QUARANTINED_PROVIDER_RESPONSE_MARKER = '[DevSeek 已隔离 Provider 响应]';
export const CONTEXT_COMPACTION_RECEIPT_PROTOCOL = CODING_CONTEXT_COMPACTION_VERSION;
export const CONTEXT_COMPACTION_SUMMARY_MARKER = '[DevSeek Canonical Context Compaction]';
const SECRET_REDACTION = '[REDACTED_SECRET]';

export type ContextCompactionReceipt = CodingContextCompactionReceipt;

export interface AgentHistoryCompactionOptions {
  receipt: CodingContextCompactionReceipt;
  maxMessages?: number;
  isProtectedMessage?: (message: ChatMessage, index: number) => boolean;
}

export function replaceLatestAssistantToolHistory(
  messages: ChatMessage[],
  textToolProtocol: TextToolProtocolSession,
  providerNativeTextTools: readonly FakeTool[] = [],
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const summarized = summarizeExecutedAssistantToolHistory(
      message.content,
      textToolProtocol,
      providerNativeTextTools,
    );
    if (summarized === message.content) return false;
    message.content = summarized;
    return true;
  }
  return false;
}

export function replaceAllAssistantToolHistory(
  messages: ChatMessage[],
  textToolProtocol: TextToolProtocolSession,
): number {
  let changed = 0;
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const summarized = summarizeExecutedAssistantToolHistory(message.content, textToolProtocol);
    if (summarized === message.content) continue;
    message.content = summarized;
    changed += 1;
  }
  return changed;
}

export function applyProviderRecoveryHistory(
  messages: ChatMessage[],
  recoveryMessage: ChatMessage,
  preserveProviderSession = false,
): void {
  if (preserveProviderSession) {
    const responseIndex = findLatestAssistantMessageIndex(messages);
    if (responseIndex >= 0) {
      messages[responseIndex].content = [
        QUARANTINED_PROVIDER_RESPONSE_MARKER,
        '该响应未通过当前工具协议门禁，未执行其中任何动作；恢复要求见下一条用户消息。',
      ].join('\n');
    }
    messages.push(recoveryMessage);
    return;
  }
  const taskPrompt = messages[0];
  messages.splice(0, messages.length, taskPrompt, recoveryMessage);
}

function findLatestAssistantMessageIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index;
  }
  return -1;
}

export function compactAgentMessageHistoryWithFidelity(
  messages: ChatMessage[],
  options: AgentHistoryCompactionOptions,
): ContextCompactionReceipt {
  const maxMessages = clampPositiveInteger(options.maxMessages, 10, 2);
  const summary = renderCodingContextCompactionReceipt(options.receipt);
  redactAgentMessageHistory(messages);
  rewriteMessagesWithContextSummary(messages, summary, options, maxMessages);
  return options.receipt;
}

export function redactAgentMessageHistory(messages: ChatMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (typeof message.content !== 'string') continue;
    const redacted = redactSecretsInText(message.content);
    count += redacted.count;
    if (redacted.text !== message.content) message.content = redacted.text;
  }
  return count;
}

export function summarizeExecutedAssistantToolHistory(
  text: string,
  textToolProtocol: TextToolProtocolSession,
  providerNativeTextTools: readonly FakeTool[] = [],
): string {
  if (text.trimStart().startsWith(EXECUTED_TOOL_SUMMARY_MARKER)) return text;
  const authorizedTools = parseAuthorizedTextToolCalls(text, textToolProtocol);
  const providerNative = authorizedTools.length === 0 && providerNativeTextTools.length > 0
    ? projectProviderNativeTextToolResponse(text)
    : undefined;
  const tools = authorizedTools.length > 0 ? authorizedTools : providerNative?.tools ?? [];
  if (!tools.length) return text;

  const firstToolIndex = findFirstAuthorizedTextToolEnvelopeStart(text, textToolProtocol);
  const prose = providerNative
    ? providerNative.prose
    : stripAuthorizedTextToolEnvelopes(
      firstToolIndex >= 0 ? text.slice(0, firstToolIndex) : text,
      textToolProtocol,
    ).trim();
  const lines = [
    EXECUTED_TOOL_SUMMARY_MARKER,
  ];
  const intent = summarizeProviderIntent(prose);
  if (intent) lines.push(`意图：${intent}`);
  lines.push(`工具调用：${tools.length} 个；真实执行结果、文件写入和验证证据见后续 [工具结果 Round]。`);

  for (const tool of tools.slice(0, MAX_TOOL_SUMMARIES)) {
    lines.push(`- ${describeToolForHistory(tool)}`);
  }
  if (tools.length > MAX_TOOL_SUMMARIES) {
    lines.push(`- 另有 ${tools.length - MAX_TOOL_SUMMARIES} 个工具调用已省略。`);
  }
  if (tools.some(hasLargeToolPayload)) {
    lines.push('大段 content/源码/Markdown 已从对话历史省略；如需细节，必须通过 read_file 读取已落盘文件。');
  }
  return lines.join('\n');
}

function summarizeProviderIntent(prose: string): string {
  const providerOnly = redactSecretsInText(String(prose || '')).text
    .split(/\[DevSeek (?:已执行工具请求摘要|上下文压缩(?:事实)?)\]|\[工具结果 Round\b/)[0];
  const cleanLines = providerOnly
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^\[DevSeek (?:已执行工具请求摘要|上下文压缩(?:事实)?)\]/.test(line))
    .filter(line => !/^\[工具结果 Round\b/.test(line))
    .filter(line => !/^(?:工具调用：|大段 content\/源码\/Markdown 已从对话历史省略)/.test(line))
    .filter(line => !/^-\s+(?:read_file|list_dir|grep_search|file_search|semantic_search|create_file|write_file|replace_in_file|apply_patch|delete_file|run_terminal)\b/.test(line))
    .filter(line => !/^意图：.*\[DevSeek 已执行工具请求摘要\]/.test(line));
  return truncateOneLine(cleanLines.slice(0, 4).join(' '), 260);
}

function describeToolForHistory(tool: FakeTool): string {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  const parts = [tool.name];
  const path = stringField(input.path);
  if (path) parts.push(`path=${path}`);
  const command = stringField(input.command);
  if (command) parts.push(`command=${truncateOneLine(redactSecretsInText(command).text, 180)}`);
  const pattern = stringField(input.pattern);
  if (pattern) parts.push(`pattern=${truncateOneLine(redactSecretsInText(pattern).text, 120)}`);
  const glob = stringField(input.glob);
  if (glob) parts.push(`glob=${glob}`);
  const startLine = numericField(input.startLine);
  const endLine = numericField(input.endLine);
  if (startLine !== undefined || endLine !== undefined) {
    parts.push(`lines=${startLine ?? ''}-${endLine ?? ''}`);
  }
  const content = stringField(input.content);
  if (content) parts.push(`contentChars=${content.length}`);
  const patch = stringField(input.patch);
  if (patch) parts.push(`patchChars=${patch.length}`);
  const todoList = Array.isArray(input.todoList) ? input.todoList : undefined;
  if (todoList) parts.push(`todos=${todoList.length}`);
  return parts.join(' ');
}

function hasLargeToolPayload(tool: FakeTool): boolean {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  return stringField(input.content).length > 0
    || stringField(input.patch).length > 0
    || stringField(input.new_str).length > 500
    || stringField(input.old_str).length > 500;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numericField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function redactSecretsInText(text: string): { text: string; count: number } {
  const redacted = redactCodingSecretsInText(text, { replacement: SECRET_REDACTION });
  return { text: redacted.text, count: redacted.redactionCount };
}

function rewriteMessagesWithContextSummary(
  messages: ChatMessage[],
  summary: string,
  options: AgentHistoryCompactionOptions,
  maxMessages: number,
): void {
  const compacted: ChatMessage[] = [];
  const seen = new Set<ChatMessage>();
  const push = (message: ChatMessage | undefined) => {
    if (!message || seen.has(message) || shouldDropFromCompactedTail(message)) return;
    seen.add(message);
    compacted.push(message);
  };

  push(messages[0]);
  if (options.isProtectedMessage) {
    const protectedMessages = messages
      .map((message, index) => ({ message, index }))
      .filter(item => options.isProtectedMessage?.(item.message, item.index))
      .map(item => item.message)
      .slice(-1);
    for (const message of protectedMessages) push(message);
  }

  const tailKeepCount = Math.max(0, maxMessages - compacted.length - 1);
  const tail = messages
    .filter(message => !seen.has(message) && !shouldDropFromCompactedTail(message))
    .slice(-tailKeepCount);
  for (const message of tail) push(message);

  const summaryMessage: ChatMessage = { role: 'user', content: summary };
  compacted.splice(Math.min(1, compacted.length), 0, summaryMessage);
  messages.splice(0, messages.length, ...compacted.slice(0, maxMessages));
}

function shouldDropFromCompactedTail(message: ChatMessage): boolean {
  if (typeof message.content !== 'string') return false;
  return isContextCompactionSummary(message.content);
}

function isContextCompactionSummary(content: string): boolean {
  const trimmed = String(content || '').trimStart();
  return trimmed.startsWith(CONTEXT_COMPACTION_SUMMARY_MARKER)
    || trimmed.startsWith('[DevSeek 上下文压缩事实]')
    || trimmed.startsWith('[DevSeek 上下文压缩]');
}

function clampPositiveInteger(value: number | undefined, fallback: number, min: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, integer);
}

function truncateOneLine(text: string, maxChars: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 24)).trimEnd()}...[截断 ${clean.length - maxChars + 24} 字符]`;
}
