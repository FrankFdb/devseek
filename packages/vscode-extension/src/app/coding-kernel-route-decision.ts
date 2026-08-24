import type { AgentTask } from '../agent/agent-task';
import type { CodingCheckpoint, CodingKernelTaskContract } from '@devseek-netai/shared';
import {
  createCheckpointKernelRecovery,
  type CheckpointKernelRecovery,
} from './coding-kernel-recovery';

export const CODING_KERNEL_ROUTE_DECISION_VERSION = 'devseek.coding-kernel-route-decision/v1';

export interface CodingKernelCheckpointResume {
  readonly tasks: readonly AgentTask[];
  readonly startFromIndex: number;
  readonly canonicalCheckpoint: CodingCheckpoint;
  readonly canonicalTaskContract: CodingKernelTaskContract;
  readonly analysisContext?: string;
}

export interface CodingKernelStoredCheckpointResume {
  readonly allTasks: readonly AgentTask[];
  readonly startFromIndex: number;
  readonly canonicalCheckpoint: CodingCheckpoint;
  readonly canonicalTaskContract: CodingKernelTaskContract;
}

export function projectCodingKernelCheckpointResume(
  checkpoint: CodingKernelStoredCheckpointResume | undefined,
  analysisContext?: string,
): CodingKernelCheckpointResume | undefined {
  if (!checkpoint) return undefined;
  return {
    tasks: checkpoint.allTasks,
    startFromIndex: checkpoint.startFromIndex,
    canonicalCheckpoint: checkpoint.canonicalCheckpoint,
    canonicalTaskContract: checkpoint.canonicalTaskContract,
    ...(analysisContext?.trim() ? { analysisContext: analysisContext.trim() } : {}),
  };
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
