import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { AgentTask } from '../agent-task-decomposer';
import type { ChatMessage } from '../llm/types';
import type { ExecutionMode } from '../intent/intent-types';
import { buildAgenticHistoryText, buildAgenticQualityGateForHistory } from './agentic-history';
import { ArtifactGroundingCollector } from './artifact-grounding-lifecycle';
import { coalesceWrittenFileEvidence } from './completion-evidence';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import { tryExecuteMarkdownDeliverableTask } from './markdown-deliverable-task';
import {
  buildTaskContract,
  getSourceClaimArtifactContractIssue,
  hasSourceClaimArtifactContract,
} from './task-contract';
import { createAgentTaskTodoLedger } from './task-state-machine';
import type { TaskExecutionResult } from './task-execution-result';

type GroundedMarkdownChatWithMessages = (
  messages: ChatMessage[],
  mode?: 'fast' | 'r1',
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession?: boolean,
  traceRunId?: string,
  traceWorkspaceRoot?: string,
) => Promise<{ text: string }>;

export async function tryRunGroundedMarkdownAgenticTask(
  userPrompt: string,
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  workflowMode: ExecutionMode,
  callbacks: AgentLoopCallbacks,
  chatWithMessages: GroundedMarkdownChatWithMessages,
  externalEvidencePaths: readonly string[] = [],
  sessionContextText = '',
): Promise<AgentLoopResult | undefined> {
  if (workflowMode !== 'edit') return undefined;
  // Attachments and free-text session history are not source-claim evidence.
  // A self-contained current request must stay on the verified route; otherwise
  // stale context could divert it into an unverified simple/generic writer.
  void externalEvidencePaths;
  void sessionContextText;
  const contract = buildTaskContract(userPrompt);
  // Source-claim artifact obligations are security-sensitive even when the
  // user's mutation verb is unfamiliar. Route them here or fail closed rather
  // than letting a generic writer bypass ArtifactClaim verification.
  const isExplicitGroundedArtifact = hasSourceClaimArtifactContract(contract);
  if (!isExplicitGroundedArtifact) return undefined;
  const [target] = contract.deliverableTargets;
  const invalidReason = getSourceClaimArtifactContractIssue(contract)
    ?? (contract.deliverableTargets.length !== 1 || !target
        ? `源码事实报告必须唯一绑定一个 Markdown 目标，当前解析到 ${contract.deliverableTargets.length} 个。`
        : undefined);
  if (invalidReason) {
    return failGroundedMarkdownRouting(userPrompt, workspaceRoot, callbacks, target, invalidReason);
  }
  const absPath = nodePath.isAbsolute(target) ? target : nodePath.join(workspaceRoot, target.replace(/^\.\//, ''));
  const task: AgentTask = {
    id: 'grounded-markdown-report',
    action: fs.existsSync(absPath) ? 'modify' : 'create',
    file: target || '',
    absPath,
    visibleTarget: target,
    desc: userPrompt,
  };
  const result = await tryExecuteMarkdownDeliverableTask({
    task,
    taskIndex: 1,
    taskTotal: 1,
    userPrompt,
    workspaceRoot: vscode.Uri.file(workspaceRoot),
    effectiveAbsPath: absPath,
    callbacks,
    chat: async messages => (await chatWithMessages(
      messages,
      mode,
      undefined,
      callbacks.signal,
      true,
      callbacks.traceRunId,
      callbacks.traceWorkspaceRoot,
    )).text,
  });
  if (!result) {
    return failGroundedMarkdownRouting(
      userPrompt,
      workspaceRoot,
      callbacks,
      target,
      '源码事实报告未进入受验证的 Markdown 执行器，已安全阻止通用写入回退。',
    );
  }
  return settleGroundedMarkdownAgenticResult(userPrompt, task, workspaceRoot, callbacks, result);
}

async function failGroundedMarkdownRouting(
  userPrompt: string,
  workspaceRoot: string,
  callbacks: AgentLoopCallbacks,
  target: string | undefined,
  failedReason: string,
): Promise<AgentLoopResult> {
  const visibleTarget = target || 'Markdown 源码事实报告';
  const absPath = target
    ? (nodePath.isAbsolute(target) ? target : nodePath.join(workspaceRoot, target.replace(/^\.\//, '')))
    : nodePath.join(workspaceRoot, 'unresolved-grounded-report.md');
  const task: AgentTask = {
    id: 'grounded-markdown-report',
    action: fs.existsSync(absPath) ? 'modify' : 'create',
    file: target || '',
    absPath,
    visibleTarget,
    desc: userPrompt,
  };
  const ledger = createAgentTaskTodoLedger([task]);
  ledger.startTask(0);
  const settlement = ledger.settleTask(0, {
    action: task.action,
    applied: false,
    path: target,
    taskComplete: false,
    failedReason,
    workspaceRoot,
  });
  const todos = settlement.todos;
  await callbacks.onTodoUpdate?.(todos);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'failed',
    title: '源码事实报告契约不完整',
    detail: failedReason,
    taskTotal: 1,
  });
  callbacks.onDelta(`\x00ASUM\x00任务没有完成：${failedReason}`);
  await callbacks.onTaskCheckpoint?.(0, [task], 'paused');
  const qualityGate = buildAgenticQualityGateForHistory({
    failedReason,
    writtenFiles: [],
    terminalEvidence: [],
  });
  return {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 1,
    changedPaths: [],
    historyText: buildAgenticHistoryText({
      userPrompt,
      roundCount: 0,
      completed: false,
      failedReason,
      todos,
      writtenFiles: [],
      terminalEvidence: [],
      qualityGate,
      workspaceRoot,
    }),
  };
}

async function settleGroundedMarkdownAgenticResult(
  userPrompt: string,
  task: AgentTask,
  workspaceRoot: string,
  callbacks: AgentLoopCallbacks,
  result: TaskExecutionResult,
): Promise<AgentLoopResult> {
  const artifactGrounding = new ArtifactGroundingCollector(callbacks, workspaceRoot);
  const settlementGrounding = artifactGrounding.captureTask(userPrompt, result);
  const contract = buildTaskContract(userPrompt);
  const latest = result.verificationResults?.at(-1);
  const expectedSymbols = new Set(contract.evidenceRequirements.map(requirement => requirement.symbol));
  const writtenFiles = coalesceWrittenFileEvidence(result.writtenFiles ?? [], workspaceRoot);
  const taskTodoLedger = createAgentTaskTodoLedger([task]);
  taskTodoLedger.startTask(0);
  const settlement = taskTodoLedger.settleTask(0, {
    action: task.action,
    applied: result.applied,
    path: result.path,
    writtenFiles,
    raw: result.raw,
    taskComplete: result.taskComplete,
    failedReason: result.failedReason,
    terminalEvidence: result.terminalEvidence,
    workspaceRoot,
    ...settlementGrounding,
  });
  const failed = settlement.failed || !settlement.completed;
  const failedReason = settlement.failedReason
    || (failed ? '统一任务结算未取得完整的写盘、证据与验证结果。' : undefined);
  const todos = settlement.todos;
  await callbacks.onTodoUpdate?.(todos);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: failed ? 'failed' : 'completed',
    title: failed ? '源码事实报告未通过中央结算' : `${expectedSymbols.size} 项源码事实已验证并完成交付`,
    detail: failed ? failedReason : `${latest!.artifactPath} · VerificationResult ${latest!.verificationId}`,
    taskTotal: 1,
    ...(writtenFiles.length > 0 ? { editedFiles: writtenFiles } : {}),
  });
  callbacks.onDelta(`\x00ASUM\x00${failed
    ? `任务没有完成：${failedReason}`
    : `已完成 ${nodePath.basename(latest!.artifactPath)}，${expectedSymbols.size} 项源码事实与写后读回结果全部一致。`}`);
  if (failed) {
    await callbacks.onTaskCheckpoint?.(0, [task], 'paused');
  } else {
    await callbacks.onTaskCheckpoint?.(null, [], 'completed');
  }
  const historyQualityGate = buildAgenticQualityGateForHistory({
    failedReason: failedReason || undefined,
    writtenFiles,
    terminalEvidence: [],
  });
  const historyText = buildAgenticHistoryText({
    userPrompt,
    roundCount: result.verificationResults?.length || 1,
    completed: !failed,
    failedReason: failedReason || undefined,
    summary: failed ? undefined : `${expectedSymbols.size} 项源码事实和交付格式全部通过宿主验证。`,
    todos,
    writtenFiles,
    terminalEvidence: [],
    qualityGate: historyQualityGate,
    workspaceRoot,
  });
  return {
    tasksTotal: 1,
    tasksApplied: writtenFiles.length > 0 ? 1 : 0,
    tasksFailed: failed ? 1 : 0,
    changedPaths: [...new Set(writtenFiles.map(file => file.path))],
    ...artifactGrounding.resultFields(),
    historyText,
  };
}
