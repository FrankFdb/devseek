import type { CodingVerificationReceipt } from '@devseek-netai/shared';
import type { AgentLoopResult } from './loop-types';
import {
  withTaskTerminalEvidence,
  type TaskExecutionResult,
} from './task-execution-result';
import type { TerminalEvidence } from './completion-evidence';
import type { EvidenceRef } from './evidence-grounding';
import type { ToolLoopResult } from './tool-loop';
import { withToolReadEvidence } from './tool-read-evidence';

export interface AgentLoopExecutionEvidence {
  terminalEvidence: TerminalEvidence[];
  verificationReceipts: NonNullable<AgentLoopResult['verificationReceipts']>;
  toolExecutionReceipts: NonNullable<AgentLoopResult['toolExecutionReceipts']>;
  changeReceipts: NonNullable<AgentLoopResult['changeReceipts']>;
}

export function createAgentLoopExecutionEvidence(): AgentLoopExecutionEvidence {
  return {
    terminalEvidence: [],
    verificationReceipts: [],
    toolExecutionReceipts: [],
    changeReceipts: [],
  };
}

export function appendTaskExecutionEvidence(
  target: AgentLoopExecutionEvidence,
  result: TaskExecutionResult,
): void {
  if (result.terminalEvidence?.length) target.terminalEvidence.push(...result.terminalEvidence);
  if (result.verificationReceipts?.length) target.verificationReceipts.push(...result.verificationReceipts);
  if (result.toolExecutionReceipts?.length) target.toolExecutionReceipts.push(...result.toolExecutionReceipts);
  if (result.changeReceipts?.length) target.changeReceipts.push(...result.changeReceipts);
}

export function appendVerificationReceipt(
  target: AgentLoopExecutionEvidence,
  receipt: CodingVerificationReceipt | undefined,
): void {
  if (receipt) target.verificationReceipts.push(receipt);
}

/** Collects canonical receipts and grounding for one legacy task execution. */
export class TaskExecutionEvidenceCollector {
  private readonly verificationReceipts: NonNullable<TaskExecutionResult['verificationReceipts']> = [];
  private readonly toolExecutionReceipts: NonNullable<TaskExecutionResult['toolExecutionReceipts']> = [];
  private readonly changeReceipts: NonNullable<TaskExecutionResult['changeReceipts']> = [];

  constructor(private readonly readEvidence: EvidenceRef[]) {}

  appendToolLoop(result: ToolLoopResult): void {
    if (result.toolExecutionReceipts?.length) this.toolExecutionReceipts.push(...result.toolExecutionReceipts);
    if (result.changeReceipts?.length) this.changeReceipts.push(...result.changeReceipts);
  }

  appendVerification(receipt: NonNullable<TaskExecutionResult['verificationReceipts']>[number] | undefined): void {
    if (receipt) this.verificationReceipts.push(receipt);
  }

  appendChange(receipt: NonNullable<TaskExecutionResult['changeReceipts']>[number]): void {
    this.changeReceipts.push(receipt);
  }

  appendChanges(receipts: NonNullable<TaskExecutionResult['changeReceipts']> | undefined): void {
    if (receipts?.length) this.changeReceipts.push(...receipts);
  }

  attach<T extends Omit<
    TaskExecutionResult,
    'terminalEvidence' | 'verificationReceipts' | 'toolExecutionReceipts' | 'changeReceipts'
  >>(result: T, terminalEvidence: TerminalEvidence[]): TaskExecutionResult {
    return {
      ...withToolReadEvidence(withTaskTerminalEvidence(result, terminalEvidence), this.readEvidence),
      ...(this.verificationReceipts.length > 0 ? { verificationReceipts: [...this.verificationReceipts] } : {}),
      ...(this.toolExecutionReceipts.length > 0 ? { toolExecutionReceipts: [...this.toolExecutionReceipts] } : {}),
      ...(this.changeReceipts.length > 0 ? { changeReceipts: [...this.changeReceipts] } : {}),
    };
  }
}
