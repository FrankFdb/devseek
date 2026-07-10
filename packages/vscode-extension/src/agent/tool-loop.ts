import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  createDevSeekTraceLogger,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import { looksLikeRawToolCallText, parseGeneratedArtifacts } from '../generated-file-parser';
import { resolveGeneratedArtifactPathForPrompt, resolveWorkspaceWritePath } from '../workspace/path-resolver';
import { WorkspaceEditService } from '../workspace/edit-service';
import {
  decideProjectInstructionFileWrite,
} from '../workspace/instruction-file-safety';
import { AgentToolExecutor, type EvidenceRef } from './tool-executor';
import { containsFakeToolCallProtocol, type FakeTool } from './fake-tool-parser';
import { cleanAgentFinalSummaryForUser } from './agentic-summary';
import {
  detectNestedFilePayloadDrift,
  detectShellFileWriteCommand,
  isInsideWorkspacePath,
  resolveAgentToolEvidencePath,
  shouldBlockUnverifiedSourceOverwrite,
} from './write-guard';
import {
  classifyTerminalEvidenceCommand,
  coalesceWrittenFileEvidence,
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

const workspaceEditService = new WorkspaceEditService();
const agentToolExecutor = new AgentToolExecutor();
const NON_WORK_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete', 'memory_write']);
const TOOL_TRACE_LOGGERS = new Map<string, DevSeekTraceLogger>();

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

function promptLooksLikeCppProgram(userPrompt: string): boolean {
  return /(?:c\+\+|cpp|\.cpp\b|\.cc\b|\.cxx\b|C\+\+)/i.test(userPrompt);
}

function promptLooksLikeCProgram(userPrompt: string): boolean {
  return /(?:\bC\b|C语言|c程序|\.c\b)/i.test(userPrompt) && !promptLooksLikeCppProgram(userPrompt);
}

function contentLooksLikeCProgram(content: string): boolean {
  return /#include\s*</.test(content) && /\bmain\s*\(/.test(content) && !contentLooksLikeCppProgram(content);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function defaultCodeArtifactBasename(userPrompt: string): string {
  return /(?:三维|3d|3D|OpenGL|GLUT|动画世界)/i.test(userPrompt) ? '3d_world' : 'main';
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

function isLikelyWritableFilePathForAgent(filePath: string): boolean {
  const normalized = (filePath || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  const base = nodePath.posix.basename(normalized);
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return /\.[A-Za-z0-9]+$/.test(base);
}

function inferCArtifactFromMarkdown(text: string, userPrompt: string): Array<{path: string; content: string}> {
  const wantsCpp = promptLooksLikeCppProgram(userPrompt);
  const wantsC = !wantsCpp && promptLooksLikeCProgram(userPrompt);
  if (!wantsCpp && !wantsC) return [];
  const blockRe = /```(?:c|cpp|cxx|cc|c\+\+)\s*\n([\s\S]*?)```/gi;
  const results: Array<{path: string; content: string}> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const content = (m[1] || '').trim();
    if (!/#include\s*</.test(content) || !/\bmain\s*\(/.test(content)) continue;
    if (wantsCpp && !contentLooksLikeCppProgram(content) && !/(?:c\+\+|cpp|cxx|cc)/i.test(m[0].slice(0, 24))) continue;
    const before = text.slice(Math.max(0, m.index - 400), m.index);
    const pathMatch = before.match(/([A-Za-z0-9_./-]+\.(?:c|cc|cpp|cxx))\b/g);
    const ext = wantsCpp ? '.cpp' : '.c';
    const path = pathMatch?.[pathMatch.length - 1] || `code/${defaultCodeArtifactBasename(userPrompt)}${ext}`;
    results.push({ path: normalizeGeneratedArtifactPathForAgent(path, userPrompt), content });
  }
  return results;
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

export async function applyMarkdownFileArtifactsForLoop(
  text: string,
  userPrompt: string,
  workspaceRoot: string,
  callbacks: AgentLoopCallbacks,
  writeGuard?: {
    requireReadBeforeOverwrite?: boolean;
    readEvidencePaths?: Iterable<string>;
  },
): Promise<{ feedbackForAI: string; writtenFiles: WrittenFileEvidence[] }> {
  const parsed = parseGeneratedArtifacts(text)
    .filter((artifact): artifact is Extract<ReturnType<typeof parseGeneratedArtifacts>[number], { type: 'file' }> => artifact.type === 'file')
    .map(artifact => ({ path: artifact.path, content: artifact.content }));
  const inferred = parsed.length > 0 ? [] : inferCArtifactFromMarkdown(text, userPrompt);
  const candidates = parsed.length > 0 ? parsed : inferred;
  const feedback: string[] = [];
  const writtenFiles: WrittenFileEvidence[] = [];
  const seen = new Set<string>();

  for (const artifact of candidates) {
    if (!artifact.path || !artifact.content.trim()) continue;
    const resolvedWrite = resolveWorkspaceWritePath(artifact.path, {
      requestPrompt: userPrompt,
      content: artifact.content,
      workspaceRootFsPath: workspaceRoot,
      defaultWorkdir: workspaceRoot,
    });
    if (!resolvedWrite) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（无法解析为工作区内路径）`);
      continue;
    }
    if (!isLikelyWritableFilePathForAgent(resolvedWrite.relPath)) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（目标是目录或缺少文件名）`);
      continue;
    }
    const instructionDecision = decideProjectInstructionFileWrite({
      filePath: resolvedWrite.relPath,
      content: artifact.content,
      requestPrompt: userPrompt,
    });
    if (!instructionDecision.allowed) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（${instructionDecision.reason ?? '项目指令文件写入未被允许'}）`);
      continue;
    }
    const resolvedAbs = resolvedWrite.absPath;
    const payloadDrift = detectNestedFilePayloadDrift({
      targetAbsPath: resolvedAbs,
      content: artifact.content,
      workspaceRoot,
      defaultWorkdir: workspaceRoot,
    });
    if (payloadDrift.block) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过：${payloadDrift.reason}`);
      continue;
    }
    if (seen.has(resolvedAbs)) continue;
    seen.add(resolvedAbs);
    try {
      if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isDirectory()) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过（目标是目录）`);
        continue;
      }
    } catch { /* allow normal write path to report errors */ }
    const existed = fs.existsSync(resolvedAbs);
    if (writeGuard?.requireReadBeforeOverwrite) {
      const guard = shouldBlockUnverifiedSourceOverwrite({
        absPath: resolvedAbs,
        existed,
        readEvidencePaths: writeGuard.readEvidencePaths,
      });
      if (guard.block) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过：${guard.reason}`);
        continue;
      }
    }
    if (callbacks.onBeforeFileWrite) {
      const allowed = await callbacks.onBeforeFileWrite(resolvedAbs, {
        purpose: 'tool-write',
        userRequested: false,
        displayName: resolvedWrite.relPath,
        requestPrompt: userPrompt,
      });
      if (!allowed) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过（写入权限策略阻止）`);
        continue;
      }
    }
    callbacks.onToolActivity?.('write', resolvedWrite.relPath);
    let writeResult;
    try {
      writeResult = workspaceEditService.writeTextFileSync(resolvedAbs, artifact.content, {
        validateSourceSanity: true,
        repairSourceTransportEscapes: true,
      });
    } catch (error) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（源码语法护栏）：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (writeResult.normalization) {
      feedback.push(
        `[generated_file: ${artifact.path}] 诊断: 已修复 ${writeResult.normalization.repairCount} 处源码工具协议转义污染。`,
      );
    }
    if (writeResult.existed && writeResult.oldContent === writeResult.newContent) {
      feedback.push(`[generated_file: ${artifact.path}] 未发生内容变化，未计入本轮修改证据：${resolvedWrite.relPath}`);
      continue;
    }
    await callbacks.onAppliedChange({ path: resolvedAbs, ...writeResult });
    const newLines = writeResult.newContent.split('\n').length;
    const oldLines = writeResult.oldContent ? writeResult.oldContent.split('\n').length : 0;
    writtenFiles.push({
      path: resolvedAbs,
      basename: nodePath.basename(resolvedAbs),
      linesAdded: newLines,
      linesRemoved: oldLines,
      action: writeResult.existed ? 'modify' : 'create',
    });
    feedback.push(`[generated_file: ${artifact.path}] 已写入 ${resolvedWrite.relPath} (${newLines} 行)`);
  }

  return { feedbackForAI: feedback.join('\n'), writtenFiles };
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
  let deferredCompletedTodoItems: TodoItem[] | undefined;
  let lastTodoItems: TodoItem[] | undefined;
  let summaryEmitted = false;
  // Track consecutive file-write failures per path so feedback can stay specific
  // without steering the model into shell redirection as a write fallback.
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
      const existed = fs.existsSync(absPath);
      if (existed && fs.statSync(absPath).isDirectory()) {
        parts.push(`[${toolName}: ${rawPath}] 错误: 目标是目录，不是文件：${absPath}`);
        return false;
      }
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
      let writeResult;
      try {
        writeResult = workspaceEditService.writeTextFileSync(absPath, content, {
          validateSourceSanity: true,
          repairSourceTransportEscapes: true,
        });
      } catch (error) {
        const reason = `源码语法护栏阻止写入：${error instanceof Error ? error.message : String(error)}`;
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

  // isLastTask: only the final task should emit phase:done and onTaskComplete.
  // For intermediate tasks the orchestrator (runAgentLoop) drives sequencing; side-
  // effects are suppressed here to prevent premature "done" state in the UI.
  // This is the Copilot/Claude Code pattern: orchestrator owns task-sequence state,
  // not the model.
  const isLastTask = !taskContext || taskContext.currentTaskIndex >= taskContext.taskTotal;
  const workspaceRoot = taskContext?.workspaceRoot ?? inferWorkspaceRootForAgentTool(defaultWorkdir);
  const readEvidencePaths = new Set(taskContext?.readEvidencePaths ?? []);
  const trace = getToolTraceLogger(callbacks.traceWorkspaceRoot ?? workspaceRoot, callbacks.traceRunId);
  trace?.debug('tool-loop', 'execute-start', {
    toolCount: tools.length,
    tools: tools.map(t => t.name),
    workTools: tools.filter(t => isAgentWorkToolName(t.name)).map(t => t.name),
    defaultWorkdir,
  });

  for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
    const toolPlan = agentToolExecutor.plan(tools[toolIndex]);
    evidenceRefs.push(...toolPlan.evidence);
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
    if (tool.name === 'manage_todo_list') {
      let items = normalizeVisibleTodos((tool.input.todoList ?? []) as TodoItem[]);
      if (Array.isArray(items)) {
        // Treat todo updates as a real tool action so the loop continues.
        // Some models emit planning-only manage_todo_list in round-1, then
        // emit create/edit tools in round-2 after receiving tool feedback.
        markToolCall(false);
        // ARCHITECTURAL GUARD (mirrors Copilot/Claude Code API-level enforcement):
        // The orchestrator owns task-sequence state. AI may never pre-emptively mark
        // future tasks as completed — clamp any such items back to 'not-started'.
        if (taskContext) {
          items = items.map((item) =>
            typeof item.id === 'number' && item.id > taskContext.currentTaskIndex && item.status === 'completed'
              ? { ...item, status: 'not-started' as const }
              : item,
          );
        }
        // Detect implicit completion: all items are 'completed' → AI is done.
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
        // Re-inject todo state into next round's context (mirrors Copilot's
        // getCurrentTodoContext() — explicit state beats relying on AI memory alone,
        // especially after context-window truncation strips early manage_todo_list messages).
        parts.push(`[manage_todo_list] 任务清单已更新：\n${items.map(i => `${i.id}. [${i.status}] ${i.title}`).join('\n')}`);
      }
    } else if (tool.name === 'task_complete') {
      const summary = typeof tool.input.summary === 'string' ? tool.input.summary : '';
      completeSummary = summary;
      const visibleSummary = cleanAgentFinalSummaryForUser(summary);
      // G-analy-feedback: Stream substantial summaries via ASUM prefix so analysis
      // conclusions are visible even when AI puts all analysis in task_complete rather
      // than inline streaming prose. Webview routes ASUM to currentRaw → prose bubble.
      if (visibleSummary.length > 20 && !taskContext?.requireWorkBeforeComplete) {
        callbacks.onDelta('\x00ASUM\x00' + visibleSummary);
        summaryEmitted = true;
      }
      // Only fire done-phase UI + onTaskComplete for the final task. For intermediate
      // tasks the outer runAgentLoop manages progression — no premature phase:done.
      if (isLastTask && !taskContext?.deferDoneStatus) {
        if (callbacks.onTaskComplete) { await callbacks.onTaskComplete(summary); }
        const finalWrittenFiles = coalesceWrittenFileEvidence(writtenFiles, workspaceRoot);
        await callbacks.onAgentStatus({
          type: 'agentStatus', phase: 'done', state: 'completed',
          title: visibleSummary || '任务已完成',
          ...(finalWrittenFiles.length > 0 ? { editedFiles: finalWrittenFiles } : {}),
        });
      }
      taskComplete = true;
    } else if (tool.name === 'run_terminal' && callbacks.onTerminalCommand) {
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      // Use AI-specified workdir first; fall back to task directory so binaries land
      // in the correct subdirectory (code/) rather than the workspace root.
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
    } else if (tool.name === 'replace_in_file') {
      const input = tool.input as Record<string, unknown>;
      const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
      const oldStr = typeof input.old_str === 'string' ? input.old_str : '';
      const newStr = typeof input.new_str === 'string' ? input.new_str : '';
      const replaceAll = input.replaceAll === true;
      markToolCall();
      if (!rawPath) {
        parts.push(`[replace_in_file] 错误: 缺少 path，未修改任何文件。`);
        continue;
      }
      if (!oldStr) {
        parts.push(`[replace_in_file: ${rawPath}] 错误: old_str 为空，不能执行不确定替换。请先 read_file 后提供精确原文。`);
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
          parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
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
    } else if (agentToolExecutor.isFileWrite(tool) && callbacks.onAppliedChange) {
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
          const result = await callbacks.onCreateDirectory(dirPath);
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
