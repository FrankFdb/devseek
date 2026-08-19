import {
  DEEPSEEK_WEB_CONNECTOR_CAPABILITIES,
  DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION,
  createDeepSeekStreamFrame,
  deepSeekStreamBackoffMs,
  type DeepSeekStreamErrorCategory,
  type DeepSeekStreamFrame,
  type DeepSeekWebConnectorAdvertisement,
} from '@devseek-netai/shared';

export const DEEPSEEK_WEB_CONNECTOR_MAX_ATTEMPTS = 2;

export type DeepSeekWebConnectorRequestState =
  | 'queued'
  | 'running'
  | 'retry-wait'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DeepSeekWebConnectorRequestSnapshot {
  readonly requestId: string;
  readonly stream: boolean;
  readonly state: DeepSeekWebConnectorRequestState;
  readonly attempt: number;
  readonly nextSequence: number;
  readonly providerDeltaCount: number;
  readonly providerSubmissionAttempt?: number;
  readonly cancelRequested: boolean;
  readonly terminalEvent?: 'done' | 'error' | 'cancelled';
}

export interface DeepSeekWebConnectorRetryDecision {
  readonly decision: 'retry' | 'stop';
  readonly reason:
    | 'bounded-retry'
    | 'submission-confirmed'
    | 'partial-output'
    | 'non-retryable'
    | 'budget-exhausted'
    | 'cancelled';
  readonly retryAfterMs?: number;
  readonly frame?: DeepSeekStreamFrame;
}

export interface DeepSeekWebConnectorCancelDecision {
  readonly decision: 'accepted' | 'not-found' | 'ambiguous' | 'already-terminal';
  readonly requestId?: string;
  readonly shouldInterruptProvider: boolean;
}

export interface DeepSeekWebConnectorSessionPort {
  readonly requestId: string;
  beginAttempt(): number;
  confirmProviderSubmission(): void;
  acceptProviderDelta(rawDelta: string, releasedDelta: string): DeepSeekStreamFrame | undefined;
  decideRetry(category: DeepSeekStreamErrorCategory): DeepSeekWebConnectorRetryDecision;
  rejectBeforeDispatch(message: string, category: DeepSeekStreamErrorCategory): DeepSeekStreamFrame;
  complete(): DeepSeekStreamFrame;
  fail(message: string, category: DeepSeekStreamErrorCategory): DeepSeekStreamFrame;
  settleCancelled(): DeepSeekStreamFrame;
  requestCancel(): boolean;
  assertDispatchable(): void;
  snapshot(): DeepSeekWebConnectorRequestSnapshot;
}

export interface DeepSeekWebConnectorPort {
  advertisement(): DeepSeekWebConnectorAdvertisement;
  open(input: { readonly requestId: string; readonly stream: boolean }): DeepSeekWebConnectorSessionPort;
  cancel(requestId?: string): DeepSeekWebConnectorCancelDecision;
  activeRequests(): readonly DeepSeekWebConnectorRequestSnapshot[];
}

export interface DeepSeekWebConnectorExclusiveExecutionPort {
  execute<T>(operation: () => Promise<T>, requestId?: string): Promise<T>;
}

export interface DeepSeekWebConnectorExecutionOptions {
  readonly exclusive: DeepSeekWebConnectorExclusiveExecutionPort;
  readonly classifyError: (error: unknown) => DeepSeekStreamErrorCategory;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface DeepSeekWebConnectorExecutionObserver {
  readonly onAttemptStarted?: (attempt: number) => void;
  readonly onRetryScheduled?: (decision: DeepSeekWebConnectorRetryDecision) => void;
  readonly onRetryFrame?: (frame: DeepSeekStreamFrame) => void;
}

export class DeepSeekWebConnectorCancelledError extends Error {
  constructor(readonly requestId: string) {
    super('Cancelled');
    this.name = 'DeepSeekWebConnectorCancelledError';
  }
}

/** Keeps one browser-backed request exclusive across its complete bounded retry lifecycle. */
export class CanonicalDeepSeekWebConnectorExecutionService {
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: DeepSeekWebConnectorExecutionOptions) {
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  execute<T>(
    session: DeepSeekWebConnectorSessionPort,
    operation: (attempt: number) => Promise<T>,
    observer: DeepSeekWebConnectorExecutionObserver = {},
  ): Promise<T> {
    return this.options.exclusive.execute(async () => {
      while (true) {
        try {
          const attempt = session.beginAttempt();
          notifyExecutionObserver(observer.onAttemptStarted, attempt);
          session.assertDispatchable();
          return await operation(attempt);
        } catch (error) {
          if (error instanceof DeepSeekWebConnectorCancelledError) throw error;
          const snapshot = session.snapshot();
          if (snapshot.state !== 'running') throw error;
          const retry = session.decideRetry(this.options.classifyError(error));
          if (retry.decision !== 'retry') throw error;
          notifyExecutionObserver(observer.onRetryScheduled, retry);
          if (retry.frame) notifyExecutionObserver(observer.onRetryFrame, retry.frame);
          await this.sleep(retry.retryAfterMs ?? 0);
        }
      }
    }, session.requestId);
  }
}

function notifyExecutionObserver<T>(observer: ((value: T) => void) | undefined, value: T): void {
  try {
    observer?.(value);
  } catch {
    // Diagnostics must never alter provider execution or retry semantics.
  }
}

export class CanonicalDeepSeekWebConnectorService implements DeepSeekWebConnectorPort {
  private readonly active = new Map<string, CanonicalDeepSeekWebConnectorSession>();
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  advertisement(): DeepSeekWebConnectorAdvertisement {
    return Object.freeze({
      protocolVersion: DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION,
      provider: 'deepseek-web',
      capabilities: DEEPSEEK_WEB_CONNECTOR_CAPABILITIES,
      maxAttempts: DEEPSEEK_WEB_CONNECTOR_MAX_ATTEMPTS,
      activeRequestCount: this.active.size,
    });
  }

  open(input: { readonly requestId: string; readonly stream: boolean }): DeepSeekWebConnectorSessionPort {
    const requestId = requireRequestId(input.requestId);
    if (this.seen.has(requestId)) throw new Error('deepseek-web-connector:duplicate-request-id');
    this.remember(requestId);
    const session = new CanonicalDeepSeekWebConnectorSession(
      requestId,
      input.stream === true,
      () => this.active.delete(requestId),
    );
    this.active.set(requestId, session);
    return session;
  }

  cancel(requestId?: string): DeepSeekWebConnectorCancelDecision {
    const target = String(requestId ?? '').trim();
    if (target && !this.active.has(target)) {
      return Object.freeze({
        decision: this.seen.has(target) ? 'already-terminal' : 'not-found',
        requestId: target,
        shouldInterruptProvider: false,
      });
    }
    const candidates = target
      ? [this.active.get(target)!]
      : [...this.active.values()];
    if (candidates.length === 0) {
      return Object.freeze({ decision: 'not-found', shouldInterruptProvider: false });
    }
    if (candidates.length > 1) {
      return Object.freeze({ decision: 'ambiguous', shouldInterruptProvider: false });
    }
    const session = candidates[0];
    const shouldInterruptProvider = session.requestCancel();
    return Object.freeze({
      decision: 'accepted',
      requestId: session.requestId,
      shouldInterruptProvider,
    });
  }

  activeRequests(): readonly DeepSeekWebConnectorRequestSnapshot[] {
    return Object.freeze([...this.active.values()].map(session => session.snapshot()));
  }

  private remember(requestId: string): void {
    this.seen.add(requestId);
    this.seenOrder.push(requestId);
    while (this.seenOrder.length > 512) {
      const expired = this.seenOrder.shift();
      if (expired) this.seen.delete(expired);
    }
  }
}

class CanonicalDeepSeekWebConnectorSession implements DeepSeekWebConnectorSessionPort {
  private state: DeepSeekWebConnectorRequestState = 'queued';
  private attempt = 0;
  private nextSequence = 1;
  private providerDeltaCount = 0;
  private providerSubmissionAttempt: number | undefined;
  private cancelRequested = false;
  private terminalEvent: 'done' | 'error' | 'cancelled' | undefined;

  constructor(
    readonly requestId: string,
    private readonly stream: boolean,
    private readonly onTerminal: () => void,
  ) {}

  beginAttempt(): number {
    this.assertDispatchable();
    if (this.providerSubmissionAttempt !== undefined) {
      throw new Error('deepseek-web-connector:provider-request-already-submitted');
    }
    if (this.state !== 'queued' && this.state !== 'retry-wait') {
      throw new Error('deepseek-web-connector:attempt-state-invalid');
    }
    if (this.attempt >= DEEPSEEK_WEB_CONNECTOR_MAX_ATTEMPTS) {
      throw new Error('deepseek-web-connector:attempt-budget-exhausted');
    }
    this.attempt += 1;
    this.state = 'running';
    return this.attempt;
  }

  confirmProviderSubmission(): void {
    this.requireRunning();
    if (this.providerSubmissionAttempt === undefined) {
      this.providerSubmissionAttempt = this.attempt;
      return;
    }
    if (this.providerSubmissionAttempt !== this.attempt) {
      throw new Error('deepseek-web-connector:provider-submission-attempt-mismatch');
    }
  }

  acceptProviderDelta(rawDelta: string, releasedDelta: string): DeepSeekStreamFrame | undefined {
    this.requireRunning();
    if (this.cancelRequested) throw new DeepSeekWebConnectorCancelledError(this.requestId);
    if (typeof rawDelta !== 'string' || typeof releasedDelta !== 'string') {
      throw new Error('deepseek-web-connector:delta-invalid');
    }
    if (rawDelta.length > 0) this.providerDeltaCount += 1;
    if (!this.stream || !releasedDelta) return undefined;
    return this.nextFrame({
      event: 'delta',
      delta: releasedDelta,
      done: false,
      attempt: this.attempt,
    });
  }

  decideRetry(category: DeepSeekStreamErrorCategory): DeepSeekWebConnectorRetryDecision {
    this.requireRunning();
    if (this.cancelRequested || category === 'cancelled') {
      return Object.freeze({ decision: 'stop', reason: 'cancelled' });
    }
    if (this.providerSubmissionAttempt !== undefined) {
      return Object.freeze({ decision: 'stop', reason: 'submission-confirmed' });
    }
    if (this.providerDeltaCount > 0) {
      return Object.freeze({ decision: 'stop', reason: 'partial-output' });
    }
    if (category !== 'provider-error') {
      return Object.freeze({ decision: 'stop', reason: 'non-retryable' });
    }
    if (this.attempt >= DEEPSEEK_WEB_CONNECTOR_MAX_ATTEMPTS) {
      return Object.freeze({ decision: 'stop', reason: 'budget-exhausted' });
    }
    const retryAfterMs = deepSeekStreamBackoffMs(category, this.attempt) ?? 1_000;
    this.state = 'retry-wait';
    const frame = this.stream
      ? this.nextFrame({
          event: 'retry',
          delta: '',
          done: false,
          attempt: this.attempt + 1,
          retryAfterMs,
        })
      : undefined;
    return Object.freeze({
      decision: 'retry',
      reason: 'bounded-retry',
      retryAfterMs,
      ...(frame ? { frame } : {}),
    });
  }

  complete(): DeepSeekStreamFrame {
    this.requireRunning();
    if (this.cancelRequested) return this.settleCancelled();
    return this.settle('completed', 'done', { event: 'done', delta: '', done: true, attempt: this.attempt });
  }

  rejectBeforeDispatch(message: string, category: DeepSeekStreamErrorCategory): DeepSeekStreamFrame {
    if (this.state !== 'queued') {
      throw new Error('deepseek-web-connector:request-already-dispatched');
    }
    if (this.cancelRequested || category === 'cancelled') return this.settleCancelled();
    return this.settle('failed', 'error', {
      event: 'error',
      delta: '',
      done: true,
      error: String(message || 'DeepSeek Web request failed before dispatch'),
      errorCategory: category,
      attempt: 1,
      retryAfterMs: deepSeekStreamBackoffMs(category),
    });
  }

  fail(message: string, category: DeepSeekStreamErrorCategory): DeepSeekStreamFrame {
    this.requireRunning();
    if (this.cancelRequested || category === 'cancelled') return this.settleCancelled();
    return this.settle('failed', 'error', {
      event: 'error',
      delta: '',
      done: true,
      error: String(message || 'DeepSeek Web request failed'),
      errorCategory: category,
      attempt: this.attempt,
      retryAfterMs: deepSeekStreamBackoffMs(category, this.attempt),
    });
  }

  settleCancelled(): DeepSeekStreamFrame {
    if (isTerminal(this.state)) throw new Error('deepseek-web-connector:terminal-already-settled');
    return this.settle('cancelled', 'cancelled', {
      event: 'cancelled',
      delta: '',
      done: true,
      errorCategory: 'cancelled',
      attempt: Math.max(1, this.attempt),
    });
  }

  requestCancel(): boolean {
    if (isTerminal(this.state)) return false;
    this.cancelRequested = true;
    return this.state === 'running';
  }

  assertDispatchable(): void {
    if (this.cancelRequested) throw new DeepSeekWebConnectorCancelledError(this.requestId);
    if (isTerminal(this.state)) throw new Error('deepseek-web-connector:request-terminal');
  }

  snapshot(): DeepSeekWebConnectorRequestSnapshot {
    return Object.freeze({
      requestId: this.requestId,
      stream: this.stream,
      state: this.state,
      attempt: this.attempt,
      nextSequence: this.nextSequence,
      providerDeltaCount: this.providerDeltaCount,
      ...(this.providerSubmissionAttempt !== undefined
        ? { providerSubmissionAttempt: this.providerSubmissionAttempt }
        : {}),
      cancelRequested: this.cancelRequested,
      ...(this.terminalEvent ? { terminalEvent: this.terminalEvent } : {}),
    });
  }

  private requireRunning(): void {
    if (this.state !== 'running') throw new Error('deepseek-web-connector:request-not-running');
  }

  private settle(
    state: Extract<DeepSeekWebConnectorRequestState, 'completed' | 'failed' | 'cancelled'>,
    terminalEvent: 'done' | 'error' | 'cancelled',
    frame: Parameters<CanonicalDeepSeekWebConnectorSession['nextFrame']>[0],
  ): DeepSeekStreamFrame {
    if (isTerminal(this.state)) throw new Error('deepseek-web-connector:terminal-already-settled');
    const terminalFrame = this.nextFrame(frame);
    this.state = state;
    this.terminalEvent = terminalEvent;
    this.onTerminal();
    return terminalFrame;
  }

  private nextFrame(
    input: Omit<Parameters<typeof createDeepSeekStreamFrame>[0], 'requestId' | 'sequence'>,
  ): DeepSeekStreamFrame {
    const frame = createDeepSeekStreamFrame({
      requestId: this.requestId,
      sequence: this.nextSequence,
      ...input,
    });
    this.nextSequence += 1;
    return frame;
  }
}

function isTerminal(state: DeepSeekWebConnectorRequestState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function requireRequestId(value: string): string {
  const requestId = String(value ?? '').trim();
  if (!requestId || requestId.length > 256 || /[\r\n\0]/u.test(requestId)) {
    throw new Error('deepseek-web-connector:request-id-invalid');
  }
  return requestId;
}
