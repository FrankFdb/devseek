import { listAgentToolNames } from '../../agent/tool-registry';
import { hasIncompleteFakeToolCallProtocol } from '../../agent/fake-tool-parser';
import {
  looksLikeProviderLoginGate,
  looksLikeProviderRateLimitGate,
  looksLikeProviderVerificationGate,
} from '../provider-surface-classifier';

export type ResponseIntegrityStatus =
  | 'ok'
  | 'empty'
  | 'unclosed-markdown-fence'
  | 'incomplete-tool-block'
  | 'incomplete-assistant-intent'
  | 'invalid-json-response'
  | 'login-required'
  | 'rate-limited';

export interface ResponseIntegrityResult {
  ok: boolean;
  status: ResponseIntegrityStatus;
  reason: string;
  safeToExecute: boolean;
  evidenceRefs: string[];
}

const CALLING_LABEL_RE = /(?:^|\n)\s*(?:\[\s*)?[*_]{0,3}(?:Calling|Call|调用)(?:[ \t]*[:：]?[ \t]*tool\b|[ \t]+tool\b)?[ \t]*[:：]?[ \t]*[*_]{0,3}[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?/i;
const CALLING_LINE_RE = /^\s*(?:\[\s*)?[*_]{0,3}\s*(?:Calling|Call|调用)\b/i;
const REGISTERED_TOOL_NAMES_PATTERN = listAgentToolNames(true)
  .map(escapeRegExp)
  .sort((a, b) => b.length - a.length)
  .join('|');
const MODEL_TOOL_NAME_PATTERN = `(?:${REGISTERED_TOOL_NAMES_PATTERN}|mcp__[A-Za-z0-9_]+)`;
const XML_MODEL_TOOL_NAME_PATTERN = `(?:TOOL_)?${MODEL_TOOL_NAME_PATTERN}`;
const BRACKET_TOOL_PAYLOAD_RE = new RegExp(`\\[TOOL:${MODEL_TOOL_NAME_PATTERN}(?:\\s*\\]|\\s+)\\s*\\{`, 'i');
const JSON_TOOL_NAME_RE = new RegExp(`"(?:tool|name|function|type)"\\s*:\\s*"${MODEL_TOOL_NAME_PATTERN}"`, 'i');
const TOOL_INPUT_FIELD_RE = /"(?:arguments|input|parameters|path|filePath|command|todoList|summary|content)"\s*:/i;
const REACT_ACTION_ONLY_TAIL_RE = new RegExp(`(?:^|\\n|\\s)Action\\s*:\\s*${MODEL_TOOL_NAME_PATTERN}\\s*$`, 'i');
const REACT_ACTION_INPUT_EMPTY_TAIL_RE = new RegExp(`(?:^|\\n|\\s)Action\\s*:\\s*${MODEL_TOOL_NAME_PATTERN}[\\s\\S]*Action\\s*Input\\s*:\\s*$`, 'i');
const CALLING_TOOL_ONLY_TAIL_RE = new RegExp(`(?:^|\\n)\\s*(?:\\[\\s*)?[*_]{0,3}\\s*(?:Calling|Call|调用)(?:[ \\t]*[:：]?[ \\t]*tool\\b|[ \\t]+tool\\b)?[ \\t]*[:：][ \\t]*[*_]{0,3}[ \\t]*\\[?\`?${MODEL_TOOL_NAME_PATTERN}\`?\\]?\\s*[*_]{0,3}\\s*$`, 'i');
const TOOL_CALL_ENVELOPE_TAIL_RE = /(?:<|&lt;)\s*(?:T|TO|TOO|TOOL|TOOL_|TOOL_C|TOOL_CA|TOOL_CAL|TOOL_CALLS?)?$/i;
const TOOL_CALL_ENVELOPE_OPEN_RE = /(?:<|&lt;)\s*TOOL_CALLS?\b/gi;
const TOOL_CALL_ENVELOPE_CLOSE_RE = /(?:<\/|&lt;\/)\s*TOOL_CALLS?\s*(?:>|&gt;)/gi;
const XML_REGISTERED_TOOL_OPEN_RE = new RegExp(`(?:<|&lt;)\\s*(${XML_MODEL_TOOL_NAME_PATTERN})\\b[^<>]*(?:>|&gt;)?`, 'gi');

export class ResponseIntegrityChecker {
  check(content: string): ResponseIntegrityResult {
    const text = String(content || '');
    const trimmed = text.trim();
    if (!trimmed) {
      return result('empty', 'Provider returned an empty response.', false);
    }
    if (looksLikeProviderLoginGate(trimmed)) {
      return result('login-required', 'Provider requires login before continuing.', false);
    }
    if (looksLikeProviderVerificationGate(trimmed) || looksLikeProviderRateLimitGate(trimmed)) {
      return result('rate-limited', 'Provider is rate limited or waiting for verification.', false);
    }
    if (hasUnclosedMarkdownFence(trimmed)) {
      return result('unclosed-markdown-fence', 'Markdown code fence is not closed; response may be truncated.', false);
    }
    if (hasIncompleteToolBlock(trimmed)) {
      return result('incomplete-tool-block', 'Tool block is incomplete; response must not enter tool normalization.', false);
    }
    if (hasIncompleteAssistantIntent(trimmed)) {
      return result('incomplete-assistant-intent', 'Assistant response ends with an unfinished action cue; response may still be streaming.', false);
    }
    if (looksLikeWholeJson(trimmed) && !canParseJson(trimmed) && !looksLikeToolProtocolPayload(trimmed)) {
      return result('invalid-json-response', 'Whole response looks like JSON but cannot be parsed.', false);
    }
    return result('ok', 'Response integrity checks passed.', true);
  }

  assertSafeForExecution(content: string): void {
    const integrity = this.check(content);
    if (!integrity.safeToExecute) {
      const error = new Error(`RESPONSE_CORRUPTED:${integrity.status}:${integrity.reason}`);
      (error as Error & { integrity?: ResponseIntegrityResult }).integrity = integrity;
      throw error;
    }
  }
}

export interface StreamWatchdogState {
  status: 'idle' | 'streaming' | 'stalled' | 'finished';
  elapsedMs: number;
  idleMs: number;
  reason: string;
}

export class StreamWatchdog {
  private startedAt = 0;
  private lastChunkAt = 0;
  private finished = false;

  constructor(private readonly stallAfterMs = 30_000) {}

  start(now = Date.now()): void {
    this.startedAt = now;
    this.lastChunkAt = now;
    this.finished = false;
  }

  observeChunk(_chunk: string, now = Date.now()): StreamWatchdogState {
    if (!this.startedAt) this.start(now);
    this.lastChunkAt = now;
    return this.state(now);
  }

  finish(now = Date.now()): StreamWatchdogState {
    if (!this.startedAt) this.start(now);
    this.finished = true;
    return this.state(now);
  }

  state(now = Date.now()): StreamWatchdogState {
    if (!this.startedAt) {
      return { status: 'idle', elapsedMs: 0, idleMs: 0, reason: 'not-started' };
    }
    const elapsedMs = Math.max(0, now - this.startedAt);
    const idleMs = Math.max(0, now - this.lastChunkAt);
    if (this.finished) {
      return { status: 'finished', elapsedMs, idleMs, reason: 'finished' };
    }
    if (idleMs > this.stallAfterMs) {
      return { status: 'stalled', elapsedMs, idleMs, reason: 'stream-stalled' };
    }
    return { status: 'streaming', elapsedMs, idleMs, reason: 'receiving' };
  }
}

export interface BridgeHealthSnapshot {
  browserReady: boolean;
  loggedInLikely: boolean;
  reason?: string;
  queueLength?: number;
}

export interface BridgeHealthDecision {
  status: 'ok' | 'login-required' | 'unavailable' | 'degraded';
  reason: string;
  canSendPrompt: boolean;
  evidenceRefs: string[];
}

export class BridgeHealthMonitor {
  evaluate(snapshot: BridgeHealthSnapshot | null | undefined): BridgeHealthDecision {
    if (!snapshot) {
      return health('unavailable', 'bridge-status-unavailable', false);
    }
    if (!snapshot.browserReady) {
      return health('unavailable', snapshot.reason || 'browser-not-ready', false);
    }
    if (!snapshot.loggedInLikely) {
      return health('login-required', snapshot.reason || 'login-indicator-missing', false);
    }
    if ((snapshot.queueLength ?? 0) > 0) {
      return health('degraded', 'bridge-queue-not-empty', true);
    }
    return health('ok', snapshot.reason || 'bridge-ready', true);
  }
}

function result(status: ResponseIntegrityStatus, reason: string, safeToExecute: boolean): ResponseIntegrityResult {
  return {
    ok: safeToExecute,
    status,
    reason,
    safeToExecute,
    evidenceRefs: [`response-integrity:${status}`],
  };
}

function health(status: BridgeHealthDecision['status'], reason: string, canSendPrompt: boolean): BridgeHealthDecision {
  return {
    status,
    reason,
    canSendPrompt,
    evidenceRefs: [`bridge-health:${status}:${reason}`],
  };
}

function hasUnclosedMarkdownFence(text: string): boolean {
  const matches = text.match(/```/g);
  return Boolean(matches && matches.length % 2 === 1);
}

function hasIncompleteToolBlock(text: string): boolean {
  if (hasIncompleteModelToolProtocol(text)) return true;
  if (/<tool_calls?>/i.test(text) && !/<\/tool_calls?>/i.test(text)) return true;
  const toolRe = /\[TOOL:([A-Za-z_]\w*)/g;
  let match: RegExpExecArray | null;
  while ((match = toolRe.exec(text)) !== null) {
    const name = match[1];
    const jsonStart = text.indexOf('{', toolRe.lastIndex);
    if (jsonStart < 0) return true;
    const strictEnd = findJsonObjectEndAt(text, jsonStart);
    if (strictEnd >= 0) {
      toolRe.lastIndex = strictEnd + 1;
      continue;
    }
    const looseEnd = findLooseFileWriteObjectEndAt(text, name, jsonStart);
    if (looseEnd >= 0) {
      toolRe.lastIndex = looseEnd + 1;
      continue;
    }
    return true;
  }
  return false;
}

function hasIncompleteModelToolProtocol(text: string): boolean {
  if (hasIncompleteFakeToolCallProtocol(text)) return true;
  if (REACT_ACTION_ONLY_TAIL_RE.test(text)) return true;
  if (REACT_ACTION_INPUT_EMPTY_TAIL_RE.test(text)) return true;
  if (CALLING_TOOL_ONLY_TAIL_RE.test(text)) return true;
  if (hasIncompleteToolCallEnvelope(text)) return true;
  if (hasIncompleteRegisteredXmlTool(text)) return true;
  return false;
}

function hasIncompleteToolCallEnvelope(text: string): boolean {
  if (TOOL_CALL_ENVELOPE_TAIL_RE.test(text)) return true;
  const openCount = countMatches(text, TOOL_CALL_ENVELOPE_OPEN_RE);
  if (openCount === 0) return false;
  return openCount > countMatches(text, TOOL_CALL_ENVELOPE_CLOSE_RE);
}

function hasIncompleteRegisteredXmlTool(text: string): boolean {
  XML_REGISTERED_TOOL_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_REGISTERED_TOOL_OPEN_RE.exec(text)) !== null) {
    const openTag = match[0];
    if (!hasXmlTagTerminator(openTag)) return true;
    if (isSelfClosingXmlTag(openTag)) continue;
    const toolName = match[1];
    const closeRe = new RegExp(`(?:<\\/|&lt;\\/)\\s*${escapeRegExp(toolName)}\\s*(?:>|&gt;)`, 'i');
    if (closeRe.test(text.slice(XML_REGISTERED_TOOL_OPEN_RE.lastIndex))) continue;
    if (hasCompleteJsonPayloadAfterXmlToolOpen(text, XML_REGISTERED_TOOL_OPEN_RE.lastIndex)) continue;
    return true;
  }
  return false;
}

function hasCompleteJsonPayloadAfterXmlToolOpen(text: string, start: number): boolean {
  let i = start;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  if (text[i] !== '{') return false;
  return findJsonObjectEndAt(text, i) >= 0;
}

function hasXmlTagTerminator(tag: string): boolean {
  return /(?:>|&gt;)\s*$/.test(tag);
}

function isSelfClosingXmlTag(tag: string): boolean {
  return /\/\s*(?:>|&gt;)\s*$/.test(tag);
}

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let count = 0;
  while (re.exec(text) !== null) count++;
  return count;
}

function hasIncompleteAssistantIntent(text: string): boolean {
  if (looksLikeToolProtocolPayload(text)) return false;
  const tail = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join('\n');
  if (!tail) return false;
  return /(?:让我|我来|接下来|下面|现在|首先|然后|继续|需要|将|准备)[\s\S]{0,120}(?:修复|修改|更新|创建|写入|执行|读取|查看|检查|编译|运行|调用|处理)[\s\S]{0,80}[：:]\s*$/i.test(tail);
}

function looksLikeWholeJson(text: string): boolean {
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
}

function looksLikeToolProtocolPayload(text: string): boolean {
  if (BRACKET_TOOL_PAYLOAD_RE.test(text)) return true;
  if (CALLING_LABEL_RE.test(text)) return true;
  return JSON_TOOL_NAME_RE.test(text) && TOOL_INPUT_FIELD_RE.test(text);
}

function canParseJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function findJsonObjectEndAt(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const LOOSE_FILE_WRITE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file']);
const LOOSE_FILE_WRITE_PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'];
const LOOSE_FILE_WRITE_CONTENT_KEYS = [
  'content', 'contents', 'text', 'body',
  'fileContent', 'file_content', 'source', 'code', 'newContent', 'new_content',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLooseJsonStringFieldValueStart(text: string, objectStart: number, keys: readonly string[]): number {
  const header = text.slice(objectStart, Math.min(text.length, objectStart + 4000));
  for (const key of keys) {
    const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'i');
    const match = keyRe.exec(header);
    if (match) return objectStart + match.index + match[0].length;
  }
  return -1;
}

function isEscapedQuote(text: string, quoteIndex: number, valueStart: number): boolean {
  let slashCount = 0;
  for (let i = quoteIndex - 1; i >= valueStart && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}

function findLooseObjectCloseAfterString(text: string, afterStringQuote: number): number {
  let i = afterStringQuote;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  if (text[i] !== '}') return -1;
  const closeBrace = i;
  i++;
  let sawLineBreak = false;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) {
    if (text[i] === '\n' || text[i] === '\r') sawLineBreak = true;
    i++;
  }
  if (i >= text.length || text[i] === ']' || sawLineBreak) return closeBrace;
  if (text.startsWith('[TOOL:', i) || text.startsWith('```', i)) return closeBrace;
  if (CALLING_LINE_RE.test(text.slice(i, i + 30))) return closeBrace;
  return -1;
}

function findLooseFileWriteObjectEndAt(text: string, name: string, jsonStart: number): number {
  if (!LOOSE_FILE_WRITE_TOOL_NAMES.has(name) || text[jsonStart] !== '{') return -1;
  if (findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_FILE_WRITE_PATH_KEYS) < 0) return -1;
  const contentValueStart = findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_FILE_WRITE_CONTENT_KEYS);
  if (contentValueStart < 0) return -1;

  for (let i = contentValueStart; i < text.length; i++) {
    if (text[i] !== '"' || isEscapedQuote(text, i, contentValueStart)) continue;
    const close = findLooseObjectCloseAfterString(text, i + 1);
    if (close >= 0) return close;
  }
  return -1;
}
