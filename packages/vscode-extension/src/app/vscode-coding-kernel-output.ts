import {
  projectSettledCodingConformanceRun,
  type CodingCompletionDecision,
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
  const verificationAuditReceipts = output.result.agentResult.verificationReceipts
    ?? output.verificationReceipts;
  const actionOwnedVerifications = verificationAuditReceipts.filter(
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
  const settledAgentResult = reconcileAgentResultWithCompletion(
    output.result.agentResult,
    output.completion,
  );
  return {
    ...settledAgentResult,
    terminalPresentation: output.result.terminalPresentation,
    toolExecutionReceipts: [...output.toolExecutionReceipts],
    changeReceipts: [...output.workspaceMutationReceipts],
    verificationReceipts: [...verificationAuditReceipts],
    completionDecision: output.completion,
    codingConformance,
  };
}

export function reconcileAgentResultWithCompletion(
  result: AgentLoopResult,
  completion: CodingCompletionDecision,
): AgentLoopResult {
  if (completion.status === 'completed') return result;
  const statusText = completion.status === 'blocked'
    ? '仍缺少可交付证据'
    : completion.status === 'cancelled'
      ? '任务已取消'
      : '最终验证或证据结算未通过';
  const historyText = result.historyText?.includes('[Agentic] 未完成')
    ? result.historyText
    : `**[Agentic] 未完成：${statusText}**${result.historyText ? `\n\n${result.historyText}` : ''}`;
  return {
    ...result,
    tasksFailed: completion.status === 'failed' ? Math.max(1, result.tasksFailed) : result.tasksFailed,
    failedReason: result.failedReason || statusText,
    historyText,
  };
}
