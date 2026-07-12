import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  createDevSeekTraceLogger,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { looksLikeRawToolCallText } from '../generated-file-parser';
import { resolveGeneratedArtifactPathForPrompt, resolveWorkspaceWritePath } from '../workspace/path-resolver';
import { WorkspaceEditService } from '../workspace/edit-service';
import {
  decideProjectInstructionFileWrite,
} from '../workspace/instruction-file-safety';
import { AgentToolExecutor, type EvidenceRef } from './tool-executor';
import { ToolReadEvidenceRecorder } from './tool-read-evidence';
import { containsFakeToolCallProtocol, type FakeTool } from './fake-tool-parser';
import {
  detectNestedFilePayloadDrift,
  detectShellFileWriteCommand,
  detectShellFileMutationCommand,
  isInsideWorkspacePath,
  resolveAgentToolEvidencePath,
  shouldBlockUnverifiedSourceOverwrite,
} from './write-guard';
import {
  classifyTerminalEvidenceCommand,
  isReadOnlyTerminalEvidenceCommand,
  requiresCodeArtifactForEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import {
  classifyFormattedTerminalExecutionEvidence,
} from '../execution-outcome-classifier';
import type { TodoItem } from './evidence-recovery';
import type { AgentLoopCallbacks } from './loop-types';
import {
  detectTaskOutputScopeDrift,
} from './task-output-scope';
import { decideTerminalCommandPermission } from '../app/terminal-command-policy';
import { buildToolPolicy } from '../app/permission-service';
import type { ToolKind } from '../intent/intent-types';

const workspaceEditService = new WorkspaceEditService();
const agentToolExecutor = new AgentToolExecutor();
const NON_WORK_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete', 'memory_write']);
const TOOL_TRACE_LOGGERS = new Map<string, DevSeekTraceLogger>();

function hasEvidenceAwareToolAuthority(kind: ToolKind, callbacks: AgentLoopCallbacks): boolean {
  switch (kind) {
    case 'edit':
      return typeof callbacks.onBeforeFileWrite === 'function';
    case 'terminal':
      return typeof callbacks.onTerminalCommand === 'function';
    case 'vscode':
    case 'vscode-command':
      return typeof callbacks.onRunVscodeCommand === 'function';
    case 'mcp':
      return typeof callbacks.onMcpToolCall === 'function';
    default:
      return false;
  }
}

export function isAgentWorkToolName(name: string): boolean {
  return !NON_WORK_TOOL_NAMES.has(name);
}

export function buildAgentMetaOnlyToolFeedback(taskDescription?: string): string {
  const scope = taskDescription?.trim()
    ? `当前任务：${taskDescription.trim()}`
    : '当前任务仍缺少真实执行证据。';
  return [
    '【系统反馈】本轮只更新了 todo/记忆/完成状态，没有执行真实工作工具。',
    scope,
    '请继续调用 read_file/list_dir/grep_search/create_file/write_file/run_terminal 等真实工具。',
    '需要编译、运行或验证时，必须使用 run_terminal 并提供可验证的退出码和输出；不要只更新任务清单。',
  ].join('\n');
}

function getToolTraceLogger(workspaceRoot: string | undefined, runId: string | undefined): DevSeekTraceLogger | undefined {
  if (!workspaceRoot || !runId) return undefined;
  const key = `${nodePath.resolve(workspaceRoot)}::${runId}`;
  const existing = TOOL_TRACE_LOGGERS.get(key);
  if (existing) return existing;
  const created = createDevSeekTraceLogger({
    workspaceRoot,
    runId,
    source: 'vscode-extension.tool-loop',
  });
  TOOL_TRACE_LOGGERS.set(key, created);
  return created;
}

export function describeAgentToolActivity(tool: FakeTool): { kind: string; label: string } | undefined {
  return agentToolExecutor.plan(tool).activity ?? undefined;
}

// ── Multi-round tool executor ─────────────────────────────────────────────────
// Handles all fake-tool dispatch: emits results via onDelta and returns
// structured result data so the agentic mini-loop can feed tool outputs back
// to the AI in the next LLM round (Copilot/Cursor style).
// Used by both single-shot analysis paths and the full agentic loop.

export interface ToolLoopResult {
  taskComplete: boolean;
  /** Whether any data-fetching tool was called (triggers next AI round). */
  toolCallsMade: boolean;
  /** Whether any real work tool ran; todo/memory/task_complete are meta tools. */
  workToolCallsMade: boolean;
  /** Combined tool outputs to inject as context for the next AI round. */
  feedbackForAI: string;
  /** task_complete.summary value, if the AI called task_complete (may be empty). */
  completeSummary?: string;
  /** True when manage_todo_list was called and ALL items have status 'completed'.
   *  Used in runAgenticLoop to break early without requiring an explicit task_complete call.
   *  Common for DeepSeek web mode where the AI delivers all tools in one response. */
  allTodosCompleted?: boolean;
  /** Last todo state supplied by manage_todo_list in this loop iteration. */
  todoItems?: TodoItem[];
  /** Whether task_complete.summary was already routed to the final assistant bubble. */
  summaryEmitted?: boolean;
  /** Terminal commands that actually ran during this tool loop iteration. */
  terminalCommands?: string[];
  /** Structured terminal evidence from compile/run/test/read-check commands. */
  terminalEvidence?: TerminalEvidence[];
  /** Files written (created or overwritten) during this tool loop iteration. */
  writtenFiles?: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}>;
  /** Files successfully read through read_file during this tool loop iteration. */
  readFiles?: string[];
  /** Unified evidence refs produced from normalized ToolCall plans. */
  evidenceRefs?: EvidenceRef[];
  /** Blocking tool failures that should be audited across rounds for no-progress loops. */
  toolFailures?: ToolFailureEvidence[];
}

export interface ToolFailureEvidence {
  tool: string;
  kind: 'write' | 'replace' | 'terminal-guard';
  path?: string;
  reason: string;
}

function isInternalMemoryTodo(item: TodoItem): boolean {
  return /(?:项目记忆|智能体记忆|记忆体|memory|memory_write|写入记忆|记录.*记忆)/i.test(item.title || '');
}

export function normalizeVisibleTodos(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) return [];
  return (items as TodoItem[])
    .filter(item => item && typeof item.title === 'string' && item.title.trim() && !isInternalMemoryTodo(item))
    .map((item, index) => ({ ...item, id: index + 1, title: item.title.trim() }));
}

function optionalLineNumber(input: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function shellTokenizeSimple(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | '' = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function hasPollutedReplaceArgument(value: string): boolean {
  return /[\u200B-\u200D\u2060\uFEFF]/.test(value)
    || /<\/?\s*(?:old_?str|new_?str|oldstr|newstr|replace_in_file|TOOL_[A-Za-z0-9_]+)\b/i.test(value);
}

function formatReplaceRecoverySnapshot(content: string): string {
  const maxChars = 4_200;
  if (content.length <= maxChars) {
    return `[current_file_snapshot chars=${content.length}]\n${content}`;
  }
  const head = content.slice(0, 2_400);
  const tail = content.slice(-1_400);
  return [
    `[current_file_snapshot chars=${content.length} truncated=${content.length - head.length - tail.length}]`,
    head,
    '... [中间内容已省略，请用 read_file 指定行范围继续读取] ...',
    tail,
  ].join('\n');
}

function resolveCompilerOutputPath(command: string, workdir: string): string | undefined {
  const tokens = shellTokenizeSimple(command);
  const compilerIndex = tokens.findIndex(t => /^(?:g\+\+|gcc|clang\+\+|clang)(?:-\d+)?$/.test(nodePath.basename(t)));
  if (compilerIndex < 0) return undefined;
  const compilerArgs = tokens.slice(compilerIndex + 1);
  if (compilerArgs.some(t => t === '-c' || t === '-S' || t === '-E' || t === '-fsyntax-only')) return undefined;

  let output = '';
  for (let i = 0; i < compilerArgs.length; i++) {
    const token = compilerArgs[i];
    if (token === '-o' && compilerArgs[i + 1]) {
      output = compilerArgs[i + 1];
      break;
    }
    if (token.startsWith('-o') && token.length > 2) {
      output = token.slice(2);
      break;
    }
  }
  if (!output) output = 'a.out';
  if (!output || output.startsWith('-')) return undefined;
  return nodePath.isAbsolute(output) ? output : nodePath.resolve(workdir || process.cwd(), output);
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function analyzeTerminalEvidence(command: string, formattedOutput: string, workdir: string): { ran: boolean; evidence: TerminalEvidence } {
  const executionEvidence = classifyFormattedTerminalExecutionEvidence(formattedOutput);
  const kind = classifyTerminalEvidenceCommand(command);
  let ok = executionEvidence.ok;
  let detail = executionEvidence.detail;
  const outputPath = resolveCompilerOutputPath(command, workdir);
  if (ok && outputPath && !isExecutableFile(outputPath)) {
    ok = false;
    detail = `编译命令退出码为 0，但未找到可执行产物：${outputPath}`;
  }
  return {
    ran: executionEvidence.ran,
    evidence: {
      command,
      kind,
      ok,
      exitCode: executionEvidence.exitCode,
      ...(outputPath ? { outputPath } : {}),
      ...(detail ? { detail } : {}),
      ...(executionEvidence.reviewRequired ? { reviewRequired: true } : {}),
    },
  };
}

function normalizeGeneratedArtifactPathForAgent(rawPath: string, userPrompt: string): string {
  return resolveGeneratedArtifactPathForPrompt(rawPath, userPrompt);
}

function promptRequestsCodeDirectory(userPrompt: string): boolean {
  return /(?:code\s*目录|code目录|code\/|code\s+dir|code\s+folder)/i.test(userPrompt);
}

function contentLooksLikeCProgram(content: string): boolean {
  return /#include\s*</.test(content) && /\bmain\s*\(/.test(content) && !contentLooksLikeCppProgram(content);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function normalizeExplicitFileWritePathForAgent(
  rawPath: string,
  userPrompt: string,
  content: string,
  workspaceRootFsPath?: string,
  defaultWorkdir?: string,
): { path: string; absPath?: string; note?: string } {
  const resolved = resolveWorkspaceWritePath(rawPath, {
    requestPrompt: userPrompt,
    content,
    workspaceRootFsPath,
    defaultWorkdir,
  });
  if (resolved) {
    return {
      path: resolved.relPath,
      absPath: resolved.absPath,
      ...(resolved.note ? { note: resolved.note } : {}),
    };
  }

  const p = normalizeGeneratedArtifactPathForAgent(rawPath, userPrompt);
  return { path: p };
}

function inferWorkspaceRootForAgentTool(defaultWorkdir?: string): string {
  if (defaultWorkdir) {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (isInsideWorkspacePath(defaultWorkdir, folder.uri.fsPath)) {
        return folder.uri.fsPath;
      }
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? defaultWorkdir ?? process.cwd();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const FILE_WRITE_PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'];
const FILE_WRITE_CONTENT_KEYS = ['content', 'contents', 'text', 'body'];
const FILE_WRITE_CONTENT_ALIAS_KEYS = [
  ...FILE_WRITE_CONTENT_KEYS,
  'fileContent', 'file_content', 'source', 'code', 'newContent', 'new_content',
];
const FILE_WRITE_BATCH_KEYS = ['files', 'artifacts', 'changes', 'edits'];

function getStringInput(input: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

function getFileContentInput(input: Record<string, unknown>): string {
  for (const key of FILE_WRITE_CONTENT_ALIAS_KEYS) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeFileWriteInputs(input: Record<string, unknown>): Array<{rawPath: string; content: string}> {
  const directRawPath = getStringInput(input, FILE_WRITE_PATH_KEYS);
  const directContent = getFileContentInput(input);
  const batch: Array<{rawPath: string; content: string}> = [];

  for (const key of FILE_WRITE_BATCH_KEYS) {
    const value = input[key];
    const items = Array.isArray(value) ? value : asRecord(value) ? [value] : [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const rawPath = getStringInput(record, [...FILE_WRITE_PATH_KEYS, 'file', 'name', 'relativePath']);
      const content = getFileContentInput(record);
      if (rawPath || content) batch.push({ rawPath, content });
    }
  }

  if (batch.length > 0) return batch;
  if (directRawPath || directContent) return [{ rawPath: directRawPath, content: directContent }];
  return [];
}

export async function executeFakeToolsForLoop(
  tools: FakeTool[],
  callbacks: AgentLoopCallbacks,
  defaultWorkdir?: string,
  taskContext?: {
    currentTaskIndex: number;
    taskTotal: number;
    deferDoneStatus?: boolean;
    requireWorkBeforeComplete?: boolean;
    userPrompt?: string;
    workspaceRoot?: string;
    requireReadBeforeOverwrite?: boolean;
    readEvidencePaths?: string[];
    readEvidenceRecorder?: ToolReadEvidenceRecorder;
  },
): Promise<ToolLoopResult> {
  let taskComplete = false;
  let toolCallsMade = false;
  let workToolCallsMade = false;
  const markToolCall = (isWorkTool = true): void => {
    toolCallsMade = true;
    if (isWorkTool) workToolCallsMade = true;
  };
  let completeSummary: string | undefined;
  let allTodosCompleted = false;
  const parts: string[] = [];
  const writtenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  const readFiles: string[] = [];
  const terminalCommands: string[] = [];
  const terminalEvidence: TerminalEvidence[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  const toolFailures: ToolFailureEvidence[] = [];
  const replaceMissSnapshots = new Set<string>();
  let deferredCompletedTodoItems: TodoItem[] | undefined;
  let lastTodoItems: TodoItem[] | undefined;
  let summaryEmitted = false;
  const createFileFailCounts = new Map<string, number>();
  const recordToolFailure = (
    toolName: string,
    kind: ToolFailureEvidence['kind'],
    rawPath: string | undefined,
    reason: string,
  ): void => {
    toolFailures.push({
      tool: toolName,
      kind,
      ...(rawPath ? { path: rawPath } : {}),
      reason,
    });
  };
  const applyWorkspaceFileContent = async (
    toolName: string,
    rawPath: string,
    content: string,
  ): Promise<boolean> => {
    if (!callbacks.onAppliedChange) {
      parts.push(`[${toolName}] 错误: 当前运行环境没有注册文件写入执行器，未写入任何文件。`);
      return false;
    }
    if (!rawPath) {
      parts.push(`[${toolName}] 错误: 缺少 path/filePath，未写入任何文件。请提供目标文件路径和完整 content。`);
      return false;
    }
    callbacks.onToolActivity?.('write', rawPath);
    try {
      const taskPrompt = taskContext?.userPrompt ?? '';
      const normalized = normalizeExplicitFileWritePathForAgent(rawPath, taskPrompt, content, workspaceRoot, defaultWorkdir);
      if (normalized.note) parts.push(`[${toolName}: ${rawPath}] 诊断: ${normalized.note}`);
      if (!content && requiresCodeArtifactForEvidence(taskPrompt)) {
        parts.push(`[${toolName}: ${rawPath}] 错误: content 为空，不能创建空源码文件。请提供完整文件内容。`);
        return false;
      }
      if (looksLikeRawToolCallText(content)) {
        parts.push(`[${toolName}: ${rawPath}] 错误: content 是工具调用文本，不是文件内容，已阻止写入。请只把目标文件源码放入 content。`);
        return false;
      }
      const absPath = normalized.absPath;
      if (!absPath) {
        parts.push(`[${toolName}: ${rawPath}] 错误: 无法解析为工作区内文件路径，已阻止写入。`);
        return false;
      }
      const instructionDecision = decideProjectInstructionFileWrite({
        filePath: normalized.path,
        content,
        requestPrompt: taskPrompt,
      });
      if (!instructionDecision.allowed) {
        parts.push(`[${toolName}: ${rawPath}] 错误: ${instructionDecision.reason ?? '项目指令文件写入未被允许'}`);
        return false;
      }
      const payloadDrift = detectNestedFilePayloadDrift({
        targetAbsPath: absPath,
        content,
        workspaceRoot,
        defaultWorkdir,
      });
      if (payloadDrift.block) {
        parts.push(`[${toolName}: ${rawPath}] 错误: ${payloadDrift.reason}`);
        return false;
      }
      let baseline;
      try {
        baseline = workspaceEditService.captureTextFileBaseline(absPath, workspaceRoot);
      } catch (error) {
        const reason = `工作区写入边界阻止写入：${error instanceof Error ? error.message : String(error)}`;
        recordToolFailure(toolName, 'write', rawPath, reason);
        parts.push(`[${toolName}: ${rawPath}] 错误: ${reason}`);
        return false;
      }
      const existed = baseline.snapshot.existed;
      if (taskContext?.requireReadBeforeOverwrite) {
        const guard = shouldBlockUnverifiedSourceOverwrite({
          absPath,
          existed,
          readEvidencePaths,
        });
        if (guard.block) {
          parts.push(`[${toolName}: ${rawPath}] 错误: ${guard.reason}`);
          return false;
        }
      }
      if (callbacks.onBeforeFileWrite) {
        const allowed = await callbacks.onBeforeFileWrite(absPath, {
          purpose: 'tool-write',
          userRequested: false,
          displayName: rawPath,
          requestPrompt: taskPrompt,
        });
        if (!allowed) {
          parts.push(`[${toolName}: ${rawPath}] 跳过（写入权限策略阻止）`);
          return false;
        }
      }
      let writeResult;
      try {
        writeResult = workspaceEditService.commitTextFileProposal(
          workspaceEditService.proposeTextFileWrite(absPath, content),
          baseline,
          {
            validateSourceSanity: true,
            repairSourceTransportEscapes: true,
          },
        ).result;
      } catch (error) {
        const reason = `源码语法护栏阻止写入：${error instanceof Error ? error.message : String(error)}`;
        recordToolFailure(toolName, 'write', rawPath, reason);
        parts.push(`[${toolName}: ${rawPath}] 错误: ${reason}`);
        return false;
      }
      const persistedContent = fs.readFileSync(absPath, 'utf8');
      if (persistedContent !== writeResult.newContent) {
        const reason = `写入后读回内容不一致：${absPath}`;
        recordToolFailure(toolName, 'write', rawPath, reason);
        parts.push(`[${toolName}: ${rawPath}] 错误: ${reason}`);
        return false;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size === 0) {
        const failN = (createFileFailCounts.get(rawPath) || 0) + 1;
        createFileFailCounts.set(rawPath, failN);
        let errMsg = `[${toolName}: ${rawPath}] 错误: 写入后校验失败（不是有效文件或文件为空）：${absPath}`;
        if (failN >= 2) errMsg += `\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file/replace_in_file，并检查 path 与内容参数是否正确。`;
        recordToolFailure(toolName, 'write', rawPath, `写入后校验失败（不是有效文件或文件为空）：${absPath}`);
        parts.push(errMsg);
        return false;
      }
      if (writeResult.normalization) {
        parts.push(`[${toolName}: ${rawPath}] 诊断: 已修复 ${writeResult.normalization.repairCount} 处源码工具协议转义污染。`);
      }
      if (writeResult.existed && writeResult.oldContent === writeResult.newContent) {
        recordToolFailure(toolName, 'write', rawPath, `未发生内容变化：${normalized.path}`);
        parts.push(`[${toolName}: ${rawPath}] 未发生内容变化，未计入本轮修改证据：${normalized.path}`);
        return false;
      }
      await callbacks.onAppliedChange({ path: absPath, ...writeResult });
      const newLines = writeResult.newContent.split('\n').length;
      const oldLines = writeResult.oldContent ? writeResult.oldContent.split('\n').length : 0;
      writtenFiles.push({
        path: absPath,
        basename: nodePath.basename(absPath),
        linesAdded: newLines,
        linesRemoved: oldLines,
        action: writeResult.existed ? 'modify' : 'create',
      });
      evidenceRefs.push(readEvidenceRecorder.recordArtifactReadback(absPath, persistedContent));
      parts.push(`[${toolName}: ${rawPath}] 已写入 ${normalized.path} (${newLines} 行)`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = typeof err === 'object' && err && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
      if ((code === 'EACCES' || code === 'EPERM') && callbacks.onTerminalCommand) {
        const normalized = normalizeExplicitFileWritePathForAgent(rawPath, taskContext?.userPrompt ?? '', content, workspaceRoot, defaultWorkdir);
        const dir = normalized.absPath ? nodePath.dirname(normalized.absPath) : (defaultWorkdir ?? workspaceRoot);
        callbacks.onToolActivity?.('terminal', `请求修复写入权限: ${nodePath.basename(dir)}`);
        const repair = await callbacks.onTerminalCommand(`chmod u+w ${shellQuote(dir)}`, defaultWorkdir);
        parts.push(`[${toolName}: ${rawPath}] 权限不足: ${msg}\n[permission_repair]\n${repair}`);
      } else {
        const failN = (createFileFailCounts.get(rawPath) || 0) + 1;
        createFileFailCounts.set(rawPath, failN);
        let errMsg = `[${toolName}: ${rawPath}] 错误: ${msg}`;
        if (failN >= 2) errMsg += `\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file/replace_in_file，并检查 path、content/old_str/new_str 和目标目录。`;
        recordToolFailure(toolName, 'write', rawPath, msg);
        parts.push(errMsg);
      }
      return false;
    }
  };

  const workspaceRoot = taskContext?.workspaceRoot ?? inferWorkspaceRootForAgentTool(defaultWorkdir);
  const readEvidencePaths = new Set(taskContext?.readEvidencePaths ?? []);
  const trace = getToolTraceLogger(callbacks.traceWorkspaceRoot ?? workspaceRoot, callbacks.traceRunId);
  const readEvidenceRecorder = taskContext?.readEvidenceRecorder
    ?? new ToolReadEvidenceRecorder(workspaceRoot, callbacks.traceRunId);
  trace?.debug('tool-loop', 'execute-start', {
    toolCount: tools.length,
    tools: tools.map(t => t.name),
    workTools: tools.filter(t => isAgentWorkToolName(t.name)).map(t => t.name),
    defaultWorkdir,
  });

  for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
    const toolPlan = agentToolExecutor.plan(
      tools[toolIndex],
      buildToolPolicy(callbacks.executionMode ?? 'inspect'),
    );
    const tool = toolPlan.tool;
    const inputValidation = agentToolExecutor.validateInput(toolPlan);
    if (!inputValidation.ok) {
      markToolCall(isAgentWorkToolName(tool.name));
      parts.push([
        `[${tool.name || 'unknown'}] 工具调用无效：${inputValidation.error}`,
        `请按工具说明重新调用，并提供完整 JSON 参数；不要省略必填字段。`,
      ].join('\n'));
      continue;
    }
    if (toolPlan.permission?.action === 'deny') {
      markToolCall(isAgentWorkToolName(tool.name));
      parts.push(`[${tool.name}] 工具调用被执行策略拒绝：${toolPlan.permission.reason}`);
      continue;
    }
    if (toolPlan.permission?.action === 'requireConfirm' && !hasEvidenceAwareToolAuthority(toolPlan.kind, callbacks)) {
      markToolCall(isAgentWorkToolName(tool.name));
      parts.push(`[${tool.name}] 工具调用被拒绝：需要确认，但当前执行面没有证据感知的授权边界。`);
      continue;
    }
    if (tool.name === 'manage_todo_list') {
      let items = normalizeVisibleTodos((tool.input.todoList ?? []) as TodoItem[]);
      if (Array.isArray(items)) {
        // Planning-only todo updates must keep the loop alive for later work tools.
        markToolCall(false);
        // The orchestrator owns task sequence state; the model cannot complete future tasks.
        if (taskContext) {
          items = items.map((item) =>
            typeof item.id === 'number' && item.id > taskContext.currentTaskIndex && item.status === 'completed'
              ? { ...item, status: 'not-started' as const }
              : item,
          );
        }
        const todoUpdateIsAllCompleted = items.length > 0 && items.every(it => it.status === 'completed');
        const hasLaterWorkTools = tools.slice(toolIndex + 1).some(t => isAgentWorkToolName(t.name));
        callbacks.onToolActivity?.('todo', items.map(i => i.title).filter(Boolean).slice(0, 3).join('、') || '更新任务清单');
        if (todoUpdateIsAllCompleted && (hasLaterWorkTools || taskContext?.requireWorkBeforeComplete)) {
          deferredCompletedTodoItems = items;
        } else if (callbacks.onTodoUpdate) {
          await callbacks.onTodoUpdate(items);
        }
        if (todoUpdateIsAllCompleted) {
          allTodosCompleted = true;
        }
        lastTodoItems = items;
        // Re-inject explicit todo state because context truncation can drop earlier updates.
        parts.push(`[manage_todo_list] 任务清单已更新：\n${items.map(i => `${i.id}. [${i.status}] ${i.title}`).join('\n')}`);
      }
    } else if (tool.name === 'task_complete') {
      const summary = typeof tool.input.summary === 'string' ? tool.input.summary : '';
      completeSummary = summary;
      // task_complete is a model intent only. The orchestrator owns user-visible
      // completion, checkpoint clearing, and final settlement after host evidence.
      taskComplete = true;
    } else if (tool.name === 'run_terminal' && callbacks.onTerminalCommand) {
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      const workdir = typeof tool.input.workdir === 'string' ? tool.input.workdir : defaultWorkdir;
      if (command) {
        markToolCall();
        if (containsFakeToolCallProtocol(command)) {
          const msg = [
            `[run_terminal] 已阻止`,
            `检测到工具协议文本被放入 command 字段，不能作为 shell 命令执行。`,
            `请重新发起标准工具调用，只把真实命令放入 run_terminal.command。`,
          ].join('\n');
          callbacks.onToolActivity?.('terminal', '阻止工具协议文本进入终端');
          parts.push(msg);
          continue;
        }
        const shellWriteTarget = detectShellFileWriteCommand(command);
        if (shellWriteTarget) {
          const reason = `检测到通过 shell 重定向/tee 写入源码文件：${shellWriteTarget}`;
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            reason,
            `请改用 create_file 或 write_file，并把完整文件内容放入 content 字段。run_terminal 仅用于编译、运行、测试、查询。`,
          ].join('\n');
          callbacks.onToolActivity?.('terminal', `阻止 shell 写文件: ${nodePath.basename(shellWriteTarget)}`);
          recordToolFailure('run_terminal', 'terminal-guard', shellWriteTarget, reason);
          parts.push(msg);
          continue;
        }
        const shellMutation = detectShellFileMutationCommand(command);
        if (shellMutation) {
          const reason = `检测到终端命令绕过结构化文件工具执行工作区变更：${shellMutation}`;
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            reason,
            '请使用 create_directory/create_file/write_file/replace_in_file/delete_file；run_terminal 仅用于查询、编译、运行和测试。',
          ].join('\n');
          callbacks.onToolActivity?.('terminal', `阻止终端文件变更: ${shellMutation}`);
          recordToolFailure('run_terminal', 'terminal-guard', shellMutation, reason);
          parts.push(msg);
          continue;
        }
        const outputScopeDrift = detectTaskOutputScopeDrift({
          requestPrompt: taskContext?.userPrompt,
          text: `${command}\n${workdir ?? ''}`,
          workspaceRoot,
        });
        if (outputScopeDrift.blocked) {
          const reason = outputScopeDrift.reason ?? '检测到旧运行目录或过期产物路径。';
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            reason,
            `请使用当前用户指定的输出目录重新生成命令；不要复用旧时间戳目录或旧会话路径。`,
          ].join('\n');
          callbacks.onToolActivity?.('terminal', '阻止旧运行目录命令');
          recordToolFailure('run_terminal', 'terminal-guard', command, reason);
          parts.push(msg);
          continue;
        }
        const terminalPermission = decideTerminalCommandPermission({ command, workspaceRoot, workdir });
        if (terminalPermission.risk !== 'read-only' && terminalPermission.risk !== 'validation') {
          const reason = `终端命令未通过只读/验证分类：${terminalPermission.reason}`;
          callbacks.onToolActivity?.('terminal', `阻止未分类终端命令: ${terminalPermission.risk}`);
          recordToolFailure('run_terminal', 'terminal-guard', command, reason);
          parts.push(`[run_terminal: ${command}] 已阻止\n${reason}\n请改用结构化文件工具；run_terminal 仅允许只读查询和已分类验证命令。`);
          continue;
        }
        callbacks.onToolActivity?.('terminal', command);
        try {
          const output = await callbacks.onTerminalCommand(command, workdir);
          const evidenceResult = analyzeTerminalEvidence(command, output, workdir ?? defaultWorkdir ?? workspaceRoot);
          if (evidenceResult.ran) {
            terminalCommands.push(command);
          }
          if (evidenceResult.evidence.kind !== 'other' || isReadOnlyTerminalEvidenceCommand(command)) {
            terminalEvidence.push(evidenceResult.evidence);
          }
          // Silent: output goes to AI context only (shown in Working box via terminalRanNotice)
          parts.push(`[run_terminal: ${command}]\n${output}`);
          if (evidenceResult.evidence.kind !== 'other' && !evidenceResult.evidence.ok) {
            parts.push(
              `[terminal_evidence]\n` +
              `验证命令未通过，不能把编译/运行/测试标记为完成。\n` +
              `kind=${evidenceResult.evidence.kind} exitCode=${evidenceResult.evidence.exitCode ?? 'unknown'}\n` +
              `${evidenceResult.evidence.detail ?? '请根据终端输出修复后重新验证。'}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[run_terminal: ${command}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'read_file' && callbacks.onReadFile) {
      const filePath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      if (filePath) {
        markToolCall();
        try {
          // Pass defaultWorkdir so bare filenames like "main.cpp" resolve relative to
          // the current task's directory first (Copilot/Claude Code: tool calls inherit
          // task working directory context, not just workspace root).
          const content = await callbacks.onReadFile(filePath, defaultWorkdir, {
            startLine: optionalLineNumber(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine'),
            endLine: optionalLineNumber(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine'),
          });
          callbacks.onToolActivity?.('read', filePath);
          const readEvidencePath = resolveAgentToolEvidencePath(filePath, workspaceRoot, defaultWorkdir);
          if (readEvidencePath) {
            readFiles.push(readEvidencePath);
            readEvidencePaths.add(readEvidencePath);
          }
          evidenceRefs.push(readEvidenceRecorder.record(content, readEvidencePath || filePath));
          // Silent: file content goes to AI context only (shown as chip in Working box)
          parts.push(`[read_file: ${filePath}]\n${content}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[read_file: ${filePath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'grep_search' && callbacks.onGrepSearch) {
      const pattern = typeof tool.input.pattern === 'string' ? tool.input.pattern : '';
      const searchPath = typeof tool.input.path === 'string' ? tool.input.path : undefined;
      const isRegexp = tool.input.isRegexp !== false;
      if (pattern) {
        markToolCall();
        try {
          const results = await callbacks.onGrepSearch(pattern, searchPath, isRegexp, defaultWorkdir, {
            includePattern: typeof tool.input.includePattern === 'string' ? tool.input.includePattern : undefined,
            fileTypes: typeof tool.input.fileTypes === 'string' ? tool.input.fileTypes : undefined,
          });
          callbacks.onToolActivity?.('search', searchPath ? `"${pattern}" in ${searchPath}` : `"${pattern}"`);
          // Silent: search results go to AI context only
          parts.push(`[grep_search: "${pattern}"${searchPath ? ` in ${searchPath}` : ''}]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[grep_search: "${pattern}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'list_dir' && callbacks.onListDir) {
      const p = typeof tool.input.path === 'string' ? tool.input.path : '.';
      markToolCall();
      try {
        const listing = await callbacks.onListDir(p);
        callbacks.onToolActivity?.('list', p);
        // Silent: directory listing goes to AI context only
        parts.push(`[list_dir: ${p}]\n${listing}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[list_dir: ${p}] 错误: ${msg}`);
      }
    } else if (tool.name === 'get_errors' && callbacks.onGetErrors) {
      markToolCall();
      try {
        const errors = await callbacks.onGetErrors();
        // Silent: errors go to AI context only
        parts.push(`[get_errors]\n${errors}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[get_errors] 错误: ${msg}`);
      }
    } else if ((tool.name === 'file_search' || tool.name === 'search_file') && callbacks.onFileSearch) {
      const input = tool.input as Record<string, unknown>;
      const directGlob = typeof input.glob === 'string' ? input.glob.trim() : '';
      const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : '';
      const targetDir = typeof input.target_directory === 'string'
        ? input.target_directory.trim()
        : typeof input.targetDirectory === 'string'
          ? input.targetDirectory.trim()
          : typeof input.path === 'string'
            ? input.path.trim()
            : '';
      const glob = directGlob || (targetDir && pattern ? nodePath.join(targetDir, pattern) : pattern);
      if (glob) {
        markToolCall();
        try {
          const results = await callbacks.onFileSearch(glob);
          callbacks.onToolActivity?.('search', `glob:${glob}`);
          // Silent: file list goes to AI context only
          parts.push(`[file_search: "${glob}"]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[file_search: "${glob}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'semantic_search' && callbacks.onGrepSearch) {
      // Semantic search: no embeddings available, fall back to keyword OR-grep across workspace.
      // Extract significant tokens from the query (skip short stop words).
      const query = typeof (tool.input as Record<string, unknown>)?.query === 'string'
        ? (tool.input as Record<string, string>).query.trim()
        : '';
      if (query) {
        markToolCall();
        try {
          // Build an OR-pattern from significant words (>3 chars) to cast a wide net.
          const words = query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 6);
          const pattern = words.length > 0 ? words.join('|') : query.slice(0, 100);
          const results = await callbacks.onGrepSearch(pattern, undefined, true, defaultWorkdir);
          callbacks.onToolActivity?.('search', `semantic:"${query.slice(0, 50)}"`);
          // Silent: search results go to AI context only
          parts.push(`[semantic_search: "${query}"]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[semantic_search: "${query}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'memory_write' && callbacks.onMemoryWrite) {
      const content = typeof (tool.input as Record<string, unknown>)?.content === 'string'
        ? (tool.input as Record<string, string>).content.slice(0, 500)
        : '';
      if (content) {
        try {
          await callbacks.onMemoryWrite({
            type: 'verified-experience', scope: 'repository', content, source: { kind: 'agent' }, reason: 'Agent memory_write tool', tags: ['agent'], requiresUserApproval: false,
          });
          parts.push(`[memory_write] 已写入记忆：${content.slice(0, 80)}`);
          callbacks.onToolActivity?.('memory', `记忆已保存: ${content.slice(0, 60)}`);
        } catch (err) {
          parts.push(`[memory_write] 失败：${(err as Error).message}`);
        }
      }
    } else if (tool.name === 'delete_file') {
      const rawPath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      markToolCall();
      if (!rawPath) {
        const reason = '缺少 path，未删除任何文件。';
        recordToolFailure('delete_file', 'write', undefined, reason);
        parts.push(`[delete_file] 错误: ${reason}`);
        continue;
      }
      const absPath = resolveAgentToolEvidencePath(rawPath, workspaceRoot, defaultWorkdir);
      try {
        if (!absPath || (workspaceRoot && !isInsideWorkspacePath(absPath, workspaceRoot))) {
          const reason = '无法解析为工作区内文件路径，已阻止删除。';
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (!fs.existsSync(absPath)) {
          const reason = '目标文件不存在，无法删除。请先 list_dir/read_file 确认当前路径。';
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
          const reason = '目标是目录；delete_file 只允许删除已确认的单个文件。';
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (taskContext?.requireReadBeforeOverwrite) {
          const guard = shouldBlockUnverifiedSourceOverwrite({
            absPath,
            existed: true,
            readEvidencePaths,
          });
          if (guard.block) {
            const reason = guard.reason ?? '删除既有源码前必须先读取同一路径。';
            recordToolFailure('delete_file', 'write', rawPath, reason);
            parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
            continue;
          }
        }
        if (callbacks.onBeforeFileWrite) {
          const allowed = await callbacks.onBeforeFileWrite(absPath, {
            purpose: 'tool-write',
            userRequested: false,
            taskAction: 'delete_file',
            displayName: rawPath,
            requestPrompt: taskContext?.userPrompt ?? '',
          });
          if (!allowed) {
            parts.push(`[delete_file: ${rawPath}] 跳过（写入权限策略阻止）`);
            continue;
          }
        }
        const oldContent = fs.readFileSync(absPath, 'utf8');
        workspaceEditService.deleteTextFile(absPath, workspaceRoot);
        callbacks.onToolActivity?.('write', `删除 ${rawPath}`);
        await callbacks.onAppliedChange({
          path: absPath,
          existed: true,
          oldContent,
          newContent: '',
        });
        writtenFiles.push({
          path: absPath,
          basename: nodePath.basename(absPath),
          linesAdded: 0,
          linesRemoved: oldContent ? oldContent.split('\n').length : 0,
          action: 'delete',
        });
        parts.push(`[delete_file: ${rawPath}] 已删除 ${absPath}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        recordToolFailure('delete_file', 'write', rawPath, reason);
        parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
      }
    } else if (tool.name === 'replace_in_file') {
      const input = tool.input as Record<string, unknown>;
      const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
      const oldStr = typeof input.old_str === 'string' ? input.old_str : '';
      const newStr = typeof input.new_str === 'string' ? input.new_str : '';
      const replaceAll = input.replaceAll === true;
      markToolCall();
      if (!rawPath) {
        const reason = '缺少 path，未修改任何文件。';
        recordToolFailure('replace_in_file', 'replace', undefined, reason);
        parts.push(`[replace_in_file] 错误: ${reason}`);
        continue;
      }
      if (!oldStr) {
        const reason = 'old_str 为空，不能执行不确定替换。请先 read_file 后提供精确原文。';
        recordToolFailure('replace_in_file', 'replace', rawPath, reason);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      if (hasPollutedReplaceArgument(oldStr) || hasPollutedReplaceArgument(newStr)) {
        const reason = 'old_str/new_str 混入工具标签或不可见控制字符，无法作为可信补丁执行。请基于最新文件快照重新生成结构化替换参数。';
        recordToolFailure('replace_in_file', 'replace', rawPath, reason);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      if (oldStr === newStr) {
        const reason = 'old_str 与 new_str 完全相同，不会产生任何修改。请重新 read_file 后给出真正变化的替换内容。';
        recordToolFailure('replace_in_file', 'replace', rawPath, reason);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      const absPath = resolveAgentToolEvidencePath(rawPath, workspaceRoot, defaultWorkdir);
      try {
        if (!absPath || !fs.existsSync(absPath)) {
          const reason = '目标文件不存在，无法替换。请先 list_dir/read_file 确认路径。';
          recordToolFailure('replace_in_file', 'replace', rawPath, reason);
          parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
          parts.push(`[replace_in_file: ${rawPath}] 错误: 目标是目录，不是文件：${absPath}`);
          continue;
        }
        const oldContent = fs.readFileSync(absPath, 'utf8');
        readFiles.push(absPath);
        readEvidencePaths.add(absPath);
        if (!oldContent.includes(oldStr)) {
          const reason = 'old_str 未在当前文件中找到。请重新 read_file 读取最新内容后再精确替换。';
          recordToolFailure('replace_in_file', 'replace', rawPath, reason);
          const snapshotKey = nodePath.normalize(absPath);
          const snapshot = replaceMissSnapshots.has(snapshotKey)
            ? '当前文件快照已在本轮前一个失败结果中提供，请不要继续猜测 old_str。'
            : formatReplaceRecoverySnapshot(oldContent);
          replaceMissSnapshots.add(snapshotKey);
          parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}\n${snapshot}`);
          continue;
        }
        const nextContent = replaceAll
          ? oldContent.split(oldStr).join(newStr)
          : oldContent.slice(0, oldContent.indexOf(oldStr)) + newStr + oldContent.slice(oldContent.indexOf(oldStr) + oldStr.length);
        await applyWorkspaceFileContent('replace_in_file', rawPath, nextContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        recordToolFailure('replace_in_file', 'replace', rawPath, msg);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${msg}`);
      }
    } else if (agentToolExecutor.isFileWrite(tool)) {
      // Unified file create/overwrite — works for new files AND full rewrites.
      // Matching Copilot's #edit/editFiles for the agentic free-explore loop.
      const fileWrites = normalizeFileWriteInputs(tool.input);
      markToolCall();
      if (fileWrites.length === 0) {
        parts.push(`[${tool.name}] 错误: 缺少 path/filePath 和 content，未写入任何文件。批量写入请使用 files:[{path,content}]。`);
        continue;
      }
      for (const fileWrite of fileWrites) {
        const { rawPath, content } = fileWrite;
        await applyWorkspaceFileContent(tool.name, rawPath, content);
      }
    } else if (tool.name === 'get_changed_files' && callbacks.onGetChangedFiles) {
      markToolCall();
      try {
        const result = await callbacks.onGetChangedFiles();
        callbacks.onToolActivity?.('search', 'git changes');
        parts.push(`[get_changed_files]\n${result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[get_changed_files] 错误: ${msg}`);
      }
    } else if (tool.name === 'create_directory' && callbacks.onCreateDirectory) {
      const dirPath = typeof (tool.input as Record<string, unknown>).path === 'string'
        ? (tool.input as Record<string, string>).path.trim()
        : '';
      if (dirPath) {
        markToolCall();
        callbacks.onToolActivity?.('write', `mkdir ${dirPath}`);
        try {
          const absPath = resolveAgentToolEvidencePath(dirPath, workspaceRoot, defaultWorkdir);
          if (!callbacks.onBeforeFileWrite) {
            parts.push(`[create_directory: ${dirPath}] 跳过（缺少写入授权边界）`);
            continue;
          }
          const allowed = await callbacks.onBeforeFileWrite(absPath, {
            purpose: 'tool-write',
            userRequested: false,
            taskAction: 'create_directory',
            displayName: dirPath,
            requestPrompt: taskContext?.userPrompt ?? '',
          });
          if (!allowed) {
            parts.push(`[create_directory: ${dirPath}] 跳过（写入权限策略阻止）`);
            continue;
          }
          const result = await callbacks.onCreateDirectory(absPath, { policyPreauthorized: true });
          parts.push(`[create_directory: ${dirPath}] ${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[create_directory: ${dirPath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'fetch_webpage' && callbacks.onFetchWebpage) {
      const url = typeof (tool.input as Record<string, unknown>).url === 'string'
        ? (tool.input as Record<string, string>).url.trim()
        : '';
      if (url) {
        markToolCall();
        callbacks.onToolActivity?.('web', url.replace(/^https?:\/\//, '').slice(0, 60));
        try {
          const result = await callbacks.onFetchWebpage(url);
          parts.push(`[fetch_webpage: ${url}]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[fetch_webpage: ${url}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'vscode_listCodeUsages' && callbacks.onListCodeUsages) {
      const symbol = typeof (tool.input as Record<string, unknown>).symbol === 'string'
        ? (tool.input as Record<string, string>).symbol.trim()
        : '';
      const filePath = typeof (tool.input as Record<string, unknown>).filePath === 'string'
        ? (tool.input as Record<string, string>).filePath.trim()
        : undefined;
      if (symbol) {
        markToolCall();
        callbacks.onToolActivity?.('search', `refs:${symbol}`);
        try {
          const result = await callbacks.onListCodeUsages(symbol, filePath);
          parts.push(`[vscode_listCodeUsages: "${symbol}"]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[vscode_listCodeUsages: "${symbol}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'run_vscode_command' && callbacks.onRunVscodeCommand) {
      const command = typeof (tool.input as Record<string, unknown>).command === 'string'
        ? (tool.input as Record<string, string>).command.trim()
        : '';
      const args = Array.isArray((tool.input as Record<string, unknown>).args)
        ? (tool.input as Record<string, unknown[]>).args
        : undefined;
      if (command) {
        markToolCall();
        callbacks.onToolActivity?.('terminal', `⚡ ${command}`);
        try {
          const result = await callbacks.onRunVscodeCommand(command, args);
          parts.push(`[run_vscode_command: ${command}]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[run_vscode_command: ${command}] 错误: ${msg}`);
        }
      }
    } else if (tool.name.startsWith('mcp__') && callbacks.onMcpToolCall) {
      markToolCall();
      try {
        const result = await callbacks.onMcpToolCall(tool.name, tool.input as Record<string, unknown>);
        // Silent: MCP result goes to AI context only
        parts.push(`[${tool.name}]\n${result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[${tool.name}] 错误: ${msg}`);
        callbacks.onToolActivity?.('terminal', `❌ ${tool.name}: ${msg.slice(0, 50)}`);
      }
    }
  }

  if (deferredCompletedTodoItems && callbacks.onTodoUpdate && !taskContext?.requireWorkBeforeComplete) {
    await callbacks.onTodoUpdate(deferredCompletedTodoItems);
  }
  trace?.debug('tool-loop', 'execute-complete', {
    taskComplete,
    toolCallsMade,
    workToolCallsMade,
    feedbackLength: parts.join('\n\n').length,
    terminalCommandCount: terminalCommands.length,
    terminalEvidenceCount: terminalEvidence.length,
    writtenFileCount: writtenFiles.length,
    readFileCount: readFiles.length,
    evidenceRefCount: evidenceRefs.length,
    toolFailureCount: toolFailures.length,
  });
  return {
    taskComplete,
    toolCallsMade,
    workToolCallsMade,
    feedbackForAI: parts.join('\n\n'),
    completeSummary,
    allTodosCompleted,
    todoItems: lastTodoItems,
    summaryEmitted,
    terminalCommands: terminalCommands.length > 0 ? terminalCommands : undefined,
    terminalEvidence: terminalEvidence.length > 0 ? terminalEvidence : undefined,
    writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
    readFiles: readFiles.length > 0 ? readFiles : undefined,
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
    toolFailures: toolFailures.length > 0 ? toolFailures : undefined,
  };
}
