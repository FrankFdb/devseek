import * as vscode from 'vscode';
import * as nodePath from 'path';
import { chat, relogin, readWorkspaceFile, ensureBridgeRunning, setBridgeExtensionRoot } from './bridge-client';
import { createProviderStatusBar, getActiveProvider, getActiveProviderType, getProviderConfigService, promptUpdateApiKey } from './llm/provider-router';
import { type ChatMessage } from './llm/types';
import { getProjectRules, invalidateProjectRulesCache, getProjectMemorySync, assembleProjectRulesAndMemoryContext } from './project-rules';
import { getDiagnosticsContext } from './context-builder';
import {
  applyGeneratedArtifactsWithPrompt,
  looksLikeTargetScopedSourceResponse,
  resolveGeneratedArtifactPathForPrompt,
  type ApplyWorkflowStatus,
} from './workspace-applier';
import { detectWorkspacePathScope, isGeneratedArtifactAllowedForPrompt } from './workspace/path-resolver';
import { sanitizeWorkspaceContextAnchorPath } from './workspace/context-anchor';
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
import { extractAnalysisFindings } from './agent/analysis-findings';
import type { AgentLoopResult, AgentStatusMessage } from './agent/loop-types';
import { createAgentHostToolCallbacks } from './agent/agent-host-tools';
import { getTaskWorkspaceRootFsPath, resolveWorkspaceFileUri } from './workspace-roots';
import { McpManager } from './mcp/client';
import type { AgentFileWriteContext } from './app/agent-file-write-policy';
import { recoverApplyFailureIfPossible } from './app/apply-failure-recovery-service';
import { responseClaimsStatusOk, shouldRunClosedLoopRepair } from './app/agentic-repair-service';
import { runClosedLoopRepair } from './app/closed-loop-repair-runner';
import { runLocalExecutionChatIfPossible } from './local-execution-chat-runner';
import { TerminalPermissionCoordinator } from './app/terminal-permission-coordinator';
import { ChatRouteController } from './app/chat-controller';
import { resolveSemanticRouteDecision } from './app/semantic-route-service';
import { ChatSessionTurnService } from './app/chat-session-turn-service';
import { migrateLegacyDeepseekConfiguration } from './app/config-migration-service';
import { buildPreExecutionInteraction } from './app/interaction-service';
import { buildLocalAttachmentContextPrompt } from './app/local-attachment-context';
import { MemoryService } from './app/memory-service';
import { AgentDisplayPresenter } from './app/agent-display-presenter';
import { AgentKernelService, type AgentKernelRun } from './app/agent-kernel-service';
import { productCodingKernelExecutor } from './product-coding-kernel-executor';
import { createDevSeekRunContext, type DevSeekRunContext, type RunContextStatus } from './app/run-context';
import { createAgentCheckpointCallback } from './app/agent-checkpoint-callback';
import { guardNonAgentResponse } from './app/non-agent-response-guard';
import type { AgentChatRequest } from './app/agent-protocol';
import { createAgentApplicationBridgeAdapter, EvidenceAwareChatRouter } from './app/evidence-aware-chat-router';
import { createEvidenceAwareMcpToolCallFactory } from './app/evidence-aware-mcp-tool-call';
import { recordApplyWorkflowEvidence } from './app/workflow-run-evidence-adapter';
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
import { ScopedTaskCheckpointService } from './app/task-checkpoint-store';
import { buildProviderRecoveryCheckpointTasks, buildProviderRecoveryDisplay, ProviderRecoveryService } from './app/provider-recovery-service';
import { resolveProviderStatusResponse } from './app/provider-status-service';
import { PendingEditCoordinator } from './pending-edit-coordinator';
import { recordTrackedChatHistory as recordTrackedChatHistoryState } from './app/chat-history-tracker';
import { createDirectVisibleResponsePublisher } from './app/direct-visible-response-service';
import {
  AGENT_CODE_FILE_RE,
  buildAgenticSessionContextFromState,
  resolveSessionContinuationFilesFromState,
  type AgentSessionState,
} from './app/agent-session-context';
import { emitResponseMeta, injectFileHintsIntoResponse } from './ui/generated-artifact-ui';
import { createAgentFileWriteConfirmation } from './ui/agent-file-write-confirmation';
import { postWebviewEvent, postWebviewMessage } from './ui/webview-event-adapter';
import { postAgentSettlementRefusal } from './ui/agent-run-settlement-presenter';
import { DeepSeekViewProvider } from './ui/deepseek-view-provider';
import type { WebviewInboundMessage } from './ui/webview-protocol';
import { recordRealPluginHarnessProgress, registerRealPluginDeepSeekHarnessCommand } from './ui/real-plugin-harness';
import { buildAgentRunDisplayProfile } from './agent/agent-run-display';
import { enforceAgentTaskExecutionPolicy } from './agent/task-execution-policy';
import { discoverFilesFromDirectoryPrompt, relPathFromWorkspace, toContextDisplayLabels } from './app/context-discovery-service';
import { TaskHistoryUiService } from './app/task-history-ui-service';
import { registerExtensionCommands } from './ui/extension-command-registration';
import { FileContextService } from './workspace/file-context-service';
import { WorkspaceGrepSearchService } from './workspace/grep-search-service';
import { listWorkspaceDirectoryForAi } from './workspace/list-dir-service';
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

// ----------------------------------------------------------------
// Sidebar chat view state (single-level entry, no launcher page)
// ----------------------------------------------------------------
let viewProvider: DeepSeekViewProvider;
let lastLocalExecutionPlan: LocalExecutionPlan | undefined;
let pendingEditCoordinator: PendingEditCoordinator;
const chatRouteController = new ChatRouteController();
const terminalPermissionCoordinator = new TerminalPermissionCoordinator();
const agentKernelService = new AgentKernelService(terminalPermissionCoordinator, productCodingKernelExecutor);
let lastConversationFiles: string[] = [];
let lastAnalysisText = '';
/** Workspace-relative paths of files created/modified by the last agent run */
let lastAgentChangedPaths: string[] = [];
/** DevSeek 当前 session 的显式对话历史；Bridge 网页侧历史不作为上下文来源。 */
let nonBridgeChatHistory: ChatMessage[] = [];
/** 当前正在执行的 chat 请求的 AbortController（停止按钮使用） */
let activeChatAbortController: AbortController | null = null;
/** 当前活跃 Agent Kernel run；取消/新请求只通过 Kernel/RunContext 结算。 */
let activeAgentKernelRun: AgentKernelRun | null = null;
/** 用户在 Agent 运行中输入的补充/纠偏，会在下一轮模型调用前注入。 */
const activeAgentSteerQueue: string[] = [];
// ── Session memory (L1a/L1b + L2) ─────────────────────────────────────────
/** VS Code ExtensionContext，用于 workspaceState 持久化 */
let extContext: vscode.ExtensionContext;
let agentCheckpointService: ScopedTaskCheckpointService<AgentTask>;
/** L2: 文件路径字典 basename/relPath → absPath，跨轮次不清空 */
const sessionRecentFiles = new Map<string, string>();
/** 当前活跃的 session ID */
let activeSessionId = '';
// P3-5: MCP manager (singleton; initialized lazily in activate)
const mcpManager = new McpManager();
const confirmAgentFileWrite = createAgentFileWriteConfirmation(terminalPermissionCoordinator);
const createEvidenceAwareMcpToolCall = createEvidenceAwareMcpToolCallFactory({
  terminalPermissions: terminalPermissionCoordinator,
  mcpManager,
});
const evidenceAwareChatRouter = new EvidenceAwareChatRouter({
  getProviderType: getActiveProviderType,
  getProvider: getActiveProvider,
  bridgeChat: createAgentApplicationBridgeAdapter(chat),
  getChatHistory: () => [...nonBridgeChatHistory],
  recordChatHistory: recordTrackedChatHistory,
  promptForApiKeyUpdate: promptUpdateApiKey,
  getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  getSessionId: () => activeSessionId,
  getTraceLevel: () => vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
});

function cancelActiveAgentRun(data: Record<string, unknown> = {}): RunContextStatus | undefined {
  const run = activeAgentKernelRun;
  if (!run) return undefined;
  activeAgentKernelRun = null;
  return run.cancelRun(data);
}

function clearActiveAgentKernelRun(run: AgentKernelRun): void {
  if (activeAgentKernelRun === run) activeAgentKernelRun = null;
}

function createFileContextService(workspaceRoot?: string): FileContextService {
  return new FileContextService({
    workspaceRoot,
    recentFiles: sessionRecentFiles,
    fallbackRead: readWorkspaceFile,
  });
}

async function grepWorkspace(
  workspaceRoot: string,
  pattern: string,
  path?: string,
  workDir?: string,
  options?: { includePattern?: string; fileTypes?: string },
): Promise<string> {
  const { runCommand } = await import('./tools/terminal');
  return new WorkspaceGrepSearchService(workspaceRoot, runCommand).search({
    pattern,
    path,
    workDir,
    includePattern: options?.includePattern,
    fileTypes: options?.fileTypes,
  });
}

function getSessionService(): SessionService | undefined {
  return extContext ? new SessionService(extContext.workspaceState) : undefined;
}

function getActiveEditorContextPath(): string | undefined {
  const rawPath = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? vscode.window.activeTextEditor.document.uri.fsPath
    : undefined;
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  return sanitizeWorkspaceContextAnchorPath(rawPath, workspaceRoots);
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
    ? await agentCheckpointService.loadFresh(7_200_000)
    : undefined;
  if (promptResumeCp) {
    if (!suppressUserMessage) webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    webview.postMessage({ type: 'agentCheckpointCleared' });
    await runChat(webview, promptResumeCp.displayPrompt, promptResumeCp.userPrompt, false, promptResumeCp.mode, undefined, false, promptResumeCp.startFromIndex, promptResumeCp.allTasks, undefined, intentConfirmed, true);
    return;
  }

  // 为本次请求创建独立 AbortController，停止按钮可随时中断
  cancelActiveAgentRun({ reason: 'superseded-by-new-run', source: 'run-chat-start' });
  activeChatAbortController?.abort();
  activeAgentSteerQueue.length = 0;
  const abortCtrl = new AbortController();
  activeChatAbortController = abortCtrl;
  const chatSignal = abortCtrl.signal;
  const consumeAgentSteer = (): string[] => activeAgentSteerQueue.splice(0, activeAgentSteerQueue.length);

  let effectiveFiles = normalizeConversationFiles(files);
  const userExplicitlyAttachedFiles = effectiveFiles.length > 0;
  await getChatSessionTurnService(webview).beginTurn({
    newSession,
    userDisplay,
    userExplicitlyAttachedFiles,
  });
  const directVisibleResponsePublisher = createDirectVisibleResponsePublisher({
    postMessage: message => webview.postMessage(message),
    postDelta: message => postWebviewMessage(webview, message),
    recordHistory: recordTrackedChatHistory,
  });

  if (isProjectInitRequest(userDisplay) || isProjectInitRequest(prompt)) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const text = root ? renderProjectInitDraftMarkdown(new ProjectInitService().generateDraft({ workspaceRoot: root })) : '请先打开一个工作区，再使用 `/init` 生成 DevSeek 项目指令草稿。';
    directVisibleResponsePublisher.publish({
      userDisplay,
      userMessagePrompt: prompt,
      responsePrompt: prompt,
      responseText: text,
      images,
      newSession,
      suppressUserMessage,
    });
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
  recordRealPluginHarnessProgress('run-chat-initial-route', {
    intentKind: initialRouteDecision.intent.kind,
    intentMode: initialRouteDecision.intent.mode,
    forceNoAgent: !!forceNoAgent,
    intentConfirmed: !!intentConfirmed,
  });

  const providerStatusResponse = await resolveProviderStatusResponse({
    prompt: initialRouteDecision.intentRoutingText,
    snapshot: getProviderConfigService().getSnapshot(),
    checkAvailability: () => getActiveProvider().available(),
  });
  if (providerStatusResponse) {
    recordRealPluginHarnessProgress('run-chat-return-provider-status');
    directVisibleResponsePublisher.publish({
      userDisplay,
      userMessagePrompt: prompt,
      responsePrompt: initialRouteDecision.intentRoutingText,
      responseText: providerStatusResponse,
      images,
      newSession,
      suppressUserMessage,
    });
    if (extContext) recordIntentOutcome(initialRouteDecision.intentRoutingText, 'chat', activeSessionId, extContext);
    if (activeChatAbortController === abortCtrl) {
      activeChatAbortController = null;
      activeAgentSteerQueue.length = 0;
    }
    return;
  }

  if (initialRouteDecision.intent.mode === 'smalltalk') {
    recordRealPluginHarnessProgress('run-chat-return-smalltalk');
    const reply = buildSmalltalkReply(initialRouteDecision.intentRoutingText);
    directVisibleResponsePublisher.publish({
      userDisplay,
      userMessagePrompt: prompt,
      responsePrompt: initialRouteDecision.intentRoutingText,
      responseText: reply,
      images,
      newSession,
      suppressUserMessage,
    });
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

  // Auto-discover directory context for read/analysis prompts only.
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
      const names = discovered.map(p => nodePath.basename(p));
      const preview = names.slice(0, 8).join('、');
      const suffix = names.length > 8 ? ' 等' : '';
      autoDiscoveredNote = `_[自动识别目录] 已加载 ${discovered.length} 个源文件${preview ? `（${preview}${suffix}）` : ''}，完整清单仅用于本地上下文。_\n\n`;
    }
  }
  const autoDiscoveredFileSet = new Set(autoDiscoveredFiles);

  const activeEditorContextPath = getActiveEditorContextPath();
  const promptScope = detectWorkspacePathScope(prompt, effectiveFiles, activeEditorContextPath);
  const pathResolutionHints = [
    ...new Set([
      ...effectiveFiles,
      ...(promptScope.promptDir ? [promptScope.promptDir] : []),
      ...(activeEditorContextPath ? [activeEditorContextPath] : []),
    ]),
  ];

  // When starting a new session, tell the webview to clear the old conversation first.
  if (newSession) {
    webview.postMessage({ type: 'newSessionStarted' });
  }
  if (!suppressUserMessage) {
    webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
  }
  const agentEnabled = vscode.workspace.getConfiguration('devseek').get<boolean>('agentEnabled', true);
  const routeDecision = await resolveSemanticRouteDecision({
    controller: chatRouteController,
    userDisplay,
    prompt,
    files: effectiveFiles,
    agentEnabled,
    forceNoAgent,
    intentConfirmed,
    mode,
    signal: chatSignal,
    lookupLearnedIntent: extContext ? (text) => lookupLearnedIntent(text, extContext!) : undefined,
    recordProgress: recordRealPluginHarnessProgress,
  });
  if (chatSignal.aborted) return;
  const { intentRoutingText, intent, toolPolicy, workflow } = routeDecision;
  recordRealPluginHarnessProgress('run-chat-workflow-selected', {
    intentKind: intent.kind,
    intentMode: intent.mode,
    workflowKind: workflow.kind,
    workflowState: workflow.state,
    useAgent: workflow.useAgent,
    requiresPlanReview: workflow.requiresPlanReview,
    effectiveFiles: effectiveFiles.length,
  });
  const preExecutionInteraction = buildPreExecutionInteraction({
    userText: intentRoutingText,
    prompt,
    files: effectiveFiles,
    intent,
    workflow,
    intentConfirmed,
  });
  if (preExecutionInteraction) {
    recordRealPluginHarnessProgress('run-chat-return-pre-execution-interaction', {
      interactionKind: preExecutionInteraction.kind,
      title: preExecutionInteraction.title,
    });
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

  const directInspectionRoot = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath)
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? '';
  const directInspection = workflow.kind === 'inspect-agent' && intent.mode === 'inspect' && resumeFromIndex === undefined
    ? tryBuildReadOnlyInspectionResult({ prompt: intentRoutingText, workspaceRoot: directInspectionRoot })
    : null;
  if (directInspection) {
    recordRealPluginHarnessProgress('run-chat-return-direct-inspection', {
      workspaceRoot: directInspectionRoot,
      textLength: directInspection.text.length,
    });
    webview.postMessage({
      type: 'startResponse',
      prompt: intentRoutingText,
      expectGeneratedArtifacts: false,
      agentMode: false,
    });
    postWebviewMessage(webview, { type: 'delta', text: directInspection.text });
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

  let workflowRunContext: ReturnType<typeof createDevSeekRunContext> | undefined;
  const workflowReporter = async (status: ApplyWorkflowStatus): Promise<void> => {
    recordApplyWorkflowEvidence(workflowRunContext, status);
    postWebviewEvent(webview, { kind: 'workflow', status });
  };
  const localPreflightConfig = vscode.workspace.getConfiguration('devseek');
  const shouldBypassAgentForLocalExecution = (() => {
    if (!localPreflightConfig.get<boolean>('localExecutionFirst', true)) return false;
    if (intent.mode !== 'run') return false;
    const workspaceRootForLocal = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath);
    if (shouldPreferLocalExecution(prompt, effectiveFiles, workspaceRootForLocal)) {
      return !!planLocalExecution(prompt, effectiveFiles || [], workspaceRootForLocal);
    }
    return !!planRepeatLocalExecution(prompt, lastLocalExecutionPlan, workspaceRootForLocal);
  })();

  // ── Agent Mode: two-phase Architect + Editor loop ────────────────────────
  if (workflow.useAgent) {
  recordRealPluginHarnessProgress('run-chat-enter-agent-workflow', {
    workflowKind: workflow.kind,
    intentMode: intent.mode,
    effectiveFiles: effectiveFiles.length,
  });
  if (!shouldBypassAgentForLocalExecution) {
    // 只有 bridge provider 才需要检查 bridge 连接
    if (getActiveProviderType() === 'bridge') {
      const ready = await ensureBridgeRunning();
      if (!ready) {
        webview.postMessage({ type: 'startResponse' });
        postWebviewMessage(webview, { type: 'delta', text: '_正在启动 Bridge 服务，请稍候…_' });
        webview.postMessage({ type: 'endResponse' });
        postWebviewMessage(webview, { type: 'error', text: 'Bridge 服务启动失败。\n请重载 VS Code 窗口或重新安装最新 VSIX；网页免费方式应由扩展内置 Bridge 自动启动。' });
        return;
      }
    }

    pendingEditCoordinator.beginReviewScope(webview);
    // P5: carry agentMode so webview can set isAgentMode synchronously on receipt
    webview.postMessage({ type: 'startResponse', prompt, expectGeneratedArtifacts: true, agentMode: true });
    // Emit the auto-discovery note as the first delta so the user knows files were found
    if (sessionContinuationNote) {
      postWebviewMessage(webview, { type: 'delta', text: sessionContinuationNote });
    }
    if (autoDiscoveredNote) {
      postWebviewMessage(webview, { type: 'delta', text: autoDiscoveredNote });
    }

    const agentDisplayPresenter = new AgentDisplayPresenter();
    let agentRunContext: DevSeekRunContext | undefined;
    const postAgent = (msg: AgentStatusMessage) => {
      agentRunContext?.recordAgentStatus(msg);
      webview.postMessage(agentDisplayPresenter.presentStatus(msg));
    };
    const postAgentToolActivity = (kind: string, label: string) => {
      agentRunContext?.recordToolActivity(kind, label);
      webview.postMessage(agentDisplayPresenter.presentToolActivity(kind, label));
    };
    const agentWorkspaceRoot = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath)
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();
    const agentKernelRun = agentKernelService.startRun({
      workspaceRoot: agentWorkspaceRoot,
      source: 'vscode-extension.agent',
      userPrompt: prompt,
      sessionId: activeSessionId,
      mode,
      traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
      contextRefs: effectiveFiles.map(file => ({
        kind: 'file',
        uri: file,
      })),
    });
    activeAgentKernelRun = agentKernelRun;
    agentRunContext = agentKernelRun.runContext;
    workflowRunContext = agentRunContext;
    const agentTraceRunId = agentRunContext.runId;
    const agentTraceWorkspaceRoot = agentRunContext.workspaceRoot;
    // L1a: filled inside try/catch, used after to persist agent turn in session history
    let agentHistoryText = '';
    let loopResult: AgentLoopResult | undefined;
    let loopAutopilotHandled = false;
    let loopFailedForAutoAccept = false;
    let decomposedTaskCount = 0;
    let durableAgentSettlement: RunContextStatus | undefined;

    try {
      const checkpointResumeTasks = resumeFromIndex !== undefined && resumeTasks && resumeTasks.length > 0
        ? resumeTasks
        : undefined;
      // ── Agentic routing: no code files → free-explore loop (Claude Code style) ──
      // This mirrors Copilot's principle: "no Working Set → no Architect phase".
      // The LLM drives tool exploration directly; we skip decomposeTask entirely.
      const hasCodeFiles = effectiveFiles.some(f => AGENT_CODE_FILE_RE.test(f));
      // The kernel exploratory route handles investigation, pure code creation, and mixed data-file tasks.
      // It can self-route through read, exploration, planning, and write tools as needed.
      // Only skip to Architect+Editor when user explicitly attached code files to edit.
      if (!hasCodeFiles && !checkpointResumeTasks) {
        // No code file attachments → agentic free-explore (investigate) mode
        const agWsRootPath = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath);
        const agWsRoot = agWsRootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const agSessionContext = buildAgenticSessionContext(agWsRoot, userDisplay);
        const agDisplayProfile = buildAgentRunDisplayProfile(prompt);
        // Non-code files (logs, csvs, etc.) are passed directly
        const dataFiles = effectiveFiles.filter(f => !AGENT_CODE_FILE_RE.test(f));
        const activeEditorPath = activeEditorContextPath ?? '';
        const agMemoryRelatedPaths = [
          ...dataFiles,
          ...pathResolutionHints,
          activeEditorPath,
        ].filter((pathValue): pathValue is string => Boolean(pathValue));
        // Free-explore mode has no Architect decomposition phase, but the UI still
        // needs a visible beginning before the model's first tool call arrives.
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'started',
          title: agDisplayProfile.planStartedTitle,
          taskTotal: 0,
          detail: agDisplayProfile.planStartedDetail,
          progressTitle: agDisplayProfile.planStartedTitle,
          progressDetail: agDisplayProfile.planStartedDetail,
        });
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: agDisplayProfile.planCompletedTitle,
          taskTotal: 0,
          detail: agDisplayProfile.planCompletedDetail,
          progressTitle: agDisplayProfile.planCompletedTitle,
          progressDetail: agDisplayProfile.planCompletedDetail,
        });
        const agResult = await agentKernelService.executeExploratory({
          userPrompt: prompt,
          dataFiles,
          workspaceRoot: agWsRoot,
          mode,
          callbacks: {
            executionMode: workflow.toolPolicyMode,
            traceRunId: agentTraceRunId,
            traceWorkspaceRoot: agentTraceWorkspaceRoot,
            traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
            onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
            runDisplayAction: agDisplayProfile.initialTaskAction,
            runDisplayTarget: agDisplayProfile.initialTaskLabel,
            onDelta: (delta) => {
              if (delta.startsWith('\x00RESET\x00')) {
                postWebviewMessage(webview, { type: 'resetResponse', text: delta.slice(7) });
              } else if (delta === '\x00PROSE_CLEAR\x00') {
                // Silently wipe intermediate round prose from the webview buffer.
                // Keeps currentRaw clean so the final bubble only shows the ASUM summary.
                webview.postMessage({ type: 'clearAgentProse' });
              } else {
                postWebviewMessage(webview, { type: 'delta', text: delta });
              }
            },
            onWorkflowStatus: async (s) => { postWebviewEvent(webview, { kind: 'workflow', status: s }); },
            onAgentStatus: async (s) => { postAgent(s); },
            onAppliedChange: async (c) => { await pendingEditCoordinator.registerChange(webview, c); },
            onResponseMeta: async (_raw) => { /* suppressed in agent mode */ },
            onAgentAnnouncement: (text) => {
              postWebviewMessage(webview, { type: 'agentAnnouncement', text });
            },
            onToolActivity: (kind, label) => {
              postAgentToolActivity(kind, label);
            },
            onTodoUpdate: (items) => { webview.postMessage({ type: 'todoUpdate', items }); },
            onUserSteer: consumeAgentSteer,
            onTaskComplete: (_summary) => { /* phase:done handled inside runAgenticLoop */ },
            onMemoryWrite: async (proposal) => {
              if (agWsRoot) new MemoryService({ workspaceRoot: agWsRoot }).acceptWriteProposal(proposal);
            },
            onBeforeFileWrite: (absPath: string, context?: AgentFileWriteContext): Promise<boolean> => confirmAgentFileWrite({
              webview,
              absPath,
              context,
              workspaceRoot: agWsRoot,
              toolPolicy,
              trace: agentRunContext.childTrace('vscode-extension.file-write-policy'),
            }),
            mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
            onMcpToolCall: mcpManager.hasMcpTools
              ? createEvidenceAwareMcpToolCall(agentRunContext, webview)
              : undefined,
            onTerminalCommand: async (command, workdir) => {
              return terminalPermissionCoordinator.runCommandWithPermission({
                webview,
                command,
                workdir,
                workspaceRoot: agWsRoot,
                mode: intent.mode,
                toolPolicy,
                traceRunId: agentTraceRunId,
                traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
                onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
              });
            },
            onValidationCommand: terminalPermissionCoordinator.createValidationCommandRunner({
              webview,
              workspaceRoot: agWsRoot,
              mode: intent.mode,
              toolPolicy,
              traceRunId: agentTraceRunId,
              traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
              onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
            }),
            onReadFile: async (filePath: string, workDir?: string, range?: { startLine?: number; endLine?: number }) => (
              createFileContextService(agWsRoot).readFileForAi(filePath, { workDir, ...range })
            ),
            onGrepSearch: async (pattern: string, path?: string, _isRegexp?: boolean, workDir?: string, options?: { includePattern?: string; fileTypes?: string }) => (
              grepWorkspace(agWsRoot, pattern, path, workDir, options)
            ),
            onListDir: async (path: string) => listWorkspaceDirectoryForAi(agWsRoot, path),
            ...createAgentHostToolCallbacks({
              workspaceRoot: agWsRoot,
              webview,
              terminalPermissionCoordinator,
              runContext: agentRunContext,
            }),
            signal: chatSignal,
            onTaskCheckpoint: async (firstUnfinishedIndex, remainingTasks, reason = 'progress') => {
              agentRunContext?.recordCheckpoint(firstUnfinishedIndex, remainingTasks.length, reason);
              return createAgentCheckpointCallback({
                userPrompt: prompt,
                displayPrompt: userDisplay,
                mode,
                workspaceRoot: agWsRoot,
                sessionId: activeSessionId,
                save: agentCheckpointService.save,
                postMessage: message => { webview.postMessage(message); },
              })(firstUnfinishedIndex, remainingTasks, reason);
            },
            autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
          },
          sessionContextText: agSessionContext,
          workflowMode: workflow.toolPolicyMode,
          memoryRelatedPaths: agMemoryRelatedPaths,
        });
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
        const agSettlement = agentKernelRun.settleAgentLoopResult(agResult, lastAgentChangedPaths);
        const agDurablyCompleted = agSettlement.completed;
        if (agSettlement.refused) postAgentSettlementRefusal(webview, agentDisplayPresenter);
        const agChangedDetails = lastAgentChangedPaths.length > 0
          ? '\n**涉及文件（workspace 相对路径）：**\n' + lastAgentChangedPaths.map(p => `  - ${p}`).join('\n')
          : '';
        agentHistoryText = agResult.historyText
          || `**[Agentic] ${agDurablyCompleted ? '已完成' : '未完成'}（${agResult.tasksTotal} 轮）**${agChangedDetails}`;
        if (agSettlement.refused) {
          agentHistoryText = `**[Agentic] 未完成：运行证据结算失败**\n\n${agentHistoryText}`;
        }
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: lastAgentChangedPaths.slice(0, 12),
          completed: agDurablyCompleted,
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
        if (agDurablyCompleted) {
          const agAutopilotHandled = pendingEditCoordinator.handleAgentAutopilot(webview, agResult);
          pendingEditCoordinator.scheduleAutoAccept(webview, agResult, agAutopilotHandled);
        }
        webview.postMessage({ type: 'endResponse' });
        clearActiveAgentKernelRun(agentKernelRun);
        return;
      }

      // Phase-0: Architect — decompose the task into a per-file plan
      // (Skipped when resuming from a checkpoint — tasks are already known.)
      let tasks: import('./agent-task-decomposer').AgentTask[];
      let _decomposeProse = '';
      const _wsFolderForContext = agentWorkspaceRoot;
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
        const _wsFolder0 = agentWorkspaceRoot;
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
          // Agent internals must not inherit the DeepSeek web page's implicit
          // browser-side history. DevSeek injects only explicit current-session
          // context into the prompt it builds.
          async (p, m) => routeChat({
            prompt: p,
            mode: m,
            newSession: true,
            trackHistory: false,
            traceRunId: agentTraceRunId,
            traceWorkspaceRoot: agentTraceWorkspaceRoot,
            traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
            onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
          }),
          // Active editor file: used as path anchor when no files are attached and no
          // explicit path is in the prompt. Mirrors Copilot's per-file context behaviour.
          activeEditorContextPath,
        );

        tasks = decomposeResult.ok
          ? decomposeResult.tasks
          : decomposeResult.fallbackAllowed === false
            ? []
            : inferTasksFromFiles(effectiveFiles, promptForAgent);
        _decomposeProse = decomposeResult.prose ?? '';
        const taskPolicyResult = enforceAgentTaskExecutionPolicy(tasks, {
          mode: workflow.toolPolicyMode,
          userPrompt: promptForAgent,
        });
        if (taskPolicyResult.changed) {
          tasks = taskPolicyResult.tasks;
          postAgent({
            type: 'agentStatus',
            phase: 'plan',
            state: 'started',
            title: '已按权限模式调整任务计划',
            taskTotal: tasks.length,
            detail: taskPolicyResult.reason,
          });
        }

        // If tasks is empty (decompose failed or produced no tasks), show an error
        // but keep the Working area visible so user sees what was attempted.
        // Copilot pattern: fallback gracefully rather than disappearing silently.
        if (tasks.length === 0) {
          const errMsg = decomposeResult.error ?? '未识别到子任务';
          postAgent({ type: 'agentStatus', phase: 'plan', state: 'failed', title: '任务计划生成失败', taskTotal: 0, detail: errMsg });
          let errDelta = `_[Agent] 未能生成执行计划（${errMsg}）。建议尝试：_\n\n- 重新表述或简化需求  \n- 确保选中相关代码或文件\n- 检查工作区文件是否可访问\n\n**DeepSeek 反馈：**`;
          if (decomposeResult.raw?.trim()) {
            errDelta += `\n\n\`\`\`\n${decomposeResult.raw.slice(0, 1500).trim()}\n\`\`\``;
          } else {
            errDelta += '（无详细信息）';
          }
          postWebviewMessage(webview, { type: 'error', text: errDelta, loginRequired: false });
          postAgent({ type: 'agentStatus', phase: 'done', state: 'failed', title: '执行结束（无可执行计划）', detail: 'Agent 模式已终止；请先解决计划生成失败原因后重试' });
          agentKernelRun.failRun({
            reason: 'plan-generation-failed',
            detail: errMsg,
          });
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
            postWebviewMessage(webview, { type: 'agentAnnouncement', text: _announcement });
          }
        }
      }

      // Phase-1: Editor — execute each task sequentially
      // P2: derive workspace root from attached files (Copilot: getWorkspaceFolder per-uri)
      // rather than blindly using workspaceFolders[0] which would be wrong in multi-root setups.
      const wsRootPath = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath);
      const wsRoot = wsRootPath ? vscode.Uri.file(wsRootPath) : vscode.workspace.workspaceFolders?.[0]?.uri;
      decomposedTaskCount = tasks.length;
      if (wsRoot) {
        const editorSessionContext = shouldInjectSessionContext
          ? [lastAnalysisText, sessionContextForAgent].filter(Boolean).join('\n\n')
          : (lastAnalysisText || undefined);
        loopResult = await agentKernelService.executePlanned({
          tasks,
          userPrompt: promptForAgent,
          mode,
          workspaceRoot: wsRoot,
          callbacks: {
            executionMode: workflow.toolPolicyMode,
            traceRunId: agentTraceRunId,
            traceWorkspaceRoot: agentTraceWorkspaceRoot,
            traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
            onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
            onDelta: (delta) => {
              if (delta.startsWith('\x00RESET\x00')) {
                postWebviewMessage(webview, { type: 'resetResponse', text: delta.slice(7) });
              } else {
                postWebviewMessage(webview, { type: 'delta', text: delta });
              }
            },
            onWorkflowStatus: async (s) => { postWebviewEvent(webview, { kind: 'workflow', status: s }); },
            onAgentStatus: async (s) => { postAgent(s); },
            onAppliedChange: async (c) => { await pendingEditCoordinator.registerChange(webview, c); },
            onResponseMeta: async (_raw) => { /* suppressed in agent mode */ },
            // G-tool: AI performed read/search/list — show activity chip in working area
            onToolActivity: (kind, label) => {
              postAgentToolActivity(kind, label);
            },
            // L-2: AI called manage_todo_list — push to webview todo widget
            onTodoUpdate: (items) => { webview.postMessage({ type: 'todoUpdate', items }); },
            onUserSteer: consumeAgentSteer,
            // L-3: AI called task_complete — phase:done is emitted by executeFakeToolsForLoop
            // directly via callbacks.onAgentStatus; do NOT duplicate it here.
            onTaskComplete: (_summary) => { /* side-effect hook; phase:done handled in agent-loop */ },
            // P3: AI called memory_write — host service validates and persists it.
            onMemoryWrite: async (proposal) => {
              const wsPath = wsRoot.fsPath;
              if (wsPath) new MemoryService({ workspaceRoot: wsPath }).acceptWriteProposal(proposal);
            },
            // P-SEC: sensitive file protection — confirm before writing .env / *.pem / *.key etc.
            // §8.3: also enforce user-configured devseek.protectedFiles glob list (hard block, no confirm)
            onBeforeFileWrite: (absPath: string, context?: AgentFileWriteContext): Promise<boolean> => confirmAgentFileWrite({
              webview,
              absPath,
              context,
              workspaceRoot: wsRoot.fsPath,
              toolPolicy,
              trace: agentRunContext.childTrace('vscode-extension.file-write-policy'),
            }),
            // P3-5: MCP tools available in this session
            mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
            onMcpToolCall: mcpManager.hasMcpTools
              ? createEvidenceAwareMcpToolCall(agentRunContext, webview)
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
                traceRunId: agentTraceRunId,
                traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
                onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
              });
            },
            onValidationCommand: terminalPermissionCoordinator.createValidationCommandRunner({
              webview,
              workspaceRoot: wsRoot.fsPath,
              mode: intent.mode,
              toolPolicy,
              traceRunId: agentTraceRunId,
              traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
              onTraceEvidenceError: error => agentRunContext?.markEvidenceDegraded(error),
            }),
            // P5-3: read_file tool — AI can read workspace files during agent loop
            // workDir = absolute path of the current task's directory (passed by executeFakeToolsForLoop).
            // Copilot/Claude Code pattern: tool calls inherit parent task's working directory so
            // bare filenames like "main.cpp" resolve to code/3D/main.cpp, not workspace root.
            onReadFile: async (filePath, workDir?: string, range?: { startLine?: number; endLine?: number }) => (
              createFileContextService(wsRoot.fsPath).readFileForAi(filePath, { workDir, ...range })
            ),
            // grep_search tool — AI can search workspace files for patterns
            onGrepSearch: async (pattern: string, path?: string, _isRegexp?: boolean, workDir?: string, options?: { includePattern?: string; fileTypes?: string }) => (
              grepWorkspace(wsRoot.fsPath, pattern, path, workDir, options)
            ),
            // list_dir tool — AI can explore directory structure (G9: supports absolute paths)
            onListDir: async (path: string) => listWorkspaceDirectoryForAi(wsRoot.fsPath, path),
            ...createAgentHostToolCallbacks({
              workspaceRoot: wsRoot.fsPath,
              webview,
              terminalPermissionCoordinator,
              runContext: agentRunContext,
            }),
            // Stop button support: abort in-progress LLM calls
            signal: chatSignal,
            // 断点续传：save/clear checkpoint after each task and on network failure
            autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
            onTaskCheckpoint: async (completedUpToIndex, remainingTasks, checkpointReason = 'progress') => {
              agentRunContext?.recordCheckpoint(completedUpToIndex, remainingTasks.length, checkpointReason);
              if (completedUpToIndex === null) {
                // Loop completed successfully — clear any stale checkpoint
                await agentCheckpointService.save(null);
                // Tell webview to hide the checkpoint banner (if shown)
                webview.postMessage({ type: 'agentCheckpointCleared' });
                return;
              }
              // Save current progress so the user can resume later
              await agentCheckpointService.save({
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
          },
          analysisContext: editorSessionContext,
          startFromIndex: resumeFromIndex ?? 0,
        });
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
        const agentSettlement = agentKernelRun.settleAgentLoopResult(loopResult);
        durableAgentSettlement = agentSettlement.status;
        const agentDurablyCompleted = agentSettlement.completed;
        if (agentSettlement.refused) postAgentSettlementRefusal(webview, agentDisplayPresenter);
        loopAutopilotHandled = agentDurablyCompleted
          ? pendingEditCoordinator.handleAgentAutopilot(webview, loopResult)
          : false;
        agentHistoryText = loopResult.historyText
          || `**[Agent] ${agentDurablyCompleted ? '已完成' : '未完成'}（${loopResult.tasksApplied}/${tasks.length} 个任务）**\n\n未生成可恢复的执行证据摘要。`;
        if (agentSettlement.refused) {
          agentHistoryText = `**[Agent] 未完成：运行证据结算失败**\n\n${agentHistoryText}`;
        }
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: lastAgentChangedPaths.slice(0, 12),
          completed: agentDurablyCompleted,
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
        const wsRootFsPath = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath)
          ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          ?? '';
        const recoveryTasks = buildProviderRecoveryCheckpointTasks({
          prompt,
          files: effectiveFiles,
          workspaceRootFsPath: wsRootFsPath,
          recoveryKind: recovery.kind,
        }) as AgentTask[];
        await agentCheckpointService.save({
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
        postWebviewMessage(webview, {
          type: 'error',
          text: recoveryDisplay.text,
          loginRequired: recovery.kind === 'LoginRequired',
        });
        agentHistoryText = agentHistoryText || recoveryDisplay.historyText;
      } else {
        postAgent({ type: 'agentStatus', phase: 'error', state: 'failed', title: `Agent 执行出错：${msg}` });
        postWebviewMessage(webview, { type: 'error', text: msg, loginRequired: msg === 'LOGIN_REQUIRED' });
        agentHistoryText = agentHistoryText || `[Agent 执行出错] ${msg.slice(0, 200)}`;
      }
      saveAgentSessionState({
        lastUserPrompt: userDisplay,
        lastSummary: agentHistoryText,
        changedPaths: [],
        completed: false,
        savedAt: Date.now(),
      });
      durableAgentSettlement = agentKernelRun.failRun({
        reason: 'agent-error',
        changedPaths: [],
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
    if (!loopFailedForAutoAccept && !durableAgentSettlement) {
      durableAgentSettlement = loopResult
        ? agentKernelRun.settleAgentLoopResult(loopResult).status
        : agentKernelRun.failRun({
          tasksTotal: decomposedTaskCount,
          tasksApplied: 0,
          tasksFailed: 0,
          changedPaths: [],
        });
    }
    if (!loopFailedForAutoAccept && durableAgentSettlement === 'completed') {
      pendingEditCoordinator.scheduleAutoAccept(webview, autoAcceptResult, loopAutopilotHandled);
    }
    webview.postMessage({ type: 'endResponse' });
    clearActiveAgentKernelRun(agentKernelRun);
    return;
  }
  }
  // ── End Agent Mode ────────────────────────────────────────────────────────

  // 只有 bridge provider 才需要检查 bridge 连接
  if (getActiveProviderType() === 'bridge') {
    const ready = await ensureBridgeRunning();
    if (!ready) {
      webview.postMessage({ type: 'startResponse' });
      postWebviewMessage(webview, { type: 'delta', text: '_正在启动 Bridge 服务，请稍候…_' });
      webview.postMessage({ type: 'endResponse' });
      postWebviewMessage(webview, {
        type: 'error',
        text: 'Bridge 服务启动失败。\n请重载 VS Code 窗口或重新安装最新 VSIX；网页免费方式应由扩展内置 Bridge 自动启动。',
      });
      return;
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
    postWebviewMessage(webview, { type: 'delta', text: autoDiscoveredNote });
  }

  let chatRunContext: ReturnType<typeof createDevSeekRunContext> | undefined;
  try {
    let finalPrompt = prompt;
    const config = vscode.workspace.getConfiguration('devseek');

    // P1: inject project instructions and legacy memory through ContextAssemblyService.
    const projectRules = await getProjectRules();
    const activeEditorPathForMemory = activeEditorContextPath ?? '';
    const projectMemory = getProjectMemorySync({
      prompt: finalPrompt,
      relatedPaths: [
        ...effectiveFiles,
        ...pathResolutionHints,
        activeEditorPathForMemory,
      ].filter((pathValue): pathValue is string => Boolean(pathValue)),
    });
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
      const editorContextPath = activeEditorContextPath;
      if (editor && editorContextPath) {
        const replyLang = config.get<string>('language', 'zh') === 'zh' ? '中文' : 'English';
        const lang = editor.document.languageId;
        const file = vscode.workspace.asRelativePath(vscode.Uri.file(editorContextPath));
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
      const activeFile = activeEditorContextPath ?? '';
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
    const workspaceRoot = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath);
    const chatWorkspaceRoot = workspaceRoot
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();
    chatRunContext = createDevSeekRunContext({
      workspaceRoot: chatWorkspaceRoot,
      source: 'vscode-extension.chat',
      userPrompt: prompt,
      sessionId: activeSessionId,
      mode,
      traceLevel: config.get<string>('traceLevel', 'debug'),
    });
    workflowRunContext = chatRunContext;
    const chatValidationCommandRunner = terminalPermissionCoordinator.createValidationCommandRunner({
      webview,
      workspaceRoot: chatWorkspaceRoot,
      mode: intent.mode,
      toolPolicy,
      traceRunId: chatRunContext.runId,
      traceEvidenceParticipantToken: chatRunContext.evidenceParticipantToken,
      onTraceEvidenceError: error => chatRunContext?.markEvidenceDegraded(error),
    });
    chatRunContext.trace.info('routing', 'route-decision', {
      agentEnabled: config.get<boolean>('agentEnabled', true),
      forceNoAgent,
      intentConfirmed,
      intent: {
        kind: intent.kind,
        mode: intent.mode,
        reason: intent.reason,
        signals: intent.signals,
        blockers: intent.blockers,
      },
      workflow: {
        kind: workflow.kind,
        state: workflow.state,
        useAgent: workflow.useAgent,
        reason: workflow.reason,
        requiresPlanReview: workflow.requiresPlanReview,
        toolPolicyMode: workflow.toolPolicyMode,
      },
      files: {
        effectiveCount: effectiveFiles.length,
        pathHintCount: pathResolutionHints.length,
        autoDiscoveredCount: autoDiscoveredFiles.length,
      },
    });
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
        terminalPermissionCoordinator,
        agentKernelService,
        traceRunId: chatRunContext.runId,
        traceEvidenceParticipantToken: chatRunContext.evidenceParticipantToken,
        onTraceEvidenceError: error => chatRunContext?.markEvidenceDegraded(error),
        consumeAgentSteer,
        registerAppliedChange: (change) => pendingEditCoordinator.registerChange(webview, change),
        registerToMemory,
        sessionRecentFiles,
        mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
        onMcpToolCall: mcpManager.hasMcpTools ? createEvidenceAwareMcpToolCall(chatRunContext, webview) : undefined,
        signal: chatSignal,
        sessionId: activeSessionId,
        onChangedPaths: (relativePaths) => { lastAgentChangedPaths = relativePaths; },
      });
      if (localExecutionResult.handled) {
        const requestedStatus = localExecutionResult.status ?? 'failed';
        const settlementStatus = terminalPermissionCoordinator.completeRunContext(chatRunContext, requestedStatus, {
          reason: 'local-execution-handled',
          terminalOutcome: requestedStatus,
        });
        if (requestedStatus === 'completed') {
          if (settlementStatus === 'completed' && localExecutionResult.successMessage) {
            postWebviewMessage(webview, { type: 'delta', text: localExecutionResult.successMessage });
          } else if (settlementStatus !== 'completed') {
            postWebviewMessage(webview, {
              type: 'error',
              text: '本地命令已成功，但运行证据结算失败；本轮不能标记完成。',
            });
          }
          webview.postMessage({ type: 'endResponse' });
        }
        return;
      }
    }

    const postChatDelta = (delta: string): void => {
      if (delta.startsWith('\x00RESET\x00')) {
        const fullText = delta.slice(7);
        postWebviewMessage(webview, {
          type: 'resetResponse',
          text: fullText,
        });
        return;
      }

      postWebviewMessage(webview, { type: 'delta', text: delta });
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
      traceRunId: chatRunContext.runId,
      traceWorkspaceRoot: chatRunContext.workspaceRoot,
      traceEvidenceParticipantToken: chatRunContext.evidenceParticipantToken,
      onTraceEvidenceError: error => chatRunContext?.markEvidenceDegraded(error),
      onUsage: (usage) => {
        webview.postMessage({ type: 'tokenUsage', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      },
    });

    const guardedNonAgentResponse = guardNonAgentResponse(finalResponse);
    const finalResponseForUser = guardedNonAgentResponse.visibleText;
    const finalResponseForArtifacts = noAgentCodeChat || guardedNonAgentResponse.containsInternalToolProtocol
      ? guardedNonAgentResponse.artifactText
      : finalResponse;
    if (noAgentCodeChat || guardedNonAgentResponse.usedProtocolNotice) {
      postWebviewMessage(webview, {
        type: 'resetResponse',
        text: finalResponseForUser || guardedNonAgentResponse.artifactText,
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
      postWebviewMessage(webview, { type: 'delta', text: '\n\n---\n_[系统] 未识别到文件路径标注，正在请求按标准格式重新整理输出…_\n' });
      try {
        const reformatResp = await routeChat({
          prompt: reformatReq,
          newSession: false,
          mode,
          traceRunId: chatRunContext.runId,
          traceWorkspaceRoot: chatRunContext.workspaceRoot,
          traceEvidenceParticipantToken: chatRunContext.evidenceParticipantToken,
          onTraceEvidenceError: error => chatRunContext?.markEvidenceDegraded(error),
          onDelta: (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              postWebviewMessage(webview, { type: 'delta', text: delta.slice(7) });
            } else {
              postWebviewMessage(webview, { type: 'delta', text: delta });
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

    // 兜底3：仍然没有标准路径标注时，把原始回复交给 applier 的目标作用域兜底。
    // applier 会根据会话文件、语言和完整文件特征判定唯一目标；不唯一则不写入。
    if (
      canApplyArtifacts
      && !shouldApplyToReviewQueue
      && looksLikeTargetScopedSourceResponse(finalResponseForArtifacts, prompt, effectiveFiles)
    ) {
      responseToApply = finalResponseForArtifacts;
      shouldApplyToReviewQueue = true;
    }

    if (shouldApplyToReviewQueue) {
      const firstApply = await applyGeneratedArtifactsWithPrompt(responseToApply, prompt, workflowReporter, true, async (change) => {
        await pendingEditCoordinator.registerChange(webview, change);
      }, pathResolutionHints, {
        rollbackOnValidationFailure: false,
        validationCommandRunner: chatValidationCommandRunner,
      });
      const recoveredApply = await recoverApplyFailureIfPossible({
        reporter: workflowReporter,
        originalPrompt: prompt,
        failedResponse: responseToApply,
        failedApply: firstApply,
        preferredAbsolutePaths: pathResolutionHints,
        chat: (repairPrompt) => routeChat({
          prompt: repairPrompt,
          newSession: false,
          mode,
          stream: false,
          trackHistory: false,
          traceRunId: chatRunContext?.runId,
          traceWorkspaceRoot: chatRunContext?.workspaceRoot,
          traceEvidenceParticipantToken: chatRunContext?.evidenceParticipantToken,
          onTraceEvidenceError: error => chatRunContext?.markEvidenceDegraded(error),
        }),
        apply: (repairResponse, repairPrompt, onAppliedChange) => applyGeneratedArtifactsWithPrompt(
          repairResponse,
          repairPrompt,
          workflowReporter,
          true,
          onAppliedChange,
          pathResolutionHints,
          { rollbackOnValidationFailure: false, validationCommandRunner: chatValidationCommandRunner },
        ),
        onAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(webview, change); },
      });
      const finalApply = recoveredApply ?? firstApply;
      if (shouldRunClosedLoopRepair(finalApply)) {
        await runClosedLoopRepair({
          reporter: workflowReporter,
          originalPrompt: prompt,
          mode,
          initialApply: finalApply,
          preferredAbsolutePaths: pathResolutionHints,
          routeChat: (request) => routeChat({
            ...request,
            traceRunId: request.traceRunId ?? chatRunContext?.runId,
            traceWorkspaceRoot: request.traceWorkspaceRoot ?? chatRunContext?.workspaceRoot,
            traceEvidenceParticipantToken: request.traceEvidenceParticipantToken ?? chatRunContext?.evidenceParticipantToken,
            onTraceEvidenceError: request.onTraceEvidenceError ?? (error => chatRunContext?.markEvidenceDegraded(error)),
          }),
          registerAppliedChange: async (change) => { await pendingEditCoordinator.registerChange(webview, change); },
          getSessionId: () => activeSessionId,
          postVisibleDelta: (text) => { postWebviewMessage(webview, { type: 'delta', text }); },
          validationCommandRunner: chatValidationCommandRunner,
        });
      }
    }
    const chatSettlementStatus = terminalPermissionCoordinator.completeRunContext(chatRunContext, 'completed', {
      intent: intent.kind,
      workflow: workflow.kind,
      changedPaths: lastAgentChangedPaths.slice(0, 12),
    });
    if (chatSettlementStatus !== 'completed') {
      throw new Error('运行证据结算失败；本轮回复和文件候选不能标记为完成。');
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (chatRunContext) terminalPermissionCoordinator.completeRunContext(chatRunContext, 'failed', {
      reason: 'chat-error',
      message: msg,
    });
    if (msg === 'LOGIN_REQUIRED') {
      postWebviewMessage(webview, {
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
      postWebviewMessage(webview, { type: 'error', text: msg });
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

function getChatSessionTurnService(webview: vscode.Webview): ChatSessionTurnService {
  return new ChatSessionTurnService({
    getHistory: () => nonBridgeChatHistory,
    setHistory: (history) => { nonBridgeChatHistory = history; },
    getActiveSessionId: () => activeSessionId,
    setActiveSessionId: (sessionId) => { activeSessionId = sessionId; },
    generateSessionId,
    saveCurrentSession,
    compactAndSaveHistory,
    setSessionServiceActiveId: (sessionId) => getSessionService()?.setActiveSessionId(sessionId),
    saveSessionMeta,
    clearSessionRecentFiles: () => sessionRecentFiles.clear(),
    saveCurrentSessionFiles,
    setLastConversationFiles: (files) => { lastConversationFiles = files; },
    setLastAnalysisText: (text) => { lastAnalysisText = text; },
    setLastAgentChangedPaths: (paths) => { lastAgentChangedPaths = paths; },
    clearSessionHabits,
    clearLearnerSession,
    emitContextFiles: (files) => webview.postMessage({ type: 'contextFiles', files }),
  });
}

function recordTrackedChatHistory(opts: AgentChatRequest, response: string): void {
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

function routeChat(opts: AgentChatRequest): Promise<string> {
  return evidenceAwareChatRouter.route(opts);
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

async function loadSessionIntoWebview(wv: vscode.Webview, id: string): Promise<void> {
  if (!id || !extContext) return;
  saveCurrentSession();
  activeSessionId = id;
  getSessionService()?.setActiveSessionId(id);
  const files = extContext.workspaceState.get<Record<string, string>>(
    `deepseek.session.${id}.files`, {},
  ) ?? {};
  sessionRecentFiles.clear();
  for (const [key, value] of Object.entries(files)) sessionRecentFiles.set(key, value);
  const loadedSummary = extContext.workspaceState.get<string>(`deepseek.session.${id}.summary`, '') ?? '';
  const loadedHistory = extContext.workspaceState.get<ChatMessage[]>(`deepseek.session.${id}.history`, []) ?? [];
  nonBridgeChatHistory = buildRestoredSessionLlmHistory(loadedHistory, loadedSummary);
  lastConversationFiles = [];
  lastAnalysisText = extContext.workspaceState.get<string>(`deepseek.session.${id}.analysisText`, '') ?? '';
  restoreLastAgentPathsFromSession(id);
  const loadedMeta = getSessions().find(session => session.id === id);
  postWebviewMessage(wv, buildSessionLoadedPayload({ id, history: loadedHistory, summary: loadedSummary, meta: loadedMeta }));
}

async function handleTaskHistoryUiMessage(wv: vscode.Webview, msg: WebviewMessage): Promise<void> {
  if (!extContext) return;
  const service = new TaskHistoryUiService(extContext.workspaceState, { workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd() });
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
  agentCheckpointService = new ScopedTaskCheckpointService<AgentTask>({
    storage: context.workspaceState,
    getScope: () => ({
      wsRootFsPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      sessionId: activeSessionId,
    }),
  });
  setBridgeExtensionRoot(context.extensionUri.fsPath);
  await migrateLegacyDeepseekConfiguration();
  pendingEditCoordinator = new PendingEditCoordinator({
    getContextFiles: () => lastConversationFiles,
    getActiveWebview: () => viewProvider.webview,
  });
  viewProvider = new DeepSeekViewProvider({
    extensionUri: context.extensionUri,
    pendingEditCoordinator,
    terminalPermissionCoordinator,
    runChat,
    routeChat,
    getActiveSessionId: () => activeSessionId,
    getLastConversationFiles: () => lastConversationFiles,
    setLastConversationFiles: (files) => { lastConversationFiles = files; },
    getActiveChatAbortController: () => activeChatAbortController,
    setActiveChatAbortController: (controller) => { activeChatAbortController = controller; },
    cancelActiveAgentRun,
    pushAgentSteer: (text) => { activeAgentSteerQueue.push(text); },
    getActiveSessionPayload: () => {
      if (!activeSessionId) return undefined;
      const history = extContext?.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
      const summary = extContext?.workspaceState.get<string>(`deepseek.session.${activeSessionId}.summary`, '') ?? '';
      const payload = buildSessionLoadedPayload({
        id: activeSessionId,
        history,
        summary,
        meta: getSessions().find(session => session.id === activeSessionId),
      });
      return payload.history.length > 0 || payload.summary ? payload : undefined;
    },
    loadFreshAgentCheckpoint: agentCheckpointService.loadFresh,
    loadAgentCheckpoint: agentCheckpointService.load,
    saveAgentCheckpoint: agentCheckpointService.save,
    getSessions,
    loadSession: loadSessionIntoWebview,
    deleteSession,
    saveCurrentSession,
    handleTaskHistoryUiMessage,
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

  registerExtensionCommands(context, {
    viewProvider,
    terminalPermissionCoordinator,
    pushChatPanel,
    routeChat,
  });
  registerRealPluginDeepSeekHarnessCommand(context, viewProvider, runChat);

  // ── Session memory: restore previous session on startup ────────────
  initOrRestoreSession();
}

export function deactivate(): void { /* bridge 生命周期由用户管理 */ }
