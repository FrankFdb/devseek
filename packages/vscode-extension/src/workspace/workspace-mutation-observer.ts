import type {
  CodingWorkspaceMutationOutcome,
  CodingWorkspaceMutationPlan,
  CodingWorkspaceMutationStatus,
  WorkspaceMutationPort,
  WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';

export interface WorkspaceMutationLifecycleEvent {
  readonly state: 'started' | CodingWorkspaceMutationStatus;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly paths: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly errorCode?: string;
  readonly replayed?: boolean;
}

export type WorkspaceMutationLifecycleObserver = (
  event: WorkspaceMutationLifecycleEvent,
) => void | Promise<void>;

/** Observes only mutations that reach the host apply boundary; reconciled replays stay inert. */
export class ObservedWorkspaceMutationTransaction implements WorkspaceMutationTransactionPort {
  constructor(
    private readonly delegate: WorkspaceMutationTransactionPort,
    private readonly observer: WorkspaceMutationLifecycleObserver,
  ) {}

  async execute<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    let applyStarted = false;
    let terminalObserved = false;
    const observedHost: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult> = {
      ...(host.reconcile ? {
        reconcile: (activePlan, baseline) => host.reconcile!(activePlan, baseline),
      } : {}),
      captureBaseline: activePlan => host.captureBaseline(activePlan),
      apply: async (activePlan, baseline) => {
        await this.observer(projectEvent(activePlan, 'started'));
        applyStarted = true;
        return host.apply(activePlan, baseline);
      },
      readback: (activePlan, baseline, applied) => host.readback(activePlan, baseline, applied),
      rollback: (activePlan, baseline, applied, cause) => host.rollback(activePlan, baseline, applied, cause),
    };

    try {
      const outcome = await this.delegate.execute(plan, observedHost);
      if (applyStarted) {
        await this.observer(projectEvent(plan, outcome.receipt.status, {
          evidenceRefs: outcome.receipt.evidenceRefs,
          errorCode: outcome.receipt.errorCode,
          replayed: outcome.replayed,
        }));
        terminalObserved = true;
      }
      return outcome;
    } catch (error) {
      if (applyStarted && !terminalObserved) {
        await this.observer(projectEvent(plan, 'indeterminate', {
          errorCode: 'workspace-mutation-observer-interrupted',
        }));
      }
      throw error;
    }
  }
}

export function observeWorkspaceMutationTransaction(
  transaction: WorkspaceMutationTransactionPort,
  observer?: WorkspaceMutationLifecycleObserver,
): WorkspaceMutationTransactionPort {
  return observer ? new ObservedWorkspaceMutationTransaction(transaction, observer) : transaction;
}

function projectEvent<TPayload>(
  plan: CodingWorkspaceMutationPlan<TPayload>,
  state: WorkspaceMutationLifecycleEvent['state'],
  terminal: {
    readonly evidenceRefs?: readonly string[];
    readonly errorCode?: string;
    readonly replayed?: boolean;
  } = {},
): WorkspaceMutationLifecycleEvent {
  return Object.freeze({
    state,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    paths: Object.freeze([...plan.paths]),
    evidenceRefs: Object.freeze([...(terminal.evidenceRefs ?? plan.evidenceRefs)]),
    ...(terminal.errorCode ? { errorCode: terminal.errorCode } : {}),
    ...(terminal.replayed !== undefined ? { replayed: terminal.replayed } : {}),
  });
}
