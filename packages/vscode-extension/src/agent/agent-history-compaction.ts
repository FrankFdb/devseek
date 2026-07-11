import type { ChatMessage } from '../llm/types';
import {
  findFirstToolCallStart,
  parseFakeToolCalls,
  stripToolCallBlocks,
  type FakeTool,
} from './fake-tool-parser';

const MAX_TOOL_SUMMARIES = 14;
const EXECUTED_TOOL_SUMMARY_MARKER = '[DevSeek 已执行工具请求摘要]';

export function replaceLatestAssistantToolHistory(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const summarized = summarizeExecutedAssistantToolHistory(message.content);
    if (summarized === message.content) return false;
    message.content = summarized;
    return true;
  }
  return false;
}

export function replaceAllAssistantToolHistory(messages: ChatMessage[]): number {
  let changed = 0;
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    const summarized = summarizeExecutedAssistantToolHistory(message.content);
    if (summarized === message.content) continue;
    message.content = summarized;
    changed += 1;
  }
  return changed;
}

export function applyProviderRecoveryHistory(
  messages: ChatMessage[],
  recoveryMessage: ChatMessage,
): void {
  replaceAllAssistantToolHistory(messages);
  const taskPrompt = messages[0];
  messages.splice(0, messages.length, taskPrompt, recoveryMessage);
}

export function summarizeExecutedAssistantToolHistory(text: string): string {
  if (text.trimStart().startsWith(EXECUTED_TOOL_SUMMARY_MARKER)) return text;
  const tools = parseFakeToolCalls(text);
  if (!tools.length) return text;

  const firstToolIndex = findFirstToolCallStart(text);
  const prose = firstToolIndex >= 0
    ? stripToolCallBlocks(text.slice(0, firstToolIndex)).trim()
    : stripToolCallBlocks(text).trim();
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
  const providerOnly = String(prose || '').split(/\[DevSeek (?:已执行工具请求摘要|上下文压缩)\]|\[工具结果 Round\b/)[0];
  const cleanLines = providerOnly
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^\[DevSeek (?:已执行工具请求摘要|上下文压缩)\]/.test(line))
    .filter(line => !/^\[工具结果 Round\b/.test(line))
    .filter(line => !/^(?:工具调用：|大段 content\/源码\/Markdown 已从对话历史省略)/.test(line))
    .filter(line => !/^-\s+(?:read_file|list_dir|grep_search|file_search|semantic_search|create_file|write_file|replace_in_file|delete_file|run_terminal)\b/.test(line))
    .filter(line => !/^意图：.*\[DevSeek 已执行工具请求摘要\]/.test(line));
  return truncateOneLine(cleanLines.slice(0, 4).join(' '), 260);
}

function describeToolForHistory(tool: FakeTool): string {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  const parts = [tool.name];
  const path = stringField(input.path);
  if (path) parts.push(`path=${path}`);
  const command = stringField(input.command);
  if (command) parts.push(`command=${truncateOneLine(command, 180)}`);
  const pattern = stringField(input.pattern);
  if (pattern) parts.push(`pattern=${truncateOneLine(pattern, 120)}`);
  const glob = stringField(input.glob);
  if (glob) parts.push(`glob=${glob}`);
  const startLine = numericField(input.startLine);
  const endLine = numericField(input.endLine);
  if (startLine !== undefined || endLine !== undefined) {
    parts.push(`lines=${startLine ?? ''}-${endLine ?? ''}`);
  }
  const content = stringField(input.content);
  if (content) parts.push(`contentChars=${content.length}`);
  const todoList = Array.isArray(input.todoList) ? input.todoList : undefined;
  if (todoList) parts.push(`todos=${todoList.length}`);
  return parts.join(' ');
}

function hasLargeToolPayload(tool: FakeTool): boolean {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  return stringField(input.content).length > 0
    || stringField(input.new_str).length > 500
    || stringField(input.old_str).length > 500;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numericField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncateOneLine(text: string, maxChars: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 24)).trimEnd()}...[截断 ${clean.length - maxChars + 24} 字符]`;
}
