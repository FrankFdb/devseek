import {
  looksLikeProviderLoginGate,
  looksLikeProviderRateLimitGate,
  looksLikeProviderVerificationGate,
} from '../provider-surface-classifier';

export type ResponseIntegrityStatus =
  | 'ok'
  | 'empty'
  // Persisted diagnostic compatibility; prose inspection no longer emits these.
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

/**
 * This boundary validates provider transport surfaces only. Ordinary assistant
 * prose is not parsed as Markdown, JSON, intent, or a tool protocol here.
 */
export class ResponseIntegrityChecker {
  check(content: string): ResponseIntegrityResult {
    const trimmed = String(content || '').trim();
    if (!trimmed) return result('empty', 'Provider returned an empty response.', false);
    if (looksLikeProviderLoginGate(trimmed)) {
      return result('login-required', 'Provider requires login before continuing.', false);
    }
    if (looksLikeProviderVerificationGate(trimmed) || looksLikeProviderRateLimitGate(trimmed)) {
      return result('rate-limited', 'Provider is rate limited or waiting for verification.', false);
    }
    return result('ok', 'Provider transport surface is complete.', true);
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
    if (!this.startedAt) return { status: 'idle', elapsedMs: 0, idleMs: 0, reason: 'not-started' };
    const elapsedMs = Math.max(0, now - this.startedAt);
    const idleMs = Math.max(0, now - this.lastChunkAt);
    if (this.finished) return { status: 'finished', elapsedMs, idleMs, reason: 'finished' };
    if (idleMs > this.stallAfterMs) return { status: 'stalled', elapsedMs, idleMs, reason: 'stream-stalled' };
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
    if (!snapshot) return health('unavailable', 'bridge-status-unavailable', false);
    if (!snapshot.browserReady) return health('unavailable', snapshot.reason || 'browser-not-ready', false);
    if (!snapshot.loggedInLikely) return health('login-required', snapshot.reason || 'login-indicator-missing', false);
    if ((snapshot.queueLength ?? 0) > 0) return health('degraded', 'bridge-queue-not-empty', true);
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
