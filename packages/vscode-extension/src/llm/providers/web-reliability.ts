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

export class ResponseIntegrityChecker {
  check(content: string): ResponseIntegrityResult {
    const text = String(content || '');
    const trimmed = text.trim();
    if (!trimmed) {
      return result('empty', 'Provider returned an empty response.', false);
    }
    if (/\bLOGIN_REQUIRED\b|登录已失效|sign in|login required/i.test(trimmed)) {
      return result('login-required', 'Provider requires login before continuing.', false);
    }
    if (/captcha|验证码|rate limit|too many requests|排队|限流/i.test(trimmed)) {
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
  if (/\[TOOL:[A-Za-z_]\w*(?:\s*\]|\s+)\s*\{/i.test(text)) return true;
  if (CALLING_LABEL_RE.test(text)) return true;
  return /"(?:tool|name|function)"\s*:\s*"(?:read_file|grep_search|file_search|semantic_search|list_dir|get_errors|run_terminal|memory_write|get_changed_files|create_directory|fetch_webpage|vscode_listCodeUsages|run_vscode_command|create_file|write_file|replace_file|manage_todo_list|task_complete|mcp__[^"]+)"/i.test(text)
    && /"(?:arguments|input|parameters|path|filePath|command|todoList|summary|content)"\s*:/i.test(text);
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
