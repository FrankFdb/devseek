import type { CodingTerminalStatus } from './coding-conformance';
import type { CodingKernelSurface } from './coding-kernel';

export const CODING_RUN_LIFECYCLE_VERSION = 'devseek.coding-run-lifecycle/v1' as const;

export type CodingRunActiveStatus = 'accepted' | 'running' | 'waiting-user';
export type CodingRunLifecycleStatus = CodingRunActiveStatus | CodingTerminalStatus;
export type CodingRunLifecycleCause =
  | 'task-accepted'
  | 'execution-dispatched'
  | 'user-input-required'
  | 'user-input-received'
  | 'runtime-completed'
  | 'runtime-failed'
  | 'authority-blocked'
  | 'cancellation-observed';

export interface CodingRunLifecycleEvent {
  readonly version: typeof CODING_RUN_LIFECYCLE_VERSION;
  readonly runId: string;
  readonly surface: CodingKernelSurface;
  readonly sequence: number;
  readonly from: CodingRunLifecycleStatus | null;
  readonly to: CodingRunLifecycleStatus;
  readonly cause: CodingRunLifecycleCause;
}

export interface CodingRunLifecycleSnapshot {
  readonly version: typeof CODING_RUN_LIFECYCLE_VERSION;
  readonly runId: string;
  readonly surface: CodingKernelSurface;
  readonly status: CodingRunLifecycleStatus;
  readonly terminal: boolean;
  readonly events: readonly CodingRunLifecycleEvent[];
}

export interface RunLifecycleSessionPort {
  readonly runId: string;
  readonly surface: CodingKernelSurface;
  beginExecution(): CodingRunLifecycleEvent;
  waitForUser(): CodingRunLifecycleEvent;
  resumeExecution(): CodingRunLifecycleEvent;
  settle(status: CodingTerminalStatus): CodingRunLifecycleEvent;
  snapshot(): CodingRunLifecycleSnapshot;
}

export interface RunLifecyclePort {
  start(input: {
    readonly runId: string;
    readonly surface: CodingKernelSurface;
  }): RunLifecycleSessionPort;
}

/**
 * Unique authority for coding-run state transitions. It records facts only;
 * completion policy remains owned by the canonical completion service.
 */
export class CanonicalRunLifecycleService implements RunLifecyclePort {
  start(input: {
    readonly runId: string;
    readonly surface: CodingKernelSurface;
  }): RunLifecycleSessionPort {
    return new CanonicalRunLifecycleSession(input.runId, input.surface);
  }
}

class CanonicalRunLifecycleSession implements RunLifecycleSessionPort {
  readonly runId: string;
  readonly surface: CodingKernelSurface;
  private status: CodingRunLifecycleStatus = 'accepted';
  private readonly events: CodingRunLifecycleEvent[] = [];

  constructor(runId: string, surface: CodingKernelSurface) {
    this.runId = runId;
    this.surface = surface;
    this.events.push(this.event(null, 'accepted', 'task-accepted'));
  }

  beginExecution(): CodingRunLifecycleEvent {
    return this.transition('running', 'execution-dispatched', ['accepted']);
  }

  waitForUser(): CodingRunLifecycleEvent {
    return this.transition('waiting-user', 'user-input-required', ['running']);
  }

  resumeExecution(): CodingRunLifecycleEvent {
    return this.transition('running', 'user-input-received', ['waiting-user']);
  }

  settle(status: CodingTerminalStatus): CodingRunLifecycleEvent {
    const cause = settlementCause(status);
    const allowedFrom: CodingRunLifecycleStatus[] = status === 'completed'
      ? ['running', 'waiting-user']
      : ['accepted', 'running', 'waiting-user'];
    return this.transition(status, cause, allowedFrom);
  }

  snapshot(): CodingRunLifecycleSnapshot {
    const events = Object.freeze(this.events.map(event => Object.freeze({ ...event })));
    return Object.freeze({
      version: CODING_RUN_LIFECYCLE_VERSION,
      runId: this.runId,
      surface: this.surface,
      status: this.status,
      terminal: isTerminalStatus(this.status),
      events,
    });
  }

  private transition(
    next: CodingRunLifecycleStatus,
    cause: CodingRunLifecycleCause,
    allowedFrom: readonly CodingRunLifecycleStatus[],
  ): CodingRunLifecycleEvent {
    if (!allowedFrom.includes(this.status)) {
      throw new Error(`coding-run-lifecycle:invalid-transition:${this.status}->${next}`);
    }
    const event = this.event(this.status, next, cause);
    this.status = next;
    this.events.push(event);
    return event;
  }

  private event(
    from: CodingRunLifecycleStatus | null,
    to: CodingRunLifecycleStatus,
    cause: CodingRunLifecycleCause,
  ): CodingRunLifecycleEvent {
    return Object.freeze({
      version: CODING_RUN_LIFECYCLE_VERSION,
      runId: this.runId,
      surface: this.surface,
      sequence: this.events.length + 1,
      from,
      to,
      cause,
    });
  }
}

export function assertCodingRunLifecycleSnapshot(
  value: CodingRunLifecycleSnapshot,
): CodingRunLifecycleSnapshot {
  if (!value || typeof value !== 'object') lifecycleFailure('missing-snapshot');
  if (value.version !== CODING_RUN_LIFECYCLE_VERSION) lifecycleFailure('unsupported-version');
  if (!value.runId?.trim()) lifecycleFailure('missing-run-id');
  if (!['vscode', 'cli', 'headless'].includes(value.surface)) lifecycleFailure('invalid-surface');
  if (!Array.isArray(value.events) || value.events.length === 0) lifecycleFailure('missing-events');

  let previous: CodingRunLifecycleStatus | null = null;
  for (const [index, event] of value.events.entries()) {
    if (!event || typeof event !== 'object') lifecycleFailure(`invalid-event-${index + 1}`);
    if (event.version !== value.version
      || event.runId !== value.runId
      || event.surface !== value.surface
      || event.sequence !== index + 1
      || event.from !== previous) {
      lifecycleFailure(`event-binding-${index + 1}`);
    }
    assertLifecycleTransition(event.from, event.to, event.cause);
    const current = event.to;
    previous = current;
    if (isTerminalStatus(current) && index !== value.events.length - 1) {
      lifecycleFailure(`post-terminal-event-${index + 2}`);
    }
  }
  if (value.status !== previous) lifecycleFailure('status-mismatch');
  if (value.terminal !== isTerminalStatus(value.status)) lifecycleFailure('terminal-flag-mismatch');
  return value;
}

function assertLifecycleTransition(
  from: CodingRunLifecycleStatus | null,
  to: CodingRunLifecycleStatus,
  cause: CodingRunLifecycleCause,
): void {
  const valid = (from === null && to === 'accepted' && cause === 'task-accepted')
    || (from === 'accepted' && to === 'running' && cause === 'execution-dispatched')
    || (from === 'running' && to === 'waiting-user' && cause === 'user-input-required')
    || (from === 'waiting-user' && to === 'running' && cause === 'user-input-received')
    || (from === 'accepted'
      && isTerminalStatus(to)
      && to !== 'completed'
      && cause === settlementCause(to))
    || ((from === 'running' || from === 'waiting-user')
      && isTerminalStatus(to)
      && cause === settlementCause(to));
  if (!valid) lifecycleFailure(`invalid-transition:${from ?? 'null'}->${to}:${cause}`);
}

function lifecycleFailure(reason: string): never {
  throw new Error(`coding-run-lifecycle:${reason}`);
}

function settlementCause(status: CodingTerminalStatus): CodingRunLifecycleCause {
  if (status === 'completed') return 'runtime-completed';
  if (status === 'blocked') return 'authority-blocked';
  if (status === 'cancelled') return 'cancellation-observed';
  return 'runtime-failed';
}

function isTerminalStatus(status: CodingRunLifecycleStatus): status is CodingTerminalStatus {
  return status === 'completed'
    || status === 'failed'
    || status === 'blocked'
    || status === 'cancelled';
}
