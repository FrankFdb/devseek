import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  codingSemanticDigest,
  codingToolExecutionFailureReason,
  createDevSeekTraceLogger,
  decideTerminalCommandPermission,
  isFileWriteToolName,
  normalizeCodingFileWriteInputs,
  type CodingToolCall,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
  type DevSeekTraceLogger,
} from '@devseek-netai/shared';
import {
  WorkspaceEditService,
  type WorkspaceDeleteResult,
} from '../workspace/edit-service';
import { VsCodeWorkspaceMutationAdapter } from '../workspace/coding-workspace-mutation-adapter';
import type { EvidenceRef } from './tool-executor';
import { getAgentToolActivity } from './tool-activity';
import { ToolReadEvidenceRecorder } from './tool-read-evidence';
import { containsFakeToolCallProtocol, type FakeTool } from './fake-tool-parser';
import {
  detectShellFileWriteCommand,
  detectShellFileMutationCommand,
  isInsideWorkspacePath,
  resolveAgentToolEvidencePath,
  shouldBlockUnverifiedSourceOverwrite,
} from './write-guard';
import {
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { AgentLoopCallbacks } from './loop-types';
import { resolveTerminalCommandCapabilities } from '../app/environment-capability-resolver';
import { buildToolPolicy } from '../app/permission-service';
import type { ToolKind } from '../intent/intent-types';
import {
  createToolLoopCanonicalSession,
} from './tool-loop-canonical-session';
import { ToolLoopFileWriter } from './tool-loop-file-writer';
import { observeSettledTerminalExecution } from './tool-loop-terminal-observation';
import { resolveTextReplacement } from './text-replacement';
import { formatFileMutationRecoverySnapshot } from './file-mutation-recovery-snapshot';
import { applySingleFilePatch, SingleFilePatchError } from './single-file-patch';
import type {
  ToolFileAccessEvent,
  ToolFailureEvidence,
  ToolLoopResult,
  ToolSuppressionEvidence,
} from './tool-loop-result';

export { analyzeTerminalEvidence } from './tool-loop-terminal-evidence';
export type { ToolFailureEvidence, ToolLoopResult, ToolSuppressionEvidence } from './tool-loop-result';

const workspaceEditService = new WorkspaceEditService();
const workspaceMutation = new VsCodeWorkspaceMutationAdapter(workspaceEditService);
const NON_WORK_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete']);
const TOOL_TRACE_LOGGERS = new Map<string, DevSeekTraceLogger>();

function hasEvidenceAwareToolAuthority(kind: ToolKind, callbacks: AgentLoopCallbacks): boolean {
  switch (kind) {
    case 'edit':
      return typeof callbacks.onResolveFileWriteConstraint === 'function';
    case 'terminal':
      return typeof callbacks.onPrepareTerminalCommand === 'function';
    case 'vscode':
    case 'vscode-command':
      return typeof callbacks.onPrepareVscodeCommand === 'function';
    case 'memory':
      return typeof callbacks.onPrepareMemoryWrite === 'function';
    case 'mcp':
      return typeof callbacks.onPrepareMcpToolCall === 'function';
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
    '【系统反馈】本轮只更新了 todo/完成状态，没有执行真实工作工具。',
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
  return getAgentToolActivity(tool) ?? undefined;
}

// ── Multi-round tool executor ─────────────────────────────────────────────────
// Handles all fake-tool dispatch: emits results via onDelta and returns
// structured result data so the agentic mini-loop can feed tool outputs back
// to the AI in the next LLM round (Copilot/Cursor style).
// Used by both single-shot analysis paths and the full agentic loop.

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

function hasPollutedReplaceArgument(value: string): boolean {
  return /[\u200B-\u200D\u2060\uFEFF]/.test(value)
    || /<\/?\s*(?:old_?str|new_?str|oldstr|newstr|patch|replace_in_file|apply_patch|TOOL_[A-Za-z0-9_]+)\b/i.test(value);
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

export async function executeFakeToolsForLoop(
  tools: Array<FakeTool | CodingToolCall>,
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
    targetedReadEvidencePaths?: string[];
    readEvidenceRecorder?: ToolReadEvidenceRecorder;
    verificationScopeFiles?: readonly WrittenFileEvidence[];
    plannedTerminalValidation?: {
      command: string;
      workdir: string;
    };
    suppressedTools?: readonly ToolSuppressionEvidence[];
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
  const fileAccessEvents: ToolFileAccessEvent[] = [];
  let fileAccessSequence = 0;
  const writtenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  const readFiles: string[] = [];
  const terminalCommands: string[] = [];
  const terminalOutputs: Array<{command: string; workdir: string; output: string}> = [];
  const terminalEvidence: TerminalEvidence[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  const changeReceipts: CodingWorkspaceMutationReceipt<unknown>[] = [];
  const toolExecutionReceipts: CodingToolExecutionReceipt<unknown>[] = [];
  const verificationReceipts: CodingVerificationReceipt[] = [];
  const toolFailures: ToolFailureEvidence[] = [];
  const replaceMissSnapshots = new Set<string>();
  let cancellationFeedbackEmitted = false;
  let deferredCompletedTodoItems: TodoItem[] | undefined;
  let lastTodoItems: TodoItem[] | undefined;
  let summaryEmitted = false;
  const cancellationRequested = (): boolean => callbacks.signal?.aborted === true;
  const recordCancellationFeedback = (toolName?: string, rawPath?: string): void => {
    if (cancellationFeedbackEmitted) return;
    cancellationFeedbackEmitted = true;
    const target = toolName ? `${toolName}${rawPath ? `: ${rawPath}` : ''}` : 'tool-loop';
    parts.push(`[cancelled: ${target}] 用户已取消，未执行后续工具。`);
  };
  const recordToolFailure = (
    toolName: string,
    kind: ToolFailureEvidence['kind'],
    rawPath: string | undefined,
    reason: string,
    strategyFingerprint?: string,
  ): void => {
    toolFailures.push({
      tool: toolName,
      kind,
      ...(rawPath ? { path: rawPath } : {}),
      reason,
      ...(strategyFingerprint ? { strategyFingerprint } : {}),
    });
  };

  const workspaceRoot = taskContext?.workspaceRoot ?? inferWorkspaceRootForAgentTool(defaultWorkdir);
  const readEvidencePaths = new Set(taskContext?.readEvidencePaths ?? []);
  const targetedReadEvidencePaths = new Set(taskContext?.targetedReadEvidencePaths ?? []);
  const trace = getToolTraceLogger(callbacks.traceWorkspaceRoot ?? workspaceRoot, callbacks.traceRunId);
  const readEvidenceRecorder = taskContext?.readEvidenceRecorder
    ?? new ToolReadEvidenceRecorder(workspaceRoot, callbacks.traceRunId);
  const canonicalTools = createToolLoopCanonicalSession({
    callbacks,
    receipts: toolExecutionReceipts,
    evidenceRefs,
  });
  const fileWriter = new ToolLoopFileWriter({
    callbacks,
    workspaceRoot,
    defaultWorkdir,
    requireReadBeforeOverwrite: taskContext?.requireReadBeforeOverwrite,
    readEvidencePaths,
    targetedReadEvidencePaths,
    readEvidenceRecorder,
    canonical: canonicalTools,
    reporter: {
      feedback: message => parts.push(message),
      failure: (toolName, rawPath, reason, strategyFingerprint) => recordToolFailure(
        toolName,
        'write',
        rawPath,
        reason,
        strategyFingerprint,
      ),
      cancellation: (toolName, rawPath) => recordCancellationFeedback(toolName, rawPath),
      written: file => {
        writtenFiles.push(file);
        fileAccessEvents.push({ kind: 'write', path: file.path, sequence: ++fileAccessSequence });
      },
      evidence: ref => evidenceRefs.push(ref),
      change: receipt => changeReceipts.push(receipt),
    },
  });
  trace?.debug('tool-loop', 'execute-start', {
    toolCount: tools.length,
    tools: tools.map(t => t.name),
    workTools: tools.filter(t => isAgentWorkToolName(t.name)).map(t => t.name),
    suppressedToolCount: taskContext?.suppressedTools?.length ?? 0,
    suppressedTools: taskContext?.suppressedTools ?? [],
    defaultWorkdir,
  });

  for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
    if (cancellationRequested()) {
      recordCancellationFeedback();
      trace?.debug('tool-loop', 'execute-cancelled-before-tool', {
        toolIndex,
        remainingToolCount: tools.length - toolIndex,
      });
      break;
    }
    const toolPlan = canonicalTools.plan(
      tools[toolIndex],
      buildToolPolicy(callbacks.executionMode ?? 'inspect'),
      workspaceRoot,
    );
    const tool = toolPlan.tool;
    const inputValidation = canonicalTools.validateInput(toolPlan);
    const expandedFileWritePlans = inputValidation.ok
      && isFileWriteToolName(tool.name)
      && tool.name !== 'replace_in_file'
      && tool.name !== 'apply_patch'
      ? normalizeCodingFileWriteInputs(tool.input).map(({ rawPath, content }) => ({
          rawPath,
          content,
          plan: canonicalTools.plan({
            ...tool,
            input: { path: rawPath, content },
          }, buildToolPolicy(callbacks.executionMode ?? 'inspect'), workspaceRoot),
        }))
      : [];
    const canonicalContext = canonicalTools.nextContext(expandedFileWritePlans[0]?.plan ?? toolPlan);
    if (!inputValidation.ok) {
      markToolCall(isAgentWorkToolName(tool.name));
      await canonicalTools.settle(toolPlan, canonicalContext, {
        execute: async () => ({
          status: 'failed',
          errorCode: 'invalid-tool-input',
          evidenceRefs: [`vscode-tool-input:${canonicalContext.actionId}:invalid`],
        }),
      });
      parts.push([
        `[${tool.name || 'unknown'}] 工具调用无效：${inputValidation.error}`,
        `请按工具说明重新调用，并提供完整 JSON 参数；不要省略必填字段。`,
      ].join('\n'));
      continue;
    }
    if (toolPlan.permission?.action === 'deny') {
      markToolCall(isAgentWorkToolName(tool.name));
      await canonicalTools.settle(toolPlan, canonicalContext, {
        execute: async () => { throw new Error('denied tool host must not execute'); },
      });
      parts.push(`[${tool.name}] 工具调用被执行策略拒绝：${toolPlan.permission.reason}`);
      continue;
    }
    if (toolPlan.permission?.action === 'requireConfirm' && !hasEvidenceAwareToolAuthority(toolPlan.kind, callbacks)) {
      markToolCall(isAgentWorkToolName(tool.name));
      await canonicalTools.settle(toolPlan, canonicalContext, {
        execute: async () => { throw new Error('unconfirmed tool host must not execute'); },
      });
      parts.push(`[${tool.name}] 工具调用被拒绝：需要确认，但当前执行面没有证据感知的授权边界。`);
      continue;
    }
    if (tool.name === 'manage_todo_list') {
      let items = normalizeVisibleTodos((tool.input.todoList ?? []) as TodoItem[]);
      if (Array.isArray(items)) {
        markToolCall(false);
        // The orchestrator owns task sequence state; the model cannot complete future tasks.
        if (taskContext) {
          items = items.map((item) =>
            typeof item.id === 'number' && item.id > taskContext.currentTaskIndex && item.status === 'completed'
              ? { ...item, status: 'not-started' as const }
              : item,
          );
        }
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          async () => items,
          settledItems => readEvidenceRecorder.recordObservation(
            'plan',
            'manage_todo_list',
            JSON.stringify(settledItems),
            workspaceRoot,
          ),
        );
        if (execution.receipt.status !== 'completed' || !Array.isArray(execution.receipt.result)) {
          const reason = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', undefined, reason);
          parts.push(`[manage_todo_list] 错误: ${reason}`);
          continue;
        }
        items = execution.receipt.result;
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
      markToolCall(false);
      const execution = await canonicalTools.observe(
        toolPlan,
        canonicalContext,
        async () => summary,
        settledSummary => readEvidenceRecorder.recordObservation(
          'plan',
          'task_complete',
          settledSummary,
          workspaceRoot,
        ),
      );
      if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
        completeSummary = execution.receipt.result;
        // This receipt records model intent only. Completion remains owned by the orchestrator.
        taskComplete = true;
        const suppressedTailTools = tools.slice(toolIndex + 1).filter(t => isAgentWorkToolName(t.name)).map(t => t.name);
        if (suppressedTailTools.length > 0) {
          trace?.debug('tool-loop', 'suppress-tools-after-task-complete', {
            taskCompleteIndex: toolIndex,
            suppressedToolCount: suppressedTailTools.length,
            suppressedTools: suppressedTailTools,
          });
          parts.push(`[task_complete] 已忽略完成信号后的 ${suppressedTailTools.length} 个工具调用：${suppressedTailTools.join(', ')}。`);
        }
        break;
      } else {
        const reason = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
        recordToolFailure(tool.name, 'tool-host', undefined, reason);
        parts.push(`[task_complete] 错误: ${reason}`);
      }
    } else if (tool.name === 'run_terminal' && callbacks.onPrepareTerminalCommand) {
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      const workdir = typeof tool.input.workdir === 'string' ? tool.input.workdir : defaultWorkdir;
      if (command) {
        markToolCall();
        const isPlannedTerminalValidation = taskContext?.plannedTerminalValidation?.command === command
          && nodePath.resolve(taskContext.plannedTerminalValidation.workdir) === nodePath.resolve(workdir ?? workspaceRoot);
        if (containsFakeToolCallProtocol(command)) {
          const msg = [
            `[run_terminal] 已阻止`,
            `检测到工具协议文本被放入 command 字段，不能作为 shell 命令执行。`,
            `请重新发起标准工具调用，只把真实命令放入 run_terminal.command。`,
          ].join('\n');
          callbacks.onToolActivity?.('terminal', '阻止工具协议文本进入终端');
          await canonicalTools.deny(toolPlan, canonicalContext, 'terminal-tool-protocol-in-command');
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
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          recordToolFailure('run_terminal', 'terminal-guard', shellWriteTarget, reason);
          parts.push(msg);
          continue;
        }
        const shellMutation = detectShellFileMutationCommand(command);
        if (shellMutation && !isPlannedTerminalValidation) {
          const reason = `检测到终端命令绕过结构化文件工具执行工作区变更：${shellMutation}`;
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            reason,
            '请使用 create_directory/create_file/write_file/replace_in_file/apply_patch/delete_file；run_terminal 仅用于查询、编译、运行和测试。',
          ].join('\n');
          callbacks.onToolActivity?.('terminal', `阻止终端文件变更: ${shellMutation}`);
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          recordToolFailure('run_terminal', 'terminal-guard', shellMutation, reason);
          parts.push(msg);
          continue;
        }
        const capabilityResolution = resolveTerminalCommandCapabilities({ command, workspaceRoot, workdir });
        if (capabilityResolution.blocked) {
          const reason = capabilityResolution.reason ?? 'missing-runtime-capability';
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            capabilityResolution.notes.join('\n') || '当前系统缺少执行该命令所需的运行环境。',
            '请改用当前系统可用的运行时，或先征得用户同意后安装缺失工具。',
          ].join('\n');
          callbacks.onToolActivity?.('terminal', '阻止缺失运行环境命令');
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          recordToolFailure('run_terminal', 'terminal-capability', command, reason);
          parts.push(msg);
          continue;
        }
        const resolvedCommand = capabilityResolution.command;
        if (capabilityResolution.changed) {
          const note = capabilityResolution.notes.join('\n');
          callbacks.onToolActivity?.('terminal', note || '已解析本机运行环境');
          parts.push(`[run_terminal] ${note}\n原命令: ${command}\n执行命令: ${resolvedCommand}`);
        }
        const terminalPermission = isPlannedTerminalValidation
          ? {
            risk: 'validation' as const,
            requiresConfirmation: true,
            canRememberDecision: true,
            reason: 'orchestrator-planned-validation',
          }
          : decideTerminalCommandPermission({ command: resolvedCommand, workspaceRoot, workdir });
        if (terminalPermission.risk !== 'read-only' && terminalPermission.risk !== 'validation') {
          const reason = `终端命令未通过只读/验证分类：${terminalPermission.reason}`;
          callbacks.onToolActivity?.('terminal', `阻止未分类终端命令: ${terminalPermission.risk}`);
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          recordToolFailure('run_terminal', 'terminal-guard', resolvedCommand, reason);
          const recoveryGuidance = terminalPermission.reason === 'unclassified-command'
            ? [
              '若这是验证命令，请拆成工作区内的构建、程序运行、test/check/verify 命令，并按顺序分别调用 run_terminal。',
              '不要用重复读取文件替代必须执行的验证；若这是文件修改，请改用结构化文件工具。',
            ]
            : [
              '请把命令及工作目录限制在当前工作区内后重试；文件修改请改用结构化文件工具。',
            ];
          parts.push([
            `[run_terminal: ${resolvedCommand}] 已阻止`,
            reason,
            ...recoveryGuidance,
          ].join('\n'));
          continue;
        }
        callbacks.onToolActivity?.('terminal', resolvedCommand);
        let canonicalSettled = false;
        try {
          const prepared = await callbacks.onPrepareTerminalCommand(resolvedCommand, workdir);
          let observedOutput = '';
          const execution = await canonicalTools.settle(toolPlan, canonicalContext, {
            execute: async () => {
              const hostResult = await prepared.execute();
              observedOutput = hostResult.result ?? '';
              return hostResult;
            },
          }, prepared.constraint);
          canonicalSettled = true;
          const output = execution.receipt.result ?? observedOutput;
          if (execution.receipt.status === 'denied') {
            const reason = execution.receipt.permission.reason;
            recordToolFailure('run_terminal', 'terminal-guard', resolvedCommand, reason);
            parts.push(`[run_terminal: ${resolvedCommand}] 已拒绝：${reason}`);
            continue;
          }
          if (!output) {
            const reason = codingToolExecutionFailureReason(execution.receipt);
            recordToolFailure('run_terminal', 'terminal-guard', resolvedCommand, reason);
            parts.push(`[run_terminal: ${resolvedCommand}] 错误: ${reason}`);
            continue;
          }
          const evidenceWorkdir = workdir ?? defaultWorkdir ?? workspaceRoot;
          const observation = await observeSettledTerminalExecution({
            command: resolvedCommand,
            output,
            workdir: evidenceWorkdir,
            workspaceRoot,
            toolReceipt: execution.receipt,
            readEvidenceRecorder,
            writtenFiles: [...(taskContext?.verificationScopeFiles ?? []), ...writtenFiles],
            acceptance: callbacks.canonicalVerificationAcceptance,
            verification: callbacks.canonicalVerification,
          });
          terminalOutputs.push(observation.output);
          evidenceRefs.push(observation.evidenceRef);
          terminalCommands.push(...observation.terminalCommands);
          terminalEvidence.push(...observation.terminalEvidence);
          verificationReceipts.push(...observation.verificationReceipts);
          parts.push(...observation.feedbackParts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!canonicalSettled) {
            await canonicalTools.deny(toolPlan, canonicalContext, `terminal-authority-failed:${msg}`);
          }
          recordToolFailure(tool.name, 'tool-host', resolvedCommand, msg);
          parts.push(`[run_terminal: ${resolvedCommand}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'read_file' && callbacks.onReadFile) {
      const filePath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      if (filePath) {
        markToolCall();
        const readEvidencePath = resolveAgentToolEvidencePath(filePath, workspaceRoot, defaultWorkdir);
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onReadFile!(filePath, defaultWorkdir, {
            startLine: optionalLineNumber(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine'),
            endLine: optionalLineNumber(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine'),
          }),
          content => readEvidenceRecorder.record(content, readEvidencePath || filePath),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const content = execution.receipt.result;
          callbacks.onToolActivity?.('read', filePath);
          if (readEvidencePath) {
            readFiles.push(readEvidencePath);
            fileAccessEvents.push({
              kind: 'read',
              path: readEvidencePath,
              sequence: ++fileAccessSequence,
              sourceSegmentIndex: parts.length,
            });
          }
          parts.push(`[read_file: ${filePath}]\n${content}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', filePath, msg);
          parts.push(`[read_file: ${filePath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'grep_search' && callbacks.onGrepSearch) {
      const pattern = typeof tool.input.pattern === 'string' ? tool.input.pattern : '';
      const searchPath = typeof tool.input.path === 'string' ? tool.input.path : undefined;
      const isRegexp = tool.input.isRegexp !== false;
      if (pattern) {
        markToolCall();
        const label = searchPath ? `"${pattern}" in ${searchPath}` : `"${pattern}"`;
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onGrepSearch!(pattern, searchPath, isRegexp, defaultWorkdir, {
            includePattern: typeof tool.input.includePattern === 'string' ? tool.input.includePattern : undefined,
            fileTypes: typeof tool.input.fileTypes === 'string' ? tool.input.fileTypes : undefined,
          }),
          results => readEvidenceRecorder.recordObservation('search', label, results, searchPath ?? workspaceRoot),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const results = execution.receipt.result;
          callbacks.onToolActivity?.('search', label);
          parts.push(`[grep_search: "${pattern}"${searchPath ? ` in ${searchPath}` : ''}]\n${results}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', searchPath, msg);
          parts.push(`[grep_search: "${pattern}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'list_dir' && callbacks.onListDir) {
      const p = typeof tool.input.path === 'string' ? tool.input.path : '.';
      markToolCall();
      const execution = await canonicalTools.observe(
        toolPlan,
        canonicalContext,
        () => callbacks.onListDir!(p),
        listing => readEvidenceRecorder.recordObservation('search', `list:${p}`, listing, p),
      );
      if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
        const listing = execution.receipt.result;
        callbacks.onToolActivity?.('list', p);
        parts.push(`[list_dir: ${p}]\n${listing}`);
      } else {
        const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
        recordToolFailure(tool.name, 'tool-host', p, msg);
        parts.push(`[list_dir: ${p}] 错误: ${msg}`);
      }
    } else if (tool.name === 'get_errors' && callbacks.onGetErrors) {
      markToolCall();
      const execution = await canonicalTools.observe(
        toolPlan,
        canonicalContext,
        () => callbacks.onGetErrors!(),
        errors => readEvidenceRecorder.recordObservation('diagnostics', 'workspace diagnostics', errors, workspaceRoot),
      );
      if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
        const errors = execution.receipt.result;
        parts.push(`[get_errors]\n${errors}`);
      } else {
        const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
        recordToolFailure(tool.name, 'tool-host', undefined, msg);
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
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onFileSearch!(glob),
          results => readEvidenceRecorder.recordObservation('search', `glob:${glob}`, results, targetDir || workspaceRoot),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const results = execution.receipt.result;
          callbacks.onToolActivity?.('search', `glob:${glob}`);
          parts.push(`[file_search: "${glob}"]\n${results}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', targetDir, msg);
          parts.push(`[file_search: "${glob}"] 错误: ${msg}`);
        }
      } else {
        const reason = '缺少可执行的 glob/pattern，未搜索工作区。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-file-search-pattern');
        recordToolFailure(tool.name, 'tool-host', targetDir, reason);
        parts.push(`[file_search] 错误: ${reason}`);
      }
    } else if (tool.name === 'semantic_search' && callbacks.onGrepSearch) {
      // Semantic search: no embeddings available, fall back to keyword OR-grep across workspace.
      // Extract significant tokens from the query (skip short stop words).
      const query = typeof (tool.input as Record<string, unknown>)?.query === 'string'
        ? (tool.input as Record<string, string>).query.trim()
        : '';
      if (query) {
        markToolCall();
        const words = query
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3)
          .slice(0, 6);
        const pattern = words.length > 0 ? words.join('|') : query.slice(0, 100);
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onGrepSearch!(pattern, undefined, true, defaultWorkdir),
          results => readEvidenceRecorder.recordObservation('search', `semantic:${query}`, results, workspaceRoot),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const results = execution.receipt.result;
          callbacks.onToolActivity?.('search', `semantic:"${query.slice(0, 50)}"`);
          parts.push(`[semantic_search: "${query}"]\n${results}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', undefined, msg);
          parts.push(`[semantic_search: "${query}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'memory_search' && callbacks.onMemorySearch) {
      const query = typeof tool.input.query === 'string' ? tool.input.query.trim() : '';
      if (query) {
        markToolCall();
        const maxResults = optionalLineNumber(tool.input, 'maxResults');
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onMemorySearch!(query, maxResults),
          result => readEvidenceRecorder.recordObservation('search', `memory:${query}`, result, 'MEMORY.md'),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          callbacks.onToolActivity?.('memory', query);
          parts.push(`[memory_search: ${query}]\n${execution.receipt.result}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', 'MEMORY.md', msg);
          parts.push(`[memory_search: ${query}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'memory_read' && callbacks.onMemoryRead) {
      const memoryPath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      if (memoryPath) {
        markToolCall();
        const startLine = optionalLineNumber(tool.input, 'startLine');
        const maxLines = optionalLineNumber(tool.input, 'maxLines');
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onMemoryRead!(memoryPath, startLine, maxLines),
          result => readEvidenceRecorder.recordObservation('search', `memory-read:${memoryPath}`, result, memoryPath),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          callbacks.onToolActivity?.('memory', memoryPath);
          parts.push(`[memory_read: ${memoryPath}]\n${execution.receipt.result}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', memoryPath, msg);
          parts.push(`[memory_read: ${memoryPath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'memory_write' && callbacks.onPrepareMemoryWrite) {
      const content = typeof (tool.input as Record<string, unknown>)?.content === 'string'
        ? (tool.input as Record<string, string>).content.slice(0, 500)
        : '';
      if (content) {
        markToolCall(false);
        const proposal = {
          type: 'verified-experience' as const,
          scope: 'repository' as const,
          content,
          source: { kind: 'agent' as const },
          reason: 'Agent memory_write tool',
          tags: ['agent'],
          requiresUserApproval: true,
        };
        const prepared = await callbacks.onPrepareMemoryWrite(proposal);
        const execution = await canonicalTools.settle(
          toolPlan,
          canonicalContext,
          prepared,
          prepared.constraint,
        );
        if (execution.receipt.status === 'completed') {
          evidenceRefs.push(readEvidenceRecorder.recordObservation(
            'memory',
            'memory_write',
            String(execution.receipt.result ?? ''),
            workspaceRoot,
          ));
          parts.push(`[memory_write] 已写入记忆：${content.slice(0, 80)}`);
          callbacks.onToolActivity?.('memory', `记忆已保存: ${content.slice(0, 60)}`);
        } else {
          const reason = codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', undefined, reason);
          parts.push(`[memory_write] 失败：${reason}`);
        }
      }
    } else if (tool.name === 'delete_file') {
      const rawPath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      markToolCall();
      if (!rawPath) {
        const reason = '缺少 path，未删除任何文件。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-delete-path');
        recordToolFailure('delete_file', 'write', undefined, reason);
        parts.push(`[delete_file] 错误: ${reason}`);
        continue;
      }
      const absPath = resolveAgentToolEvidencePath(rawPath, workspaceRoot, defaultWorkdir);
      let canonicalSettled = false;
      try {
        if (!absPath || (workspaceRoot && !isInsideWorkspacePath(absPath, workspaceRoot))) {
          const reason = '无法解析为工作区内文件路径，已阻止删除。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'delete-path-outside-workspace');
          canonicalSettled = true;
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (!fs.existsSync(absPath)) {
          const reason = '目标文件不存在，无法删除。请先 list_dir/read_file 确认当前路径。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'delete-target-missing');
          canonicalSettled = true;
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
          const reason = '目标是目录；delete_file 只允许删除已确认的单个文件。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'delete-target-is-directory');
          canonicalSettled = true;
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        const baseline = workspaceEditService.captureTextFileBaseline(absPath, workspaceRoot);
        if (taskContext?.requireReadBeforeOverwrite) {
          const guard = shouldBlockUnverifiedSourceOverwrite({
            absPath,
            existed: true,
            readEvidencePaths,
          });
          if (guard.block) {
            const reason = guard.reason ?? '删除既有源码前必须先读取同一路径。';
            await canonicalTools.fail(toolPlan, canonicalContext, 'delete-without-read-evidence');
            canonicalSettled = true;
            recordToolFailure('delete_file', 'write', rawPath, reason);
            parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
            continue;
          }
        }
        if (!callbacks.onResolveFileWriteConstraint) {
          const reason = '缺少删除授权边界。';
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          canonicalSettled = true;
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 跳过（缺少删除授权边界）`);
          continue;
        }
        const fileWriteConstraint = await callbacks.onResolveFileWriteConstraint(absPath, {
          purpose: 'tool-write',
          taskAction: 'delete_file',
          toolRisk: toolPlan.risk,
          displayName: rawPath,
        });
        if (cancellationRequested()) {
          await canonicalTools.fail(toolPlan, canonicalContext, 'tool-cancelled-before-effect');
          canonicalSettled = true;
          recordCancellationFeedback('delete_file', rawPath);
          continue;
        }
        let mutationReceipt: CodingWorkspaceMutationReceipt<WorkspaceDeleteResult> | undefined;
        const toolOutcome = await canonicalTools.settle(toolPlan, canonicalContext, {
          execute: async (_plan, authority) => {
            const mutationOutcome = await workspaceMutation.executeTextFileDelete({
              transaction: canonicalTools.workspaceMutations,
              runId: canonicalContext.runId,
              sequence: canonicalContext.sequence,
              actionId: canonicalContext.actionId,
              absPath,
              workspaceRoot,
              baseline,
              evidenceRefs: authority.evidenceRefs,
            });
            mutationReceipt = mutationOutcome.receipt;
            changeReceipts.push(mutationOutcome.receipt);
            return {
              status: mutationOutcome.receipt.status === 'committed'
                ? 'completed' as const
                : mutationOutcome.receipt.status === 'indeterminate'
                  ? 'indeterminate' as const
                  : 'failed' as const,
              result: mutationOutcome.receipt,
              ...(mutationOutcome.receipt.errorCode ? { errorCode: mutationOutcome.receipt.errorCode } : {}),
              evidenceRefs: mutationOutcome.receipt.evidenceRefs,
            };
          },
        }, fileWriteConstraint);
        canonicalSettled = true;
        const deleteResult = mutationReceipt?.result;
        if (toolOutcome.receipt.status !== 'completed'
          || mutationReceipt?.status !== 'committed'
          || !deleteResult?.deleted) {
          const reason = mutationReceipt?.errorCode
            ?? codingToolExecutionFailureReason(toolOutcome.receipt);
          recordToolFailure('delete_file', 'write', rawPath, reason);
          parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        const oldContent = deleteResult.commitToken.before.snapshot.content;
        callbacks.onToolActivity?.('write', `删除 ${rawPath}`);
        await callbacks.onAppliedChange({
          path: absPath,
          existed: true,
          oldContent,
          newContent: '',
          commitToken: deleteResult.commitToken,
        });
        writtenFiles.push({
          path: absPath,
          basename: nodePath.basename(absPath),
          linesAdded: 0,
          linesRemoved: oldContent ? oldContent.split('\n').length : 0,
          action: 'delete',
        });
        fileAccessEvents.push({ kind: 'write', path: absPath, sequence: ++fileAccessSequence });
        parts.push(`[delete_file: ${rawPath}] 已删除 ${absPath}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (!canonicalSettled) {
          await canonicalTools.fail(toolPlan, canonicalContext, 'delete-preflight-failed');
        }
        recordToolFailure('delete_file', 'write', rawPath, reason);
        parts.push(`[delete_file: ${rawPath}] 错误: ${reason}`);
      }
    } else if (tool.name === 'replace_in_file') {
      const input = tool.input as Record<string, unknown>;
      const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
      const oldStr = typeof input.old_str === 'string' ? input.old_str : '';
      const newStr = typeof input.new_str === 'string' ? input.new_str : '';
      const replaceAll = input.replaceAll === true;
      const strategyFingerprint = codingSemanticDigest({
        tool: 'replace_in_file',
        path: rawPath,
        oldStr,
        newStr,
        replaceAll,
      });
      markToolCall();
      if (!rawPath) {
        const reason = '缺少 path，未修改任何文件。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-replace-path');
        recordToolFailure('replace_in_file', 'replace', undefined, reason, strategyFingerprint);
        parts.push(`[replace_in_file] 错误: ${reason}`);
        continue;
      }
      if (!oldStr) {
        const reason = 'old_str 为空，不能执行不确定替换。请先 read_file 后提供精确原文。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-replace-search-text');
        recordToolFailure('replace_in_file', 'replace', rawPath, reason, strategyFingerprint);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      if (hasPollutedReplaceArgument(oldStr) || hasPollutedReplaceArgument(newStr)) {
        const reason = 'old_str/new_str 混入工具标签或不可见控制字符，无法作为可信补丁执行。请基于最新文件快照重新生成结构化替换参数。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'polluted-replace-argument');
        recordToolFailure('replace_in_file', 'replace', rawPath, reason, strategyFingerprint);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      if (oldStr === newStr) {
        const reason = 'old_str 与 new_str 完全相同，不会产生任何修改。若当前上下文已有目标原文，请直接给出真正变化的 new_str；只有原文缺失或已过期时才重新 read_file。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'replace-no-op');
        recordToolFailure('replace_in_file', 'replace', rawPath, reason, strategyFingerprint);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
        continue;
      }
      const absPath = resolveAgentToolEvidencePath(rawPath, workspaceRoot, defaultWorkdir);
      try {
        if (!absPath || !fs.existsSync(absPath)) {
          const reason = '目标文件不存在，无法替换。请先 list_dir/read_file 确认路径。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'replace-target-missing');
          recordToolFailure('replace_in_file', 'replace', rawPath, reason, strategyFingerprint);
          parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
          await canonicalTools.fail(toolPlan, canonicalContext, 'replace-target-is-directory');
          recordToolFailure('replace_in_file', 'replace', rawPath, `目标是目录，不是文件：${absPath}`, strategyFingerprint);
          parts.push(`[replace_in_file: ${rawPath}] 错误: 目标是目录，不是文件：${absPath}`);
          continue;
        }
        const oldContent = fs.readFileSync(absPath, 'utf8');
        const replacement = resolveTextReplacement(oldContent, oldStr, newStr, replaceAll);
        if (replacement.status !== 'matched') {
          const reason = replacement.status === 'ambiguous'
            ? 'old_str 忽略行首空白后匹配到多个位置，无法确定唯一修改点。请缩小到包含唯一上下文的片段。'
            : 'old_str 未在当前文件中找到。请重新 read_file 读取最新内容后再精确替换。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'replace-search-text-stale');
          recordToolFailure('replace_in_file', 'replace', rawPath, reason, strategyFingerprint);
          const snapshotKey = nodePath.normalize(absPath);
          const snapshot = replaceMissSnapshots.has(snapshotKey)
            ? '当前文件快照已在本轮前一个失败结果中提供，请不要继续猜测 old_str。'
            : formatFileMutationRecoverySnapshot(oldContent, { expectedText: oldStr });
          replaceMissSnapshots.add(snapshotKey);
          parts.push(`[replace_in_file: ${rawPath}] 错误: ${reason}\n${snapshot}`);
          continue;
        }
        await fileWriter.apply(toolPlan, canonicalContext, 'replace_in_file', rawPath, replacement.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await canonicalTools.fail(toolPlan, canonicalContext, 'replace-preflight-failed');
        recordToolFailure('replace_in_file', 'replace', rawPath, msg, strategyFingerprint);
        parts.push(`[replace_in_file: ${rawPath}] 错误: ${msg}`);
      }
    } else if (tool.name === 'apply_patch') {
      const input = tool.input as Record<string, unknown>;
      const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
      const patch = typeof input.patch === 'string' ? input.patch : '';
      const strategyFingerprint = codingSemanticDigest({ tool: 'apply_patch', path: rawPath, patch });
      markToolCall();
      if (!rawPath || !patch.trim()) {
        const reason = !rawPath ? '缺少 path，未修改任何文件。' : 'patch 为空，未修改任何文件。';
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-apply-patch-input');
        recordToolFailure('apply_patch', 'replace', rawPath || undefined, reason, strategyFingerprint);
        parts.push(`[apply_patch${rawPath ? `: ${rawPath}` : ''}] 错误: ${reason}`);
        continue;
      }
      const absPath = resolveAgentToolEvidencePath(rawPath, workspaceRoot, defaultWorkdir);
      let currentContent = '';
      try {
        if (!absPath || !fs.existsSync(absPath)) {
          const reason = '目标文件不存在，单文件补丁只允许更新已读取的既有文件。';
          await canonicalTools.fail(toolPlan, canonicalContext, 'apply-patch-target-missing');
          recordToolFailure('apply_patch', 'replace', rawPath, reason, strategyFingerprint);
          parts.push(`[apply_patch: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
          const reason = `目标是目录，不是文件：${absPath}`;
          await canonicalTools.fail(toolPlan, canonicalContext, 'apply-patch-target-is-directory');
          recordToolFailure('apply_patch', 'replace', rawPath, reason, strategyFingerprint);
          parts.push(`[apply_patch: ${rawPath}] 错误: ${reason}`);
          continue;
        }
        currentContent = fs.readFileSync(absPath, 'utf8');
        const workspaceRelativePath = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
        const patched = applySingleFilePatch(currentContent, patch, [rawPath, workspaceRelativePath, absPath]);
        await fileWriter.apply(toolPlan, canonicalContext, 'apply_patch', rawPath, patched.content);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await canonicalTools.fail(toolPlan, canonicalContext, 'apply-patch-preflight-failed');
        recordToolFailure('apply_patch', 'replace', rawPath, reason, strategyFingerprint);
        const recoveryHint = err instanceof SingleFilePatchError
          ? { expectedText: err.expectedText, preferredStartLine: err.preferredStartLine }
          : undefined;
        const snapshot = currentContent
          ? `\n${formatFileMutationRecoverySnapshot(currentContent, recoveryHint)}`
          : '';
        parts.push(`[apply_patch: ${rawPath}] 错误: ${reason}${snapshot}`);
      }
    } else if (isFileWriteToolName(tool.name)) {
      // Unified file create/overwrite — works for new files AND full rewrites.
      // Matching Copilot's #edit/editFiles for the agentic free-explore loop.
      const fileWrites = expandedFileWritePlans;
      markToolCall();
      if (fileWrites.length === 0) {
        await canonicalTools.fail(toolPlan, canonicalContext, 'missing-file-write-payload');
        recordToolFailure(tool.name, 'write', undefined, '缺少文件写入 payload。');
        parts.push(`[${tool.name}] 错误: 缺少 path/filePath 和 content，未写入任何文件。批量写入请使用 files:[{path,content}]。`);
        continue;
      }
      for (let fileIndex = 0; fileIndex < fileWrites.length; fileIndex++) {
        const { rawPath, content, plan: filePlan } = fileWrites[fileIndex];
        const fileContext = fileIndex === 0
          ? canonicalContext
          : canonicalTools.nextContext(filePlan);
        await fileWriter.apply(filePlan, fileContext, tool.name, rawPath, content);
      }
    } else if (tool.name === 'get_changed_files' && callbacks.onGetChangedFiles) {
      markToolCall();
      const execution = await canonicalTools.observe(
        toolPlan,
        canonicalContext,
        () => callbacks.onGetChangedFiles!(),
        result => readEvidenceRecorder.recordObservation('search', 'git changes', result, workspaceRoot),
      );
      if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
        const result = execution.receipt.result;
        callbacks.onToolActivity?.('search', 'git changes');
        parts.push(`[get_changed_files]\n${result}`);
      } else {
        const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
        recordToolFailure(tool.name, 'tool-host', undefined, msg);
        parts.push(`[get_changed_files] 错误: ${msg}`);
      }
    } else if (tool.name === 'create_directory') {
      const dirPath = typeof (tool.input as Record<string, unknown>).path === 'string'
        ? (tool.input as Record<string, string>).path.trim()
        : '';
      if (dirPath) {
        markToolCall();
        callbacks.onToolActivity?.('write', `mkdir ${dirPath}`);
        let canonicalSettled = false;
        try {
          const absPath = resolveAgentToolEvidencePath(dirPath, workspaceRoot, defaultWorkdir);
          if (!callbacks.onResolveFileWriteConstraint) {
            const reason = '缺少写入授权边界。';
            await canonicalTools.deny(toolPlan, canonicalContext, reason);
            canonicalSettled = true;
            recordToolFailure('create_directory', 'write', dirPath, reason);
            parts.push(`[create_directory: ${dirPath}] 跳过（缺少写入授权边界）`);
            continue;
          }
          const fileWriteConstraint = await callbacks.onResolveFileWriteConstraint(absPath, {
            purpose: 'tool-write',
            taskAction: 'create_directory',
            toolRisk: toolPlan.risk,
            displayName: dirPath,
          });
          if (cancellationRequested()) {
            await canonicalTools.fail(toolPlan, canonicalContext, 'tool-cancelled-before-effect');
            canonicalSettled = true;
            recordCancellationFeedback('create_directory', dirPath);
            continue;
          }
          const execution = await canonicalTools.settle(toolPlan, canonicalContext, {
            execute: async (_plan, authority) => {
              if (!callbacks.onCreateDirectory) {
                return {
                  status: 'failed' as const,
                  errorCode: 'missing-create-directory-host',
                  evidenceRefs: [`vscode-create-directory:${canonicalContext.actionId}:host-missing`],
                };
              }
              const result = await callbacks.onCreateDirectory(absPath, {
                policyPreauthorized: true,
                transaction: canonicalTools.workspaceMutations,
                runId: canonicalContext.runId,
                sequence: canonicalContext.sequence,
                actionId: canonicalContext.actionId,
                evidenceRefs: authority.evidenceRefs,
              });
              changeReceipts.push(result.changeReceipt);
              if (result.changeReceipt.status === 'indeterminate') {
                return {
                  status: 'indeterminate' as const,
                  errorCode: result.changeReceipt.errorCode ?? 'workspace-directory-indeterminate',
                  evidenceRefs: result.changeReceipt.evidenceRefs,
                };
              }
              if (result.changeReceipt.status !== 'committed') {
                return {
                  status: 'failed' as const,
                  errorCode: result.changeReceipt.errorCode ?? `workspace-directory-${result.changeReceipt.status}`,
                  evidenceRefs: result.changeReceipt.evidenceRefs,
                };
              }
              return {
                status: 'completed' as const,
                result: result.message,
                evidenceRefs: result.changeReceipt.evidenceRefs,
              };
            },
          }, fileWriteConstraint);
          canonicalSettled = true;
          if (execution.receipt.status !== 'completed' || typeof execution.receipt.result !== 'string') {
            const reason = codingToolExecutionFailureReason(execution.receipt);
            recordToolFailure('create_directory', 'write', dirPath, reason);
            parts.push(`[create_directory: ${dirPath}] 错误: ${reason}`);
            continue;
          }
          parts.push(`[create_directory: ${dirPath}] ${execution.receipt.result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!canonicalSettled) {
            await canonicalTools.fail(toolPlan, canonicalContext, 'create-directory-preflight-failed');
          }
          recordToolFailure('create_directory', 'write', dirPath, msg);
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
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onFetchWebpage!(url),
          result => readEvidenceRecorder.recordObservation('network', url, result, url),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const result = execution.receipt.result;
          parts.push(`[fetch_webpage: ${url}]\n${result}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', url, msg);
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
        const execution = await canonicalTools.observe(
          toolPlan,
          canonicalContext,
          () => callbacks.onListCodeUsages!(symbol, filePath),
          result => readEvidenceRecorder.recordObservation(
            'search',
            `code-usages:${symbol}`,
            result,
            filePath ?? workspaceRoot,
          ),
        );
        if (execution.receipt.status === 'completed' && typeof execution.receipt.result === 'string') {
          const result = execution.receipt.result;
          parts.push(`[vscode_listCodeUsages: "${symbol}"]\n${result}`);
        } else {
          const msg = execution.error ?? codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', filePath, msg);
          parts.push(`[vscode_listCodeUsages: "${symbol}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'run_vscode_command') {
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
          if (!callbacks.onPrepareVscodeCommand) {
            const reason = 'missing-vscode-command-constraint';
            await canonicalTools.deny(toolPlan, canonicalContext, reason);
            recordToolFailure(tool.name, 'tool-host', command, reason);
            parts.push(`[run_vscode_command: ${command}] 错误: ${reason}`);
            continue;
          }
          const prepared = await callbacks.onPrepareVscodeCommand(command, args);
          const execution = await canonicalTools.settle(toolPlan, canonicalContext, prepared, prepared.constraint);
          if (execution.receipt.status !== 'completed' || typeof execution.receipt.result !== 'string') {
            const reason = codingToolExecutionFailureReason(execution.receipt);
            recordToolFailure(tool.name, 'tool-host', command, reason);
            parts.push(`[run_vscode_command: ${command}] ${execution.receipt.status}: ${reason}`);
            continue;
          }
          parts.push(`[run_vscode_command: ${command}]\n${execution.receipt.result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await canonicalTools.deny(toolPlan, canonicalContext, `vscode-command-constraint-failed:${msg}`);
          recordToolFailure(tool.name, 'tool-host', command, msg);
          parts.push(`[run_vscode_command: ${command}] 错误: ${msg}`);
        }
      }
    } else if (tool.name.startsWith('mcp__')) {
      markToolCall();
      try {
        if (!callbacks.onPrepareMcpToolCall) {
          const reason = 'missing-mcp-tool-constraint';
          await canonicalTools.deny(toolPlan, canonicalContext, reason);
          recordToolFailure(tool.name, 'tool-host', undefined, reason);
          parts.push(`[${tool.name}] 错误: ${reason}`);
          continue;
        }
        const prepared = await callbacks.onPrepareMcpToolCall(tool.name, tool.input as Record<string, unknown>);
        const execution = await canonicalTools.settle(toolPlan, canonicalContext, prepared, prepared.constraint);
        if (execution.receipt.status !== 'completed' || typeof execution.receipt.result !== 'string') {
          const reason = codingToolExecutionFailureReason(execution.receipt);
          recordToolFailure(tool.name, 'tool-host', undefined, reason);
          parts.push(`[${tool.name}] ${execution.receipt.status}: ${reason}`);
          continue;
        }
        // Silent: MCP result goes to AI context only
        parts.push(`[${tool.name}]\n${execution.receipt.result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await canonicalTools.deny(toolPlan, canonicalContext, `mcp-tool-constraint-failed:${msg}`);
        recordToolFailure(tool.name, 'tool-host', undefined, msg);
        parts.push(`[${tool.name}] 错误: ${msg}`);
        callbacks.onToolActivity?.('terminal', `❌ ${tool.name}: ${msg.slice(0, 50)}`);
      }
    } else {
      markToolCall(isAgentWorkToolName(tool.name));
      const reason = `missing-tool-host:${tool.name}`;
      await canonicalTools.fail(toolPlan, canonicalContext, reason);
      recordToolFailure(tool.name, 'tool-host', undefined, reason);
      parts.push(`[${tool.name}] 错误: ${reason}`);
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
    terminalOutputCount: terminalOutputs.length,
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
    feedbackSegmentsForAI: parts.length > 0 ? parts : undefined,
    fileAccessEvents: fileAccessEvents.length > 0 ? fileAccessEvents : undefined,
    completeSummary,
    allTodosCompleted,
    todoItems: lastTodoItems,
    summaryEmitted,
    terminalCommands: terminalCommands.length > 0 ? terminalCommands : undefined,
    terminalOutputs: terminalOutputs.length > 0 ? terminalOutputs : undefined,
    terminalEvidence: terminalEvidence.length > 0 ? terminalEvidence : undefined,
    writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
    readFiles: readFiles.length > 0 ? readFiles : undefined,
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
    changeReceipts: changeReceipts.length > 0 ? changeReceipts : undefined,
    toolExecutionReceipts: toolExecutionReceipts.length > 0 ? toolExecutionReceipts : undefined,
    verificationReceipts: verificationReceipts.length > 0 ? verificationReceipts : undefined,
    toolFailures: toolFailures.length > 0 ? toolFailures : undefined,
  };
}
