import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveWorkspaceWritePath } from '../workspace/path-resolver';
import { WORKSPACE_FILE_PATH_PATTERN } from '../workspace/path-patterns';
import { WorkspaceEditService } from '../workspace/edit-service';
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

export interface SimpleFileWriteRequest {
  path: string;
  content: string;
}

export interface SimpleFileTaskInput {
  userPrompt: string;
  workspaceRoot: string;
  callbacks: AgentLoopCallbacks;
  cppValidationPolicy: CppValidationPolicy;
  options?: AgentAutoValidationOptions;
}

const workspaceEditService = new WorkspaceEditService();
const SIMPLE_FILE_WRITE_PATH_RE = new RegExp(
  '(?:创建|新建|生成|写入?|create|write)\\s*[`\'"]?(' + WORKSPACE_FILE_PATH_PATTERN.source + ')[`\'"]?',
  'i',
);

export function parseSimpleFileWriteRequest(userPrompt: string): SimpleFileWriteRequest | undefined {
  const text = String(userPrompt || '').trim();
  if (!text || text.length > 12000) return undefined;

  const pathMatch = SIMPLE_FILE_WRITE_PATH_RE.exec(text);
  if (!pathMatch || !pathMatch[1]) return undefined;

  const rawPath = pathMatch[1].trim();

  const contentMarker = /(?:内容为|内容是|内容如下|写入内容(?:为|是)?|content\s*(?:is|:|=)|with\s+content)\s*[:：]?/i.exec(text);
  if (!contentMarker || contentMarker.index < pathMatch.index) return undefined;

  const rawContent = text.slice(contentMarker.index + contentMarker[0].length).trim();
  const content = normalizeSimpleContent(rawContent);
  if (!content || content.length > 20000) return undefined;

  return { path: rawPath, content };
}

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

  if (input.callbacks.onBeforeFileWrite) {
    const allowed = await input.callbacks.onBeforeFileWrite(resolved.absPath, {
      purpose: 'workspace-edit',
      userRequested: true,
      displayName: resolved.relPath,
      requestPrompt: input.userPrompt,
    });
    if (!allowed) {
      return finishSimpleFileTask({
        ...input,
        todos: failLinearAgentTodo(todos, 0),
        writtenFiles: [],
        terminalEvidence: [],
        failedReason: `写入被权限或保护规则阻止：${resolved.relPath}`,
      });
    }
  }

  input.callbacks.onToolActivity?.('write', resolved.relPath);
  let writeResult;
  try {
    writeResult = workspaceEditService.commitTextFileProposal(
      workspaceEditService.proposeTextFileWrite(resolved.absPath, request.content),
      baseline,
      {
        validateSourceSanity: true,
        repairSourceTransportEscapes: true,
      },
    ).result;
  } catch (error) {
    return finishSimpleFileTask({
      ...input,
      todos: failLinearAgentTodo(todos, 0),
      writtenFiles: [],
      terminalEvidence: [],
      failedReason: `源码语法护栏阻止写入：${error instanceof Error ? error.message : String(error)}`,
    });
  }
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
    });
  }

  return finishSimpleFileTask({
    ...input,
    todos: buildFinalSimpleFileTodos(contentVerifiedTodos, validation.evidence, 'completed'),
    writtenFiles: [writtenFile],
    terminalEvidence,
    failedReason: '',
    qualityGate: validation.qualityGate,
    summary: validation.evidence?.kind === 'other'
      ? `已创建 ${resolved.relPath}，并通过文件存在、内容读取和大小检查验证。`
      : `已创建 ${resolved.relPath}，并通过自动验证。`,
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

async function finishSimpleFileTask(input: SimpleFileTaskInput & {
  todos: TodoItem[];
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  failedReason: string;
  summary?: string;
  qualityGate?: AgenticHistoryQualityGate;
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

function trimTrailingVerificationClause(value: string): string {
  return value
    .replace(/(?:[，,;；。.]?\s*(?:并|然后|并且|同时|随后)?\s*(?:验证|确认|检查|校验)[\s\S]*)$/i, '')
    .replace(/(?:[，,;；.]?\s*(?:and\s+then\s+|then\s+|and\s+)?(?:verify|check|confirm)\b[\s\S]*)$/i, '')
    .trim();
}

function normalizeSimpleContent(value: string): string {
  const text = trimTrailingVerificationClause(value);
  const unwrapped = unwrapSimpleContent(text);
  if (unwrapped !== text.trim()) return unwrapped;
  return unwrapped.replace(/。$/, '').trimEnd();
}

function unwrapSimpleContent(value: string): string {
  let text = value.trim();
  if (!text) return '';
  const quotePairs: Array<[string, string]> = [['`', '`'], ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  for (const [open, close] of quotePairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  return text;
}
