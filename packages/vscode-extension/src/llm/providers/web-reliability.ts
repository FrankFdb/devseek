export type ResponseIntegrityStatus =
  | 'ok'
  | 'empty'
  | 'unclosed-markdown-fence'
  | 'incomplete-tool-block'
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
    if (looksLikeWholeJson(trimmed) && !canParseJson(trimmed)) {
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
  const openToolIndex = text.search(/\[TOOL:[A-Za-z_]\w*/);
  if (openToolIndex < 0) return false;
  const tail = text.slice(openToolIndex);
  const jsonStart = tail.indexOf('{');
  if (jsonStart < 0) return true;
  return findJsonObjectEndAt(tail, jsonStart) < 0;
}

function looksLikeWholeJson(text: string): boolean {
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
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
