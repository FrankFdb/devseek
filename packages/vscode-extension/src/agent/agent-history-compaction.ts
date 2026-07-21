import { createHash } from 'crypto';
import type { ChatMessage } from '../llm/types';
import { redactProviderSecrets } from '../llm/provider-events';
import {
  findFirstToolCallStart,
  parseFakeToolCalls,
  stripToolCallBlocks,
  type FakeTool,
} from './fake-tool-parser';

const MAX_TOOL_SUMMARIES = 14;
const EXECUTED_TOOL_SUMMARY_MARKER = '[DevSeek 已执行工具请求摘要]';
export const CONTEXT_COMPACTION_RECEIPT_PROTOCOL = 'devseek.context-compaction/v1';
export const CONTEXT_COMPACTION_SUMMARY_MARKER = '[DevSeek 上下文压缩事实]';
const SECRET_REDACTION = '[REDACTED_SECRET]';
const MAX_COMPACTION_FACTS = 12;

export interface ContextCompactionReceipt {
  version: typeof CONTEXT_COMPACTION_RECEIPT_PROTOCOL;
  pass: number;
  preservedConstraints: string[];
  preservedDecisions: string[];
  redactedSecretCount: number;
  staleMemoryRejectedCount: number;
  digest: string;
}

export interface AgentHistoryCompactionOptions {
  maxMessages?: number;
  maxFacts?: number;
  isProtectedMessage?: (message: ChatMessage, index: number) => boolean;
}

interface ExtractedCompactionFacts {
  preservedConstraints: string[];
  preservedDecisions: string[];
}

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

export function compactAgentMessageHistoryWithFidelity(
  messages: ChatMessage[],
  options: AgentHistoryCompactionOptions = {},
): ContextCompactionReceipt {
  const maxMessages = clampPositiveInteger(options.maxMessages, 10, 2);
  const maxFacts = clampPositiveInteger(options.maxFacts, MAX_COMPACTION_FACTS, 1);
  const priorReceipt = readPriorContextCompactionReceipt(messages);
  let redactedSecretCount = priorReceipt.redactedSecretCount;
  let staleMemoryRejectedCount = priorReceipt.staleMemoryRejectedCount;

  for (const message of messages) {
    if (typeof message.content !== 'string') continue;
    const redacted = redactSecretsInText(message.content);
    redactedSecretCount = Math.max(redactedSecretCount, redacted.count);
    staleMemoryRejectedCount = Math.max(
      staleMemoryRejectedCount,
      countStaleMemoryLines(redacted.text),
    );
    if (redacted.text !== message.content) message.content = redacted.text;
  }

  replaceAllAssistantToolHistory(messages);
  const facts = extractCompactionFacts(messages, { maxFacts });
  const receipt: ContextCompactionReceipt = {
    version: CONTEXT_COMPACTION_RECEIPT_PROTOCOL,
    pass: priorReceipt.pass + 1,
    preservedConstraints: facts.preservedConstraints,
    preservedDecisions: facts.preservedDecisions,
    redactedSecretCount,
    staleMemoryRejectedCount,
    digest: '',
  };
  receipt.digest = digestContextCompactionReceipt(receipt);
  rewriteMessagesWithContextSummary(messages, renderContextCompactionSummary(receipt), options, maxMessages);
  return receipt;
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
  const providerOnly = redactSecretsInText(String(prose || '')).text
    .split(/\[DevSeek (?:已执行工具请求摘要|上下文压缩(?:事实)?)\]|\[工具结果 Round\b/)[0];
  const cleanLines = providerOnly
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^\[DevSeek (?:已执行工具请求摘要|上下文压缩(?:事实)?)\]/.test(line))
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

export function extractCompactionFacts(
  messages: ChatMessage[],
  options: { maxFacts?: number } = {},
): ExtractedCompactionFacts {
  const maxFacts = clampPositiveInteger(options.maxFacts, MAX_COMPACTION_FACTS, 1);
  const constraints: string[] = [];
  const decisions: string[] = [];
  const constraintKeys = new Set<string>();
  const decisionKeys = new Set<string>();
  for (const message of messages) {
    if (typeof message.content !== 'string') continue;
    const redacted = redactSecretsInText(message.content).text;
    for (const rawLine of redacted.split(/\r?\n/)) {
      const line = cleanCompactionFactLine(rawLine);
      if (!line || isContextCompactionMetadata(line) || isStaleMemoryLine(line)) continue;
      if (isDurableConstraintLine(line)) {
        pushUniqueFact(constraints, constraintKeys, line, maxFacts);
      }
      if (isDurableDecisionLine(line)) {
        pushUniqueFact(decisions, decisionKeys, line, maxFacts);
      }
    }
  }
  return { preservedConstraints: constraints, preservedDecisions: decisions };
}

export function redactSecretsInText(text: string): { text: string; count: number } {
  const normalized = String(text ?? '');
  const providerRedacted = redactProviderSecrets(normalized).replace(/\*\*\*/g, SECRET_REDACTION);
  const redacted = providerRedacted
    .replace(/-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE KEY-----/gi, SECRET_REDACTION)
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, SECRET_REDACTION)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, SECRET_REDACTION)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, SECRET_REDACTION)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, SECRET_REDACTION);
  return { text: redacted, count: countOccurrences(redacted, SECRET_REDACTION) };
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

function renderContextCompactionSummary(receipt: ContextCompactionReceipt): string {
  const lines = [
    CONTEXT_COMPACTION_SUMMARY_MARKER,
    `protocol: ${receipt.version}`,
    `pass: ${receipt.pass}`,
    'preservedConstraints:',
    ...renderFactLines(receipt.preservedConstraints),
    'preservedDecisions:',
    ...renderFactLines(receipt.preservedDecisions),
    `redactedSecretCount: ${receipt.redactedSecretCount}`,
    `staleMemoryRejectedCount: ${receipt.staleMemoryRejectedCount}`,
    `digest: ${receipt.digest}`,
  ];
  return lines.join('\n');
}

function renderFactLines(facts: string[]): string[] {
  return facts.length ? facts.map(fact => `- ${fact}`) : ['- none'];
}

function digestContextCompactionReceipt(receipt: ContextCompactionReceipt): string {
  const payload = {
    version: receipt.version,
    pass: receipt.pass,
    preservedConstraints: receipt.preservedConstraints,
    preservedDecisions: receipt.preservedDecisions,
    redactedSecretCount: receipt.redactedSecretCount,
    staleMemoryRejectedCount: receipt.staleMemoryRejectedCount,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function readPriorContextCompactionReceipt(messages: ChatMessage[]): Pick<ContextCompactionReceipt, 'pass' | 'redactedSecretCount' | 'staleMemoryRejectedCount'> {
  let pass = 0;
  let redactedSecretCount = 0;
  let staleMemoryRejectedCount = 0;
  for (const message of messages) {
    if (typeof message.content !== 'string' || !isContextCompactionSummary(message.content)) continue;
    pass = Math.max(pass, readNumericMetadata(message.content, 'pass'));
    redactedSecretCount = Math.max(redactedSecretCount, readNumericMetadata(message.content, 'redactedSecretCount'));
    staleMemoryRejectedCount = Math.max(staleMemoryRejectedCount, readNumericMetadata(message.content, 'staleMemoryRejectedCount'));
  }
  return { pass, redactedSecretCount, staleMemoryRejectedCount };
}

function readNumericMetadata(content: string, key: string): number {
  const pattern = new RegExp(`^${key}:\\s*(\\d+)`, 'mi');
  const match = pattern.exec(content);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function cleanCompactionFactLine(line: string): string {
  return truncateOneLine(String(line || '').replace(/^\s*[-*]\s*/, '').trim(), 220);
}

function pushUniqueFact(list: string[], keys: Set<string>, line: string, maxFacts: number): void {
  const key = line.toLowerCase();
  if (!line || keys.has(key) || list.length >= maxFacts) return;
  keys.add(key);
  list.push(line);
}

function isContextCompactionMetadata(line: string): boolean {
  return line === CONTEXT_COMPACTION_SUMMARY_MARKER
    || /^(?:protocol|pass|redactedSecretCount|staleMemoryRejectedCount|digest):/.test(line)
    || /^(?:preservedConstraints|preservedDecisions):$/.test(line)
    || line === 'none';
}

function isDurableConstraintLine(line: string): boolean {
  return /【关键约束】|(?:必须|不得|不要|禁止|不能|只修改|只允许|保持|不被重放|权限不扩大)|\b(?:must|must not|do not|never|only)\b/i.test(line);
}

function isDurableDecisionLine(line: string): boolean {
  return /【关键决定】|(?:决定|选择|采用|复用|唯一 owner|作为唯一 owner)|\b(?:decision|decided|chosen|selected|owner)\b/i.test(line);
}

function countStaleMemoryLines(text: string): number {
  return String(text || '').split(/\r?\n/).filter(isStaleMemoryLine).length;
}

function isStaleMemoryLine(line: string): boolean {
  return /(?:\bstale\s+memory\b|\bexpired\s+memory\b|\brevoked\s+memory\b|\bttl\s*=\s*expired\b|过期记忆|已撤销记忆)/i.test(line);
}

function shouldDropFromCompactedTail(message: ChatMessage): boolean {
  if (typeof message.content !== 'string') return false;
  return isContextCompactionSummary(message.content) || countStaleMemoryLines(message.content) > 0;
}

function isContextCompactionSummary(content: string): boolean {
  const trimmed = String(content || '').trimStart();
  return trimmed.startsWith(CONTEXT_COMPACTION_SUMMARY_MARKER)
    || trimmed.startsWith('[DevSeek 上下文压缩]');
}

function clampPositiveInteger(value: number | undefined, fallback: number, min: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, integer);
}

function countOccurrences(text: string, pattern: string): number {
  return String(text || '').split(pattern).length - 1;
}

function truncateOneLine(text: string, maxChars: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 24)).trimEnd()}...[截断 ${clean.length - maxChars + 24} 字符]`;
}
