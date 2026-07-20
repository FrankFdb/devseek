export const DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION = 'devseek.deepseek-web-stream/v1' as const;
export const DEEPSEEK_WEB_STREAM_RESET_PREFIX = '\x00RESET\x00' as const;

export type DeepSeekStreamEvent = 'delta' | 'done' | 'error' | 'cancelled' | 'retry';
export type DeepSeekStreamErrorCategory =
  | 'login-required'
  | 'rate-limited'
  | 'cancelled'
  | 'browser-session-lost'
  | 'provider-error';

export interface DeepSeekStreamFrame {
  protocolVersion: typeof DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION;
  requestId: string;
  sequence: number;
  event: DeepSeekStreamEvent;
  done: boolean;
  delta?: string;
  error?: string;
  errorCategory?: DeepSeekStreamErrorCategory;
  attempt?: number;
  retryAfterMs?: number;
}

export interface DeepSeekStreamFrameInput {
  requestId: string;
  sequence: number;
  event?: DeepSeekStreamEvent;
  done?: boolean;
  delta?: string;
  error?: string;
  errorCategory?: DeepSeekStreamErrorCategory;
  attempt?: number;
  retryAfterMs?: number;
}

export interface BridgeStreamObservation {
  delta: string;
  done: boolean;
  duplicate: boolean;
  safeToApply: boolean;
  evidenceRefs: string[];
}

export function createDeepSeekStreamFrame(input: DeepSeekStreamFrameInput): DeepSeekStreamFrame {
  const requestId = requireNonEmptyText(input.requestId, 'requestId');
  const sequence = requirePositiveSequence(input.sequence);
  const event = input.event ?? inferEvent(input);
  const done = input.done ?? (event === 'done' || event === 'cancelled' || event === 'error');
  const frame: DeepSeekStreamFrame = {
    protocolVersion: DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION,
    requestId,
    sequence,
    event,
    done,
  };
  if (input.delta !== undefined) frame.delta = requireText(input.delta, 'delta');
  if (input.error !== undefined) frame.error = requireText(input.error, 'error');
  if (input.errorCategory !== undefined) frame.errorCategory = requireErrorCategory(input.errorCategory);
  if (input.attempt !== undefined) frame.attempt = requirePositiveSequence(input.attempt, 'attempt');
  if (input.retryAfterMs !== undefined) frame.retryAfterMs = requireNonNegativeInteger(input.retryAfterMs, 'retryAfterMs');
  return frame;
}

export function parseDeepSeekStreamFrameData(data: string): DeepSeekStreamFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error('RESPONSE_CORRUPTED:stream-malformed-frame:SSE data frame is not valid JSON.');
  }
  return requireDeepSeekStreamFrame(parsed);
}

export function requireDeepSeekStreamFrame(value: unknown): DeepSeekStreamFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RESPONSE_CORRUPTED:stream-malformed-frame:SSE data frame must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION) {
    throw new Error('RESPONSE_CORRUPTED:stream-protocol-mismatch:Unexpected Bridge stream protocol version.');
  }
  const requestId = requireNonEmptyText(record.requestId, 'requestId');
  const sequence = requirePositiveSequence(record.sequence);
  const event = requireEvent(record.event);
  const done = typeof record.done === 'boolean'
    ? record.done
    : event === 'done' || event === 'cancelled' || event === 'error';
  const frame: DeepSeekStreamFrame = {
    protocolVersion: DEEPSEEK_WEB_STREAM_PROTOCOL_VERSION,
    requestId,
    sequence,
    event,
    done,
  };
  if (record.delta !== undefined) frame.delta = requireText(record.delta, 'delta');
  if (record.error !== undefined) frame.error = requireText(record.error, 'error');
  if (record.errorCategory !== undefined) frame.errorCategory = requireErrorCategory(record.errorCategory);
  if (record.attempt !== undefined) frame.attempt = requirePositiveSequence(record.attempt, 'attempt');
  if (record.retryAfterMs !== undefined) frame.retryAfterMs = requireNonNegativeInteger(record.retryAfterMs, 'retryAfterMs');
  return frame;
}

export function classifyDeepSeekStreamErrorMessage(message: string): DeepSeekStreamErrorCategory {
  const text = message.toLowerCase();
  if (text === 'cancelled' || text.includes('cancelled by client')) return 'cancelled';
  if (text.includes('login_required') || text.includes('login required')) return 'login-required';
  if (text.includes('closed') || text.includes('target page') || text.includes('browser')) return 'browser-session-lost';
  if (
    text.includes('429')
    || text.includes('rate limit')
    || text.includes('rate-limit')
    || text.includes('too many requests')
    || text.includes('verification')
    || text.includes('captcha')
    || text.includes('验证码')
    || text.includes('安全验证')
  ) {
    return 'rate-limited';
  }
  return 'provider-error';
}

export function deepSeekStreamBackoffMs(category: DeepSeekStreamErrorCategory, attempt = 1): number | undefined {
  if (category === 'cancelled') return undefined;
  const normalizedAttempt = Math.min(Math.max(1, Math.floor(attempt)), 6);
  if (category === 'rate-limited') return 30_000 * normalizedAttempt;
  if (category === 'browser-session-lost' || category === 'login-required') return 2_000 * normalizedAttempt;
  return 1_000 * normalizedAttempt;
}

export class BridgeStreamCorrelator {
  private nextSequence = 1;
  private readonly seenFrames = new Map<number, string>();
  private accumulatedText = '';
  private finished = false;

  constructor(private readonly requestId: string) {
    requireNonEmptyText(requestId, 'requestId');
  }

  get fullText(): string {
    return this.accumulatedText;
  }

  observe(input: unknown): BridgeStreamObservation {
    const frame = requireDeepSeekStreamFrame(input);
    if (frame.requestId !== this.requestId) {
      throw new Error('RESPONSE_CORRUPTED:stream-correlation-mismatch:SSE frame belongs to a different Bridge request.');
    }

    const fingerprint = stableFrameFingerprint(frame);
    const previousFingerprint = this.seenFrames.get(frame.sequence);
    if (previousFingerprint !== undefined) {
      if (previousFingerprint === fingerprint) {
        return observation('', frame.done, true, false, 'stream-duplicate-replay');
      }
      throw new Error('RESPONSE_CORRUPTED:stream-sequence-conflict:SSE sequence was reused with different content.');
    }

    if (this.finished) {
      throw new Error('RESPONSE_CORRUPTED:stream-after-done:SSE frame arrived after terminal done.');
    }
    if (frame.sequence !== this.nextSequence) {
      throw new Error('RESPONSE_CORRUPTED:stream-out-of-order:SSE frame sequence is not contiguous.');
    }

    this.seenFrames.set(frame.sequence, fingerprint);
    this.nextSequence += 1;

    if (frame.event === 'error') {
      this.finished = true;
      throw bridgeStreamFrameError(frame);
    }
    if (frame.event === 'cancelled') {
      this.finished = true;
      return observation('', true, false, false, 'stream-cancelled');
    }
    if (frame.done || frame.event === 'done') {
      this.finished = true;
      return observation('', true, false, false, 'stream-done');
    }

    const delta = frame.delta ?? '';
    if (delta.startsWith(DEEPSEEK_WEB_STREAM_RESET_PREFIX)) {
      this.accumulatedText = delta.slice(DEEPSEEK_WEB_STREAM_RESET_PREFIX.length);
    } else {
      this.accumulatedText += delta;
    }
    return observation(delta, false, false, delta.length > 0, 'stream-delta');
  }

  assertComplete(): void {
    if (!this.finished) {
      throw new Error('RESPONSE_CORRUPTED:stream-truncated:SSE stream ended before a terminal done frame.');
    }
  }
}

function bridgeStreamFrameError(frame: DeepSeekStreamFrame): Error {
  const category = frame.errorCategory ?? classifyDeepSeekStreamErrorMessage(frame.error ?? '');
  if (category === 'login-required') return new Error('LOGIN_REQUIRED');
  if (category === 'cancelled') return new Error('Cancelled');
  const retryAfterMs = frame.retryAfterMs ?? deepSeekStreamBackoffMs(category);
  return new Error(
    `RESPONSE_CORRUPTED:stream-error:${category}:Bridge stream failed; retryAfterMs=${retryAfterMs ?? 'none'}.`,
  );
}

function inferEvent(input: DeepSeekStreamFrameInput): DeepSeekStreamEvent {
  if (input.error) return 'error';
  if (input.done) return 'done';
  return 'delta';
}

function observation(
  delta: string,
  done: boolean,
  duplicate: boolean,
  safeToApply: boolean,
  evidenceRef: string,
): BridgeStreamObservation {
  return {
    delta,
    done,
    duplicate,
    safeToApply,
    evidenceRefs: [`deepseek-stream:${evidenceRef}`],
  };
}

function stableFrameFingerprint(frame: DeepSeekStreamFrame): string {
  return JSON.stringify([
    frame.protocolVersion,
    frame.requestId,
    frame.sequence,
    frame.event,
    frame.done,
    frame.delta ?? '',
    frame.error ?? '',
    frame.errorCategory ?? '',
    frame.attempt ?? null,
    frame.retryAfterMs ?? null,
  ]);
}

function requireEvent(value: unknown): DeepSeekStreamEvent {
  if (
    value === 'delta'
    || value === 'done'
    || value === 'error'
    || value === 'cancelled'
    || value === 'retry'
  ) return value;
  throw new Error('RESPONSE_CORRUPTED:stream-malformed-frame:SSE event is unknown.');
}

function requireErrorCategory(value: unknown): DeepSeekStreamErrorCategory {
  if (
    value === 'login-required'
    || value === 'rate-limited'
    || value === 'cancelled'
    || value === 'browser-session-lost'
    || value === 'provider-error'
  ) return value;
  throw new Error('RESPONSE_CORRUPTED:stream-malformed-frame:SSE error category is unknown.');
}

function requireNonEmptyText(value: unknown, name: string): string {
  const text = requireText(value, name).trim();
  if (!text) throw new Error(`RESPONSE_CORRUPTED:stream-malformed-frame:${name} is required.`);
  return text;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`RESPONSE_CORRUPTED:stream-malformed-frame:${name} must be text.`);
  }
  return value;
}

function requirePositiveSequence(value: unknown, name = 'sequence'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`RESPONSE_CORRUPTED:stream-malformed-frame:${name} must be a positive integer.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`RESPONSE_CORRUPTED:stream-malformed-frame:${name} must be a non-negative integer.`);
  }
  return value;
}
