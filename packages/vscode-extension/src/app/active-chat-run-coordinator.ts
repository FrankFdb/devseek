import type { AgentKernelRun } from './agent-kernel-service';
import type { RunContextStatus } from './run-context';

type CancellableAgentKernelRun = Pick<AgentKernelRun, 'cancelRun'>;

interface ActiveChatRunState {
  readonly abortController: AbortController;
  readonly steerQueue: string[];
  agentKernelRun?: CancellableAgentKernelRun;
}

export interface ActiveChatRunHandle {
  readonly abortController: AbortController;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  bindAgentKernelRun(run: CancellableAgentKernelRun): boolean;
  clearAgentKernelRun(run: CancellableAgentKernelRun): void;
  consumeAgentSteer(): string[];
  finish(): RunContextStatus | undefined;
}

/** Owns cancellation and steering state for exactly one active VS Code chat request. */
export class ActiveChatRunCoordinator {
  private activeRun?: ActiveChatRunState;

  startRun(supersedeData: Record<string, unknown> = {}): ActiveChatRunHandle {
    this.cancelActiveRun(supersedeData);

    const state: ActiveChatRunState = {
      abortController: new AbortController(),
      steerQueue: [],
    };
    this.activeRun = state;

    return {
      abortController: state.abortController,
      signal: state.abortController.signal,
      isCurrent: () => this.activeRun === state,
      bindAgentKernelRun: run => this.bindAgentKernelRun(state, run),
      clearAgentKernelRun: run => this.clearAgentKernelRun(state, run),
      consumeAgentSteer: () => this.consumeAgentSteer(state),
      finish: () => this.finishRun(state),
    };
  }

  cancelActiveRun(data: Record<string, unknown> = {}): RunContextStatus | undefined {
    const state = this.activeRun;
    if (!state) return undefined;

    this.activeRun = undefined;
    state.steerQueue.length = 0;
    try {
      return state.agentKernelRun?.cancelRun(data);
    } finally {
      state.abortController.abort();
    }
  }

  pushAgentSteer(text: string): boolean {
    const state = this.activeRun;
    if (!state || state.abortController.signal.aborted) return false;
    state.steerQueue.push(text);
    return true;
  }

  private bindAgentKernelRun(state: ActiveChatRunState, run: CancellableAgentKernelRun): boolean {
    if (this.activeRun !== state || state.abortController.signal.aborted) {
      run.cancelRun({
        reason: 'superseded-before-kernel-bind',
        source: 'active-chat-run-coordinator',
      });
      return false;
    }

    if (state.agentKernelRun && state.agentKernelRun !== run) {
      state.agentKernelRun.cancelRun({
        reason: 'replaced-by-new-kernel-run',
        source: 'active-chat-run-coordinator',
      });
    }
    state.agentKernelRun = run;
    return true;
  }

  private clearAgentKernelRun(state: ActiveChatRunState, run: CancellableAgentKernelRun): void {
    if (this.activeRun === state && state.agentKernelRun === run) {
      state.agentKernelRun = undefined;
    }
  }

  private consumeAgentSteer(state: ActiveChatRunState): string[] {
    if (this.activeRun !== state || state.abortController.signal.aborted) return [];
    return state.steerQueue.splice(0, state.steerQueue.length);
  }

  private finishRun(state: ActiveChatRunState): RunContextStatus | undefined {
    if (this.activeRun !== state) return undefined;

    this.activeRun = undefined;
    state.steerQueue.length = 0;
    if (!state.agentKernelRun) return undefined;

    state.abortController.abort();
    return state.agentKernelRun.cancelRun({
      reason: 'request-finished-with-active-kernel',
      source: 'active-chat-run-coordinator',
    });
  }
}
