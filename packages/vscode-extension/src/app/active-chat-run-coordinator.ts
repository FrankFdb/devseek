import type { CodingSteeringCandidate } from '@devseek-netai/shared';
import type { AgentKernelRun } from './agent-kernel-service';

type CancellableAgentKernelRun = Pick<AgentKernelRun, 'runContext' | 'requestCancellation' | 'cancelRun'>;

export const ACTIVE_CHAT_STEERING_SUBMISSION_VERSION = 'devseek.active-chat-steering-submission/v1' as const;

export interface ActiveChatSteeringRequest {
  readonly instruction: string;
  readonly steeringId?: string;
  readonly expectedRunId?: string;
}

export type ActiveChatSteeringRejectionReason =
  | 'empty-input'
  | 'no-active-run'
  | 'run-not-steerable'
  | 'turn-completing'
  | 'expected-run-mismatch'
  | 'conflicting-steering-id';

export type ActiveChatSteeringSubmission = Readonly<{
  version: typeof ACTIVE_CHAT_STEERING_SUBMISSION_VERSION;
  steeringId: string;
  status: 'accepted' | 'duplicate';
  runId: string;
  queuePosition: number;
}> | Readonly<{
  version: typeof ACTIVE_CHAT_STEERING_SUBMISSION_VERSION;
  steeringId: string;
  status: 'rejected';
  reason: ActiveChatSteeringRejectionReason;
  runId?: string;
  actualRunId?: string;
}>;

export interface ActiveChatSteeringSnapshot {
  readonly version: typeof ACTIVE_CHAT_STEERING_SUBMISSION_VERSION;
  readonly activeRunId?: string;
  readonly runs: readonly Readonly<{
    runId: string;
    state: 'starting' | 'active' | 'completed' | 'cancelled';
    steeringOpen: boolean;
    submissions: readonly Readonly<{
      steeringId: string;
      instruction: string;
      state: 'queued' | 'consumed' | 'orphaned';
      reason?: string;
    }>[];
  }>[];
}

interface SteeringRecord {
  readonly candidate: CodingSteeringCandidate;
  state: 'queued' | 'consumed' | 'orphaned';
  reason?: string;
}

interface ActiveChatRunState {
  runId: string;
  readonly abortController: AbortController;
  readonly steerQueue: SteeringRecord[];
  readonly steerHistory: SteeringRecord[];
  lifecycle: 'starting' | 'active' | 'completed' | 'cancelled';
  steeringOpen: boolean;
  agentKernelRun?: CancellableAgentKernelRun;
  cancellationData?: Readonly<Record<string, unknown>>;
}

export interface ActiveChatRunHandle {
  readonly runId: string;
  readonly abortController: AbortController;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  bindAgentKernelRun(run: CancellableAgentKernelRun): boolean;
  clearAgentKernelRun(run: CancellableAgentKernelRun): void;
  consumeAgentSteer(): readonly CodingSteeringCandidate[];
  closeAgentSteeringAndConsume(): readonly CodingSteeringCandidate[];
  reopenAgentSteering(): boolean;
  cancellationData(): Readonly<Record<string, unknown>> | undefined;
  finish(): void;
}

/** Owns cancellation and turn-scoped steering intake for one active VS Code request. */
export class ActiveChatRunCoordinator {
  private activeRun?: ActiveChatRunState;
  private readonly recentRuns: ActiveChatRunState[] = [];
  private runSequence = 0;
  private steeringSequence = 0;

  startRun(supersedeData: Record<string, unknown> = {}): ActiveChatRunHandle {
    this.cancelActiveRun(supersedeData);

    const state: ActiveChatRunState = {
      runId: `chat-run-${Date.now().toString(36)}-${++this.runSequence}`,
      abortController: new AbortController(),
      steerQueue: [],
      steerHistory: [],
      lifecycle: 'starting',
      steeringOpen: false,
    };
    this.activeRun = state;
    this.recentRuns.push(state);
    if (this.recentRuns.length > 20) this.recentRuns.splice(0, this.recentRuns.length - 20);

    return {
      get runId() { return state.runId; },
      abortController: state.abortController,
      signal: state.abortController.signal,
      isCurrent: () => this.activeRun === state,
      bindAgentKernelRun: run => this.bindAgentKernelRun(state, run),
      clearAgentKernelRun: run => this.clearAgentKernelRun(state, run),
      consumeAgentSteer: () => this.consumeAgentSteer(state),
      closeAgentSteeringAndConsume: () => this.closeAgentSteeringAndConsume(state),
      reopenAgentSteering: () => this.reopenAgentSteering(state),
      cancellationData: () => state.cancellationData,
      finish: () => this.finishRun(state),
    };
  }

  cancelActiveRun(data: Record<string, unknown> = {}): void {
    const state = this.activeRun;
    if (!state) return;

    this.activeRun = undefined;
    state.lifecycle = 'cancelled';
    state.steeringOpen = false;
    this.orphanQueuedSteering(state, 'run-cancelled-before-consume');
    state.cancellationData = Object.freeze({ ...data });
    state.agentKernelRun?.requestCancellation(state.cancellationData);
    state.abortController.abort(state.cancellationData);
  }

  pushAgentSteer(request: ActiveChatSteeringRequest): ActiveChatSteeringSubmission {
    const instruction = String(request?.instruction ?? '').trim();
    const steeringId = String(request?.steeringId ?? '').trim()
      || `surface-steer-${Date.now().toString(36)}-${++this.steeringSequence}`;
    const state = this.activeRun;
    if (!instruction) return this.rejectSteering(steeringId, 'empty-input', state);
    if (!state || state.abortController.signal.aborted) {
      return this.rejectSteering(steeringId, 'no-active-run');
    }
    if (request.expectedRunId && request.expectedRunId !== state.runId) {
      return Object.freeze({
        version: ACTIVE_CHAT_STEERING_SUBMISSION_VERSION,
        steeringId,
        status: 'rejected',
        reason: 'expected-run-mismatch',
        runId: request.expectedRunId,
        actualRunId: state.runId,
      });
    }
    if (!state.agentKernelRun) return this.rejectSteering(steeringId, 'run-not-steerable', state);
    if (!state.steeringOpen) return this.rejectSteering(steeringId, 'turn-completing', state);

    const existing = state.steerHistory.find(record => record.candidate.steeringId === steeringId);
    if (existing) {
      if (existing.candidate.instruction !== instruction) {
        return this.rejectSteering(steeringId, 'conflicting-steering-id', state);
      }
      return Object.freeze({
        version: ACTIVE_CHAT_STEERING_SUBMISSION_VERSION,
        steeringId,
        status: 'duplicate',
        runId: state.runId,
        queuePosition: existing.state === 'queued' ? state.steerQueue.indexOf(existing) + 1 : 0,
      });
    }

    const record: SteeringRecord = {
      candidate: Object.freeze({ steeringId, instruction }),
      state: 'queued',
    };
    state.steerQueue.push(record);
    state.steerHistory.push(record);
    return Object.freeze({
      version: ACTIVE_CHAT_STEERING_SUBMISSION_VERSION,
      steeringId,
      status: 'accepted',
      runId: state.runId,
      queuePosition: state.steerQueue.length,
    });
  }

  steeringSnapshot(): ActiveChatSteeringSnapshot {
    return Object.freeze({
      version: ACTIVE_CHAT_STEERING_SUBMISSION_VERSION,
      ...(this.activeRun ? { activeRunId: this.activeRun.runId } : {}),
      runs: Object.freeze(this.recentRuns.map(state => Object.freeze({
        runId: state.runId,
        state: state.lifecycle,
        steeringOpen: state.steeringOpen,
        submissions: Object.freeze(state.steerHistory.map(record => Object.freeze({
          steeringId: record.candidate.steeringId ?? '',
          instruction: record.candidate.instruction,
          state: record.state,
          ...(record.reason ? { reason: record.reason } : {}),
        }))),
      }))),
    });
  }

  private bindAgentKernelRun(state: ActiveChatRunState, run: CancellableAgentKernelRun): boolean {
    if (this.activeRun !== state || state.abortController.signal.aborted) {
      run.requestCancellation({ reason: 'superseded-before-kernel-bind', source: 'active-chat-run-coordinator' });
      run.cancelRun({ reason: 'superseded-before-kernel-bind', source: 'active-chat-run-coordinator' });
      return false;
    }

    if (state.agentKernelRun && state.agentKernelRun !== run) {
      state.agentKernelRun.requestCancellation({ reason: 'replaced-by-new-kernel-run', source: 'active-chat-run-coordinator' });
      state.abortController.abort({ reason: 'replaced-by-new-kernel-run', source: 'active-chat-run-coordinator' });
      run.requestCancellation({ reason: 'duplicate-kernel-bind-refused', source: 'active-chat-run-coordinator' });
      run.cancelRun({ reason: 'duplicate-kernel-bind-refused', source: 'active-chat-run-coordinator' });
      return false;
    }
    state.agentKernelRun = run;
    state.runId = run.runContext.runId;
    state.lifecycle = 'active';
    state.steeringOpen = true;
    return true;
  }

  private clearAgentKernelRun(state: ActiveChatRunState, run: CancellableAgentKernelRun): void {
    if (this.activeRun !== state || state.agentKernelRun !== run) return;
    state.steeringOpen = false;
    this.orphanQueuedSteering(state, 'run-finished-before-consume');
    state.agentKernelRun = undefined;
    state.lifecycle = 'completed';
  }

  private consumeAgentSteer(state: ActiveChatRunState): readonly CodingSteeringCandidate[] {
    if (this.activeRun !== state || state.abortController.signal.aborted || !state.steeringOpen) return [];
    return this.drainSteering(state);
  }

  private closeAgentSteeringAndConsume(state: ActiveChatRunState): readonly CodingSteeringCandidate[] {
    if (this.activeRun !== state || state.abortController.signal.aborted || !state.agentKernelRun) return [];
    state.steeringOpen = false;
    return this.drainSteering(state);
  }

  private reopenAgentSteering(state: ActiveChatRunState): boolean {
    if (this.activeRun !== state || state.abortController.signal.aborted || !state.agentKernelRun) return false;
    state.steeringOpen = true;
    return true;
  }

  private drainSteering(state: ActiveChatRunState): readonly CodingSteeringCandidate[] {
    const records = state.steerQueue.splice(0, state.steerQueue.length);
    for (const record of records) record.state = 'consumed';
    return Object.freeze(records.map(record => record.candidate));
  }

  private orphanQueuedSteering(state: ActiveChatRunState, reason: string): void {
    for (const record of state.steerQueue.splice(0, state.steerQueue.length)) {
      record.state = 'orphaned';
      record.reason = reason;
    }
  }

  private rejectSteering(
    steeringId: string,
    reason: ActiveChatSteeringRejectionReason,
    state?: ActiveChatRunState,
  ): ActiveChatSteeringSubmission {
    return Object.freeze({
      version: ACTIVE_CHAT_STEERING_SUBMISSION_VERSION,
      steeringId,
      status: 'rejected',
      reason,
      ...(state ? { runId: state.runId } : {}),
    });
  }

  private finishRun(state: ActiveChatRunState): void {
    if (this.activeRun !== state) return;

    this.activeRun = undefined;
    state.steeringOpen = false;
    this.orphanQueuedSteering(state, 'request-finished-before-consume');
    if (!state.agentKernelRun) {
      if (state.lifecycle === 'starting') state.lifecycle = 'completed';
      return;
    }

    state.lifecycle = 'cancelled';
    const cancellationData = Object.freeze({
      reason: 'request-finished-with-active-kernel',
      source: 'active-chat-run-coordinator',
    });
    state.cancellationData = cancellationData;
    state.agentKernelRun.requestCancellation(cancellationData);
    state.abortController.abort(cancellationData);
    state.agentKernelRun.cancelRun(cancellationData);
  }
}
