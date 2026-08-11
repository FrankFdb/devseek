import * as nodePath from 'path';
import * as vscode from 'vscode';
import {
  applyGeneratedArtifactPathWithPrompt,
  applyGeneratedArtifactsWithPrompt,
  previewGeneratedArtifactPathWithPrompt,
  previewGeneratedArtifactsWithPrompt,
  type ApplyWorkflowStatus,
} from '../workspace-applier';
import type { AppliedChangeRecord } from '../workspace-applier';
import { recoverApplyFailureIfPossible } from '../app/apply-failure-recovery-service';
import { shouldRunClosedLoopRepair } from '../app/agentic-repair-service';
import { runClosedLoopRepair } from '../app/closed-loop-repair-runner';
import type { PendingEditCoordinator } from '../pending-edit-coordinator';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import { createDevSeekRunContext } from '../app/run-context';
import { buildToolPolicy } from '../app/permission-service';
import { openWorkspacePathInEditor } from './generated-artifact-ui';
import { postWebviewEvent, postWebviewMessage } from './webview-event-adapter';
import type { WebviewInboundMessage } from './webview-protocol';

export type { AppliedChangeRecord } from '../workspace-applier';

export interface GeneratedArtifactRouteChatOptions {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  files?: string[];
  stream?: boolean;
  trackHistory?: boolean;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  traceEvidenceParticipantToken?: string;
  onTraceEvidenceError?: (error: unknown) => void;
}

export interface GeneratedArtifactSurfaceControllerDeps {
  pendingEditCoordinator: PendingEditCoordinator;
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
  routeChat: (opts: GeneratedArtifactRouteChatOptions) => Promise<string>;
  getActiveSessionId: () => string;
  getLastConversationFiles: () => string[];
}

type GeneratedArtifactMessage = WebviewInboundMessage;

export class GeneratedArtifactSurfaceController {
  constructor(private readonly deps: GeneratedArtifactSurfaceControllerDeps) {}

  async previewFiles(msg: GeneratedArtifactMessage): Promise<void> {
    if (msg.text) await previewGeneratedArtifactsWithPrompt(msg.text, msg.prompt);
  }

  async applyFiles(wv: vscode.Webview, msg: GeneratedArtifactMessage): Promise<void> {
    if (!msg.text) return;
    const runContext = createGeneratedArtifactRunContext(msg, 'vscode-extension.webview-apply-files');
    const validationCommandRunner = this.deps.terminalPermissionCoordinator.createValidationCommandRunner({
      webview: wv,
      workspaceRoot: runContext.workspaceRoot,
      mode: 'edit',
      toolPolicy: buildToolPolicy('edit'),
      traceRunId: runContext.runId,
      traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
      onTraceEvidenceError: error => runContext.reportEvidenceIssue(error),
    });
    let unresolvedFailure = false;
    const reporter = async (status: ApplyWorkflowStatus) => {
      unresolvedFailure = updateGeneratedArtifactEvidence(runContext, status, unresolvedFailure);
      postWebviewEvent(wv, { kind: 'workflow', status });
    };
    const routeChat = (opts: GeneratedArtifactRouteChatOptions) => this.deps.routeChat({
      ...opts,
      traceRunId: opts.traceRunId ?? runContext.runId,
      traceWorkspaceRoot: opts.traceWorkspaceRoot ?? runContext.workspaceRoot,
      traceEvidenceParticipantToken: opts.traceEvidenceParticipantToken ?? runContext.evidenceParticipantToken,
      onTraceEvidenceError: opts.onTraceEvidenceError ?? (error => runContext.reportEvidenceIssue(error)),
    });
    try {
      const result = await applyGeneratedArtifactsWithPrompt(
        msg.text,
        msg.prompt,
        reporter,
        msg.autoApply === true,
        async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
        msg.files,
        { rollbackOnValidationFailure: false, validationCommandRunner },
      );
      const recovered = await recoverApplyFailureIfPossible({
        reporter,
        originalPrompt: msg.prompt ?? msg.text,
        failedResponse: msg.text,
        failedApply: result,
        preferredAbsolutePaths: msg.files,
        chat: (repairPrompt) => routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
        apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
          repairResponse,
          repairPrompt,
          reporter,
          true,
          onAppliedChange,
          msg.files,
          { rollbackOnValidationFailure: false, validationCommandRunner },
        ),
        onAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
      });
      const finalResult = recovered ?? result;
      if (shouldRunClosedLoopRepair(finalResult)) {
        await runClosedLoopRepair({
          reporter,
          originalPrompt: msg.prompt || '请根据自动验证失败结果继续修复，直到通过。',
          mode: msg.mode,
          initialApply: finalResult,
          preferredAbsolutePaths: msg.files ?? this.deps.getLastConversationFiles(),
          routeChat,
          registerAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
          getSessionId: this.deps.getActiveSessionId,
          postVisibleDelta: (text) => { postWebviewMessage(wv, { type: 'delta', text }); },
          validationCommandRunner,
        });
      }
      const requestedStatus = unresolvedFailure ? 'failed' : 'completed';
      const settlementStatus = this.deps.terminalPermissionCoordinator.completeRunContext(runContext, requestedStatus, {
        changedPaths: finalResult.changedPaths,
        applied: finalResult.applied,
      });
      if (requestedStatus === 'completed' && settlementStatus !== 'completed') {
        postWebviewEvent(wv, { kind: 'workflow', status: {
          phase: 'apply',
          state: 'failed',
          title: '文件已应用，但运行证据结算失败',
          detail: '本轮不能投影为完成；请检查运行证据日志后重试。',
        } });
      }
    } catch (error) {
      this.deps.terminalPermissionCoordinator.completeRunContext(runContext, 'failed', { reason: 'webview-apply-files-error' });
      throw error;
    }
  }

  async openPath(msg: GeneratedArtifactMessage): Promise<void> {
    if (!msg.path) return;
    await openWorkspacePathInEditor({
      rawPath: msg.path,
      line: msg.line,
      generatedText: msg.text,
      requestPrompt: msg.prompt,
      preferredAbsolutePaths: msg.files,
      fallbackAbsolutePaths: this.deps.getLastConversationFiles(),
    });
  }

  async previewPath(msg: GeneratedArtifactMessage): Promise<void> {
    if (msg.text && msg.path) {
      await previewGeneratedArtifactPathWithPrompt(msg.text, msg.path, msg.prompt);
    }
  }

  async applyPath(wv: vscode.Webview, msg: GeneratedArtifactMessage): Promise<void> {
    if (!msg.text || !msg.path) return;
    const runContext = createGeneratedArtifactRunContext(msg, 'vscode-extension.webview-apply-path');
    const validationCommandRunner = this.deps.terminalPermissionCoordinator.createValidationCommandRunner({
      webview: wv,
      workspaceRoot: runContext.workspaceRoot,
      mode: 'edit',
      toolPolicy: buildToolPolicy('edit'),
      traceRunId: runContext.runId,
      traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
      onTraceEvidenceError: error => runContext.reportEvidenceIssue(error),
    });
    let unresolvedFailure = false;
    const reporter = async (status: ApplyWorkflowStatus) => {
      unresolvedFailure = updateGeneratedArtifactEvidence(runContext, status, unresolvedFailure);
      postWebviewEvent(wv, { kind: 'workflow', status });
    };
    const routeChat = (opts: GeneratedArtifactRouteChatOptions) => this.deps.routeChat({
      ...opts,
      traceRunId: opts.traceRunId ?? runContext.runId,
      traceWorkspaceRoot: opts.traceWorkspaceRoot ?? runContext.workspaceRoot,
      traceEvidenceParticipantToken: opts.traceEvidenceParticipantToken ?? runContext.evidenceParticipantToken,
      onTraceEvidenceError: opts.onTraceEvidenceError ?? (error => runContext.reportEvidenceIssue(error)),
    });
    try {
      const result = await applyGeneratedArtifactPathWithPrompt(
        msg.text,
        msg.path,
        msg.prompt,
        reporter,
        msg.autoApply === true,
        async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
        msg.files,
        { validationCommandRunner },
      );
      const recovered = await recoverApplyFailureIfPossible({
        reporter,
        originalPrompt: msg.prompt ?? `请修复文件 ${msg.path}`,
        failedResponse: msg.text,
        failedApply: result,
        preferredAbsolutePaths: msg.files,
        chat: (repairPrompt) => routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
        apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
          repairResponse,
          repairPrompt,
          reporter,
          true,
          onAppliedChange,
          msg.files,
          { rollbackOnValidationFailure: false, validationCommandRunner },
        ),
        onAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
      });
      const finalResult = recovered ?? result;
      if (shouldRunClosedLoopRepair(finalResult)) {
        await runClosedLoopRepair({
          reporter,
          originalPrompt: msg.prompt || `请继续修复文件 ${msg.path} 的验证失败问题，直到通过。`,
          mode: msg.mode,
          initialApply: finalResult,
          preferredAbsolutePaths: msg.files ?? this.deps.getLastConversationFiles(),
          routeChat,
          registerAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
          getSessionId: this.deps.getActiveSessionId,
          postVisibleDelta: (text) => { postWebviewMessage(wv, { type: 'delta', text }); },
          validationCommandRunner,
        });
      }
      const requestedStatus = unresolvedFailure ? 'failed' : 'completed';
      const settlementStatus = this.deps.terminalPermissionCoordinator.completeRunContext(runContext, requestedStatus, {
        changedPaths: finalResult.changedPaths,
        applied: finalResult.applied,
      });
      if (requestedStatus === 'completed' && settlementStatus !== 'completed') {
        postWebviewEvent(wv, { kind: 'workflow', status: {
          phase: 'apply',
          state: 'failed',
          title: '目标文件已应用，但运行证据结算失败',
          detail: '本轮不能投影为完成；请检查运行证据日志后重试。',
        } });
      }
    } catch (error) {
      this.deps.terminalPermissionCoordinator.completeRunContext(runContext, 'failed', { reason: 'webview-apply-path-error' });
      throw error;
    }
  }
}

function createGeneratedArtifactRunContext(msg: GeneratedArtifactMessage, source: string) {
  const absoluteTarget = [msg.path, ...(msg.files ?? [])]
    .find(candidate => typeof candidate === 'string' && nodePath.isAbsolute(candidate));
  const targetWorkspace = absoluteTarget
    ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteTarget))
    : undefined;
  const workspaceRoot = targetWorkspace?.uri.fsPath
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();
  return createDevSeekRunContext({
    workspaceRoot,
    source,
    userPrompt: msg.prompt ?? msg.text ?? 'Apply generated workspace change',
    mode: msg.mode,
    traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
  });
}

function updateGeneratedArtifactEvidence(
  runContext: ReturnType<typeof createDevSeekRunContext>,
  status: ApplyWorkflowStatus,
  unresolvedFailure: boolean,
): boolean {
  runContext.recordAgentStatus({
    type: 'agentStatus',
    phase: status.phase === 'apply'
      ? 'execute'
      : status.phase === 'repair'
        ? 'repair'
        : status.phase,
    state: status.state === 'passed' ? 'completed' : status.state,
    taskId: `webview-${status.phase}`,
    ...((status.phase === 'validate' || status.phase === 'quality')
      ? { evidenceOperationId: status.operationId }
      : {}),
    ...(status.phase === 'apply' ? { taskAction: 'modify' as const } : {}),
    title: status.title,
    detail: status.detail,
  });
  if (status.state === 'failed' || status.state === 'skipped') return true;
  if (status.phase === 'quality' && (status.state === 'completed' || status.state === 'passed')) return false;
  return unresolvedFailure;
}
