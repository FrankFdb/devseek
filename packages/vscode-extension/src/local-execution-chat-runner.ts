import * as nodePath from 'path';
import * as vscode from 'vscode';
import { emitLearningEvent, getErrorFixHint } from './agent-learner';
import { runAgentLoop } from './agent-loop';
import { getAgentTaskDisplayTarget } from './agent-task-decomposer';
import { classifyTerminalEvidenceCommand } from './agent/completion-evidence';
import type { AgentLoopCallbacks } from './agent/loop-types';
import { shouldRequestManualReviewForRun } from './agent/manual-review-validation';
import {
  buildLocalExecutionFailureMessage,
  buildLocalExecutionSuccessMessage,
  isRepeatExecutionRequest,
  type LocalExecutionPlan,
  planLocalExecution,
  planRepeatLocalExecution,
  runLocalExecution,
  shouldPreferLocalExecution,
  shouldRepairLocalExecutionFailure,
} from './execution-planner';
import {
  buildLocalExecutionAgentCallbacks,
  buildLocalExecutionAgentRepairPrompt,
  buildLocalExecutionRepairTasks,
  relPathFromRepairWorkspace,
} from './local-execution-repair';
import type { ToolPolicy } from './app/permission-service';
import type { AppliedChangeRecord, ApplyWorkflowStatus } from './workspace-applier';
import { askRepairExhaustedAction, requestManualFixGuidance } from './app/repair-exhaustion-interaction';

export interface LocalExecutionRouteChatOptions {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  stream?: boolean;
  trackHistory?: boolean;
}

export interface LocalExecutionChatRunnerInput {
  webview: vscode.Webview;
  prompt: string;
  effectiveFiles: string[];
  workspaceRoot?: string;
  mode?: 'fast' | 'r1';
  config: vscode.WorkspaceConfiguration;
  executionApproval: 'auto' | 'confirm';
  workflowReporter: (status: ApplyWorkflowStatus) => Promise<void>;
  lastLocalExecutionPlan?: LocalExecutionPlan;
  setLastLocalExecutionPlan: (plan: LocalExecutionPlan) => void;
  requestTerminalConfirmation: (command: string, workdir?: string) => Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string }>;
  routeChat: (opts: LocalExecutionRouteChatOptions) => Promise<string>;
  toolPolicy: ToolPolicy;
  consumeAgentSteer: () => string[];
  registerAppliedChange: (change: AppliedChangeRecord) => Promise<void>;
  registerToMemory: (absPath: string) => void;
  sessionRecentFiles: Map<string, string>;
  mcpToolRefs?: AgentLoopCallbacks['mcpToolRefs'];
  onMcpToolCall?: AgentLoopCallbacks['onMcpToolCall'];
  signal?: AbortSignal;
  sessionId: string;
  onChangedPaths: (relativePaths: string[]) => void;
}

export interface LocalExecutionChatRunnerResult {
  handled: boolean;
}

export async function runLocalExecutionChatIfPossible(
  input: LocalExecutionChatRunnerInput,
): Promise<LocalExecutionChatRunnerResult> {
  const localPlan = buildLocalPlan(input);
  if (!localPlan) return { handled: false };

  input.setLastLocalExecutionPlan(localPlan);

  if (input.executionApproval === 'confirm') {
    const confirmResult = await input.requestTerminalConfirmation(localPlan.command, localPlan.cwd);
    if (confirmResult.alwaysAllow) {
      await vscode.workspace.getConfiguration('devseek').update('autopilotMode', true, vscode.ConfigurationTarget.Global);
    }
    if (!confirmResult.allow) {
      await input.workflowReporter({
        phase: 'validate',
        state: 'skipped',
        title: '本地执行已取消',
        detail: confirmResult.reason ?? '用户取消了本地编译/运行命令。',
      });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true };
    }
  }

  await input.workflowReporter({
    phase: 'validate',
    state: 'started',
    title: localPlan.mode === 'run-only' ? '插件正在本地执行已有程序' : '插件正在本地编译/执行',
    detail: `模式: ${localPlan.mode}\n原因: ${localPlan.reason}\n命令: ${localPlan.command}`,
  });

  let maxRounds = Math.max(0, Math.min(6, input.config.get<number>('autoFixRounds', 6)));
  for (let round = 0; round <= maxRounds; round += 1) {
    const localResult = await runLocalExecution(localPlan);
    const manualReview = shouldRequestManualReviewForRun({
      userPrompt: input.prompt,
      command: localResult.command,
      output: localResult.output,
      changedPaths: localPlan.targetFiles,
      terminalEvidence: {
        command: localResult.command,
        kind: classifyTerminalEvidenceCommand(localResult.command),
        ok: false,
        exitCode: localResult.exitCode,
        detail: localResult.output.slice(0, 400),
      },
    });
    if (manualReview) {
      await input.workflowReporter({
        phase: 'validate',
        state: 'passed',
        title: '本地程序已启动，等待人工确认',
        detail: `命令: ${localResult.command}\n${manualReview.detail}`,
      });
      input.webview.postMessage({ type: 'delta', text: manualReview.detail });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true };
    }
    await input.workflowReporter({
      phase: 'validate',
      state: localResult.ok ? 'passed' : 'failed',
      title: localResult.ok ? '本地执行通过' : '本地执行失败',
      detail: `命令: ${localResult.command}\nexitCode: ${localResult.exitCode ?? 'null'}\n${localResult.output.slice(0, 1200)}`,
    });

    if (localResult.ok) {
      emitLearningEvent({
        type: 'command_succeeded',
        command: localPlan.command,
        context: input.prompt.slice(0, 80),
        sessionId: input.sessionId,
      });
      input.webview.postMessage({ type: 'delta', text: buildLocalExecutionSuccessMessage(localPlan, localResult) });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true };
    }

    if (!shouldRepairLocalExecutionFailure(localPlan, localResult)) {
      input.webview.postMessage({ type: 'delta', text: buildLocalExecutionFailureMessage(localPlan, localResult) });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true };
    }

    if (round >= maxRounds) {
      const shouldContinue = await handleRepairExhausted(input, maxRounds, localResult.command, localResult.output);
      if (shouldContinue) {
        maxRounds += 3;
        continue;
      }
      return { handled: true };
    }

    const repaired = await runAgentRepairRound(input, localPlan, localResult, round + 1);
    if (!repaired) return { handled: true };
  }

  return { handled: true };
}

function buildLocalPlan(input: LocalExecutionChatRunnerInput): LocalExecutionPlan | undefined {
  if (shouldPreferLocalExecution(input.prompt, input.effectiveFiles, input.workspaceRoot)) {
    return planLocalExecution(input.prompt, input.effectiveFiles, input.workspaceRoot) || undefined;
  }
  if (isRepeatExecutionRequest(input.prompt) && input.lastLocalExecutionPlan) {
    return planRepeatLocalExecution(input.prompt, input.lastLocalExecutionPlan, input.workspaceRoot) || undefined;
  }
  return undefined;
}

async function handleRepairExhausted(
  input: LocalExecutionChatRunnerInput,
  maxRounds: number,
  command: string,
  output: string,
): Promise<boolean> {
  const action = await askRepairExhaustedAction('本地执行闭环达到上限', `已执行 ${maxRounds} 轮，仍未通过本地命令。`);
  if (action === 'continue') {
    await input.workflowReporter({
      phase: 'repair',
      state: 'started',
      title: '用户选择继续修复',
      detail: `修复上限已扩展到 ${maxRounds + 3} 轮。`,
    });
    return true;
  }

  if (action === 'guide') {
    const guidance = await requestManualFixGuidance(
      (guidanceRequest) => input.routeChat({
        ...guidanceRequest,
        newSession: false,
        mode: input.mode,
        trackHistory: false,
      }),
      input.prompt,
      command,
      output,
    );
    input.webview.postMessage({ type: 'delta', text: `\n\n[手动修复建议]\n${guidance}\n` });
  }

  await input.workflowReporter({
    phase: 'repair',
    state: 'failed',
    title: '本地执行闭环结束（NG）',
    detail: `已达到最大修复轮次 ${maxRounds}，仍未通过本地命令。`,
  });
  input.webview.postMessage({ type: 'endResponse' });
  return false;
}

async function runAgentRepairRound(
  input: LocalExecutionChatRunnerInput,
  localPlan: LocalExecutionPlan,
  localResult: Awaited<ReturnType<typeof runLocalExecution>>,
  round: number,
): Promise<boolean> {
  await input.workflowReporter({
    phase: 'repair',
    state: 'started',
    title: `第 ${round} 轮本地失败修复`,
    detail: '将本地失败输出升级为 Agent 闭环：读取文件、定位根因、修改并重新验证。',
  });

  const repairPrompt = buildLocalExecutionAgentRepairPrompt(input.prompt, localPlan, localResult, round);
  const errorHint = getErrorFixHint(localResult.output);
  const repairPromptWithHint = errorHint
    ? `${repairPrompt}\n\n【历史同类错误修复参考】\n${errorHint}`
    : repairPrompt;
  const repairWsRoot = input.workspaceRoot
    || vscode.workspace.getWorkspaceFolder(vscode.Uri.file(localPlan.cwd))?.uri.fsPath
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    || localPlan.cwd;
  const repairTasks = buildLocalExecutionRepairTasks(localPlan, localResult, repairWsRoot);

  if (repairTasks.length === 0) {
    await input.workflowReporter({
      phase: 'repair',
      state: 'failed',
      title: '未找到可交给 Agent 修复的源码文件',
      detail: '本地执行失败后，未能从执行计划中解析出可修改文件。',
    });
    input.webview.postMessage({ type: 'endResponse' });
    return false;
  }

  input.webview.postMessage({
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '本地执行失败，进入 Agent 修复',
    detail: '参考 Claude Code / Codex 的闭环策略：失败输出 → 读/搜源码 → 修改 → 重跑验证。',
    taskTotal: repairTasks.length,
  });
  input.webview.postMessage({
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: `已生成 ${repairTasks.length} 个修复子任务`,
    detail: repairTasks.map((t, i) => `${i + 1}. [${t.action}] ${getAgentTaskDisplayTarget(t)} — ${t.desc}`).join('\n'),
    taskTotal: repairTasks.length,
  });

  const repairLoop = await runAgentLoop(
    repairTasks,
    repairPromptWithHint,
    input.mode,
    vscode.Uri.file(repairWsRoot),
    buildLocalExecutionAgentCallbacks({
      webview: input.webview,
      workflowReporter: input.workflowReporter,
      workspaceRoot: repairWsRoot,
      defaultWorkdir: localPlan.cwd,
      toolPolicy: input.toolPolicy,
      consumeAgentSteer: input.consumeAgentSteer,
      confirmTerminal: input.requestTerminalConfirmation,
      registerAppliedChange: input.registerAppliedChange,
      registerToMemory: input.registerToMemory,
      sessionRecentFiles: input.sessionRecentFiles,
      repairFiles: repairTasks.map((task) => task.absPath).filter((absPath): absPath is string => Boolean(absPath)),
      mcpToolRefs: input.mcpToolRefs,
      onMcpToolCall: input.onMcpToolCall,
      signal: input.signal,
    }),
    undefined,
    0,
  );

  if (repairLoop.changedPaths.length > 0) {
    repairLoop.changedPaths.forEach((pathValue) => {
      const absPath = nodePath.isAbsolute(pathValue) ? pathValue : nodePath.join(repairWsRoot, pathValue);
      input.registerToMemory(absPath);
    });
    input.onChangedPaths(repairLoop.changedPaths
      .map(pathValue => relPathFromRepairWorkspace(
        repairWsRoot,
        nodePath.isAbsolute(pathValue) ? pathValue : nodePath.join(repairWsRoot, pathValue),
      ))
      .filter((rel): rel is string => Boolean(rel)));
  }

  if (repairLoop.tasksApplied === 0 && repairLoop.tasksFailed > 0) {
    await input.workflowReporter({
      phase: 'repair',
      state: 'failed',
      title: 'Agent 未能落地修复',
      detail: '本轮没有产生可应用的文件修改，停止本地执行闭环。',
    });
    input.webview.postMessage({ type: 'endResponse' });
    return false;
  }

  return true;
}
