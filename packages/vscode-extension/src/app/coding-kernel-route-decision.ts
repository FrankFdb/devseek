import type { AgentTask } from '../agent-task-decomposer';

export const CODING_KERNEL_ROUTE_DECISION_VERSION = 'devseek.coding-kernel-route-decision/v1';

export interface CodingKernelCheckpointResume {
  readonly tasks: readonly AgentTask[];
  readonly startFromIndex: number;
}

export type CodingKernelRouteDecision =
  | {
      readonly version: typeof CODING_KERNEL_ROUTE_DECISION_VERSION;
      readonly route: 'canonical';
      readonly reason: 'new-task';
    }
  | {
      readonly version: typeof CODING_KERNEL_ROUTE_DECISION_VERSION;
      readonly route: 'legacy-planned';
      readonly reason: 'checkpoint-resume';
      readonly checkpoint: CodingKernelCheckpointResume;
    };

export function decideCodingKernelRoute(input: {
  readonly checkpoint?: CodingKernelCheckpointResume;
}): CodingKernelRouteDecision {
  if (!input.checkpoint) {
    return {
      version: CODING_KERNEL_ROUTE_DECISION_VERSION,
      route: 'canonical',
      reason: 'new-task',
    };
  }

  const { tasks, startFromIndex } = input.checkpoint;
  if (
    tasks.length === 0
    || !Number.isInteger(startFromIndex)
    || startFromIndex < 0
    || startFromIndex >= tasks.length
  ) {
    throw new Error('coding-kernel-route:invalid-checkpoint-resume');
  }

  return {
    version: CODING_KERNEL_ROUTE_DECISION_VERSION,
    route: 'legacy-planned',
    reason: 'checkpoint-resume',
    checkpoint: {
      tasks: [...tasks],
      startFromIndex,
    },
  };
}
