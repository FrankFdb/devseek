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
  GeneratedArtifactSurfaceController,
  type AppliedChangeRecord,
  type GeneratedArtifactRouteChatOptions,
} from './generated-artifact-surface-controller';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import type { PendingEditCoordinator } from '../pending-edit-coordinator';
import { insertCodeToEditor } from '../app/chat-resource-actions';
import type { SessionMeta } from '../app/session-service';
import {
  emitResponseMeta,
  pushUiSettings,
} from './generated-artifact-ui';
import { postWebviewMessage } from './webview-event-adapter';
import { getChatHtml } from './webview-html';
import type { WebviewInboundMessage, WebviewOutboundMessage } from './webview-protocol';
import {
  buildWorkspaceFileTree,
  getGitDiff,
} from '../app/context-discovery-service';
import { settleRunContextDirect } from '../app/agent-run-settlement';
import { createDevSeekRunContext } from '../app/run-context';
import { getProblemsContext } from '../context-builder';
import { VSCodeSurfaceAdapter } from './vscode-surface-adapter';
import { ProductMutationCoordinator } from '../app/product-mutation-coordinator';

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

export type ViewRouteChatOptions = GeneratedArtifactRouteChatOptions;

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
  cancelActiveAgentRun: (data?: Record<string, unknown>) => void;
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
  private readonly generatedArtifactActions: GeneratedArtifactSurfaceController;

  constructor(private readonly deps: DeepSeekViewProviderDeps) {
    this.generatedArtifactActions = new GeneratedArtifactSurfaceController({
      pendingEditCoordinator: deps.pendingEditCoordinator,
      terminalPermissionCoordinator: deps.terminalPermissionCoordinator,
      routeChat: deps.routeChat,
      getActiveSessionId: deps.getActiveSessionId,
      getLastConversationFiles: deps.getLastConversationFiles,
    });
  }

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

  async submitHarnessChatMessage(msg: WebviewMessage): Promise<void> {
    this.focus();
    const webview = this._view?.webview;
    if (!webview) throw new Error('DevSeek chat webview is not available for harness submission');
    await this._onMessage(webview, msg);
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
        await this.generatedArtifactActions.previewFiles(msg);
        break;
      case 'applyGeneratedFiles':
        await this.generatedArtifactActions.applyFiles(wv, msg);
        break;
      case 'openGeneratedPath':
        await this.generatedArtifactActions.openPath(msg);
        break;
      case 'previewGeneratedPath':
        await this.generatedArtifactActions.previewPath(msg);
        break;
      case 'applyGeneratedPath':
        await this.generatedArtifactActions.applyPath(wv, msg);
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
          await this.deps.pendingEditCoordinator.keepHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'undoPendingHunk':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.undoHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'keepPendingEdit':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.keepEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'undoPendingEdit':
        if (msg.editId || msg.path) {
          await this.deps.pendingEditCoordinator.undoEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'keepAllPendingEdits':
        await this.deps.pendingEditCoordinator.keepAllWithNotice(wv);
        break;
      case 'undoAllPendingEdits':
        await this.deps.pendingEditCoordinator.undoAllWithNotice(wv);
        break;
      case 'cancel':
        this.deps.cancelActiveAgentRun({ reason: 'user-cancelled', source: 'vscode-webview-cancel' });
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
        await this.handleRunInVsTerminal(wv, msg);
        break;
      case 'setAutopilot':
        await vscode.workspace.getConfiguration('devseek').update('autopilotMode', msg.autopilot === true, vscode.ConfigurationTarget.Global);
        break;
      case 'runCommand':
        if (msg.command) {
          const commandRunContext = createDevSeekRunContext({
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
            source: 'vscode-extension.webview-command',
            userPrompt: `Run VS Code command ${String(msg.command)}`,
            mode: 'webview-command',
            traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
          });
          try {
            await new ProductMutationCoordinator(commandRunContext, 'vscode-webview-command').run({
              kind: 'vscode-command',
              label: `webview-command:${String(msg.command)}`,
              authorize: () => ({
                allowed: false,
                source: 'execution-policy',
                reason: 'Generic inbound VS Code commands are disabled; use a typed product action.',
              }),
              invoke: () => undefined,
            });
            const settlement = settleRunContextDirect(commandRunContext, 'completed');
            if (!settlement.completed) {
              postWebviewMessage(wv, {
                type: 'error',
                text: 'VS Code 命令候选已执行，但运行证据结算失败；本轮不能标记完成。',
              });
            }
          } catch (error) {
            settleRunContextDirect(commandRunContext, 'failed', { reason: 'generic-webview-command-refused' });
            postWebviewMessage(wv, {
              type: 'error',
              text: error instanceof Error ? error.message : String(error),
            });
          }
        }
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
        loggedIn: bridgeStatus?.loggedInLikely ?? false,
        providerMode: 'bridge',
      });
    } catch {
      wv.postMessage({ type: 'statusUpdate', online: false, loggedIn: false, providerMode: 'bridge' });
    }
  }

  private async handleRunInVsTerminal(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
    const command = msg.text || '';
    const cwd = msg.path || '';
    if (!command) return;
    const workspaceRoot = (cwd
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd))?.uri.fsPath
      : undefined)
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();
    const result = await this.deps.terminalPermissionCoordinator.runOwnedCommandWithPermission({
      webview: wv,
      command,
      workdir: cwd || workspaceRoot,
      workspaceRoot,
      mode: 'run',
      source: 'vscode-extension.webview-visible-terminal',
      presentation: 'visible',
      terminalName: 'DevSeek Run',
    });
    if (result.settlementStatus === 'failed') {
      postWebviewMessage(wv, {
        type: 'error',
        text: '终端命令已启动，但运行证据结算失败；本轮不能标记完成。',
      });
    }
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
    const checkpoint = await this.deps.loadFreshAgentCheckpoint(7_200_000);
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
