import * as nodePath from 'path';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { emitLearningEvent, getErrorFixHint } from './agent-learner';
import { getAgentTaskDisplayTarget } from './agent-task-decomposer';
import { classifyTerminalEvidenceCommand } from './agent/completion-evidence';
import type { AgentLoopCallbacks } from './agent/loop-types';
import { shouldRequestManualReviewForRun } from './agent/manual-review-validation';
import {
  buildLocalExecutionFailureMessage,
  buildLocalExecutionSuccessMessage,
  buildLocalExecutionWorkflowDetail,
  getLocalExecutionTimeoutMs,
  isRepeatExecutionRequest,
  type LocalExecutionResult,
  type LocalExecutionPlan,
  planLocalExecution,
  planRepeatLocalExecution,
  shouldPreferLocalExecution,
  shouldRepairLocalExecutionFailure,
} from './execution-planner';
import {
  buildLocalExecutionAgentCallbacks,
  buildLocalExecutionAgentRepairPrompt,
  buildLocalExecutionRepairTasks,
  relPathFromRepairWorkspace,
} from './local-execution-repair';
import { postWebviewMessage } from './ui/webview-event-adapter';
import type { ToolPolicy } from './app/permission-service';
import type { AppliedChangeRecord, ApplyWorkflowStatus } from './workspace-applier';
import { askRepairExhaustedAction, requestManualFixGuidance } from './app/repair-exhaustion-interaction';
import { AgentDisplayPresenter } from './app/agent-display-presenter';
import type { TerminalPermissionCoordinator } from './app/terminal-permission-coordinator';
import { extendRepairRoundBudget, normalizeRepairRoundBudget } from './app/bounded-repair-policy';
import type { AgentKernelService } from './app/agent-kernel-service';

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
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
  agentKernelService: Pick<AgentKernelService, 'executePlanned'>;
  traceRunId: string;
  traceEvidenceParticipantToken: string;
  onTraceEvidenceError: (error: unknown) => void;
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
  status?: 'completed' | 'failed' | 'cancelled';
  /** Candidate success is presented only after the owner run seals successfully. */
  successMessage?: string;
}

export async function runLocalExecutionChatIfPossible(
  input: LocalExecutionChatRunnerInput,
): Promise<LocalExecutionChatRunnerResult> {
  const localPlan = buildLocalPlan(input);
  if (!localPlan) return { handled: false };

  input.setLastLocalExecutionPlan(localPlan);

  let validationOperationId = `vscode-local-validation-${crypto.randomUUID()}`;
  await input.workflowReporter({
    phase: 'validate',
    operationId: validationOperationId,
    state: 'started',
    title: localPlan.mode === 'run-only' ? '插件正在本地执行已有程序' : '插件正在本地编译/执行',
    detail: buildLocalExecutionWorkflowDetail(localPlan),
  });

  let maxRounds = normalizeRepairRoundBudget(input.config.get<number>('autoFixRounds', 6));
  const adverseTerminalOperationIds: string[] = [];
  for (let round = 0; round <= maxRounds; round += 1) {
    if (round > 0) {
      validationOperationId = `vscode-local-validation-${crypto.randomUUID()}`;
      await input.workflowReporter({
        phase: 'validate',
        operationId: validationOperationId,
        state: 'started',
        title: '正在验证修复后的本地执行',
        detail: buildLocalExecutionWorkflowDetail(localPlan),
      });
    }
    const recoveryOperationId = adverseTerminalOperationIds.length > 0
      ? input.terminalPermissionCoordinator.beginCommandRecovery({
          workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
          runId: input.traceRunId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
          targetOperationIds: adverseTerminalOperationIds,
          onTraceEvidenceError: input.onTraceEvidenceError,
        })
      : undefined;
    const terminalResult = await input.terminalPermissionCoordinator.runCommandWithPermissionDetailed({
      webview: input.webview,
      command: localPlan.command,
      workdir: localPlan.cwd,
      workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
      mode: input.toolPolicy.mode,
      toolPolicy: input.toolPolicy,
      traceRunId: input.traceRunId,
      traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
      onTraceEvidenceError: input.onTraceEvidenceError,
      policyPreauthorized: input.executionApproval === 'auto',
      forceConfirmation: input.executionApproval === 'confirm',
      onAlwaysAllow: async () => {
        await vscode.workspace.getConfiguration('devseek').update(
          'autopilotMode',
          true,
          vscode.ConfigurationTarget.Global,
        );
      },
      timeoutMs: getLocalExecutionTimeoutMs(localPlan),
      manageRecoveryExternally: true,
      recoveryOperationId,
    });
    if (!terminalResult.executed) {
      if (recoveryOperationId) {
        input.terminalPermissionCoordinator.finishCommandRecovery({
          workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
          runId: input.traceRunId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
          targetOperationIds: adverseTerminalOperationIds,
          recoveryOperationId,
          status: 'failed',
          reason: 'terminal-retry-not-authorized',
          onTraceEvidenceError: input.onTraceEvidenceError,
        });
      }
      await input.workflowReporter({
        phase: 'validate',
        operationId: validationOperationId,
        state: 'skipped',
        title: '本地执行未获授权',
        detail: terminalResult.output,
      });
      await input.workflowReporter({
        phase: 'quality',
        operationId: validationOperationId,
        state: 'skipped',
        title: '本地执行 QualityGate 被否决',
        detail: '执行未获授权，不能产生通过结论。',
      });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true, status: 'cancelled' };
    }
    const localResult: LocalExecutionResult = {
      ok: terminalResult.outcome === 'committed',
      command: localPlan.command,
      cwd: localPlan.cwd,
      exitCode: terminalResult.exitCode ?? null,
      output: terminalResult.executionOutput ?? terminalResult.output,
      ...(terminalResult.reviewRequired ? {
        reviewRequired: true,
        reviewReason: '命令仍在运行或退出状态不可确定，需要人工确认。',
      } : {}),
    };
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
      if (recoveryOperationId) {
        input.terminalPermissionCoordinator.finishCommandRecovery({
          workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
          runId: input.traceRunId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
          targetOperationIds: adverseTerminalOperationIds,
          recoveryOperationId,
          status: 'failed',
          reason: 'terminal-retry-requires-manual-review',
          onTraceEvidenceError: input.onTraceEvidenceError,
        });
      }
      adverseTerminalOperationIds.push(terminalResult.operationId);
      await input.workflowReporter({
        phase: 'validate',
        operationId: validationOperationId,
        state: 'skipped',
        title: '本地程序已启动，等待人工确认',
        detail: `${buildLocalExecutionWorkflowDetail(localPlan, localResult)}\n${manualReview.detail}`,
      });
      await input.workflowReporter({
        phase: 'quality',
        operationId: validationOperationId,
        state: 'skipped',
        title: '本地执行 QualityGate 等待人工确认',
        detail: manualReview.detail,
      });
      postWebviewMessage(input.webview, { type: 'delta', text: manualReview.detail });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true, status: 'cancelled' };
    }
    await input.workflowReporter({
      phase: 'validate',
      operationId: validationOperationId,
      state: localResult.ok ? 'passed' : 'failed',
      title: localResult.ok ? '本地执行通过' : '本地执行失败',
      detail: buildLocalExecutionWorkflowDetail(localPlan, localResult),
    });
    await input.workflowReporter({
      phase: 'quality',
      operationId: validationOperationId,
      state: localResult.ok ? 'passed' : 'failed',
      title: localResult.ok ? '本地执行 QualityGate 通过' : '本地执行 QualityGate 未通过',
      detail: buildLocalExecutionWorkflowDetail(localPlan, localResult),
    });

    if (localResult.ok) {
      if (recoveryOperationId) {
        const recoveryCompleted = input.terminalPermissionCoordinator.finishCommandRecovery({
          workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
          runId: input.traceRunId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
          targetOperationIds: adverseTerminalOperationIds,
          recoveryOperationId,
          status: 'completed',
          verificationOperationId: validationOperationId,
          onTraceEvidenceError: input.onTraceEvidenceError,
        });
        if (!recoveryCompleted) {
          postWebviewMessage(input.webview, {
            type: 'delta',
            text: '本地命令已成功，但恢复证据顺序不完整，本轮不能标记完成。',
          });
          input.webview.postMessage({ type: 'endResponse' });
          return { handled: true, status: 'failed' };
        }
        adverseTerminalOperationIds.length = 0;
      }
      emitLearningEvent({
        type: 'command_succeeded',
        command: localPlan.command,
        context: input.prompt.slice(0, 80),
        sessionId: input.sessionId,
      });
      return {
        handled: true,
        status: 'completed',
        successMessage: buildLocalExecutionSuccessMessage(localPlan, localResult),
      };
    }

    if (recoveryOperationId) {
      input.terminalPermissionCoordinator.finishCommandRecovery({
        workspaceRoot: input.workspaceRoot ?? localPlan.cwd,
        runId: input.traceRunId,
        traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
        targetOperationIds: adverseTerminalOperationIds,
        recoveryOperationId,
        status: 'failed',
        reason: 'terminal-retry-failed',
        onTraceEvidenceError: input.onTraceEvidenceError,
      });
    }
    adverseTerminalOperationIds.push(terminalResult.operationId);

    if (!shouldRepairLocalExecutionFailure(localPlan, localResult)) {
      postWebviewMessage(input.webview, { type: 'delta', text: buildLocalExecutionFailureMessage(localPlan, localResult) });
      input.webview.postMessage({ type: 'endResponse' });
      return { handled: true, status: 'failed' };
    }

    if (round >= maxRounds) {
      const shouldContinue = await handleRepairExhausted(input, maxRounds, localResult.command, localResult.output);
      if (shouldContinue) {
        maxRounds = extendRepairRoundBudget(maxRounds);
        continue;
      }
      return { handled: true, status: 'failed' };
    }

    const repaired = await runAgentRepairRound(input, localPlan, localResult, round + 1);
    if (!repaired) return { handled: true, status: 'failed' };
  }

  return { handled: true, status: 'failed' };
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
    const extendedRounds = extendRepairRoundBudget(maxRounds);
    await input.workflowReporter({
      phase: 'repair',
      state: 'started',
      title: '用户选择继续修复',
      detail: `修复上限已扩展到 ${extendedRounds} 轮。`,
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
    postWebviewMessage(input.webview, { type: 'delta', text: `\n\n[手动修复建议]\n${guidance}\n` });
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
  localResult: LocalExecutionResult,
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

  const repairDisplayPresenter = new AgentDisplayPresenter();
  input.webview.postMessage(repairDisplayPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '本地执行失败，进入 Agent 修复',
    detail: '参考 Claude Code / Codex 的闭环策略：失败输出 → 读/搜源码 → 修改 → 重跑验证。',
    taskTotal: repairTasks.length,
  }));
  input.webview.postMessage(repairDisplayPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: `已生成 ${repairTasks.length} 个修复子任务`,
    detail: repairTasks.map((t, i) => `${i + 1}. [${t.action}] ${getAgentTaskDisplayTarget(t)} — ${t.desc}`).join('\n'),
    taskTotal: repairTasks.length,
  }));

  const repairLoop = await input.agentKernelService.executePlanned({
    tasks: repairTasks,
    userPrompt: repairPromptWithHint,
    mode: input.mode,
    workspaceRoot: vscode.Uri.file(repairWsRoot),
    callbacks: buildLocalExecutionAgentCallbacks({
      webview: input.webview,
      workflowReporter: input.workflowReporter,
      workspaceRoot: repairWsRoot,
      defaultWorkdir: localPlan.cwd,
      toolPolicy: input.toolPolicy,
      terminalPermissionCoordinator: input.terminalPermissionCoordinator,
      traceRunId: input.traceRunId,
      traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
      onTraceEvidenceError: input.onTraceEvidenceError,
      consumeAgentSteer: input.consumeAgentSteer,
      confirmTerminal: input.requestTerminalConfirmation,
      registerAppliedChange: input.registerAppliedChange,
      registerToMemory: input.registerToMemory,
      sessionRecentFiles: input.sessionRecentFiles,
      repairFiles: repairTasks.map((task) => task.absPath).filter((absPath): absPath is string => Boolean(absPath)),
      mcpToolRefs: input.mcpToolRefs,
      onMcpToolCall: input.onMcpToolCall,
      signal: input.signal,
      displayPresenter: repairDisplayPresenter,
    }),
    analysisContext: undefined,
    startFromIndex: 0,
  });

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
