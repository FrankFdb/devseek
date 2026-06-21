import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import { chat, ping, cancel, relogin, status, readWorkspaceFile, ensureBridgeRunning, preattachFiles, setBridgeExtensionRoot } from './bridge-client';
import { createProviderStatusBar, getActiveProvider, getActiveProviderType, getProviderConfigService, promptUpdateApiKey } from './llm/provider-router';
import { type ChatMessage, type TokenUsage } from './llm/types';
import { getProjectRules, invalidateProjectRulesCache, getProjectMemorySync, assembleProjectRulesAndMemoryContext } from './project-rules';
import {
  explainCode, fixBug, refactorCode, genTest, genDoc, askQuestion,
  generateCommitMessage, applyDiff, runTests,
} from './commands';
import {
  buildContext, buildCompletionPrompt, buildInlineChatPrompt,
  getProblemsContext, getDiagnosticsContext,
} from './context-builder';
import {
  applyGeneratedArtifactsWithPrompt,
  applyGeneratedArtifactPathWithPrompt,
  previewGeneratedArtifactsWithPrompt,
  previewGeneratedArtifactPathWithPrompt,
  resolveGeneratedArtifactPathForPrompt,
  type AppliedChangeRecord,
  type ApplyWorkflowStatus,
} from './workspace-applier';
import { detectWorkspacePathScope, isGeneratedArtifactAllowedForPrompt } from './workspace/path-resolver';
import { parseGeneratedArtifacts, type GeneratedArtifact } from './generated-file-parser';
import {
  type LocalExecutionPlan,
  planLocalExecution,
  planRepeatLocalExecution,
  shouldPreferLocalExecution,
} from './execution-planner';
import { AutoApplyPolicy, shouldAutoApplyFromResponse } from './intent-router';
import { clearSessionHabits, lookupLearnedIntent, recordIntentOutcome } from './intent-learner';
import {
  initAgentLearner, clearLearnerSession, emitLearningEvent,
  getCommandHints,
} from './agent-learner';
import { decomposeTask, getAgentTaskDisplayTarget, inferTasksFromFiles, type AgentTask } from './agent-task-decomposer';
import { runAgentLoop, AgentStatusMessage, extractAnalysisFindings, type AgentLoopResult } from './agent-loop';
import { createAgentHostToolCallbacks } from './agent/agent-host-tools';
import { runAgenticLoop } from './agent/agentic-loop';
import { getWorkspaceRootFsPath, resolveWorkspaceFileUri } from './workspace-roots';
import { McpManager } from './mcp/client';
import { isFileProtected } from './protected-files';
import { decideToolPermission, type ToolPolicy } from './app/permission-service';
import { recoverApplyFailureIfPossible } from './app/apply-failure-recovery-service';
import { responseClaimsStatusOk, shouldRunClosedLoopRepair } from './app/agentic-repair-service';
import { runClosedLoopRepair } from './app/closed-loop-repair-runner';
import { runLocalExecutionChatIfPossible } from './local-execution-chat-runner';
import { TerminalPermissionCoordinator } from './app/terminal-permission-coordinator';
import { ChatRouteController } from './app/chat-controller';
import { migrateLegacyDeepseekConfiguration } from './app/config-migration-service';
import { buildPreExecutionInteraction } from './app/interaction-service';
import { buildLocalAttachmentContextPrompt } from './app/local-attachment-context';
import { MemoryService } from './app/memory-service';
import { isProjectInitRequest, ProjectInitService, renderProjectInitDraftMarkdown } from './app/project-init-service';
import { tryBuildReadOnlyInspectionResult } from './app/read-only-inspection-service';
import { buildRestoredSessionLlmHistory, buildSessionLoadedPayload } from './app/session-display-service';
import { buildSessionBootstrapState } from './app/session-bootstrap-service';
import { SessionService, type SessionMeta } from './app/session-service';
import {
  appendSessionContinuationContext,
  shouldInjectSessionContinuationForIntent,
  shouldResumeCheckpointFromPrompt,
} from './app/session-continuation';
import {
  DEFAULT_TASK_CHECKPOINT_KEY,
  TaskCheckpointStore,
  type TaskCheckpointRecord,
} from './app/task-checkpoint-store';
import { buildProviderRecoveryCheckpointTasks, buildProviderRecoveryDisplay, ProviderRecoveryService } from './app/provider-recovery-service';
import { resolveProviderStatusResponse } from './app/provider-status-service';
import { PendingEditCoordinator } from './pending-edit-coordinator';
import { addResourceToChat, insertCodeToEditor } from './app/chat-resource-actions';
import { recordTrackedChatHistory as recordTrackedChatHistoryState } from './app/chat-history-tracker';
import {
  AGENT_CODE_FILE_RE,
  buildAgenticSessionContextFromState,
  resolveSessionContinuationFilesFromState,
  type AgentSessionState,
} from './app/agent-session-context';
import { emitResponseMeta, injectFileHintsIntoResponse, openWorkspacePathInEditor, pushUiSettings } from './ui/generated-artifact-ui';
import { postWebviewEvent, postWebviewMessage } from './ui/webview-event-adapter';
import { getChatHtml } from './ui/webview-html';
import type { WebviewInboundMessage } from './ui/webview-protocol';
import { stripToolCallBlocks } from './agent/fake-tool-parser';
import { buildAgentRunDisplayProfile } from './agent/agent-run-display';
import {
  buildWorkspaceFileTree,
  discoverFilesFromDirectoryPrompt,
  getGitDiff,
  relPathFromWorkspace,
  toContextDisplayLabels,
} from './app/context-discovery-service';
import { TaskHistoryUiService } from './app/task-history-ui-service';
import {
  appendFileAwareFormatHint,
  appendStructuredGenerationHint,
  buildReformatPrompt,
  buildSmalltalkReply,
  chatContentEquals,
  chatContentStartsWith,
  chatContentText,
  normalizeConversationFiles,
} from './app/chat-prompt-formatting';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
type WebviewMessage = WebviewInboundMessage;

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

// ----------------------------------------------------------------
// Sidebar chat view state (single-level entry, no launcher page)
// ----------------------------------------------------------------
let extensionUriGlobal: vscode.Uri;
let viewProvider: DeepSeekViewProvider;
let lastLocalExecutionPlan: LocalExecutionPlan | undefined;
let pendingEditCoordinator: PendingEditCoordinator;
const chatRouteController = new ChatRouteController();
const terminalPermissionCoordinator = new TerminalPermissionCoordinator();
let lastConversationFiles: string[] = [];
let lastAnalysisText = '';
/** Workspace-relative paths of files created/modified by the last agent run */
let lastAgentChangedPaths: string[] = [];
/** 非 bridge provider 的对话历史（多轮记忆），新会话时清空 */
let nonBridgeChatHistory: ChatMessage[] = [];
/** 当前正在执行的 chat 请求的 AbortController（停止按钮使用） */
let activeChatAbortController: AbortController | null = null;
/** 用户在 Agent 运行中输入的补充/纠偏，会在下一轮模型调用前注入。 */
const activeAgentSteerQueue: string[] = [];
// ── Session memory (L1a/L1b + L2) ─────────────────────────────────────────
/** VS Code ExtensionContext，用于 workspaceState 持久化 */
let extContext: vscode.ExtensionContext;
/** L2: 文件路径字典 basename/relPath → absPath，跨轮次不清空 */
const sessionRecentFiles = new Map<string, string>();
/** 当前活跃的 session ID */
let activeSessionId = '';
// P3-5: MCP manager (singleton; initialized lazily in activate)
const mcpManager = new McpManager();

function getSessionService(): SessionService | undefined {
  return extContext ? new SessionService(extContext.workspaceState) : undefined;
}

// ── Agent task checkpoint (断点续传) ────────────────────────────────────────
/** workspaceState key for persisting the interrupted-task checkpoint */
const CHECKPOINT_KEY = DEFAULT_TASK_CHECKPOINT_KEY;
/** Shape of the persisted checkpoint */
type AgentTaskCheckpoint = TaskCheckpointRecord<AgentTask>;

/** Save or clear the agent task checkpoint. Pass null to clear (completed). */
async function saveAgentCheckpoint(data: AgentTaskCheckpoint | null): Promise<void> {
  if (!extContext) return;
  const store = new TaskCheckpointStore<AgentTask>(extContext.workspaceState, CHECKPOINT_KEY);
  await (data ? store.save(data) : store.clear());
}

/** Load the checkpoint if one exists for the current session. */
function loadAgentCheckpoint(): AgentTaskCheckpoint | undefined {
  if (!extContext) return undefined;
  return new TaskCheckpointStore<AgentTask>(extContext.workspaceState, CHECKPOINT_KEY).load();
}

async function loadFreshAgentCheckpoint(maxAgeMs: number): Promise<AgentTaskCheckpoint | undefined> {
  if (!extContext) return undefined;
  const result = await new TaskCheckpointStore<AgentTask>(extContext.workspaceState, CHECKPOINT_KEY).loadFresh(maxAgeMs);
  return result?.checkpoint;
}

/** Provider keeps push() API but drives a Sidebar WebviewView directly. */
class DeepSeekViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _ready = false;
  private _pendingQueue: PendingItem[] = [];
  private _pendingAttachments: PendingAttachment[] = [];

  focus(): void {
    void vscode.commands.executeCommand('workbench.view.extension.devseek-sidebar');
    void vscode.commands.executeCommand('devseek.chatViewLauncher.focus');
  }

  push(userDisplay: string, prompt: string, newSession: boolean): void {
    this.focus();
    if (this._ready && this._view) {
      void runChat(this._view.webview, userDisplay, prompt, newSession);
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

  /** Add a directory as a single badge; all file paths are sent when user submits. */
  addDirectoryToChat(label: string, filePaths: string[]): void {
    this.focus();
    if (this._ready && this._view) {
      this._view.webview.postMessage({ type: 'addToChat', label, content: '', filePath: null, directoryPaths: filePaths });
    } else {
      // Queue as multiple individual files so they're sent when ready
      for (const fp of filePaths) {
        this._pendingAttachments.push({ label: nodePath.basename(fp), content: '', filePath: fp });
      }
    }
    // Pre-attach all files in background
    if (filePaths.length > 0) {
      void ping().then(online => { if (online) return preattachFiles(filePaths); });
    }
  }

  /**
   * P3-3: 将行内聊天产生的改动注册为 Pending Edit。
   * 触发侧边栏显示并自动打开 Diff 视图，让用户可以对比/撤销。
   */
  async registerInlineChatEdit(change: AppliedChangeRecord): Promise<void> {
    if (this._view?.webview) {
      await pendingEditCoordinator.registerChange(this._view.webview, change);
    }
  }

  /** G-5: Post an arbitrary message to the webview if it's active. */
  postMessage(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  /** G-5: Get the webview instance (may be undefined before first resolve). */
  get webview(): vscode.Webview | undefined {
    return this._view?.webview;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    this._ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUriGlobal],
    };
    webviewView.webview.html = getChatHtml(webviewView.webview, extensionUriGlobal);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this._onMessage(webviewView.webview, msg);
    });

    // 当用户在 VS Code 状态栏切换 provider 时，立即通知 webview 重新检查状态
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
        this._ready = true;
        pushUiSettings(wv);
        pendingEditCoordinator.post(wv);
        this._flushQueue();
        // Restore active session to webview UI on reload.
        // NOTE: nonBridgeChatHistory is intentionally empty on startup (clean LLM context).
        // We read the stored history directly for UI display only.
        if (activeSessionId) {
          const _storedHistForUI = extContext?.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
          const _storedSumForUI = extContext?.workspaceState.get<string>(`deepseek.session.${activeSessionId}.summary`, '') ?? '';
          const _payload = buildSessionLoadedPayload({
            id: activeSessionId,
            history: _storedHistForUI,
            summary: _storedSumForUI,
            meta: getSessions().find(s => s.id === activeSessionId),
          });
          if (_payload.history.length > 0 || _payload.summary) postWebviewMessage(wv, _payload);
        }
        // 断点续传：notify webview if there is a fresh unfinished task checkpoint
        {
          const _cp = await loadFreshAgentCheckpoint(7_200_000);
          if (_cp) {
            postWebviewMessage(wv, {
              type: 'agentCheckpointAvailable',
              resumeTaskIndex: _cp.startFromIndex,
              totalTasks: _cp.allTasks.length,
              userPrompt: _cp.displayPrompt,
              savedAt: _cp.savedAt,
              recoveryKind: _cp.recoveryKind,
              pauseReason: _cp.pauseReason,
            });
          }
        }
        break;
      case 'chat':
        if (msg.text) {
          await runChat(
            wv,
            msg.text,
            msg.prompt ?? msg.text,
            msg.newSession ?? false,
            msg.mode,
            msg.files,
            msg.forceNoAgent === true,
            undefined,
            undefined,
            msg.images,
            msg.intentConfirmed === true,
            msg.suppressUserMessage === true,
          );
        }
        break;
      case 'agentSteer': {
        const steerText = (msg.prompt ?? msg.text ?? '').trim();
        if (!steerText) break;
        if (!activeChatAbortController || activeChatAbortController.signal.aborted) {
          wv.postMessage({ type: 'agentSteerRejected', text: '当前没有正在运行的 Agent 任务。' });
          break;
        }
        const fileNote = (msg.files && msg.files.length > 0)
          ? `\n\n【用户补充附件路径】\n${msg.files.map(f => `- ${f}`).join('\n')}`
          : '';
        activeAgentSteerQueue.push(`${steerText}${fileNote}`);
        wv.postMessage({ type: 'agentSteerAccepted', text: msg.text ?? steerText });
        break;
      }
      case 'previewGeneratedFiles':
        if (msg.text) { await previewGeneratedArtifactsWithPrompt(msg.text, msg.prompt); }
        break;
      case 'applyGeneratedFiles':
        if (msg.text) {
          const result = await applyGeneratedArtifactsWithPrompt(msg.text, msg.prompt, async (status: ApplyWorkflowStatus) => {
            postWebviewEvent(wv, { kind: 'workflow', status });
          }, msg.autoApply === true, async (change) => {
            await pendingEditCoordinator.registerChange(wv, change);
          }, msg.files, { rollbackOnValidationFailure: msg.autoApply !== true });

          const recovered = await recoverApplyFailureIfPossible({
            reporter: async (status: ApplyWorkflowStatus) => { postWebviewEvent(wv, { kind: 'workflow', status }); },
            originalPrompt: msg.prompt ?? msg.text,
            failedResponse: msg.text,
            failedApply: result,
            preferredAbsolutePaths: msg.files,
            chat: (repairPrompt) => routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
            apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
              repairResponse, repairPrompt, async (status) => { postWebviewEvent(wv, { kind: 'workflow', status }); },
              true, onAppliedChange, msg.files, { rollbackOnValidationFailure: false },
            ),
            onAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(wv, change); },
          });
          const finalResult = recovered ?? result;

          if (shouldRunClosedLoopRepair(finalResult)) {
            const originalPrompt = msg.prompt || '请根据自动验证失败结果继续修复，直到通过。';
            await runClosedLoopRepair({
              webview: wv,
              reporter: async (status: ApplyWorkflowStatus) => {
                postWebviewEvent(wv, { kind: 'workflow', status });
              },
              originalPrompt,
              mode: msg.mode,
              initialApply: finalResult,
              preferredAbsolutePaths: msg.files ?? lastConversationFiles,
              routeChat,
              registerAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(wv, change); },
              getSessionId: () => activeSessionId,
            });
          }
        }
        break;
      case 'openGeneratedPath':
        if (msg.path) {
          await openWorkspacePathInEditor({
            rawPath: msg.path,
            line: msg.line,
            generatedText: msg.text,
            requestPrompt: msg.prompt,
            preferredAbsolutePaths: msg.files,
            fallbackAbsolutePaths: lastConversationFiles,
          });
        }
        break;
      case 'previewGeneratedPath':
        if (msg.text && msg.path) {
          await previewGeneratedArtifactPathWithPrompt(msg.text, msg.path, msg.prompt);
        }
        break;
      case 'applyGeneratedPath':
        if (msg.text && msg.path) {
          const result = await applyGeneratedArtifactPathWithPrompt(
            msg.text,
            msg.path,
            msg.prompt,
            async (status: ApplyWorkflowStatus) => {
              postWebviewEvent(wv, { kind: 'workflow', status });
            },
            msg.autoApply === true,
            async (change) => {
              await pendingEditCoordinator.registerChange(wv, change);
            },
            msg.files,
          );

          const recovered = await recoverApplyFailureIfPossible({
            reporter: async (status: ApplyWorkflowStatus) => { postWebviewEvent(wv, { kind: 'workflow', status }); },
            originalPrompt: msg.prompt ?? `请修复文件 ${msg.path}`,
            failedResponse: msg.text,
            failedApply: result,
            preferredAbsolutePaths: msg.files,
            chat: (repairPrompt) => routeChat({ prompt: repairPrompt, newSession: false, mode: msg.mode, stream: false, trackHistory: false }),
            apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
              repairResponse, repairPrompt, async (status) => { postWebviewEvent(wv, { kind: 'workflow', status }); },
              true, onAppliedChange, msg.files, { rollbackOnValidationFailure: false },
            ),
            onAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(wv, change); },
          });
          const finalResult = recovered ?? result;

          if (shouldRunClosedLoopRepair(finalResult)) {
            const originalPrompt = msg.prompt || `请继续修复文件 ${msg.path} 的验证失败问题，直到通过。`;
            await runClosedLoopRepair({
              webview: wv,
              reporter: async (status: ApplyWorkflowStatus) => {
                postWebviewEvent(wv, { kind: 'workflow', status });
              },
              originalPrompt,
              mode: msg.mode,
              initialApply: finalResult,
              preferredAbsolutePaths: msg.files ?? lastConversationFiles,
              routeChat,
              registerAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(wv, change); },
              getSessionId: () => activeSessionId,
            });
          }
        }
        break;
      case 'openPendingEdit':
        if (msg.editId || msg.path) {
          await pendingEditCoordinator.open(
            msg.editId,
            msg.path,
            msg.hunkId,
            typeof msg.hunkLine === 'number' ? msg.hunkLine : undefined,
          );
        }
        break;
      case 'keepPendingHunk':
        if (msg.editId || msg.path) {
          pendingEditCoordinator.keepHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'undoPendingHunk':
        if (msg.editId || msg.path) {
          await pendingEditCoordinator.undoHunkWithNotice(wv, msg.editId, msg.path, msg.hunkId);
        }
        break;
      case 'keepPendingEdit':
        if (msg.editId || msg.path) {
          pendingEditCoordinator.keepEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'undoPendingEdit':
        if (msg.editId || msg.path) {
          await pendingEditCoordinator.undoEditWithNotice(wv, msg.editId, msg.path);
        }
        break;
      case 'keepAllPendingEdits':
        pendingEditCoordinator.keepAllWithNotice(wv);
        break;
      case 'undoAllPendingEdits':
        await pendingEditCoordinator.undoAllWithNotice(wv);
        break;
      case 'cancel':
        activeChatAbortController?.abort();
        activeChatAbortController = null;
        lastConversationFiles = [];
        wv.postMessage({ type: 'contextFiles', files: [] });
        await cancel();
        break;
      case 'clearContext':
        lastConversationFiles = [];
        wv.postMessage({ type: 'contextFiles', files: [] });
        break;
      case 'agentToggle': {
        const newVal = msg.enabled === true;
        await vscode.workspace.getConfiguration('devseek').update('agentEnabled', newVal, vscode.ConfigurationTarget.Global);
        break;
      }
      case 'clearHistory':
        wv.postMessage({ type: 'clearHistory' });
        break;
      case 'insertCode':
        if (msg.code) { insertCodeToEditor(msg.code); }
        break;
      case 'relogin': {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'DevSeek：正在启动 Bridge…', cancellable: false },
          async (progress) => {
            const ready = await ensureBridgeRunning(true); // 强制重启，确保新版本
            if (!ready) {
              const action = await vscode.window.showErrorMessage(
                'Bridge 启动失败：未找到或无法启动内置 Bridge。请重新安装最新 VSIX，或改用 AI API 模式。',
                '切换到 API 模式', '查看说明',
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
        break;
      }
      case 'getStatus': {
        try {
        const pType = getActiveProviderType();
        if (pType !== 'bridge') {
          // 非-bridge provider：检查 provider 可用性，不检查 bridge 状态
          const prov = getActiveProvider();
          const avail = await prov.available();
          const cfg2 = vscode.workspace.getConfiguration('devseek');
          let providerLabel = '已就绪';
          if (pType === 'deepseek-api') {
            providerLabel = `API: ${cfg2.get<string>('model', 'deepseek-chat')}`;
          } else if (pType === 'openai-compat') {
            providerLabel = `OAI: ${cfg2.get<string>('openaiCompatModel', 'llama3')}`;
          }
          wv.postMessage({
            type: 'statusUpdate',
            online: avail,
            loggedIn: avail,
            providerMode: pType,
            providerLabel: avail ? providerLabel : '未配置（点击 ⚙ 设置）',
          });
        } else {
          const s = await status();
          wv.postMessage({
            type: 'statusUpdate',
            online: s !== null,
            loggedIn: s?.browserReady ?? false,
            providerMode: 'bridge',
          });
        }
        } catch {
          // 异常时兜底：显示离线状态
          wv.postMessage({ type: 'statusUpdate', online: false, loggedIn: false, providerMode: 'bridge' });
        }
        break;
      }
      case 'setMode':
        break;
      case 'terminalConfirmReply': {
        // G-2: user clicked Allow / Always Allow / Skip on the inline terminal confirm card
        terminalPermissionCoordinator.handleConfirmReply(
          msg.confirmId as string,
          msg.allow === true,
          msg.alwaysAllow === true,
        );
        break;
      }
      case 'runInVsTerminal': {
        // Launch the VS Code integrated terminal and run the command
        const termCmd = msg.text || '';
        const termCwd = msg.path || '';
        if (termCmd) {
          const terminalInstance = vscode.window.createTerminal({
            name: 'DevSeek Run',
            cwd: termCwd || undefined,
          });
          terminalInstance.show(true);
          terminalInstance.sendText(termCmd);
        }
        break;
      }
      case 'setAutopilot': {
        const config = vscode.workspace.getConfiguration('devseek');
        await config.update('autopilotMode', msg.autopilot === true, vscode.ConfigurationTarget.Global);
        break;
      }
      case 'runCommand':
        if (msg.command) { await vscode.commands.executeCommand(msg.command as string); }
        break;
      case 'getProblems': {
        const problems = getProblemsContext();
        const injected = problems
          ? `\n\n**诊断错误：**\n\`\`\`\n${problems}\n\`\`\``
          : '（无诊断错误）';
        const finalText = (msg.text as string).replace('#problems', injected);
        await runChat(wv, finalText, finalText, msg.newSession ?? false);
        break;
      }
      case 'resolveFile': {
        const filePath = msg.path as string;
        if (filePath === 'workspace' || filePath === 'ws') {
          const tree = buildWorkspaceFileTree();
          const injection = tree
            ? `\n\n**工作区文件结构：**\n\`\`\`\n${tree}\n\`\`\``
            : '（工作区为空或未打开）';
          const resolvedText = (msg.text as string).replace(`@${filePath}`, injection);
          await runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
          break;
        }
        // @git → 注入 git diff（未暂存 + 暂存变更）
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
          await runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
          break;
        }
        // @problems → 注入 VS Code 诊断错误
        if (filePath === 'problems') {
          const problems = getProblemsContext();
          const injection = problems
            ? `\n\n**诊断错误：**\n\`\`\`\n${problems}\n\`\`\``
            : '（无诊断错误）';
          const resolvedText = (msg.text as string).replace('@problems', injection);
          await runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
          break;
        }
        const content = await readWorkspaceFile(filePath, lastConversationFiles);
        const injection = content
          ? `\n\n**文件内容 \`${filePath}\`：**\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``
          : `（找不到文件：${filePath}）`;
        const resolvedText = (msg.text as string).replace(`@${filePath}`, injection);
        await runChat(wv, resolvedText, resolvedText, msg.newSession ?? false);
        break;
      }
      // ── Session memory handlers ──────────────────────────────────────
      case 'listSessions': {
        const sessions = getSessions();
        wv.postMessage({ type: 'sessionList', sessions, activeId: activeSessionId });
        break;
      }
      case 'loadSession': {
        const id = msg.id as string;
        if (!id || !extContext) break;
        saveCurrentSession();
        activeSessionId = id;
        getSessionService()?.setActiveSessionId(id);
        const files = extContext.workspaceState.get<Record<string, string>>(
          `deepseek.session.${id}.files`, {},
        ) ?? {};
        sessionRecentFiles.clear();
        for (const [k, v] of Object.entries(files)) sessionRecentFiles.set(k, v);
        const loadedSummary = extContext.workspaceState.get<string>(`deepseek.session.${id}.summary`, '') ?? '';
        const loadedHistory = extContext.workspaceState.get<ChatMessage[]>(`deepseek.session.${id}.history`, []) ?? [];
        nonBridgeChatHistory = buildRestoredSessionLlmHistory(loadedHistory, loadedSummary);
        lastConversationFiles = [];
        lastAnalysisText = extContext.workspaceState.get<string>(`deepseek.session.${id}.analysisText`, '') ?? '';
        restoreLastAgentPathsFromSession(id);
        const loadedMeta = getSessions().find(s => s.id === id);
        postWebviewMessage(wv, buildSessionLoadedPayload({ id, history: loadedHistory, summary: loadedSummary, meta: loadedMeta }));
        break;
      }
      case 'listTasks':
      case 'openTask':
      case 'continueTask':
      case 'archiveTask':
      case 'deleteTask':
      case 'exportTask':
        await handleTaskHistoryUiMessage(wv, msg);
        break;
      case 'deleteSession': {
        const id = msg.id as string;
        if (id) deleteSession(id);
        wv.postMessage({ type: 'sessionList', sessions: getSessions(), activeId: activeSessionId });
        break;
      }
      case 'saveSession':
        saveCurrentSession();
        break;
      // ── 断点续传 message handlers ─────────────────────────────────────────
      case 'resumeAgentCheckpoint': {
        const cp = loadAgentCheckpoint();
        if (!cp) break;
        // Clear the banner from webview before re-running
        wv.postMessage({ type: 'agentCheckpointCleared' });
        await runChat(
          wv,
          cp.displayPrompt,
          cp.userPrompt,
          false,
          cp.mode,
          /* files */ undefined,
          /* forceNoAgent */ false,
          cp.startFromIndex,
          cp.allTasks,
        );
        break;
      }
      case 'dismissAgentCheckpoint': {
        await saveAgentCheckpoint(null);
        break;
      }
    }
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
      void runChat(wv, item.userDisplay, item.prompt, item.newSession);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P3-2: @workspace file tree builder
// Builds a compact, prompt-friendly representation of the workspace file structure.
// Max 3 levels deep, skips build/node_modules/hidden dirs.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// P3-5: @git — inject git diff via VS Code git extension
// ─────────────────────────────────────────────────────────────────────────────
function loadAgentSessionState(sessionId = activeSessionId): AgentSessionState | undefined {
  if (!extContext || !sessionId) return undefined;
  return extContext.workspaceState.get<AgentSessionState>(`deepseek.session.${sessionId}.agentState`);
}

function saveAgentSessionState(state: AgentSessionState | null, sessionId = activeSessionId): void {
  if (!extContext || !sessionId) return;
  extContext.workspaceState.update(`deepseek.session.${sessionId}.agentState`, state ?? undefined);
}

function restoreLastAgentPathsFromSession(sessionId = activeSessionId): void {
  const state = loadAgentSessionState(sessionId);
  if (state?.changedPaths?.length) {
    lastAgentChangedPaths = state.changedPaths.slice(0, 12);
    return;
  }
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const files = extContext?.workspaceState.get<Record<string, string>>(
    `deepseek.session.${sessionId}.files`, {},
  ) ?? {};
  lastAgentChangedPaths = Object.values(files)
    .map(abs => relPathFromWorkspace(wsRoot, abs))
    .filter((rel): rel is string => Boolean(rel))
    .slice(0, 10);
}

function resolveSessionContinuationFiles(
  workspaceRoot: string,
  prompt: string,
  intent?: { mode?: string; signals?: readonly string[] },
): string[] {
  return resolveSessionContinuationFilesFromState({
    workspaceRoot,
    prompt,
    intent,
    state: loadAgentSessionState(),
    lastAgentChangedPaths,
    recentFilePaths: sessionRecentFiles.values(),
  });
}

function buildAgenticSessionContext(workspaceRoot: string, currentPrompt: string): string {
  return buildAgenticSessionContextFromState({
    workspaceRoot,
    currentPrompt,
    state: loadAgentSessionState(),
    lastAgentChangedPaths,
    recentFilePaths: sessionRecentFiles.values(),
    history: nonBridgeChatHistory,
  });
}

async function runChat(
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
  intentConfirmed = false,
  suppressUserMessage = false,
): Promise<void> {
  const promptResumeCp = shouldResumeCheckpointFromPrompt({ userDisplay, prompt, newSession, resumeFromIndex })
    ? await loadFreshAgentCheckpoint(7_200_000)
    : undefined;
  if (promptResumeCp) {
    if (!suppressUserMessage) webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    webview.postMessage({ type: 'agentCheckpointCleared' });
    await runChat(webview, promptResumeCp.displayPrompt, promptResumeCp.userPrompt, false, promptResumeCp.mode, undefined, false, promptResumeCp.startFromIndex, promptResumeCp.allTasks, undefined, intentConfirmed, true);
    return;
  }

  // 为本次请求创建独立 AbortController，停止按钮可随时中断
  activeChatAbortController?.abort();
  activeAgentSteerQueue.length = 0;
  const abortCtrl = new AbortController();
  activeChatAbortController = abortCtrl;
  const chatSignal = abortCtrl.signal;
  const consumeAgentSteer = (): string[] => activeAgentSteerQueue.splice(0, activeAgentSteerQueue.length);

  let effectiveFiles = normalizeConversationFiles(files);
  const userExplicitlyAttachedFiles = effectiveFiles.length > 0;
  if (newSession) {
    const histSnap = [...nonBridgeChatHistory];
    const prevSessionId = activeSessionId;
    saveCurrentSession();
    void (async () => {
      if (histSnap.length >= 4 && prevSessionId) {
        await compactAndSaveHistory(histSnap, prevSessionId);
      }
    })();
    activeSessionId = generateSessionId();
    getSessionService()?.setActiveSessionId(activeSessionId);
    saveSessionMeta({ id: activeSessionId, title: userDisplay.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now() });
    sessionRecentFiles.clear();
    saveCurrentSessionFiles();
    lastConversationFiles = [];
    lastAnalysisText = '';
    lastAgentChangedPaths = [];
    nonBridgeChatHistory = [];
    clearSessionHabits();
    clearLearnerSession();
    webview.postMessage({ type: 'contextFiles', files: [] });
  } else if (!userExplicitlyAttachedFiles) {
    // No files attached to THIS message — clear persisted context so it
    // does not silently bleed into this request.
    lastConversationFiles = [];
    webview.postMessage({ type: 'contextFiles', files: [] });
  }

  if (isProjectInitRequest(userDisplay) || isProjectInitRequest(prompt)) {
    if (newSession) webview.postMessage({ type: 'newSessionStarted' });
    if (!suppressUserMessage) webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    webview.postMessage({ type: 'startResponse', prompt, expectGeneratedArtifacts: false, agentMode: false });
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const text = root ? renderProjectInitDraftMarkdown(new ProjectInitService().generateDraft({ workspaceRoot: root })) : '请先打开一个工作区，再使用 `/init` 生成 DevSeek 项目指令草稿。';
    webview.postMessage({ type: 'delta', text });
    webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
    webview.postMessage({ type: 'endResponse' });
    if (activeChatAbortController === abortCtrl) activeChatAbortController = null;
    return;
  }

  const initialRouteDecision = chatRouteController.decide({
    userDisplay,
    prompt,
    files: effectiveFiles,
    agentEnabled: vscode.workspace.getConfiguration('devseek').get<boolean>('agentEnabled', true),
    forceNoAgent,
    intentConfirmed,
    lookupLearnedIntent: extContext ? (text) => lookupLearnedIntent(text, extContext!) : undefined,
  });

  const providerStatusResponse = await resolveProviderStatusResponse({
    prompt: initialRouteDecision.intentRoutingText,
    snapshot: getProviderConfigService().getSnapshot(),
    checkAvailability: () => getActiveProvider().available(),
  });
  if (providerStatusResponse) {
    if (newSession) {
      webview.postMessage({ type: 'newSessionStarted' });
    }
    if (!suppressUserMessage) {
      webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    }
    webview.postMessage({
      type: 'startResponse',
      prompt: initialRouteDecision.intentRoutingText,
      expectGeneratedArtifacts: false,
      agentMode: false,
    });
    webview.postMessage({ type: 'delta', text: providerStatusResponse });
    webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
    webview.postMessage({ type: 'endResponse' });
    recordTrackedChatHistory({
      prompt: initialRouteDecision.intentRoutingText,
      displayPrompt: userDisplay,
      newSession,
      mode,
      files: effectiveFiles,
      images,
      trackHistory: true,
      signal: chatSignal,
    }, providerStatusResponse);
    if (extContext) recordIntentOutcome(initialRouteDecision.intentRoutingText, 'chat', activeSessionId, extContext);
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
    return;
  }

  if (initialRouteDecision.intent.mode === 'smalltalk') {
    if (newSession) {
      webview.postMessage({ type: 'newSessionStarted' });
    }
    if (!suppressUserMessage) {
      webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    }
    webview.postMessage({
      type: 'startResponse',
      prompt: initialRouteDecision.intentRoutingText,
      expectGeneratedArtifacts: false,
      agentMode: false,
    });
    webview.postMessage({ type: 'delta', text: buildSmalltalkReply(initialRouteDecision.intentRoutingText) });
    webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
    webview.postMessage({ type: 'endResponse' });
    if (extContext) recordIntentOutcome(initialRouteDecision.intentRoutingText, 'chat', activeSessionId, extContext);
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
    return;
  }

  // If this is the first user message of a restored session (history was not pre-loaded
  // on startup to avoid cross-session bleed), lazily inject the saved summary now so the
  // LLM has the right context. This only fires once: after first injection, history is
  // non-empty and this branch is skipped going forward.
  if (!newSession && nonBridgeChatHistory.length === 0 && activeSessionId && extContext) {
    const _storedSummary = extContext.workspaceState.get<string>(`deepseek.session.${activeSessionId}.summary`, '') ?? '';
    const _storedHistory = extContext.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
    nonBridgeChatHistory = buildRestoredSessionLlmHistory(_storedHistory, _storedSummary);
  }

  let sessionContinuationNote = '';
  if (!newSession && !userExplicitlyAttachedFiles && effectiveFiles.length === 0) {
    const workspaceRootForContinuation = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const continuationFiles = resolveSessionContinuationFiles(
      workspaceRootForContinuation,
      prompt,
      initialRouteDecision.intent,
    );
    if (continuationFiles.length > 0) {
      effectiveFiles = continuationFiles;
      sessionContinuationNote = `_[同一 session 续作] 已自动恢复上一轮工作文件：${toContextDisplayLabels(continuationFiles).join('、')}_\n\n`;
    }
  }

  if (effectiveFiles.length > 0) {
    lastConversationFiles = [...effectiveFiles];
    // L2: register attached files to session memory for later path resolution
    effectiveFiles.forEach(p => registerToMemory(p));
    webview.postMessage({ type: 'contextFiles', files: toContextDisplayLabels(lastConversationFiles) });
  }

  // P4: Auto-discover files from directory path mentioned in prompt.
  // When the user writes e.g. "分析 tars/.../pump_sprayer 目录下代码" without
  // attaching @file, we resolve the directory and enumerate source files so they
  // can be content-injected into the prompt. This avoids:
  //   (a) the need for manual @file attachment, and
  //   (b) the browser-upload latency of the DeepSeek web UI file panel.
  // Skip auto-discovery when the user is asking to CREATE/WRITE a new file —
  // loading existing unrelated files as context only confuses the LLM and
  // clutters the DeepSeek web upload list.
  const isWriteRequest = /(编写|创建|新建|写一个|写个|generate\s*a|create\s*a|write\s*a)/i.test(prompt);
  let autoDiscoveredNote = '';
  let autoDiscoveredFiles: string[] = [];
  if (effectiveFiles.length === 0 && !isWriteRequest) {
    const discovered = discoverFilesFromDirectoryPrompt(prompt, vscode.workspace.workspaceFolders ?? []);
    if (discovered.length > 0) {
      effectiveFiles = discovered;
      autoDiscoveredFiles = discovered;
      // Do NOT persist auto-discovered files to lastConversationFiles — they are
      // ephemeral context for this request only and must not bleed into the next message.
      // They are also local-context files, not DeepSeek web attachments. Passing
      // them to the browser upload panel can time out before the prompt is sent.
      const names = discovered.map(p => nodePath.basename(p)).join('、');
      autoDiscoveredNote = `_[自动识别目录] 已加载 ${discovered.length} 个文件：${names}_\n\n`;
    }
  }
  const autoDiscoveredFileSet = new Set(autoDiscoveredFiles);

  const promptScope = detectWorkspacePathScope(prompt, effectiveFiles);
  const pathResolutionHints = [
    ...new Set([
      ...effectiveFiles,
      ...(promptScope.promptDir ? [promptScope.promptDir] : []),
    ]),
  ];

  // When starting a new session, tell the webview to clear the old conversation first.
  if (newSession) {
    webview.postMessage({ type: 'newSessionStarted' });
  }
  if (!suppressUserMessage) {
    webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
  }
  const routeDecision = chatRouteController.decide({
    userDisplay,
    prompt,
    files: effectiveFiles,
    agentEnabled: vscode.workspace.getConfiguration('devseek').get<boolean>('agentEnabled', true),
    forceNoAgent,
    intentConfirmed,
    lookupLearnedIntent: extContext ? (text) => lookupLearnedIntent(text, extContext!) : undefined,
  });
  const { intentRoutingText, intent, toolPolicy, workflow } = routeDecision;
  const preExecutionInteraction = buildPreExecutionInteraction({
    userText: intentRoutingText,
    prompt,
    files: effectiveFiles,
    intent,
    workflow,
    intentConfirmed,
  });
  if (preExecutionInteraction) {
    webview.postMessage({
      type: preExecutionInteraction.kind === 'planReview' ? 'planReview' : 'intentConfirmation',
      request: {
        ...preExecutionInteraction,
        original: {
          text: userDisplay,
          prompt,
          files: effectiveFiles.length > 0 ? effectiveFiles : undefined,
          images,
          newSession: false,
          mode,
          forceNoAgent,
        },
      },
    });
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
    return;
  }

  const directInspectionRoot = getWorkspaceRootFsPath(prompt, pathResolutionHints)
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? '';
  const directInspection = workflow.kind === 'inspect-agent' && intent.mode === 'inspect' && resumeFromIndex === undefined
    ? tryBuildReadOnlyInspectionResult({ prompt: intentRoutingText, workspaceRoot: directInspectionRoot })
    : null;
  if (directInspection) {
    webview.postMessage({
      type: 'startResponse',
      prompt: intentRoutingText,
      expectGeneratedArtifacts: false,
      agentMode: false,
    });
    webview.postMessage({ type: 'delta', text: directInspection.text });
    webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
    webview.postMessage({ type: 'endResponse' });
    recordTrackedChatHistory({
      prompt: intentRoutingText,
      displayPrompt: userDisplay,
      newSession,
      mode,
      files: effectiveFiles,
      images,
      trackHistory: true,
      signal: chatSignal,
    }, directInspection.text);
    if (extContext) recordIntentOutcome(intentRoutingText, 'chat', activeSessionId, extContext);
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
    return;
  }

  const workflowReporter = async (status: ApplyWorkflowStatus): Promise<void> => {
    postWebviewEvent(webview, { kind: 'workflow', status });
  };
  const localPreflightConfig = vscode.workspace.getConfiguration('devseek');
  const shouldBypassAgentForLocalExecution = (() => {
    if (!localPreflightConfig.get<boolean>('localExecutionFirst', true)) return false;
    if (intent.mode !== 'run') return false;
    const workspaceRootForLocal = getWorkspaceRootFsPath(prompt, pathResolutionHints);
    if (shouldPreferLocalExecution(prompt, effectiveFiles, workspaceRootForLocal)) {
      return !!planLocalExecution(prompt, effectiveFiles || [], workspaceRootForLocal);
    }
    return !!planRepeatLocalExecution(prompt, lastLocalExecutionPlan, workspaceRootForLocal);
  })();

  // ── Agent Mode: two-phase Architect + Editor loop ────────────────────────
  if (workflow.useAgent) {
  if (!shouldBypassAgentForLocalExecution) {
    // 只有 bridge provider 才需要检查 bridge 连接
    if (getActiveProviderType() === 'bridge') {
      const online2 = await status();
      if (!online2) {
        webview.postMessage({ type: 'startResponse' });
        webview.postMessage({ type: 'delta', text: '_正在启动 Bridge 服务，请稍候…_' });
        webview.postMessage({ type: 'endResponse' });
        const started = await ensureBridgeRunning();
        if (!started) {
          webview.postMessage({ type: 'error', text: 'Bridge 服务启动失败。\n请重载 VS Code 窗口或重新安装最新 VSIX；网页免费方式应由扩展内置 Bridge 自动启动。' });
          return;
        }
      }
    }

    pendingEditCoordinator.beginReviewScope(webview);
    // P5: carry agentMode so webview can set isAgentMode synchronously on receipt
    webview.postMessage({ type: 'startResponse', prompt, expectGeneratedArtifacts: true, agentMode: true });
    // Emit the auto-discovery note as the first delta so the user knows files were found
    if (sessionContinuationNote) {
      webview.postMessage({ type: 'delta', text: sessionContinuationNote });
    }
    if (autoDiscoveredNote) {
      webview.postMessage({ type: 'delta', text: autoDiscoveredNote });
    }

    const postAgent = (msg: AgentStatusMessage) => webview.postMessage(msg);
    // L1a: filled inside try/catch, used after to persist agent turn in session history
    let agentHistoryText = '';
    let loopResult: AgentLoopResult | undefined;
    let loopAutopilotHandled = false;
    let loopFailedForAutoAccept = false;
    let decomposedTaskCount = 0;

    try {
      const checkpointResumeTasks = resumeFromIndex !== undefined && resumeTasks && resumeTasks.length > 0
        ? resumeTasks
        : undefined;
      // ── Agentic routing: no code files → free-explore loop (Claude Code style) ──
      // This mirrors Copilot's principle: "no Working Set → no Architect phase".
      // The LLM drives tool exploration directly; we skip decomposeTask entirely.
      const hasCodeFiles = effectiveFiles.some(f => AGENT_CODE_FILE_RE.test(f));
      // Unified agentic loop handles all tasks without attached code files:
      // investigation (log/CSV analysis), pure code creation (no attached files),
      // and mixed data-file tasks. The loop now has create_file + all read tools,
      // so the LLM can self-route — read, explore, plan, then write as needed.
      // Only skip to Architect+Editor when user explicitly attached code files to edit.
      if (!hasCodeFiles && !checkpointResumeTasks) {
        // No code file attachments → agentic free-explore (investigate) mode
        const agWsRootPath = getWorkspaceRootFsPath(prompt, pathResolutionHints);
        const agWsRoot = agWsRootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const agSessionContext = buildAgenticSessionContext(agWsRoot, userDisplay);
        const agDisplayProfile = buildAgentRunDisplayProfile(prompt);
        // Non-code files (logs, csvs, etc.) are passed directly
        const dataFiles = effectiveFiles.filter(f => !AGENT_CODE_FILE_RE.test(f));
        // Free-explore mode has no Architect decomposition phase, but the UI still
        // needs a visible beginning before the model's first tool call arrives.
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'started',
          title: agDisplayProfile.planStartedTitle,
          taskTotal: 0,
          detail: agDisplayProfile.planStartedDetail,
        });
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: agDisplayProfile.planCompletedTitle,
          taskTotal: 0,
          detail: agDisplayProfile.planCompletedDetail,
        });
        const agResult = await runAgenticLoop(prompt, dataFiles, agWsRoot, mode, {
          runDisplayAction: agDisplayProfile.initialTaskAction,
          runDisplayTarget: agDisplayProfile.initialTaskLabel,
          onDelta: (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              webview.postMessage({ type: 'resetResponse', text: delta.slice(7) });
            } else if (delta === '\x00PROSE_CLEAR\x00') {
              // Silently wipe intermediate round prose from the webview buffer.
              // Keeps currentRaw clean so the final bubble only shows the ASUM summary.
              webview.postMessage({ type: 'clearAgentProse' });
            } else {
              webview.postMessage({ type: 'delta', text: delta });
            }
          },
          onWorkflowStatus: async (s) => { postWebviewEvent(webview, { kind: 'workflow', status: s }); },
          onAgentStatus: async (s) => { postAgent(s); },
          onAppliedChange: async (c) => { await pendingEditCoordinator.registerChange(webview, c); },
          onResponseMeta: async (_raw) => { /* suppressed in agent mode */ },
          onAgentAnnouncement: (text) => {
            webview.postMessage({ type: 'agentAnnouncement', text });
          },
          onToolActivity: (kind, label) => {
            webview.postMessage({ type: 'agentToolActivity', activityKind: kind, activityLabel: label });
          },
          onTodoUpdate: (items) => { webview.postMessage({ type: 'todoUpdate', items }); },
          onUserSteer: consumeAgentSteer,
          onTaskComplete: (_summary) => { /* phase:done handled inside runAgenticLoop */ },
          onMemoryWrite: async (proposal) => {
            if (agWsRoot) new MemoryService({ workspaceRoot: agWsRoot }).acceptWriteProposal(proposal);
          },
          onBeforeFileWrite: async (absPath: string): Promise<boolean> => {
            const writePermission = decideToolPermission(toolPolicy, 'edit');
            if (writePermission.action === 'deny') {
              webview.postMessage({ type: 'agentNotice', kind: 'warn', text: `当前 ${intent.mode} 模式不允许写入文件（${writePermission.reason}）。` });
              return false;
            }
            const wsRoot2 = agWsRoot;
            if (isFileProtected(absPath, wsRoot2)) {
              const relPath = wsRoot2 ? nodePath.relative(wsRoot2, absPath).replace(/\\/g, '/') : nodePath.basename(absPath);
              webview.postMessage({ type: 'agentNotice', kind: 'warn', text: `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）` });
              return false;
            }
            const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
            if (isAutopilot) return true;
            const fname = nodePath.basename(absPath);
            const SENSITIVE = /^(\.env(\.|$))|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|secret|credentials|token|passwd|password)$/i;
            if (!SENSITIVE.test(fname)) return true;
            const relPath = wsRoot2 ? nodePath.relative(wsRoot2, absPath).replace(/\\/g, '/') : fname;
            const confirmResult = await terminalPermissionCoordinator.requestInlineConfirmation(
              webview,
              `⚠️ 写入敏感文件：${relPath}`,
            );
            return confirmResult.allow;
          },
          mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
          onMcpToolCall: mcpManager.hasMcpTools
            ? (fakeName, args) => mcpManager.callTool(fakeName, args)
            : undefined,
          onTerminalCommand: async (command, workdir) => {
            return terminalPermissionCoordinator.runCommandWithPermission({
              webview,
              command,
              workdir,
              workspaceRoot: agWsRoot,
              mode: intent.mode,
              toolPolicy,
            });
          },
          onReadFile: async (filePath: string, workDir?: string) => {
            const agWsRootFs = agWsRoot;
            const tryRead = (p: string) => {
              try {
                const stat = fs.statSync(p);
                if (stat.isFile()) return fs.readFileSync(p, 'utf8').slice(0, 8000);
              } catch { return null; }
              return null;
            };
            if (nodePath.isAbsolute(filePath)) { const r = tryRead(filePath); if (r !== null) return r; }
            if (workDir) { const r = tryRead(nodePath.resolve(workDir, filePath)); if (r !== null) return r; }
            const byBasename = sessionRecentFiles.get(nodePath.basename(filePath).toLowerCase());
            if (byBasename) { const r = tryRead(byBasename); if (r !== null) return r; }
            if (agWsRootFs) { const r = tryRead(nodePath.join(agWsRootFs, filePath)); if (r !== null) return r; }
            const content = await readWorkspaceFile(filePath, []);
            if (!content) throw new Error(`找不到文件：${filePath}`);
            return content.slice(0, 8000);
          },
          onGrepSearch: async (pattern: string, path?: string, _isRegexp?: boolean, workDir?: string) => {
            const { runCommand } = await import('./tools/terminal');
            const agWsRootFs = agWsRoot;
            let rawDir: string;
            if (path) { rawDir = nodePath.isAbsolute(path) ? path : nodePath.join(agWsRootFs, path); }
            else if (workDir) { rawDir = workDir; }
            else { rawDir = agWsRootFs; }
            const searchDir = nodePath.resolve(rawDir);
            if (agWsRootFs && !searchDir.startsWith(nodePath.resolve(agWsRootFs))) {
              throw new Error('grep_search: path outside workspace');
            }
            const esc = pattern.replace(/'/g, "'\\''").slice(0, 200);
            const escDir = searchDir.replace(/'/g, "'\\''");
            const exts = ['ts','tsx','js','jsx','cpp','c','h','hpp','py','java','go','rs','cs','log','txt','csv','json','md'];
            const includes = exts.map(e => `--include='*.${e}'`).join(' ');
            const cmd = `grep -r -n -E '${esc}' ${includes} '${escDir}' 2>/dev/null | head -60`;
            const result = await runCommand({ command: cmd, timeoutMs: 15000 });
            return result.stdout || '（无匹配结果）';
          },
          onListDir: async (path: string) => {
            let target: string;
            const agWsRootFs = agWsRoot;
            if (nodePath.isAbsolute(path)) {
              target = path;
              const FORBIDDEN = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
              if (FORBIDDEN.some(f => target.startsWith(f))) throw new Error(`禁止列出系统目录: ${target}`);
            } else {
              target = nodePath.join(agWsRootFs, path);
            }
            try {
              const { readdirSync, statSync } = require('fs') as typeof import('fs');
              const names = readdirSync(target) as string[];
              return names.map((name: string) => {
                try { return statSync(nodePath.join(target, name)).isDirectory() ? `[dir]  ${name}` : `[file] ${name}`; }
                catch { return `[?]    ${name}`; }
              }).join('\n') || '（空目录）';
            } catch (e) { throw new Error(`list_dir 失败: ${(e as Error).message}`); }
          },
          ...createAgentHostToolCallbacks({
            workspaceRoot: agWsRoot,
            webview,
            terminalPermissionCoordinator,
          }),
          signal: chatSignal,
          onTaskCheckpoint: async (completedUpToIndex, _remainingTasks) => {
            if (completedUpToIndex === null) { await saveAgentCheckpoint(null); webview.postMessage({ type: 'agentCheckpointCleared' }); }
          },
          autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
        }, agSessionContext, intent.mode);
        if (agResult.changedPaths.length > 0) {
          lastAgentChangedPaths = agResult.changedPaths.map(p => {
            const fsPath = nodePath.isAbsolute(p) ? p : nodePath.join(agWsRoot, p);
            return agWsRoot ? nodePath.relative(agWsRoot, fsPath).replace(/\\/g, '/') : p;
          }).filter(p => p && !p.startsWith('..'));
          emitLearningEvent({ type: 'files_cochanged', paths: lastAgentChangedPaths, sessionId: activeSessionId });
          agResult.changedPaths.forEach(p => {
            const absPath = nodePath.isAbsolute(p) ? p : nodePath.join(agWsRoot, p);
            registerToMemory(absPath);
          });
        }
        const agChangedDetails = lastAgentChangedPaths.length > 0
          ? '\n**涉及文件（workspace 相对路径）：**\n' + lastAgentChangedPaths.map(p => `  - ${p}`).join('\n')
          : '';
        agentHistoryText = agResult.historyText
          || `**[Agentic] 已完成（${agResult.tasksTotal} 轮）**${agChangedDetails}`;
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: lastAgentChangedPaths.slice(0, 12),
          completed: agResult.tasksFailed === 0,
          savedAt: Date.now(),
        });
        nonBridgeChatHistory.push({ role: 'user', content: userDisplay });
        nonBridgeChatHistory.push({ role: 'assistant', content: agentHistoryText });
        if (nonBridgeChatHistory.length > 40) nonBridgeChatHistory = nonBridgeChatHistory.slice(-40);
        if (extContext && activeSessionId) {
          const existingMeta = getSessions().find(s => s.id === activeSessionId);
          if (existingMeta) {
            saveSessionMeta({ ...existingMeta, updatedAt: Date.now() });
          } else {
            saveSessionMeta({ id: activeSessionId, title: userDisplay.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now() });
          }
          saveCurrentSession();
          recordIntentOutcome(intentRoutingText, 'code-change', activeSessionId, extContext);
        }
        const agAutopilotHandled = pendingEditCoordinator.handleAgentAutopilot(webview, agResult);
        pendingEditCoordinator.scheduleAutoAccept(webview, agResult, agAutopilotHandled);
        webview.postMessage({ type: 'endResponse' });
        return;
      }

      // Phase-0: Architect — decompose the task into a per-file plan
      // (Skipped when resuming from a checkpoint — tasks are already known.)
      let tasks: import('./agent-task-decomposer').AgentTask[];
      let _decomposeProse = '';
      const _wsFolderForContext = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const sessionContextForAgent = buildAgenticSessionContext(_wsFolderForContext, userDisplay);
      const shouldInjectSessionContext = shouldInjectSessionContinuationForIntent(
        userDisplay,
        sessionContextForAgent,
        intent,
      );
      const promptForAgent = shouldInjectSessionContext
        ? appendSessionContinuationContext(prompt, sessionContextForAgent)
        : prompt;

      if (resumeFromIndex !== undefined && checkpointResumeTasks) {
        // ── Resume path: restore tasks from checkpoint, skip LLM decompose ──
        tasks = checkpointResumeTasks;
        const remaining = tasks.length - resumeFromIndex;
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: `断点续传：从第 ${resumeFromIndex + 1} 个任务继续（共 ${tasks.length} 个）`,
          taskTotal: tasks.length,
          detail: `已完成 ${resumeFromIndex} 个，剩余 ${remaining} 个：\n` +
            tasks.slice(resumeFromIndex).map((t, i) =>
              `${resumeFromIndex + i + 1}. [${t.action}] ${getAgentTaskDisplayTarget(t)} — ${t.desc}`).join('\n'),
        });
      } else {
        // ── Normal path: call LLM to decompose the task ──
        postAgent({ type: 'agentStatus', phase: 'plan', state: 'started', title: '分析任务，正在生成执行计划…', taskTotal: effectiveFiles.length });

        // P14: inject analysis findings from prior round, plus recently changed paths so
        // follow-up requests (e.g. "compile and run") target the right files.
        // Augment with session-memory files (workspaceState-restored) so follow-up requests
        // after restart resolve file paths without explicit re-attachment (Claude Code pattern).
        const _wsFolder0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const _sessionRelPaths = _wsFolder0
          ? [...new Set(sessionRecentFiles.values())]
              .filter(abs => abs.startsWith(_wsFolder0 + nodePath.sep) || abs.startsWith(_wsFolder0 + '/'))
              .map(abs => nodePath.relative(_wsFolder0, abs).replace(/\\/g, '/'))
              .filter(rel => rel && !rel.startsWith('..') && !lastAgentChangedPaths.includes(rel))
              .slice(0, 8)
          : [];
        const _allRecentPaths = [...lastAgentChangedPaths, ..._sessionRelPaths].filter(Boolean);
        const priorFindings: import('./agent-task-decomposer').AnalysisFindings | undefined =
          (lastAnalysisText || _allRecentPaths.length > 0)
            ? {
                issues: lastAnalysisText ? extractAnalysisFindings(lastAnalysisText).issues : [],
                recentlyChangedPaths: _allRecentPaths.length > 0 ? _allRecentPaths : undefined,
              }
            : undefined;
        const decomposeResult = await decomposeTask(
          promptForAgent, effectiveFiles, mode,
          (progress) => {
            postAgent({ type: 'agentStatus', phase: 'plan', state: 'started', title: progress });
          },
          priorFindings,
          // newSession is NOT passed here — internal decompose calls should not
          // create a new DeepSeek web conversation. The user explicitly controls
          // session switching via the '新对话' button.
          async (p, m) => routeChat({ prompt: p, mode: m, newSession: false }),
          // Active editor file: used as path anchor when no files are attached and no
          // explicit path is in the prompt. Mirrors Copilot's per-file context behaviour.
          vscode.window.activeTextEditor?.document.uri.scheme === 'file'
            ? vscode.window.activeTextEditor.document.uri.fsPath
            : undefined,
        );

        tasks = decomposeResult.ok ? decomposeResult.tasks : inferTasksFromFiles(effectiveFiles, promptForAgent);
        _decomposeProse = decomposeResult.prose ?? '';

        // If tasks is empty (decompose failed or produced no tasks), show an error
        // but keep the Working area visible so user sees what was attempted.
        // Copilot pattern: fallback gracefully rather than disappearing silently.
        if (tasks.length === 0) {
          const errMsg = decomposeResult.error ?? '未识别到子任务';
          postAgent({ type: 'agentStatus', phase: 'plan', state: 'completed', title: '任务计划生成失败', taskTotal: 0, detail: errMsg });
          let errDelta = `_[Agent] 未能生成执行计划（${errMsg}）。建议尝试：_\n\n- 重新表述或简化需求  \n- 确保选中相关代码或文件\n- 检查工作区文件是否可访问\n\n**DeepSeek 反馈：**`;
          if (decomposeResult.raw?.trim()) {
            errDelta += `\n\n\`\`\`\n${decomposeResult.raw.slice(0, 1500).trim()}\n\`\`\``;
          } else {
            errDelta += '（无详细信息）';
          }
          webview.postMessage({ type: 'delta', text: errDelta });
          // Keep the Working area visible; don't call endResponse yet so the error stays in context
          postAgent({ type: 'agentStatus', phase: 'done', state: 'completed', title: '执行结束（无可执行计划）', detail: 'Agent 模式已终止；可尝试普通对话模式' });
          webview.postMessage({ type: 'endResponse' });
          return;
        }

        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: `任务计划已生成：${tasks.length} 个子任务`,
          taskTotal: tasks.length,
          detail: tasks.map((t, i) => `${i + 1}. [${t.action}] ${getAgentTaskDisplayTarget(t)} — ${t.desc}`).join('\n'),
          // G-1: planning reasoning — use AI prose from decompose only (no fallback to user prompt)
          planningText: _decomposeProse ? _decomposeProse.split('\n')[0].slice(0, 120) : '',
          planningDetail: _decomposeProse,
        });

        // Phase B: emit transitional announcement prose between plan and execution.
        // The first meaningful sentence(s) the AI wrote before the JSON plan is shown as
        // an inline prose bubble — gives users "now I understand, here is what I'll do" context.
        if (_decomposeProse?.trim()) {
          const _bLines = _decomposeProse.split('\n').filter(l => {
            const s = l.trim();
            return s.length > 15 && !s.startsWith('{') && !s.startsWith('[') && !s.match(/^\d+\.\s*\[/);
          });
          if (_bLines.length > 0) {
            const _announcement = _bLines.slice(0, 3).join(' ').slice(0, 300);
            webview.postMessage({ type: 'agentAnnouncement', text: _announcement });
          }
        }
      }

      // Phase-1: Editor — execute each task sequentially
      // P2: derive workspace root from attached files (Copilot: getWorkspaceFolder per-uri)
      // rather than blindly using workspaceFolders[0] which would be wrong in multi-root setups.
      const wsRootPath = getWorkspaceRootFsPath(prompt, pathResolutionHints);
      const wsRoot = wsRootPath ? vscode.Uri.file(wsRootPath) : vscode.workspace.workspaceFolders?.[0]?.uri;
      decomposedTaskCount = tasks.length;
      if (wsRoot) {
        const editorSessionContext = shouldInjectSessionContext
          ? [lastAnalysisText, sessionContextForAgent].filter(Boolean).join('\n\n')
          : (lastAnalysisText || undefined);
        loopResult = await runAgentLoop(tasks, promptForAgent, mode, wsRoot, {
          onDelta: (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              webview.postMessage({ type: 'resetResponse', text: delta.slice(7) });
            } else {
              webview.postMessage({ type: 'delta', text: delta });
            }
          },
          onWorkflowStatus: async (s) => { postWebviewEvent(webview, { kind: 'workflow', status: s }); },
          onAgentStatus: async (s) => { postAgent(s); },
          onAppliedChange: async (c) => { await pendingEditCoordinator.registerChange(webview, c); },
          onResponseMeta: async (_raw) => { /* suppressed in agent mode */ },
          // G-tool: AI performed read/search/list — show activity chip in working area
          onToolActivity: (kind, label) => {
            webview.postMessage({ type: 'agentToolActivity', activityKind: kind, activityLabel: label });
          },
          // L-2: AI called manage_todo_list — push to webview todo widget
          onTodoUpdate: (items) => { webview.postMessage({ type: 'todoUpdate', items }); },
          onUserSteer: consumeAgentSteer,
          // L-3: AI called task_complete — phase:done is emitted by executeFakeToolsForLoop
          // directly via callbacks.onAgentStatus; do NOT duplicate it here.
          onTaskComplete: (_summary) => { /* side-effect hook; phase:done handled in agent-loop */ },
          // P3: AI called memory_write — host service validates and persists it.
          onMemoryWrite: async (proposal) => {
            const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsPath) new MemoryService({ workspaceRoot: wsPath }).acceptWriteProposal(proposal);
          },
          // P-SEC: sensitive file protection — confirm before writing .env / *.pem / *.key etc.
          // §8.3: also enforce user-configured devseek.protectedFiles glob list (hard block, no confirm)
          onBeforeFileWrite: async (absPath: string): Promise<boolean> => {
            const writePermission = decideToolPermission(toolPolicy, 'edit');
            if (writePermission.action === 'deny') {
              webview.postMessage({ type: 'agentNotice', kind: 'warn', text: `当前 ${intent.mode} 模式不允许写入文件（${writePermission.reason}）。` });
              return false;
            }
            const wsRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            // §8.3: hard-block user-configured protected files (Copilot chat.tools.edits.autoApprove equivalent)
            if (isFileProtected(absPath, wsRoot2)) {
              const relPath = wsRoot2 ? nodePath.relative(wsRoot2, absPath).replace(/\\/g, '/') : nodePath.basename(absPath);
              webview.postMessage({ type: 'agentNotice', kind: 'warn', text: `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）` });
              return false;
            }
            const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
            if (isAutopilot) return true;
            const fname = nodePath.basename(absPath);
            const SENSITIVE = /^(\.env(\.|$))|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|secret|credentials|token|passwd|password)$/i;
            if (!SENSITIVE.test(fname)) return true;
            const relPath = wsRoot2 ? nodePath.relative(wsRoot2, absPath).replace(/\\/g, '/') : fname;
            const confirmResult = await terminalPermissionCoordinator.requestInlineConfirmation(
              webview,
              `⚠️ 写入敏感文件：${relPath}`,
            );
            return confirmResult.allow;
          },
          // P3-5: MCP tools available in this session
          mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
          onMcpToolCall: mcpManager.hasMcpTools
            ? (fakeName, args) => mcpManager.callTool(fakeName, args)
            : undefined,
          // P4-1: run_terminal tool — AI can execute shell commands from agent loop
          // G-2: replaced showWarningMessage modal with an inline confirm card in the webview
          onTerminalCommand: async (command, workdir) => {
            return terminalPermissionCoordinator.runCommandWithPermission({
              webview,
              command,
              workdir,
              workspaceRoot: wsRoot.fsPath,
              mode: intent.mode,
              toolPolicy,
            });
          },
          // P5-3: read_file tool — AI can read workspace files during agent loop
          // workDir = absolute path of the current task's directory (passed by executeFakeToolsForLoop).
          // Copilot/Claude Code pattern: tool calls inherit parent task's working directory so
          // bare filenames like "main.cpp" resolve to code/3D/main.cpp, not workspace root.
          onReadFile: async (filePath, workDir?: string) => {
            const { statSync, readFileSync } = require('fs') as typeof import('fs');
            function tryRead(p: string): string | null {
              try { if (statSync(p).isFile()) return readFileSync(p, 'utf8').slice(0, 8000); } catch {}
              return null;
            }
	            // P1: workDir-relative (path.resolve handles ../ correctly)
	            if (workDir && !nodePath.isAbsolute(filePath)) {
	              const candidate = nodePath.resolve(workDir, filePath);
	              const wsRootPath = wsRoot.fsPath;
	              if (wsRootPath && candidate.startsWith(wsRootPath)) {
	                const r = tryRead(candidate);
	                if (r !== null) return r;
	              }
	            }
	            // P2: sessionRecentFiles dict — basename or rel-path lookup after task scope
	            const byBasename = sessionRecentFiles.get(nodePath.basename(filePath).toLowerCase());
	            if (byBasename) { const r = tryRead(byBasename); if (r !== null) return r; }
	            const byRel = sessionRecentFiles.get(filePath);
	            if (byRel && byRel !== byBasename) { const r = tryRead(byRel); if (r !== null) return r; }
	            // P3: normal workspace-relative / absolute resolution via bridge + VS Code API.
            const content = await readWorkspaceFile(filePath, []);
            if (!content) throw new Error(`找不到文件：${filePath}`);
            return content.slice(0, 8000);
          },
          // grep_search tool — AI can search workspace files for patterns
          onGrepSearch: async (pattern: string, path?: string, _isRegexp?: boolean, workDir?: string) => {
            const { runCommand } = await import('./tools/terminal');
            // Resolve and validate path stays within workspace root (prevent path traversal).
            // Priority: explicit path > task workDir (project subdir) > workspace root.
            // Using workDir as the default prevents grep flooding results from unrelated projects.
            let rawDir: string;
            if (path) {
              rawDir = nodePath.isAbsolute(path) ? path : nodePath.join(wsRoot.fsPath, path);
            } else if (workDir) {
              rawDir = workDir;
            } else {
              rawDir = wsRoot.fsPath;
            }
            const searchDir = nodePath.resolve(rawDir);
            if (!searchDir.startsWith(nodePath.resolve(wsRoot.fsPath))) {
              throw new Error('grep_search: path outside workspace');
            }
            const esc = pattern.replace(/'/g, "'\\''").slice(0, 200);
            // Escape searchDir for safe single-quote shell interpolation
            const escDir = searchDir.replace(/'/g, "'\\''");
            const exts = ['ts','tsx','js','jsx','cpp','c','h','hpp','py','java','go','rs','cs'];
            const includes = exts.map(e => `--include='*.${e}'`).join(' ');
            const cmd = `grep -r -n -E '${esc}' ${includes} '${escDir}' 2>/dev/null | head -60`;
            const result = await runCommand({ command: cmd, timeoutMs: 15000 });
            return result.stdout || '（无匹配结果）';
          },
          // list_dir tool — AI can explore directory structure (G9: supports absolute paths)
          onListDir: async (path: string) => {
            let target: string;
            if (nodePath.isAbsolute(path)) {
              // G9: Support absolute paths for log/data file exploration
              target = path;
              // Safety: block system directories
              const FORBIDDEN = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
              if (FORBIDDEN.some(f => target.startsWith(f))) {
                throw new Error(`禁止列出系统目录: ${target}`);
              }
            } else {
              target = nodePath.join(wsRoot.fsPath, path);
            }
            try {
              const { readdirSync, statSync } = require('fs') as typeof import('fs');
              const names = readdirSync(target) as string[];
              return names.map((name: string) => {
                try {
                  return statSync(nodePath.join(target, name)).isDirectory()
                    ? `[dir]  ${name}`
                    : `[file] ${name}`;
                } catch { return `[?]    ${name}`; }
              }).join('\n') || '（空目录）';
            } catch (e) {
              throw new Error(`list_dir 失败: ${(e as Error).message}`);
            }
          },
          ...createAgentHostToolCallbacks({
            workspaceRoot: wsRoot.fsPath,
            webview,
            terminalPermissionCoordinator,
          }),
          // Stop button support: abort in-progress LLM calls
          // Stop button support: abort in-progress LLM calls
          signal: chatSignal,
          // 断点续传：save/clear checkpoint after each task and on network failure
          autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
          onTaskCheckpoint: async (completedUpToIndex, _remainingTasks, checkpointReason = 'progress') => {
            if (completedUpToIndex === null) {
              // Loop completed successfully — clear any stale checkpoint
              await saveAgentCheckpoint(null);
              // Tell webview to hide the checkpoint banner (if shown)
              webview.postMessage({ type: 'agentCheckpointCleared' });
              return;
            }
            // Save current progress so the user can resume later
            await saveAgentCheckpoint({
              userPrompt: promptForAgent,
              displayPrompt: userDisplay,
              mode,
              wsRootFsPath: wsRoot.fsPath,
              allTasks: tasks,
              startFromIndex: completedUpToIndex,
              completedCount: completedUpToIndex,
              savedAt: Date.now(),
              sessionId: activeSessionId,
            });
            if (checkpointReason === 'paused') {
              // Only surface a resume entry once the active run is actually paused.
              // Progress checkpoints are internal state for reload/reconnect recovery.
              webview.postMessage({
                type: 'agentCheckpointAvailable',
                resumeTaskIndex: completedUpToIndex,
                totalTasks: tasks.length,
                userPrompt: userDisplay,
                savedAt: Date.now(),
              });
            }
          },
        }, editorSessionContext, resumeFromIndex ?? 0);
        // P14: persist analysisText from this round for injection into next round's plan
        if (loopResult.analysisText) {
          lastAnalysisText = loopResult.analysisText;
          // L2: persist to workspaceState so it survives reload (Claude Code pattern)
          extContext?.workspaceState.update(`deepseek.session.${activeSessionId}.analysisText`, lastAnalysisText);
        }
        // Persist changed paths so the next decompose knows which files were just created/modified
        if (loopResult.changedPaths && loopResult.changedPaths.length > 0) {
          const _wsRootFs = wsRoot ? (typeof wsRoot === 'string' ? wsRoot : (wsRoot as vscode.Uri).fsPath) : '';
          lastAgentChangedPaths = loopResult.changedPaths.map(p => {
            const fsPath = typeof p === 'string' ? p : (p as vscode.Uri).fsPath;
            const absPath = nodePath.isAbsolute(fsPath)
              ? fsPath
              : (_wsRootFs ? nodePath.join(_wsRootFs, fsPath) : fsPath);
            return _wsRootFs ? relPathFromWorkspace(_wsRootFs, absPath) : fsPath.replace(/\\/g, '/');
          }).filter((rel): rel is string => Boolean(rel));
          emitLearningEvent({ type: 'files_cochanged', paths: lastAgentChangedPaths, sessionId: activeSessionId });
          // L2: register absolute paths to session memory for later resolution.
          // changedPaths from workspace-applier are workspace-relative strings;
          // resolve them to absolute before registering so sessionRecentFiles stores
          // the true absolute path and subsequent requests can find the file.
          loopResult.changedPaths.forEach(p => {
            const fsPath = typeof p === 'string' ? p : (p as vscode.Uri).fsPath;
            const absPath = nodePath.isAbsolute(fsPath)
              ? fsPath
              : (_wsRootFs ? nodePath.join(_wsRootFs, fsPath) : fsPath);
            registerToMemory(absPath);
          });
        }
        loopAutopilotHandled = pendingEditCoordinator.handleAgentAutopilot(webview, loopResult);
        // L1a: build rich summary text for session history
        // Include: task plan, each file with workspace-relative path, analysis summary.
        // This is the key data the user needs to continue work after loading a session.
        const _wsRootFs2 = wsRoot ? wsRoot.fsPath : '';
        const _taskPlanLines = tasks.map((t, i) =>
          `  ${i + 1}. [${t.action}] ${
            (t.absPath && _wsRootFs2 && t.absPath.startsWith(_wsRootFs2))
              ? t.absPath.slice(_wsRootFs2.length + 1).replace(/\\/g, '/')
              : getAgentTaskDisplayTarget(t)
          } — ${t.desc}`,
        ).join('\n');
        const _changedDetails = lastAgentChangedPaths.length > 0
          ? '\n**已修改文件（workspace 相对路径）：**\n' +
            lastAgentChangedPaths.map(p => `  - ${p}`).join('\n')
          : '';
        const _analysisSnippet = loopResult.analysisText
          ? '\n**分析摘要：**\n' + loopResult.analysisText.slice(0, 800)
          : '';
        agentHistoryText = [
          `**[Agent] 已完成 ${loopResult.tasksApplied}/${tasks.length} 个任务**`,
          _taskPlanLines ? `\n**任务计划：**\n${_taskPlanLines}` : '',
          _changedDetails,
          _analysisSnippet,
        ].filter(Boolean).join('\n') || `[Agent] 已完成 ${tasks.length} 个子任务`;
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: lastAgentChangedPaths.slice(0, 12),
          completed: loopResult.tasksFailed === 0,
          savedAt: Date.now(),
        });
      }
    } catch (e) {
      loopFailedForAutoAccept = true;
      const msg = (e as Error).message;
      const recovery = new ProviderRecoveryService().classify({
        providerType: getActiveProviderType(),
        message: msg,
        code: msg,
        signals: [msg],
      });
      if (recovery.kind !== 'Unknown') {
        const savedAt = Date.now();
        const wsRootFsPath = getWorkspaceRootFsPath(prompt, pathResolutionHints)
          ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          ?? '';
        const recoveryTasks = buildProviderRecoveryCheckpointTasks({
          prompt,
          files: effectiveFiles,
          workspaceRootFsPath: wsRootFsPath,
          recoveryKind: recovery.kind,
        }) as AgentTask[];
        await saveAgentCheckpoint({
          userPrompt: prompt,
          displayPrompt: userDisplay,
          mode,
          wsRootFsPath,
          allTasks: recoveryTasks,
          startFromIndex: 0,
          completedCount: 0,
          savedAt,
          sessionId: activeSessionId || 'provider-recovery',
          recoveryKind: recovery.kind,
          pauseReason: recovery.pauseReason,
        });
        webview.postMessage({
          type: 'agentCheckpointAvailable',
          resumeTaskIndex: 0,
          totalTasks: recoveryTasks.length,
          userPrompt: userDisplay,
          savedAt,
          recoveryKind: recovery.kind,
          pauseReason: recovery.pauseReason,
        });
        const recoveryDisplay = buildProviderRecoveryDisplay(recovery, msg);
        postAgent({ type: 'agentStatus', phase: 'error', state: 'failed', title: recoveryDisplay.title, detail: recoveryDisplay.detail });
        webview.postMessage({
          type: 'error',
          text: recoveryDisplay.text,
          loginRequired: recovery.kind === 'LoginRequired',
        });
        agentHistoryText = agentHistoryText || recoveryDisplay.historyText;
      } else {
        postAgent({ type: 'agentStatus', phase: 'error', state: 'failed', title: `Agent 执行出错：${msg}` });
        webview.postMessage({ type: 'error', text: msg, loginRequired: msg === 'LOGIN_REQUIRED' });
        agentHistoryText = agentHistoryText || `[Agent 执行出错] ${msg.slice(0, 200)}`;
      }
      saveAgentSessionState({
        lastUserPrompt: userDisplay,
        lastSummary: agentHistoryText,
        changedPaths: lastAgentChangedPaths.slice(0, 12),
        completed: false,
        savedAt: Date.now(),
      });
    }

    // L1a: persist agent turn to session history so sessions can be saved and restored
    if (agentHistoryText) {
      nonBridgeChatHistory.push({ role: 'user', content: userDisplay });
      nonBridgeChatHistory.push({ role: 'assistant', content: agentHistoryText });
      if (nonBridgeChatHistory.length > 40) nonBridgeChatHistory = nonBridgeChatHistory.slice(-40);
      if (extContext && activeSessionId) {
        const _agentMeta = getSessions().find(s => s.id === activeSessionId);
        if (_agentMeta) {
          saveSessionMeta({ ..._agentMeta, updatedAt: Date.now() });
        } else {
          saveSessionMeta({ id: activeSessionId, title: userDisplay.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now() });
        }
        saveCurrentSession();
        // Record agent-mode outcome for learning
        recordIntentOutcome(intentRoutingText, 'code-change', activeSessionId, extContext);
      }
    }

    const autoAcceptResult = loopResult
      ?? (loopFailedForAutoAccept ? { tasksTotal: decomposedTaskCount, tasksApplied: 0, tasksFailed: 1, changedPaths: [] } : undefined);
    pendingEditCoordinator.scheduleAutoAccept(webview, autoAcceptResult, loopAutopilotHandled);
    webview.postMessage({ type: 'endResponse' });
    return;
  }
  }
  // ── End Agent Mode ────────────────────────────────────────────────────────

  // 只有 bridge provider 才需要检查 bridge 连接
  if (getActiveProviderType() === 'bridge') {
    const online = await status();
    if (!online) {
      webview.postMessage({ type: 'startResponse' });
      webview.postMessage({ type: 'delta', text: '_正在启动 Bridge 服务，请稍候…_' });
      webview.postMessage({ type: 'endResponse' });
      const started = await ensureBridgeRunning();
      if (!started) {
        webview.postMessage({
          type: 'error',
          text: 'Bridge 服务启动失败。\n请重载 VS Code 窗口或重新安装最新 VSIX；网页免费方式应由扩展内置 Bridge 自动启动。',
        });
        return;
      }
    }
  }

  // P5: carry agentMode to eliminate the race condition in webview
  webview.postMessage({
    type: 'startResponse',
    prompt,
    expectGeneratedArtifacts: intent.addStructuredHint,
    agentMode: false,
  });
  // Emit auto-discovery note in single-turn path too
  if (autoDiscoveredNote) {
    webview.postMessage({ type: 'delta', text: autoDiscoveredNote });
  }

  try {
    let finalPrompt = prompt;
    const config = vscode.workspace.getConfiguration('devseek');

    // P1: inject project instructions and legacy memory through ContextAssemblyService.
    const projectRules = await getProjectRules();
    const projectMemory = getProjectMemorySync();
    finalPrompt = assembleProjectRulesAndMemoryContext(finalPrompt, projectRules, projectMemory);

    // Non-agent chat: inject a brief system context so the LLM knows it lives inside a
    // VS Code plugin that has Agent mode with file-reading tools. This prevents the LLM
    // from falsely claiming "I cannot access your filesystem" while a simple Agent-mode
    // escalation would actually work.
    if (intent.kind === 'chat') {
      const agentCapabilityHint = `[系统] 你是 VS Code 插件 DeepSeek 的 AI 编程助手（当前为对话模式）。
插件支持 Agent 模式，启用后 AI 可使用 list_dir、read_file、grep_search、run_terminal 等工具直接访问工作区文件。
若用户询问能否读取文件：可以读取，建议用户使用 @文件 语法或开启 Agent 模式以获得最佳体验。
若用户询问能否编写代码：可以编写，将代码直接输出即可，插件会自动检测并提供应用选项。

`;
      finalPrompt = agentCapabilityHint + finalPrompt;
    }

    // 直接聊天（非代码命令）时，追加活跃编辑器上下文。
    // 问题A修复：只要 effectiveFiles 非空（附件/自动发现/续写继承均算在内）
    // 就不注入活跃编辑器，避免把不相关文件塞入 prompt。
    // autoInjectActiveEditor 配置（默认 false）控制是否自动注入当前打开文件。
    const autoInjectEnabled = config.get<boolean>('autoInjectActiveEditor', false);
    const shouldInjectEditorContext = autoInjectEnabled && userDisplay === prompt && effectiveFiles.length === 0;
    if (shouldInjectEditorContext) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const replyLang = config.get<string>('language', 'zh') === 'zh' ? '中文' : 'English';
        const lang = editor.document.languageId;
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        finalPrompt = `你是一个专业的编程助手。\n当前文件：${file}\n编程语言：${lang}\n\n---\n${prompt}\n\n请用${replyLang}回复。`;
      }
    }

    if (effectiveFiles.length > 0 && intent.kind === 'code-change') {
      // 有附件时使用含实际路径的具体格式示例，覆盖泛化提示
      // 仅当用户本轮显式附加了文件，或对话历史为空（首轮）时才注入格式提示
      // 避免历史中已有文件内容时重复注入，浪费 token
      const filesAlreadyInHistory = !userExplicitlyAttachedFiles && nonBridgeChatHistory.length > 0;
      if (!filesAlreadyInHistory) {
        finalPrompt = appendFileAwareFormatHint(finalPrompt, effectiveFiles);
      }
    } else if (intent.addStructuredHint) {
      finalPrompt = appendStructuredGenerationHint(finalPrompt);
    }

    // P2-4: 自动注入当前诊断上下文（当活跃文件存在实际错误时注入，不依赖关键词匹配）
    // 结构性判断：有诊断错误才注入，而非猜测用户是否在问错误话题。
    // 这与 Copilot/Claude Code 的方式一致：让 LLM 决定是否相关，而不是预过滤。
    {
      const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';
      const isExtensionSrc = /packages[\\/]vscode-extension[\\/]src/.test(activeFile)
        || /node_modules/.test(activeFile);
      if (!isExtensionSrc) {
        const diagCtx = getDiagnosticsContext('active');
        if (diagCtx) { finalPrompt = diagCtx + '\n\n' + finalPrompt; }
      }
    }

    const autoApplyPolicy = config.get<AutoApplyPolicy>('autoApplyPolicy', 'conservative');
    const localExecutionFirst = config.get<boolean>('localExecutionFirst', true);
    const executionApproval = config.get<'auto' | 'confirm'>('executionApproval', 'auto');
    const workspaceRoot = getWorkspaceRootFsPath(prompt, pathResolutionHints);
    let routeFiles = effectiveFiles;
    const noAgentCodeChat = !workflow.useAgent && intent.kind === 'code-change';

    const shouldInlineLocalFiles = effectiveFiles.length > 0
      && (intent.kind === 'chat' || noAgentCodeChat || autoDiscoveredFiles.length > 0);
    if (shouldInlineLocalFiles) {
      const attachmentContext = buildLocalAttachmentContextPrompt(finalPrompt, effectiveFiles, { workspaceRoot });
      finalPrompt = attachmentContext.prompt;
      if (attachmentContext.inlinedFiles.length > 0) {
        const inlinedFileSet = new Set(attachmentContext.inlinedFiles);
        routeFiles = routeFiles.filter((f) => {
          const resolved = nodePath.isAbsolute(f)
            ? nodePath.resolve(f)
            : nodePath.resolve(workspaceRoot || process.cwd(), f);
          return !inlinedFileSet.has(resolved);
        });
      }
    }
    if (autoDiscoveredFileSet.size > 0) {
      routeFiles = routeFiles.filter(f => !autoDiscoveredFileSet.has(f));
    }

    if (noAgentCodeChat) {
      finalPrompt = [
        '[系统] 当前为 no-agent 普通对话模式。禁止输出 [TOOL:...]、JSON 工具调用、create_file/write_file/replace_file 等内部工具协议。',
        '如需给出文件修改，请使用普通 Markdown：文件路径标题 + 完整代码块。',
        '',
        finalPrompt,
      ].join('\n');
    }

    if (!newSession) {
      const sessionContextForChat = buildAgenticSessionContext(workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', userDisplay);
      if (shouldInjectSessionContinuationForIntent(userDisplay, sessionContextForChat, intent)) {
        finalPrompt = appendSessionContinuationContext(finalPrompt, sessionContextForChat);
      }
    }

    if (localExecutionFirst) {
      const localExecutionResult = await runLocalExecutionChatIfPossible({
        webview,
        prompt,
        effectiveFiles,
        workspaceRoot,
        mode,
        config,
        executionApproval,
        workflowReporter,
        lastLocalExecutionPlan,
        setLastLocalExecutionPlan: (plan) => { lastLocalExecutionPlan = plan; },
        requestTerminalConfirmation: (command, workdir) => terminalPermissionCoordinator.requestInlineConfirmation(webview, command, workdir ?? ''),
        routeChat,
        toolPolicy,
        consumeAgentSteer,
        registerAppliedChange: (change) => pendingEditCoordinator.registerChange(webview, change),
        registerToMemory,
        sessionRecentFiles,
        mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
        onMcpToolCall: mcpManager.hasMcpTools ? (fakeName, args) => mcpManager.callTool(fakeName, args) : undefined,
        signal: chatSignal,
        sessionId: activeSessionId,
        onChangedPaths: (relativePaths) => { lastAgentChangedPaths = relativePaths; },
      });
      if (localExecutionResult.handled) return;
    }

    const postChatDelta = (delta: string): void => {
      if (delta.startsWith('\x00RESET\x00')) {
        const fullText = delta.slice(7);
        webview.postMessage({
          type: 'resetResponse',
          text: noAgentCodeChat ? stripToolCallBlocks(fullText) : fullText,
        });
        return;
      }

      const visibleDelta = noAgentCodeChat ? stripToolCallBlocks(delta) : delta;
      if (visibleDelta) {
        webview.postMessage({ type: 'delta', text: visibleDelta });
      }
    };

    const finalResponse = await routeChat({
      prompt: finalPrompt,
      displayPrompt: userDisplay,
      newSession,
      mode,
      files: routeFiles,
      images,
      trackHistory: true, // 主聊天调用维护对话历史（多轮记忆）
      signal: chatSignal,
      onDelta: postChatDelta,
      onUsage: (usage) => {
        webview.postMessage({ type: 'tokenUsage', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      },
    });

    const finalResponseForUser = noAgentCodeChat ? stripToolCallBlocks(finalResponse) : finalResponse;
    const finalResponseForArtifacts = noAgentCodeChat ? finalResponseForUser : finalResponse;
    if (noAgentCodeChat) {
      webview.postMessage({
        type: 'resetResponse',
        text: finalResponseForUser || '（no-agent 模式已忽略模型返回的内部工具调用；请重试，或开启 Agent 模式执行工具调用。）',
      });
    }

    // P10 (收紧)：只有 code-change 意图才解析文件候选。
    // 问题B修复：analyze/explain 意图即使有文件附件也绝不触发文件检测面板。
    if (intent.kind === 'code-change' && (intent.addStructuredHint || pathResolutionHints.length > 0)) {
      await emitResponseMeta(webview, finalResponseForArtifacts, prompt, pathResolutionHints);
    } else {
      webview.postMessage({ type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] });
    }

    const canApplyArtifacts = intent.kind === 'code-change';
    const parsedArtifacts = canApplyArtifacts ? parseGeneratedArtifacts(finalResponseForArtifacts) : [];
    let responseToApply = finalResponseForArtifacts;
    let shouldApplyToReviewQueue = canApplyArtifacts
      && (parsedArtifacts.length > 0 || shouldAutoApplyFromResponse(intent, finalResponseForArtifacts, autoApplyPolicy));

    // 兜底1：注入已知路径让 parser 能关联代码块
    if (canApplyArtifacts && !shouldApplyToReviewQueue && effectiveFiles.length > 0 && /```[\s\S]*?```/.test(finalResponseForArtifacts)) {
      responseToApply = injectFileHintsIntoResponse(finalResponseForArtifacts, effectiveFiles);
      if (responseToApply !== finalResponseForArtifacts) {
        const hintedArtifacts = parseGeneratedArtifacts(responseToApply);
        if (hintedArtifacts.length > 0) {
          shouldApplyToReviewQueue = true;
        }
      }
    }

    // 兜底2：注入仍然失败 → 追问 DeepSeek 按标准格式重新整理输出（参考 Aider 的 retry 思路）
    if (canApplyArtifacts && !shouldApplyToReviewQueue && effectiveFiles.length > 0 && /```[\s\S]*?```/.test(finalResponseForArtifacts)) {
      const reformatReq = buildReformatPrompt(effectiveFiles);
      webview.postMessage({ type: 'delta', text: '\n\n---\n_[系统] 未识别到文件路径标注，正在请求按标准格式重新整理输出…_\n' });
      try {
        const reformatResp = await routeChat({
          prompt: reformatReq,
          newSession: false,
          mode,
          onDelta: (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              webview.postMessage({ type: 'delta', text: delta.slice(7) });
            } else {
              webview.postMessage({ type: 'delta', text: delta });
            }
          },
        });
        if (reformatResp) {
          const reformatArtifacts = parseGeneratedArtifacts(reformatResp);
          if (reformatArtifacts.length > 0) {
            responseToApply = reformatResp;
            shouldApplyToReviewQueue = true;
          }
        }
      } catch { /* reformat 失败，继续正常流程 */ }
    }

    if (shouldApplyToReviewQueue) {
      const firstApply = await applyGeneratedArtifactsWithPrompt(responseToApply, prompt, workflowReporter, true, async (change) => {
        await pendingEditCoordinator.registerChange(webview, change);
      }, pathResolutionHints, { rollbackOnValidationFailure: false });
      const recoveredApply = await recoverApplyFailureIfPossible({
        reporter: workflowReporter,
        originalPrompt: prompt,
        failedResponse: responseToApply,
        failedApply: firstApply,
        preferredAbsolutePaths: pathResolutionHints,
        chat: (repairPrompt) => routeChat({ prompt: repairPrompt, newSession: false, mode, stream: false, trackHistory: false }),
        apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
          repairResponse, repairPrompt, workflowReporter, true, onAppliedChange, pathResolutionHints, { rollbackOnValidationFailure: false },
        ),
        onAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(webview, change); },
      });
      const finalApply = recoveredApply ?? firstApply;
      if (shouldRunClosedLoopRepair(finalApply)) {
        await runClosedLoopRepair({
          webview,
          reporter: workflowReporter,
          originalPrompt: prompt,
          mode,
          initialApply: finalApply,
          preferredAbsolutePaths: pathResolutionHints,
          routeChat,
          registerAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(webview, change); },
          getSessionId: () => activeSessionId,
        });
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'LOGIN_REQUIRED') {
      webview.postMessage({
        type: 'error',
        text: 'DeepSeek 登录已过期，请重新登录。',
        loginRequired: true,
      });
      const choice = await vscode.window.showWarningMessage(
        'DeepSeek 登录已过期',
        { modal: false },
        '重新登录（打开浏览器）',
      );
      if (choice) {
        const ok = await relogin();
        if (ok) {
          vscode.window.showInformationMessage('浏览器已打开，请在浏览器中完成登录，登录成功后即可继续使用。');
        } else {
          vscode.window.showErrorMessage('无法连接到 Bridge，请先启动：cd packages/bridge && npm run dev');
        }
      }
    } else {
      webview.postMessage({ type: 'error', text: msg });
    }
  } finally {
    // Record chat-mode outcome for learning
    if (extContext) recordIntentOutcome(intentRoutingText, intent.kind as 'chat' | 'code-change', activeSessionId, extContext);
    // 释放 AbortController 引用，防止内存泄漏
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
  }

  webview.postMessage({ type: 'endResponse' });
}

function pushChatPanel(userDisplay: string, prompt: string, newSession: boolean): void { viewProvider.push(userDisplay, prompt, newSession); }

/**
 * 统一 chat 路由：自动选择当前活跃 Provider。
 * - bridge provider：走原 bridge-client.chat()（支持 files、newSession 等参数）
 * - 其他 provider：走 getActiveProvider().chat()（messages 格式）
 */
interface RouteChatOpts {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  files?: string[];
  stream?: boolean;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
  /**
   * true → 将此次请求纳入非 bridge provider 的会话历史（多轮记忆）。
   * 仅主聊天调用传 true；修复/格式化等内部子调用不传，以免污染历史。
   */
  trackHistory?: boolean;
  /**
   * 用户可读的原始消息文本（不含系统注入内容），用于历史记录和会话标题。
   * 若未传则回退到 prompt（可能含系统上下文）。
   */
  displayPrompt?: string;
  onUsage?: (usage: TokenUsage) => void;
  signal?: AbortSignal;
  /** base64 image data URLs to include as vision content (only for non-bridge providers) */
  images?: string[];
}

function recordTrackedChatHistory(opts: RouteChatOpts, response: string): void {
  recordTrackedChatHistoryState({
    opts,
    response,
    activeSessionId,
    getHistory: () => nonBridgeChatHistory,
    setHistory: (history) => { nonBridgeChatHistory = history; },
    compactAndSaveHistory,
    getFreshSummary: (sessionId) => extContext?.workspaceState.get<string>(`deepseek.session.${sessionId}.summary`),
    getSessions,
    saveSessionMeta,
    saveCurrentSession,
  });
}

async function routeChat(opts: RouteChatOpts): Promise<string> {
  const pType = getActiveProviderType();
  if (pType === 'bridge') {
    const response = await chat({ ...opts });
    recordTrackedChatHistory(opts, response);
    return response;
  }
  const provider = getActiveProvider();

  // 构造消息列表：trackHistory=true 时携带多轮历史（对齐 Copilot runOne 每轮携带完整历史）
  const historyMessages: ChatMessage[] = opts.trackHistory ? [...nonBridgeChatHistory] : [];
  const userContent: ChatMessage['content'] =
    (opts.images && opts.images.length > 0)
      ? [
          { type: 'text' as const, text: opts.prompt },
          ...opts.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
        ]
      : opts.prompt;
  const messages: ChatMessage[] = [
    ...historyMessages,
    { role: 'user', content: userContent },
  ];

  try {
    const response = await provider.chat({
      messages,
      mode: opts.mode,
      stream: opts.stream,
      onDelta: opts.onDelta,
      timeoutMs: opts.timeoutMs,
      onUsage: opts.onUsage,
      signal: opts.signal,
      files: opts.files,
    });

    recordTrackedChatHistory(opts, response);

    return response;
  } catch (e) {
    // 401 认证失败：引导用户更新 API Key 并重试一次
    if ((e as Error).message === 'DEEPSEEK_INVALID_API_KEY') {
      const updated = await promptUpdateApiKey();
      if (updated) {
        const retryResponse = await getActiveProvider().chat({
          messages,
          mode: opts.mode,
          stream: opts.stream,
          onDelta: opts.onDelta,
          timeoutMs: opts.timeoutMs,
          onUsage: opts.onUsage,
          signal: opts.signal,
          files: opts.files,
        });
        recordTrackedChatHistory(opts, retryResponse);
        return retryResponse;
      }
      throw new Error('请先更新有效的 DeepSeek API Key 再重试。');
    }
    throw e;
  }
}

// ================================================================
// Session Memory Management (L1a / L1b / L2)
// ================================================================

function generateSessionId(): string {
  return getSessionService()?.generateSessionId() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
}

function getSessions(): SessionMeta[] {
  return getSessionService()?.getSessions() ?? [];
}

function saveSessionMeta(meta: SessionMeta): void {
  getSessionService()?.saveSessionMeta(meta);
}

function saveCurrentSession(): void {
  if (!extContext || !activeSessionId) return;
  if (nonBridgeChatHistory.length === 0) return;
  // Strip summary primer pair/legacy prefix before persisting so reloads don't double-inject
  let _histToSave = nonBridgeChatHistory;
  if (_histToSave[0]?.role === 'user' && chatContentStartsWith(_histToSave[0]?.content, '[上次会话背景') &&
      _histToSave[1]?.role === 'assistant' && chatContentEquals(_histToSave[1]?.content, '好的，我已了解上次的工作进展，可以继续。')) {
    _histToSave = _histToSave.slice(2);
  } else if (_histToSave[0]?.role === 'assistant' && (chatContentStartsWith(_histToSave[0]?.content, '【上次 session 摘要】\n') || chatContentStartsWith(_histToSave[0]?.content, '【历史摘要】\n'))) {
    _histToSave = _histToSave.slice(1);
  }
  extContext.workspaceState.update(
    `deepseek.session.${activeSessionId}.history`,
    _histToSave.slice(-40),
  );
  const filesMap = Object.fromEntries(sessionRecentFiles);
  extContext.workspaceState.update(
    `deepseek.session.${activeSessionId}.files`,
    filesMap,
  );
  // Keep meta stats up-to-date (messageCount, fileCount, changedFiles)
  const existing = getSessions().find(s => s.id === activeSessionId);
  if (existing) {
    const fileValues = Object.values(filesMap) as string[];
    const changedFiles = [...new Set(fileValues.map(f => nodePath.basename(f)))].slice(0, 8);
    saveSessionMeta({
      ...existing,
      messageCount: nonBridgeChatHistory.filter(m => m.role === 'user').length,
      fileCount: changedFiles.length,
      changedFiles,
    });
  }
}

function saveCurrentSessionFiles(): void {
  if (!extContext || !activeSessionId) return;
  extContext.workspaceState.update(
    `deepseek.session.${activeSessionId}.files`,
    Object.fromEntries(sessionRecentFiles),
  );
}

async function compactAndSaveHistory(history: ChatMessage[], sessionId: string): Promise<void> {
  if (history.length < 4 || !extContext) return;
  const histText = history.slice(-30).map(m => `[${m.role}]: ${m.content.slice(0, 600)}`).join('\n');
  const compactPrompt = `你是一个 AI 编程助手会话摘要生成器。请将下面的对话历史生成一份**结构化 Markdown 摘要**，严格按以下格式输出（不要省略任何章节标题，保持 Markdown 格式）：

## 主要任务
一句话说明本次对话的核心目标。

## 已完成的工作
- （用列表列出具体完成的任务，每条20字以内）

## 修改/创建的文件
- \`相对路径/文件名\` — 一句话描述改动内容
（路径非常重要，保留完整相对路径）

## 遇到的问题与解决方案
- （如有，列出关键错误和修复方法；如无可写"无"）

## 当前状态与未完成事项
- （列出尚未完成的工作，如全部完成写"已全部完成"）

---
对话内容：
${histText}`;
  try {
    const summary = await routeChat({ prompt: compactPrompt, mode: 'fast', trackHistory: false });
    extContext.workspaceState.update(`deepseek.session.${sessionId}.summary`, summary);
    // Extract ultra-compact digest (~150 chars) from first meaningful line of summary
    const lines = summary.split('\n').map(l => l.trim()).filter(l => l);
    const digestLine = lines.find(l => l.length > 15 && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('*'));
    const digest = (digestLine || lines[0] || summary).replace(/[#*`]/g, '').trim().slice(0, 150);
    // Update SessionMeta with digest
    getSessionService()?.updateSessionMeta(sessionId, { digest });
  } catch {
    // compact failure is non-critical, ignore
  }
}

function registerToMemory(absPath: string): void {
  if (!absPath) return;
  sessionRecentFiles.set(nodePath.basename(absPath).toLowerCase(), absPath);
  const wsFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
  const wsRoot = wsFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot && absPath.startsWith(wsRoot + nodePath.sep)) {
    const rel = absPath.slice(wsRoot.length + 1);
    sessionRecentFiles.set(rel, absPath);
    sessionRecentFiles.set(nodePath.basename(rel).toLowerCase(), absPath);
  }
  saveCurrentSessionFiles();
}

function deleteSession(id: string): void {
  getSessionService()?.deleteSession(id);
}

async function handleTaskHistoryUiMessage(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
  if (!extContext) return;
  const service = new TaskHistoryUiService(extContext.workspaceState);
  for (const response of await service.handle(msg)) {
    postWebviewMessage(wv, response);
  }
}

function initOrRestoreSession(): void {
  if (!extContext) return;
  const bootstrap = buildSessionBootstrapState({
    sessionService: getSessionService(),
    workspaceState: extContext.workspaceState,
  });
  activeSessionId = bootstrap.activeSessionId;
  sessionRecentFiles.clear();
  for (const [key, value] of Object.entries(bootstrap.files)) sessionRecentFiles.set(key, value);
  nonBridgeChatHistory = bootstrap.history;
  lastAnalysisText = bootstrap.analysisText || lastAnalysisText;
  if (bootstrap.restoreAgentPathsForSessionId) {
    restoreLastAgentPathsFromSession(bootstrap.restoreAgentPathsForSessionId);
  }
}

// ----------------------------------------------------------------
// Extension entry point
// ----------------------------------------------------------------
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extContext = context;
  extensionUriGlobal = context.extensionUri;
  setBridgeExtensionRoot(context.extensionUri.fsPath);
  await migrateLegacyDeepseekConfiguration();
  viewProvider = new DeepSeekViewProvider();
  pendingEditCoordinator = new PendingEditCoordinator({
    getContextFiles: () => lastConversationFiles,
    getActiveWebview: () => viewProvider.webview,
  });
  pendingEditCoordinator.activate(context);
  initAgentLearner(context);

  // Auto-show sidebar on first install so VS Code pins it to the activity bar
  const INSTALLED_KEY = 'devseek.activatedBefore';
  if (!context.globalState.get(INSTALLED_KEY)) {
    void context.globalState.update(INSTALLED_KEY, true);
    void vscode.commands.executeCommand('workbench.view.extension.devseek-sidebar');
  }

  // ── P1-3: LLM Provider 状态栏 ──────────────────────────────────────
  for (const d of createProviderStatusBar(context)) {
    context.subscriptions.push(d);
  }

  // ── P1-4: 监听 .devseek/rules.md 变更，使缓存失效 ────────────────
  const rulesWatcher = vscode.workspace.createFileSystemWatcher('**/.devseek/rules.md');
  rulesWatcher.onDidChange(() => invalidateProjectRulesCache());
  rulesWatcher.onDidCreate(() => invalidateProjectRulesCache());
  rulesWatcher.onDidDelete(() => invalidateProjectRulesCache());
  context.subscriptions.push(rulesWatcher);

  // ── P3-5: MCP 客户端初始化 ─────────────────────────────────────────
  // Load MCP server config from .devseek/mcp.json in any workspace folder.
  // This is fire-and-forget; MCP failing never blocks extension activation.
  void (async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const configPath = nodePath.join(folders[0].uri.fsPath, '.devseek', 'mcp.json');
      await mcpManager.load(configPath);
    }
  })();
  context.subscriptions.push({ dispose: () => mcpManager.dispose() });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('devseek.chatViewLauncher', viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 内部命令：从代码命令分发到聊天面板
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '_deepseek.askChat',
      (userDisplay: string, prompt: string, newSession: boolean) => {
        pushChatPanel(userDisplay, prompt, newSession);
      },
    ),
  );

  // 用户可见命令
  const cmds: [string, () => Promise<void>][] = [
    ['devseek.explain',          explainCode],
    ['devseek.fix',              fixBug],
    ['devseek.refactor',         refactorCode],
    ['devseek.genTest',          genTest],
    ['devseek.runTests',         runTests],
    ['devseek.genDoc',           genDoc],
    ['devseek.ask',              askQuestion],
    ['devseek.generateCommit',   generateCommitMessage],
    ['devseek.applyDiff',        applyDiff],
    ['devseek.openChat',         async () => { viewProvider.focus(); }],
    ['devseek.triggerCompletion', async () => {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }],
    // P2-3: run_in_terminal — 在集成终端执行命令并将输出发到聊天
    ['devseek.runTerminalCommand', async () => {
      const cmd = await vscode.window.showInputBox({
        prompt: '输入要执行的 Shell 命令',
        placeHolder: 'e.g. npm run build',
      });
      if (!cmd) return;
      const { runCommand, formatTerminalOutputForPrompt } = await import('./tools/terminal');
      const result = await runCommand({ command: cmd, visible: false });
      const formatted = formatTerminalOutputForPrompt(cmd, result);
      await pushChatPanel(
        `> ${cmd}`,
        `请分析以下命令输出并给出建议：\n\n${formatted}`,
        false,
      );
      viewProvider.focus();
    }],
    // §8.6: Show Memory Files — matches Copilot "Chat: Show Memory Files" command
    ['devseek.showMemoryFiles', async () => {
      const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsPath) {
        vscode.window.showWarningMessage('DevSeek: 请先打开一个工作区');
        return;
      }
      const memPath = new MemoryService({ workspaceRoot: wsPath }).ensureLegacyMemoryFile();
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(memPath));
      await vscode.window.showTextDocument(doc);
    }],
  ];
  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('devseek.addFileToChat', async (resource?: vscode.Uri) => {
      await addResourceToChat(viewProvider, resource);
    }),
  );

  // ── EX-40: 行内聊天 Ctrl+I ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('devseek.inlineChat', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件');
        return;
      }

      const slashItems: vscode.QuickPickItem[] = [
        { label: '/fix',      description: '修复 Bug' },
        { label: '/refactor', description: '重构代码' },
        { label: '/tests',    description: '生成单元测试' },
        { label: '/doc',      description: '生成文档注释' },
        { label: '/explain',  description: '解释代码' },
      ];

      const qp = vscode.window.createQuickPick();
      qp.placeholder = '输入指令，或 / 选择预设命令...';
      qp.items = slashItems;
      qp.matchOnDescription = true;
      qp.show();

      let instruction = await new Promise<string | undefined>((resolve) => {
        qp.onDidChangeValue(v => {
          // 如果不以 / 开头，隐藏预设列表
          qp.items = v.startsWith('/') ? slashItems.filter(i => i.label.startsWith(v.split(' ')[0])) : [];
        });
        qp.onDidAccept(() => {
          const val = qp.value.trim() || qp.selectedItems[0]?.label;
          qp.hide();
          resolve(val);
        });
        qp.onDidHide(() => resolve(undefined));
      });
      if (!instruction) return;

      // 将斜杠命令映射为自然语言指令
      const slashMap: Record<string, string> = {
        '/fix':      '修复代码中的 Bug，返回完整修复后代码',
        '/refactor': '重构代码，提升可读性和性能，返回完整重构后代码',
        '/tests':    '为代码编写完整单元测试',
        '/doc':      '为代码生成规范的文档注释，不改变代码逻辑',
        '/explain':  '详细解释代码的功能和逻辑',
      };
      for (const [slash, mapped] of Object.entries(slashMap)) {
        if (instruction === slash || instruction.startsWith(slash + ' ')) {
          instruction = mapped + (instruction.slice(slash.length));
          break;
        }
      }

      // P3-3: 使用当前 provider 检查可用性（不再依赖 bridge-specific ping）
      const inlineProv = getActiveProvider();
      const inlineAvail = await inlineProv.available();
      if (!inlineAvail) {
        vscode.window.showErrorMessage('DeepSeek NetAI: LLM Provider 不可用，请检查设置（⚙ 状态栏）');
        return;
      }

      const ctx = buildContext(editor);
      const prompt = buildInlineChatPrompt(instruction, ctx.code, ctx.language, ctx.relPath);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `DevSeek: ${instruction.slice(0, 30)}...`, cancellable: false },
        async () => {
          try {
            const result = await routeChat({ prompt, stream: false });
            // 提取代码块
            const codeMatch = result.match(/```[^\n]*\n([\s\S]*?)```/);
            const newCode = codeMatch ? codeMatch[1].trimEnd() : result.trim();

            if (!newCode) { vscode.window.showWarningMessage('DeepSeek: 未收到有效代码'); return; }

            // P3-3 增强：选区有内容时注册 Pending Edit（侧边栏对比 + Diff 视图）
            if (!editor.selection.isEmpty) {
              const originalContent = editor.document.getText();
              const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
              await editor.edit(eb => eb.replace(editor.selection, newCode));
              const newContent = editor.document.getText();
              // 注册为 pending edit → 自动打开 Diff 视图，可在侧边栏撤销
              await viewProvider.registerInlineChatEdit({
                path: relPath,
                oldContent: originalContent,
                newContent,
                existed: true,
              });
              vscode.window.showInformationMessage('✅ DeepSeek 行内修改已应用（侧边栏可对比 / 撤销）');
            } else {
              // 无选区：直接发到 Chat 面板显示
              pushChatPanel(`⚡ **${instruction}** · \`${ctx.filename}\``, prompt, false);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`DeepSeek Inline Chat: ${(e as Error).message}`);
          }
        },
      );
    }),
  );

  // ── EX-30: Ghost Text 行内补全 Provider ──────────────────────────
  // P3-1: 迁移到 getActiveProvider()，支持所有 LLM Provider（不再依赖 bridge ping）
  let completionDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const completionCache = new Map<string, vscode.InlineCompletionItem[]>();

  const completionProvider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    {
      provideInlineCompletionItems: async (document, position, _context, token) => {
        const config = vscode.workspace.getConfiguration('devseek');
        const enabled = config.get<boolean>('completionEnabled', false);
        if (!enabled) return [];
        if (token.isCancellationRequested) return [];

        // 检查当前 provider 是否可用（不再依赖 bridge-specific ping）
        const provider = getActiveProvider();
        const available = await provider.available();
        if (!available || token.isCancellationRequested) return [];

        const PREFIXLINES = 50;
        const SUFFIXLINES = 20;
        const startLine = Math.max(0, position.line - PREFIXLINES);
        const endLine = Math.min(document.lineCount - 1, position.line + SUFFIXLINES);
        const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
        const suffix = document.getText(new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length));
        const relPath = vscode.workspace.asRelativePath(document.uri);
        // 缓存 key：用光标前最后 200 字符（后缀不参与缓存避免误命中）
        const cacheKey = `${relPath}::${prefix.slice(-200)}`;

        if (completionCache.has(cacheKey)) {
          return completionCache.get(cacheKey)!;
        }

        const prompt = buildCompletionPrompt(prefix, suffix, document.languageId, relPath);
        // 默认 debounce 800ms，用户可通过 completionTriggerDelay 覆盖
        const delay = config.get<number>('completionTriggerDelay', 800);

        return new Promise((resolve) => {
          if (completionDebounceTimer) clearTimeout(completionDebounceTimer);
          completionDebounceTimer = setTimeout(async () => {
            if (token.isCancellationRequested) { resolve([]); return; }
            try {
              const abortCtrl = new AbortController();
              token.onCancellationRequested(() => abortCtrl.abort());
              const result = await provider.chat({
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                timeoutMs: 15000,
                signal: abortCtrl.signal,
              });
              if (token.isCancellationRequested) { resolve([]); return; }
              const items = [new vscode.InlineCompletionItem(result.trim())];
              completionCache.set(cacheKey, items);
              // 缓存 30s
              setTimeout(() => completionCache.delete(cacheKey), 30000);
              resolve(items);
            } catch {
              resolve([]);
            }
          }, delay);
        });
      },
    },
  );
  context.subscriptions.push(completionProvider);

  // ── Session memory: restore previous session on startup ────────────
  initOrRestoreSession();
}

export function deactivate(): void { /* bridge 生命周期由用户管理 */ }
