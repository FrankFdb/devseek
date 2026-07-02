import * as vscode from 'vscode';
import { createDevSeekTraceLogger, summarizeTraceText } from '@devseek-netai/shared';
import { decideTerminalCommandPermission, type TerminalCommandRiskClass } from './terminal-command-policy';
import { decideToolPermission, type ToolPolicy } from './permission-service';
import { shouldUseManualReviewLaunchMode } from './terminal-launch-classifier';
import {
  cleanupLegacyCppBuildDirsForCommand,
  normalizeLegacyCppBuildCommandForRun,
} from '../workspace/cpp-build-cleanup-service';

type TerminalConfirmResolver = (allow: boolean, alwaysAllow?: boolean) => void;

export interface TerminalConfirmationResult {
  allow: boolean;
  alwaysAllow?: boolean;
  reason?: string;
}

export interface RunTerminalWithPermissionInput {
  webview: vscode.Webview;
  command: string;
  workdir?: string;
  workspaceRoot?: string;
  mode: string;
  toolPolicy: ToolPolicy;
  traceRunId?: string;
}

export class TerminalPermissionCoordinator {
  private readonly pendingConfirms = new Map<string, TerminalConfirmResolver>();
  private readonly trustedRiskClasses = new Set<TerminalCommandRiskClass>();

  requestInlineConfirmation(
    webview: vscode.Webview,
    command: string,
    workdir = '',
    timeoutMs = 60000,
  ): Promise<TerminalConfirmationResult> {
    const confirmId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      this.pendingConfirms.set(confirmId, (allow, alwaysAllow) => resolve({ allow, alwaysAllow }));
      webview.postMessage({ type: 'terminalConfirm', command, workdir, confirmId });
      setTimeout(() => {
        if (this.pendingConfirms.delete(confirmId)) {
          resolve({ allow: false, reason: '您未在 60 秒内确认，命令未执行。' });
        }
      }, timeoutMs);
    });
  }

  handleConfirmReply(confirmId: string, allow: boolean, alwaysAllow?: boolean): boolean {
    const resolve = this.pendingConfirms.get(confirmId);
    if (!resolve) return false;
    this.pendingConfirms.delete(confirmId);
    resolve(allow, alwaysAllow);
    return true;
  }

  async runCommandWithPermission(input: RunTerminalWithPermissionInput): Promise<string> {
    const { webview, command, workdir, workspaceRoot, mode, toolPolicy, traceRunId } = input;
    const normalizedCommand = normalizeLegacyCppBuildCommandForRun({ command, workdir, workspaceRoot }).command;
    const trace = traceRunId && workspaceRoot
      ? createDevSeekTraceLogger({
          workspaceRoot,
          source: 'vscode-extension.terminal',
          level: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
          runId: traceRunId,
        })
      : undefined;
    trace?.info('terminal', 'command-requested', {
      command: summarizeTraceText(normalizedCommand),
      workdir,
      mode,
    });
    const terminalPermission = decideToolPermission(toolPolicy, 'terminal');
    if (terminalPermission.action === 'deny') {
      trace?.info('terminal', 'command-skipped', {
        reason: terminalPermission.reason,
        command: summarizeTraceText(normalizedCommand),
        workdir,
      });
      return `（命令未执行：当前 ${mode} 模式不允许终端工具：${terminalPermission.reason}）`;
    }

    const terminalDecision = decideTerminalCommandPermission({
      command: normalizedCommand,
      workdir,
      workspaceRoot,
    });
    const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
    const remembered = terminalDecision.canRememberDecision && this.trustedRiskClasses.has(terminalDecision.risk);
    let confirmedByUser = false;

    if (!isAutopilot && terminalPermission.action === 'requireConfirm' && terminalDecision.requiresConfirmation && !remembered) {
      const confirmResult = await this.requestInlineConfirmation(webview, normalizedCommand, workdir ?? '');
      if (confirmResult.alwaysAllow && terminalDecision.canRememberDecision) {
        this.trustedRiskClasses.add(terminalDecision.risk);
      }
      if (!confirmResult.allow) {
        trace?.info('terminal', 'command-skipped', {
          reason: confirmResult.reason ?? '用户拒绝',
          command: summarizeTraceText(normalizedCommand),
          workdir,
        });
        return `（命令未执行：${confirmResult.reason ?? '用户拒绝'}）`;
      }
      confirmedByUser = true;
    }

    const { runCommand, formatTerminalOutputForPrompt } = await import('../tools/terminal');
    const manualReviewOnLongRunning = shouldUseManualReviewLaunchMode({ command: normalizedCommand, workdir, workspaceRoot });
    cleanupLegacyCppBuildDirsForCommand({ command, workdir, workspaceRoot });
    const result = await runCommand({
      command: normalizedCommand,
      cwd: workdir,
      visible: false,
      allowRisky: !isAutopilot && (confirmedByUser || remembered),
      manualReviewOnLongRunning,
    });
    const outputPreview = result.output.slice(0, 4000);
    trace?.info('terminal', 'command-complete', {
      command: summarizeTraceText(normalizedCommand),
      workdir,
      exitCode: result.exitCode,
      output: summarizeTraceText(outputPreview),
    });
    trace?.payload('terminal', 'terminal.output', outputPreview);
    webview.postMessage({
      type: 'terminalRanNotice',
      command: normalizedCommand,
      workdir: workdir ?? '',
      exitCode: result.exitCode,
      output: outputPreview,
    });
    return formatTerminalOutputForPrompt(normalizedCommand, result);
  }
}
