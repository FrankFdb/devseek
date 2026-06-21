import * as nodePath from 'path';
import * as vscode from 'vscode';
import {
  cancel,
  ensureBridgeRunning,
  ping,
  preattachFiles,
  readWorkspaceFile,
  relogin,
  status,
} from '../bridge-client';
import { getActiveProvider, getActiveProviderType } from '../llm/provider-router';
import type { ChatMessage } from '../llm/types';
import type { AgentTask } from '../agent-task-decomposer';
import type { TaskCheckpointRecord } from '../app/task-checkpoint-store';
import {
  applyGeneratedArtifactPathWithPrompt,
  applyGeneratedArtifactsWithPrompt,
  previewGeneratedArtifactPathWithPrompt,
  previewGeneratedArtifactsWithPrompt,
  type AppliedChangeRecord,
  type ApplyWorkflowStatus,
} from '../workspace-applier';
import { recoverApplyFailureIfPossible } from '../app/apply-failure-recovery-service';
import { shouldRunClosedLoopRepair } from '../app/agentic-repair-service';
import { runClosedLoopRepair } from '../app/closed-loop-repair-runner';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import type { PendingEditCoordinator } from '../pending-edit-coordinator';
import { insertCodeToEditor } from '../app/chat-resource-actions';
import type { SessionMeta } from '../app/session-service';
import {
  emitResponseMeta,
  openWorkspacePathInEditor,
  pushUiSettings,
} from './generated-artifact-ui';
import { postWebviewEvent, postWebviewMessage } from './webview-event-adapter';
import { getChatHtml } from './webview-html';
import type { WebviewInboundMessage, WebviewOutboundMessage } from './webview-protocol';
import {
  buildWorkspaceFileTree,
  getGitDiff,
} from '../app/context-discovery-service';
import { getProblemsContext } from '../context-builder';
import { VSCodeSurfaceAdapter } from './vscode-surface-adapter';

type WebviewMessage = WebviewInboundMessage;
type AgentTaskCheckpoint = TaskCheckpointRecord<AgentTask>;

interface PendingItem {
  userDisplay: string;
  prompt: string;
  newSession: boolean;
}

interface PendingAttachment {
  label: string;
  content: string;
  filePath?: string;
}

export interface ViewRouteChatOptions {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  files?: string[];
  stream?: boolean;
  trackHistory?: boolean;
}

export type ViewRunChat = (
  webview: vscode.Webview,
  userDisplay: string,
  prompt: string,
  newSession: boolean,
  mode?: 'fast' | 'r1',
  files?: string[],
  forceNoAgent?: boolean,
  resumeFromIndex?: number,
  resumeTasks?: AgentTask[],
  images?: string[],
  intentConfirmed?: boolean,
  suppressUserMessage?: boolean,
) => Promise<void>;

export interface DeepSeekViewProviderDeps {
  extensionUri: vscode.Uri;
  pendingEditCoordinator: PendingEditCoordinator;
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
  runChat: ViewRunChat;
  routeChat: (opts: ViewRouteChatOptions) => Promise<string>;
  getActiveSessionId: () => string;
  getLastConversationFiles: () => string[];
  setLastConversationFiles: (files: string[]) => void;
  getActiveChatAbortController: () => AbortController | null;
  setActiveChatAbortController: (controller: AbortController | null) => void;
  pushAgentSteer: (text: string) => void;
  getActiveSessionPayload: () => WebviewOutboundMessage | undefined;
  loadFreshAgentCheckpoint: (maxAgeMs: number) => Promise<AgentTaskCheckpoint | undefined>;
  loadAgentCheckpoint: () => AgentTaskCheckpoint | undefined;
  saveAgentCheckpoint: (data: AgentTaskCheckpoint | null) => Promise<void>;
  getSessions: () => SessionMeta[];
  loadSession: (webview: vscode.Webview, id: string) => Promise<void>;
  deleteSession: (id: string) => void;
  saveCurrentSession: () => void;
  handleTaskHistoryUiMessage: (webview: vscode.Webview, msg: WebviewMessage) => Promise<void>;
}

/** Sidebar WebviewView adapter. It owns UI lifecycle and message dispatch only. */
export class DeepSeekViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _ready = false;
  private _pendingQueue: PendingItem[] = [];
  private _pendingAttachments: PendingAttachment[] = [];
  private readonly surfaceAdapter = new VSCodeSurfaceAdapter(() => this._view?.webview);

  constructor(private readonly deps: DeepSeekViewProviderDeps) {}

  focus(): void {
    void vscode.commands.executeCommand('workbench.view.extension.devseek-sidebar');
    void vscode.commands.executeCommand('devseek.chatViewLauncher.focus');
  }

  push(userDisplay: string, prompt: string, newSession: boolean): void {
    this.focus();
    if (this._ready && this._view) {
      void this.deps.runChat(this._view.webview, userDisplay, prompt, newSession);
    } else {
      this._pendingQueue.push({ userDisplay, prompt, newSession });
    }
  }

  addToChat(label: string, content: string, filePath?: string): void {
    this.focus();
    if (this._ready && this._view) {
      this._view.webview.postMessage({ type: 'addToChat', label, content, filePath });
    } else {
      this._pendingAttachments.push({ label, content, filePath });
    }
    if (filePath) {
      void ping().then(online => { if (online) return preattachFiles([filePath]); });
    }
  }

  addDirectoryToChat(label: string, filePaths: string[]): void {
    this.focus();
    if (this._ready && this._view) {
      this._view.webview.postMessage({ type: 'addToChat', label, content: '', filePath: null, directoryPaths: filePaths });
    } else {
      for (const fp of filePaths) {
        this._pendingAttachments.push({ label: nodePath.basename(fp), content: '', filePath: fp });
      }
    }
    if (filePaths.length > 0) {
      void ping().then(online => { if (online) return preattachFiles(filePaths); });
    }
  }

  async registerInlineChatEdit(change: AppliedChangeRecord): Promise<void> {
    if (this._view?.webview) {
      await this.deps.pendingEditCoordinator.registerChange(this._view.webview, change);
    }
  }

  postMessage(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  get webview(): vscode.Webview | undefined {
    return this._view?.webview;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    this._ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.deps.extensionUri],
    };
    webviewView.webview.html = getChatHtml(webviewView.webview, this.deps.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this._onMessage(webviewView.webview, msg);
    });

    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devseek.provider') && this._view) {
        this._view.webview.postMessage({ type: 'triggerStatusPoll' });
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._ready = false;
      cfgSub.dispose();
    });
  }

  private async _onMessage(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.handleReady(wv);
        break;
      case 'chat':
        if (msg.text) {
          const command = this.surfaceAdapter.toChatCommand({
            prompt: msg.prompt ?? msg.text,
            request: {
              newSession: msg.newSession ?? false,
              mode: msg.mode,
              files: msg.files,
              images: msg.images,
            },
          });
          await this.deps.runChat(
            wv,
            msg.text,
            command.request.prompt,
            command.request.newSession ?? false,
            command.request.mode,
            command.request.files,
            msg.forceNoAgent === true,
            undefined,
            undefined,
            command.request.images,
            msg.intentConfirmed === true,
            msg.suppressUserMessage === true,
          );
        }
        break;
      case 'agentSteer':
        this.handleAgentSteer(wv, msg);
        break;
      case 'previewGeneratedFiles':
        if (msg.text) await previewGeneratedArtifactsWithPrompt(msg.text, msg.prompt);
        break;
      case 'applyGeneratedFiles':
        await this.handleApplyGeneratedFiles(wv, msg);
        break;
      case 'openGeneratedPath':
        if (msg.path) {
          await openWorkspacePathInEditor({
            rawPath: msg.path,
            line: msg.line,
            generatedText: msg.text,
            requestPrompt: msg.prompt,
            preferredAbsolutePaths: msg.files,
            fallbackAbsolutePaths: this.deps.getLastConversationFiles(),
          });
        }
        break;
      case 'previewGeneratedPath':
        if (msg.text && msg.path) {
          await previewGeneratedArtifactPathWithPrompt(msg.text, msg.path, msg.prompt);
        }
        break;
      case 'applyGeneratedPath':
        await this.handleApplyGeneratedPath(wv, msg);
        break;
      case 'openPendingEdit':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.open(
            msg.editId,
            msg.path,
            msg.hunkId,
            typeof msg.hunkLine === 'number' ? msg.hunkLine : undefined,
          );
        }
        break;
      case 'keepPendingHunk':
        if (msg.editId || msg.path) {
          this.deps.pendingEditCoordinator.keepHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'undoPendingHunk':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.undoHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'keepPendingEdit':
        if (msg.editId || msg.path) {
          this.deps.pendingEditCoordinator.keepEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'undoPendingEdit':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.undoEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'keepAllPendingEdits':
        this.deps.pendingEditCoordinator.keepAllWithNotice(wv);
        break;
      case 'undoAllPendingEdits':
        await this.deps.pendingEditCoordinator.undoAllWithNotice(wv);
        break;
      case 'cancel':
        this.deps.getActiveChatAbortController()?.abort();
        this.deps.setActiveChatAbortController(null);
        this.deps.setLastConversationFiles([]);
        wv.postMessage({ type: 'contextFiles', files: [] });
        await cancel();
        break;
      case 'clearContext':
        this.deps.setLastConversationFiles([]);
        wv.postMessage({ type: 'contextFiles', files: [] });
        break;
      case 'agentToggle':
        await vscode.workspace.getConfiguration('devseek').update('agentEnabled', msg.enabled === true, vscode.ConfigurationTarget.Global);
        break;
      case 'clearHistory':
        wv.postMessage({ type: 'clearHistory' });
        break;
      case 'insertCode':
        if (msg.code) insertCodeToEditor(msg.code);
        break;
      case 'relogin':
        await this.handleRelogin(wv);
        break;
      case 'getStatus':
        await this.handleGetStatus(wv);
        break;
      case 'setMode':
        break;
      case 'terminalConfirmReply':
        this.deps.terminalPermissionCoordinator.handleConfirmReply(
          msg.confirmId as string,
          msg.allow === true,
          msg.alwaysAllow === true,
        );
        break;
      case 'runInVsTerminal':
        this.handleRunInVsTerminal(msg);
        break;
      case 'setAutopilot':
        await vscode.workspace.getConfiguration('devseek').update('autopilotMode', msg.autopilot === true, vscode.ConfigurationTarget.Global);
        break;
      case 'runCommand':
        if (msg.command) await vscode.commands.executeCommand(msg.command as string);
        break;
      case 'getProblems':
        await this.handleGetProblems(wv, msg);
        break;
      case 'resolveFile':
        await this.handleResolveFile(wv, msg);
        break;
      case 'listSessions':
        wv.postMessage({ type: 'sessionList', sessions: this.deps.getSessions(), activeId: this.deps.getActiveSessionId() });
        break;
      case 'loadSession':
        if (msg.id) await this.deps.loadSession(wv, msg.id as string);
        break;
      case 'listTasks':
      case 'openTask':
      case 'continueTask':
      case 'archiveTask':
      case 'deleteTask':
      case 'exportTask':
        await this.deps.handleTaskHistoryUiMessage(wv, msg);
        break;
      case 'deleteSession':
        if (msg.id) this.deps.deleteSession(msg.id as string);
        wv.postMessage({ type: 'sessionList', sessions: this.deps.getSessions(), activeId: this.deps.getActiveSessionId() });
        break;
      case 'saveSession':
        this.deps.saveCurrentSession();
        break;
      case 'resumeAgentCheckpoint':
        await this.handleResumeAgentCheckpoint(wv);
        break;
      case 'dismissAgentCheckpoint':
        await this.deps.saveAgentCheckpoint(null);
        break;
    }
  }

  private async handleReady(wv: vscode.Webview): Promise<void> {
    this._ready = true;
    pushUiSettings(wv);
    this.deps.pendingEditCoordinator.post(wv);
    this._flushQueue();

    const sessionPayload = this.deps.getActiveSessionPayload();
    if (sessionPayload) postWebviewMessage(wv, sessionPayload);

    const checkpoint = await this.deps.loadFreshAgentCheckpoint(7_200_000);
    if (checkpoint) {
      postWebviewMessage(wv, {
        type: 'agentCheckpointAvailable',
        resumeTaskIndex: checkpoint.startFromIndex,
        totalTasks: checkpoint.allTasks.length,
        userPrompt: checkpoint.displayPrompt,
        savedAt: checkpoint.savedAt,
        recoveryKind: checkpoint.recoveryKind,
        pauseReason: checkpoint.pauseReason,
      });
    }
  }

  private handleAgentSteer(wv: vscode.Webview, msg: WebviewMessage): void {
    const steerText = (msg.prompt ?? msg.text ?? '').trim();
    if (!steerText) return;
    const controller = this.deps.getActiveChatAbortController();
    if (!controller || controller.signal.aborted) {
      wv.postMessage({ type: 'agentSteerRejected', text: '当前没有正在运行的 Agent 任务。' });
      return;
    }
    const fileNote = (msg.files && msg.files.length > 0)
      ? `\n\n【用户补充附件路径】\n${msg.files.map(f => `- ${f}`).join('\n')}`
      : '';
    this.deps.pushAgentSteer(`${steerText}${fileNote}`);
    wv.postMessage({ type: 'agentSteerAccepted', text: msg.text ?? steerText });
  }

  private async handleApplyGeneratedFiles(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    if (!msg.text) return;
    const reporter = async (status: ApplyWorkflowStatus) => {
      postWebviewEvent(wv, { kind: 'workflow', status });
    };
    const result = await applyGeneratedArtifactsWithPrompt(
      msg.text,
      msg.prompt,
      reporter,
      msg.autoApply === true,
      async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
      msg.files,
      { rollbackOnValidationFailure: msg.autoApply !== true },
    );
    const recovered = await recoverApplyFailureIfPossible({
      reporter,
      originalPrompt: msg.prompt ?? msg.text,
      failedResponse: msg.text,
      failedApply: result,
      preferredAbsolutePaths: msg.files,
      chat: (repairPrompt) => this.deps.routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
      apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
        repairResponse,
        repairPrompt,
        reporter,
        true,
        onAppliedChange,
        msg.files,
        { rollbackOnValidationFailure: false },
      ),
      onAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
    });
    const finalResult = recovered ?? result;
    if (shouldRunClosedLoopRepair(finalResult)) {
      await runClosedLoopRepair({
        webview: wv,
        reporter,
        originalPrompt: msg.prompt || '请根据自动验证失败结果继续修复，直到通过。',
        mode: msg.mode,
        initialApply: finalResult,
        preferredAbsolutePaths: msg.files ?? this.deps.getLastConversationFiles(),
        routeChat: this.deps.routeChat,
        registerAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
        getSessionId: this.deps.getActiveSessionId,
      });
    }
  }

  private async handleApplyGeneratedPath(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    if (!msg.text || !msg.path) return;
    const reporter = async (status: ApplyWorkflowStatus) => {
      postWebviewEvent(wv, { kind: 'workflow', status });
    };
    const result = await applyGeneratedArtifactPathWithPrompt(
      msg.text,
      msg.path,
      msg.prompt,
      reporter,
      msg.autoApply === true,
      async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
      msg.files,
    );
    const recovered = await recoverApplyFailureIfPossible({
      reporter,
      originalPrompt: msg.prompt ?? `请修复文件 ${msg.path}`,
      failedResponse: msg.text,
      failedApply: result,
      preferredAbsolutePaths: msg.files,
      chat: (repairPrompt) => this.deps.routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
      apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
        repairResponse,
        repairPrompt,
        reporter,
        true,
        onAppliedChange,
        msg.files,
        { rollbackOnValidationFailure: false },
      ),
      onAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
    });
    const finalResult = recovered ?? result;
    if (shouldRunClosedLoopRepair(finalResult)) {
      await runClosedLoopRepair({
        webview: wv,
        reporter,
        originalPrompt: msg.prompt || `请继续修复文件 ${msg.path} 的验证失败问题，直到通过。`,
        mode: msg.mode,
        initialApply: finalResult,
        preferredAbsolutePaths: msg.files ?? this.deps.getLastConversationFiles(),
        routeChat: this.deps.routeChat,
        registerAppliedChange: async (change) => { await this.deps.pendingEditCoordinator.registerChange(wv, change); },
        getSessionId: this.deps.getActiveSessionId,
      });
    }
  }

  private async handleRelogin(wv: vscode.Webview): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DevSeek：正在启动 Bridge…', cancellable: false },
      async (progress) => {
        const ready = await ensureBridgeRunning(true);
        if (!ready) {
          const action = await vscode.window.showErrorMessage(
            'Bridge 启动失败：未找到或无法启动内置 Bridge。请重新安装最新 VSIX，或改用 AI API 模式。',
            '切换到 API 模式',
            '查看说明',
          );
          if (action === '切换到 API 模式') {
            await vscode.commands.executeCommand('devseek.switchProvider');
          } else if (action === '查看说明') {
            vscode.window.showInformationMessage('网页免费方式会随扩展内置 Bridge 启动；若刚安装过，请重载 VS Code 窗口后再点击登录。');
          }
          return;
        }
        progress.report({ message: '正在打开登录页…' });
        const ok = await relogin();
        if (ok) {
          vscode.window.showInformationMessage('浏览器已打开，请完成登录后即可继续使用 DevSeek。');
          setTimeout(() => wv.postMessage({ type: 'triggerStatusPoll' }), 3000);
        } else {
          vscode.window.showErrorMessage('无法打开登录页，请检查 Bridge 状态。');
        }
      },
    );
  }

  private async handleGetStatus(wv: vscode.Webview): Promise<void> {
    try {
      const providerType = getActiveProviderType();
      if (providerType !== 'bridge') {
        const provider = getActiveProvider();
        const available = await provider.available();
        const cfg = vscode.workspace.getConfiguration('devseek');
        let providerLabel = '已就绪';
        if (providerType === 'deepseek-api') {
          providerLabel = `API: ${cfg.get<string>('model', 'deepseek-chat')}`;
        } else if (providerType === 'openai-compat') {
          providerLabel = `OAI: ${cfg.get<string>('openaiCompatModel', 'llama3')}`;
        }
        wv.postMessage({
          type: 'statusUpdate',
          online: available,
          loggedIn: available,
          providerMode: providerType,
          providerLabel: available ? providerLabel : '未配置（点击 ⚙ 设置）',
        });
        return;
      }
      const bridgeStatus = await status();
      wv.postMessage({
        type: 'statusUpdate',
        online: bridgeStatus !== null,
        loggedIn: bridgeStatus?.browserReady ?? false,
        providerMode: 'bridge',
      });
    } catch {
      wv.postMessage({ type: 'statusUpdate', online: false, loggedIn: false, providerMode: 'bridge' });
    }
  }

  private handleRunInVsTerminal(msg: WebviewMessage): void {
    const command = msg.text || '';
    const cwd = msg.path || '';
    if (!command) return;
    const terminal = vscode.window.createTerminal({ name: 'DevSeek Run', cwd: cwd || undefined });
    terminal.show(true);
    terminal.sendText(command);
  }

  private async handleGetProblems(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    const problems = getProblemsContext();
    const injected = problems
      ? `\n\n**诊断错误：**\n\`\`\`\n${problems}\n\`\`\``
      : '（无诊断错误）';
    const finalText = (msg.text as string).replace('#problems', injected);
    await this.deps.runChat(wv, finalText, finalText, msg.newSession ?? false);
  }

  private async handleResolveFile(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    const filePath = msg.path as string;
    if (filePath === 'workspace' || filePath === 'ws') {
      const tree = buildWorkspaceFileTree();
      const injection = tree
        ? `\n\n**工作区文件结构：**\n\`\`\`\n${tree}\n\`\`\``
        : '（工作区为空或未打开）';
      const resolvedText = (msg.text as string).replace(`@${filePath}`, injection);
      await this.deps.runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
      return;
    }
    if (filePath === 'git') {
      const diff = await getGitDiff(false);
      const stagedDiff = await getGitDiff(true);
      const combined = [
        stagedDiff ? `# 已暂存（staged）\n${stagedDiff}` : '',
        diff ? `# 未暂存（unstaged）\n${diff}` : '',
      ].filter(Boolean).join('\n\n');
      const injection = combined
        ? `\n\n**Git 变更：**\n\`\`\`diff\n${combined.slice(0, 6000)}\n\`\`\``
        : '（没有检测到 git 变更）';
      const resolvedText = (msg.text as string).replace('@git', injection);
      await this.deps.runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
      return;
    }
    if (filePath === 'problems') {
      const problems = getProblemsContext();
      const injection = problems
        ? `\n\n**诊断错误：**\n\`\`\`\n${problems}\n\`\`\``
        : '（无诊断错误）';
      const resolvedText = (msg.text as string).replace('@problems', injection);
      await this.deps.runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
      return;
    }
    const content = await readWorkspaceFile(filePath, this.deps.getLastConversationFiles());
    const injection = content
      ? `\n\n**文件内容 \`${filePath}\`：**\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``
      : `（找不到文件：${filePath}）`;
    const resolvedText = (msg.text as string).replace(`@${filePath}`, injection);
    await this.deps.runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
  }

  private async handleResumeAgentCheckpoint(wv: vscode.Webview): Promise<void> {
    const checkpoint = this.deps.loadAgentCheckpoint();
    if (!checkpoint) return;
    wv.postMessage({ type: 'agentCheckpointCleared' });
    await this.deps.runChat(
      wv,
      checkpoint.displayPrompt,
      checkpoint.userPrompt,
      false,
      checkpoint.mode,
      undefined,
      false,
      checkpoint.startFromIndex,
      checkpoint.allTasks,
    );
  }

  private _flushQueue(): void {
    if (!this._view) return;
    const wv = this._view.webview;
    const files = this._pendingAttachments.splice(0);
    for (const file of files) {
      wv.postMessage({ type: 'addToChat', ...file });
    }
    const items = this._pendingQueue.splice(0);
    for (const item of items) {
      void this.deps.runChat(wv, item.userDisplay, item.prompt, item.newSession);
    }
  }
}
