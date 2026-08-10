import {
  projectSettledCodingConformanceRun,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import type { AgentLoopResult } from '../agent/loop-types';
import type { VsCodeCodingKernelRuntimeResult } from './coding-kernel-execution';

export function projectVsCodeCodingKernelOutput(
  output: CodingKernelExecutionOutput<VsCodeCodingKernelRuntimeResult>,
): AgentLoopResult {
  if (output.completion.status !== output.settlement.status) {
    throw new Error('vscode-coding-kernel:settlement-binding-mismatch');
  }
  const toolActionIds = new Set(output.toolExecutionReceipts.map(receipt => receipt.actionId));
  const actionOwnedVerifications = output.verificationReceipts.filter(
    receipt => toolActionIds.has(receipt.actionId),
  );
  const codingConformance = projectSettledCodingConformanceRun({
    fixtureId: output.runId,
    taskContract: output.taskContract,
    toolExecutions: output.toolExecutionReceipts,
    changeReceipts: output.workspaceMutationReceipts,
    verifications: actionOwnedVerifications,
    completion: output.completion,
  });
  return {
    ...output.result.agentResult,
    toolExecutionReceipts: [...output.toolExecutionReceipts],
    changeReceipts: [...output.workspaceMutationReceipts],
    verificationReceipts: [...output.verificationReceipts],
    completionDecision: output.completion,
    codingConformance,
  };
}
