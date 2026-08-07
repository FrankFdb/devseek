import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveWorkspaceWritePath } from '../workspace/path-resolver';
import { WorkspaceEditService } from '../workspace/edit-service';
import { VsCodeWorkspaceMutationAdapter } from '../workspace/coding-workspace-mutation-adapter';
import { resolveProductWorkspaceMutationSession } from '../workspace/product-workspace-mutation-transaction';
import { runAgentAutoValidationForWrites, type AgentAutoValidationOptions } from './auto-validation';
import {
  buildAgenticHistoryText,
  buildAgenticQualityGateForHistory,
  type AgenticHistoryQualityGate,
} from './agentic-history';
import {
  coalesceWrittenFileEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import type { CppValidationPolicy } from '../validation-planner';
import {
  advanceLinearAgentTodo,
  appendQualityGateTodo,
  createLinearAgentTodos,
  failLinearAgentTodo,
} from './task-state-machine';
import {
  parseSimpleFileWriteRequest,
  type SimpleFileWriteRequest,
} from './simple-file-intent';
import { isAgentFileWriteConstraintSatisfied } from '../app/agent-file-write-policy';

export { parseSimpleFileWriteRequest };
export type { SimpleFileWriteRequest };

export interface SimpleFileTaskInput {
  userPrompt: string;
  workspaceRoot: string;
  callbacks: AgentLoopCallbacks;
  cppValidationPolicy: CppValidationPolicy;
  options?: AgentAutoValidationOptions;
}

const workspaceEditService = new WorkspaceEditService();
const workspaceMutation = new VsCodeWorkspaceMutationAdapter(workspaceEditService);

export async function tryRunSimpleFileTask(input: SimpleFileTaskInput): Promise<AgentLoopResult | undefined> {
  const request = parseSimpleFileWriteRequest(input.userPrompt);
  if (!request || !input.workspaceRoot) return undefined;

  const resolved = resolveWorkspaceWritePath(request.path, {
    requestPrompt: input.userPrompt,
    content: request.content,
    workspaceRootFsPath: input.workspaceRoot,
  });
  if (!resolved) return undefined;

  const todos = buildSimpleFileTodos(resolved.relPath);
  let baseline;
  try {
    baseline = workspaceEditService.captureTextFileBaseline(resolved.absPath, input.workspaceRoot);
  } catch (error) {
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(todos, 0),
      writtenFiles: [],
      terminalEvidence: [],
      failedReason: `工作区写入边界阻止写入：${error instanceof Error ? error.message : String(error)}`,
    });
  }
  await input.callbacks.onTodoUpdate?.(todos);

  const resolveConstraint = input.callbacks.onResolveFileWriteConstraint;
  const fileWriteConstraint = resolveConstraint
    ? await resolveConstraint(resolved.absPath, {
        purpose: 'workspace-edit',
        userRequested: true,
        displayName: resolved.relPath,
        requestPrompt: input.userPrompt,
      })
    : undefined;
  if (!fileWriteConstraint || !isAgentFileWriteConstraintSatisfied(fileWriteConstraint)) {
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(todos, 0),
      writtenFiles: [],
      terminalEvidence: [],
      failedReason: `写入被权限或保护规则阻止：${resolved.relPath}`,
    });
  }

  input.callbacks.onToolActivity?.('write', resolved.relPath);
  const mutationSession = resolveProductWorkspaceMutationSession({
    workspaceRoot: input.workspaceRoot,
    canonicalTransaction: input.callbacks.canonicalWorkspaceMutations,
    canonicalRunId: input.callbacks.traceRunId,
    owner: 'simple-file-task',
    operationIdentity: {
      path: resolved.relPath,
      content: request.content,
      userPrompt: input.userPrompt,
    },
  });
  let mutationOutcome;
  try {
    mutationOutcome = await workspaceMutation.executeTextFileWrite({
      transaction: mutationSession.transaction,
      runId: mutationSession.runId,
      actionId: `simple-file-write:${resolved.relPath}`,
      sequence: 1,
      absPath: resolved.absPath,
      workspaceRoot: input.workspaceRoot,
      content: request.content,
      baseline,
      applyOptions: {
        validateSourceSanity: true,
        repairSourceTransportEscapes: true,
      },
      evidenceRefs: [`file-write-authority:${resolved.relPath}`],
    });
  } catch (error) {
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(todos, 0),
      writtenFiles: [],
      terminalEvidence: [],
      failedReason: `源码语法护栏阻止写入：${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const committedEdit = mutationOutcome.receipt.result;
  if (mutationOutcome.receipt.status !== 'committed' || !committedEdit) {
    const errorCode = mutationOutcome.receipt.errorCode;
    const failure = errorCode === 'workspace-baseline-conflict'
      ? 'target changed after write authority was captured (workspace-baseline-conflict)'
      : errorCode ?? mutationOutcome.receipt.status;
    const failureLabel = errorCode === 'workspace-proposal-invalid'
      ? '源码语法护栏阻止写入'
      : '工作区写入事务未提交';
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(todos, 0),
      writtenFiles: [],
      terminalEvidence: [],
      failedReason: `${failureLabel}：${failure}`,
      changeReceipt: mutationOutcome.receipt,
    });
  }
  const writeResult = committedEdit.result;
  await input.callbacks.onAppliedChange({ path: resolved.absPath, ...writeResult });

  const persistedContent = writeResult.newContent;
  const newLines = persistedContent.split('\n').length;
  const oldLines = writeResult.oldContent ? writeResult.oldContent.split('\n').length : 0;
  const writtenFile: WrittenFileEvidence = {
    path: resolved.absPath,
    basename: nodePath.basename(resolved.absPath),
    linesAdded: newLines,
    linesRemoved: oldLines,
    action: writeResult.existed ? 'modify' : 'create',
  };
  await emitSimpleFileWriteCommitted(input.callbacks, resolved.relPath, writtenFile);

  const afterWriteTodos = advanceLinearAgentTodo(todos, 0, 1);
  await input.callbacks.onTodoUpdate?.(afterWriteTodos);

  const contentCheck = verifyWrittenContent(resolved.absPath, persistedContent);
  if (!contentCheck.ok) {
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(afterWriteTodos, 1),
      writtenFiles: [writtenFile],
      terminalEvidence: [],
      failedReason: contentCheck.reason,
      changeReceipt: mutationOutcome.receipt,
    });
  }

  const contentVerifiedTodos = advanceLinearAgentTodo(afterWriteTodos, 1);
  await input.callbacks.onTodoUpdate?.(contentVerifiedTodos);

  const validation = await runAgentAutoValidationForWrites(
    [writtenFile],
    input.workspaceRoot,
    input.userPrompt,
    input.callbacks,
    input.cppValidationPolicy,
    input.options,
  );
  const terminalEvidence = validation.evidence ? [validation.evidence] : [];
  const failedReason = validation.repairBlockedReason
    ? validation.repairBlockedReason
    : validation.evidence && !validation.evidence.ok
    ? `自动验证未通过：${validation.evidence.detail || validation.evidence.command}`
    : !validation.evidence
      ? validation.feedbackForAI || 'QualityGate 阻塞：缺少自动验证证据。'
      : '';

  if (failedReason) {
    return finishSimpleFileTask({
      ...input,
      todos: buildFinalSimpleFileTodos(contentVerifiedTodos, validation.evidence, 'failed'),
      writtenFiles: [writtenFile],
      terminalEvidence,
      failedReason,
      qualityGate: validation.qualityGate,
      verificationReceipt: validation.verificationReceipt,
      changeReceipt: mutationOutcome.receipt,
    });
  }

  return finishSimpleFileTask({
    ...input,
    todos: buildFinalSimpleFileTodos(contentVerifiedTodos, validation.evidence, 'completed'),
    writtenFiles: [writtenFile],
    terminalEvidence,
    failedReason: '',
    qualityGate: validation.qualityGate,
    verificationReceipt: validation.verificationReceipt,
    changeReceipt: mutationOutcome.receipt,
    summary: buildSimpleFileCompletionSummary(resolved.relPath, validation.evidence),
  });
}

function buildSimpleFileTodos(relPath: string): TodoItem[] {
  return createLinearAgentTodos([
    { title: `创建 ${relPath} 文件`, status: 'in-progress' },
    { title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: 'not-started' },
  ]);
}

function buildFinalSimpleFileTodos(
  contentVerifiedTodos: TodoItem[],
  evidence: TerminalEvidence | undefined,
  qualityGateStatus: 'completed' | 'failed',
): TodoItem[] {
  if (evidence?.kind === 'other') {
    return qualityGateStatus === 'completed'
      ? contentVerifiedTodos
      : failLinearAgentTodo(contentVerifiedTodos, 1);
  }

  return appendQualityGateTodo(contentVerifiedTodos, qualityGateStatus);
}

function buildSimpleFileCompletionSummary(relPath: string, evidence: TerminalEvidence | undefined): string {
  if (evidence?.kind === 'other') {
    return [
      `完成：已创建 \`${relPath}\`。`,
      '验证：已读回确认文件存在、内容正确、大小正常。',
      '结论：任务已完成。',
    ].join('\n');
  }
  return [
    `完成：已创建 \`${relPath}\`。`,
    '验证：自动验证已通过。',
    '结论：任务已完成。',
  ].join('\n');
}

async function emitSimpleFileWriteCommitted(
  callbacks: AgentLoopCallbacks,
  relPath: string,
  writtenFile: WrittenFileEvidence,
): Promise<void> {
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'completed',
    taskId: 'agentic',
    taskFile: relPath,
    taskAction: 'create',
    taskIndex: 1,
    taskTotal: 1,
    title: relPath,
    editedFiles: [writtenFile],
  });
}

async function finishSimpleFileTask(input: SimpleFileTaskInput & {
  todos: TodoItem[];
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  failedReason: string;
  summary?: string;
  qualityGate?: AgenticHistoryQualityGate;
  verificationReceipt?: NonNullable<Awaited<ReturnType<typeof runAgentAutoValidationForWrites>>['verificationReceipt']>;
  changeReceipt?: NonNullable<AgentLoopResult['changeReceipts']>[number];
}): Promise<AgentLoopResult> {
  const finalWrittenFiles = coalesceWrittenFileEvidence(input.writtenFiles, input.workspaceRoot);
  await input.callbacks.onTodoUpdate?.(input.todos);
  await input.callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: input.failedReason ? 'failed' : 'completed',
    title: input.failedReason || input.summary || '任务已完成',
    taskTotal: 1,
    ...(finalWrittenFiles.length > 0 ? { editedFiles: finalWrittenFiles } : {}),
  });

  const finalMsg = input.failedReason
    ? `任务没有完成：${input.failedReason}`
    : input.summary || '任务已完成。';
  input.callbacks.onDelta('\x00ASUM\x00' + finalMsg);
  await input.callbacks.onTaskCheckpoint?.(null, [], 'completed');

  const historyText = buildAgenticHistoryText({
    userPrompt: input.userPrompt,
    roundCount: 0,
    completed: !input.failedReason,
    failedReason: input.failedReason,
    summary: input.summary,
    todos: input.todos,
    writtenFiles: finalWrittenFiles,
    terminalEvidence: input.terminalEvidence,
    qualityGate: input.qualityGate ?? buildAgenticQualityGateForHistory({
      failedReason: input.failedReason,
      writtenFiles: finalWrittenFiles,
      terminalEvidence: input.terminalEvidence,
    }),
    workspaceRoot: input.workspaceRoot,
  });

  return {
    tasksTotal: 1,
    tasksApplied: finalWrittenFiles.length > 0 ? 1 : 0,
    tasksFailed: input.failedReason ? 1 : 0,
    changedPaths: finalWrittenFiles.map(file => file.path),
    ...(input.verificationReceipt ? { verificationReceipts: [input.verificationReceipt] } : {}),
    ...(input.changeReceipt ? { changeReceipts: [input.changeReceipt] } : {}),
    historyText,
  };
}

function verifyWrittenContent(absPath: string, expectedContent: string): { ok: true } | { ok: false; reason: string } {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return { ok: false, reason: `写入后目标不是文件：${absPath}` };
    if (stat.size <= 0) return { ok: false, reason: `写入后文件为空：${absPath}` };
    const actual = fs.readFileSync(absPath, 'utf8');
    if (actual !== expectedContent) {
      return { ok: false, reason: `写入后内容与用户指定内容不一致：${absPath}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `写入后文件检查异常：${err instanceof Error ? err.message : String(err)}` };
  }
}
