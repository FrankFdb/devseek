import { CodingKernelExecutionError } from '@devseek-netai/shared';
import type { TaskCheckpointRecord } from './task-checkpoint-store';
import {
  buildProviderRecoveryCheckpointTasks,
  type ProviderRecoveryCheckpointTask,
  type ProviderRecoveryKind,
} from './provider-recovery-service';

export interface ProviderRecoveryCheckpointInput {
  readonly error: CodingKernelExecutionError;
  readonly prompt: string;
  readonly displayPrompt: string;
  readonly mode?: 'fast' | 'r1';
  readonly files?: string[];
  readonly workspaceRootFsPath: string;
  readonly savedAt: number;
  readonly sessionId: string;
  readonly recoveryKind: ProviderRecoveryKind;
  readonly pauseReason: string;
  readonly evidenceRefs?: readonly string[];
}

export function buildProviderRecoveryCheckpointRecord(
  input: ProviderRecoveryCheckpointInput,
): TaskCheckpointRecord<ProviderRecoveryCheckpointTask> {
  const allTasks = buildProviderRecoveryCheckpointTasks(input);
  const canonicalCheckpoint = input.error.checkpoint.create({
    epoch: 1,
    completedUnitCount: 0,
    pendingUnits: allTasks.map(task => ({
      id: task.id,
      description: task.desc,
      action: task.action,
      target: task.visibleTarget || task.file || 'Agent task',
    })),
    reason: 'failed',
    evidenceRefs: input.evidenceRefs ?? input.error.settlement.evidenceRefs,
  });
  return {
    userPrompt: input.prompt,
    displayPrompt: input.displayPrompt,
    mode: input.mode,
    wsRootFsPath: input.workspaceRootFsPath,
    allTasks,
    startFromIndex: 0,
    completedCount: 0,
    savedAt: input.savedAt,
    sessionId: input.sessionId,
    recoveryKind: input.recoveryKind,
    pauseReason: input.pauseReason,
    canonicalCheckpoint,
  };
}

export function isCheckpointableProviderRecoveryError(
  error: unknown,
): error is CodingKernelExecutionError {
  return error instanceof CodingKernelExecutionError;
}
