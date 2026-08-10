import {
  projectSettledCodingConformanceRun,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import type { AgentLoopResult } from '../agent/loop-types';
import type { VsCodeCodingKernelRuntimeResult } from './coding-kernel-execution';
import { correlateVsCodeCodingConformanceReceipts } from './vscode-coding-conformance-correlation';

export function projectVsCodeCodingKernelOutput(
  output: CodingKernelExecutionOutput<VsCodeCodingKernelRuntimeResult>,
): AgentLoopResult {
  if (output.completion.status !== output.settlement.status) {
    throw new Error('vscode-coding-kernel:settlement-binding-mismatch');
  }
  const receipts = correlateVsCodeCodingConformanceReceipts({
    toolExecutions: output.toolExecutionReceipts,
    changeReceipts: output.workspaceMutationReceipts,
    verifications: output.verificationReceipts,
  });
  const codingConformance = projectSettledCodingConformanceRun({
    fixtureId: output.runId,
    taskContract: output.taskContract,
    toolExecutions: receipts.toolExecutions,
    changeReceipts: receipts.changeReceipts,
    verifications: receipts.verifications,
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
