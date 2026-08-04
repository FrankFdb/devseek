import type { AgentTask } from '../agent-task-decomposer';
import {
  createCheckpointKernelRecovery,
  type CheckpointKernelRecovery,
} from './coding-kernel-recovery';

export const CODING_KERNEL_ROUTE_DECISION_VERSION = 'devseek.coding-kernel-route-decision/v1';

export interface CodingKernelCheckpointResume {
  readonly tasks: readonly AgentTask[];
  readonly startFromIndex: number;
  readonly analysisContext?: string;
}

export type CodingKernelRouteDecision =
  | {
      readonly version: typeof CODING_KERNEL_ROUTE_DECISION_VERSION;
      readonly route: 'canonical';
      readonly reason: 'new-task';
    }
  | {
      readonly version: typeof CODING_KERNEL_ROUTE_DECISION_VERSION;
      readonly route: 'canonical';
      readonly reason: 'checkpoint-resume';
      readonly recovery: CheckpointKernelRecovery;
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

  try {
    return {
      version: CODING_KERNEL_ROUTE_DECISION_VERSION,
      route: 'canonical',
      reason: 'checkpoint-resume',
      recovery: createCheckpointKernelRecovery(input.checkpoint),
    };
  } catch {
    throw new Error('coding-kernel-route:invalid-checkpoint-resume');
  }
}
