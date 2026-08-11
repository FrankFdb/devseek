import * as vscode from 'vscode';
import * as nodePath from 'path';
import { chat, relogin, readWorkspaceFile, ensureBridgeRunning, setBridgeExtensionRoot } from './bridge-client';
import { createProviderStatusBar, getActiveProvider, getActiveProviderType, getProviderConfigService, promptUpdateApiKey } from './llm/provider-router';
import { type ChatMessage } from './llm/types';
import {
  getProjectRules,
  invalidateProjectRulesCache,
  getProjectMemorySync,
  assembleProjectRulesAndMemoryContext,
} from './project-rules';
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
import { getAgentTaskDisplayTarget, type AgentTask } from './agent-task-decomposer';
import type { AgentLoopResult } from './agent/loop-types';
import { createAgentHostToolCallbacks } from './agent/agent-host-tools';
import { getTaskWorkspaceRootFsPath, resolveWorkspaceFileUri } from './workspace-roots';
import { createVscodeMcpManager, initializeWorkspaceMcp } from './mcp/vscode-mcp-runtime';
import type { AgentFileWriteContext } from './app/agent-file-write-policy';
import { recoverApplyFailureIfPossible } from './app/apply-failure-recovery-service';
import { responseClaimsStatusOk, shouldRunClosedLoopRepair } from './app/agentic-repair-service';
import { runClosedLoopRepair } from './app/closed-loop-repair-runner';
import { runLocalExecutionChatIfPossible } from './local-execution-chat-runner';
import { TerminalPermissionCoordinator } from './app/terminal-permission-coordinator';
import { ChatRouteController } from './app/chat-controller';
import { decideAgentTurnRoute } from './app/agent-turn-routing-service';
import { resolveSemanticRouteDecision } from './app/semantic-route-service';
import { ChatSessionTurnService } from './app/chat-session-turn-service';
import { migrateLegacyDeepseekConfiguration } from './app/config-migration-service';
import { buildPreExecutionInteraction } from './app/interaction-service';
import { buildLocalAttachmentContextPrompt } from './app/local-attachment-context';
import { MemoryService } from './app/memory-service';
import { AgentKernelService } from './app/agent-kernel-service';
import { getKernelRecoveryContextFiles } from './app/coding-kernel-recovery';
import { projectCodingKernelCheckpointResume } from './app/coding-kernel-route-decision';
import { ActiveChatRunCoordinator, type ActiveChatRunHandle } from './app/active-chat-run-coordinator';
import { productCodingKernelExecutor } from './product-coding-kernel-executor';
import { createDevSeekRunContext } from './app/run-context';
import { createAgentCheckpointCallback } from './app/agent-checkpoint-callback';
import { guardNonAgentResponse } from './app/non-agent-response-guard';
import type { AgentChatRequest } from './app/agent-protocol';
import { createAgentApplicationBridgeAdapter, EvidenceAwareChatRouter } from './app/evidence-aware-chat-router';
import { createEvidenceAwareMcpToolCallFactory } from './app/evidence-aware-mcp-tool-call';
import { recordApplyWorkflowEvidence } from './app/workflow-run-evidence-adapter';
import { tryPublishProjectInitTurn } from './app/project-init-service';
import { tryBuildReadOnlyInspectionResult } from './app/read-only-inspection-service';
import { buildRestoredSessionLlmHistory, buildSessionLoadedPayload, stripSessionContextPrefix } from './app/session-display-service';
import { buildSessionBootstrapState } from './app/session-bootstrap-service';
import { SessionService, type SessionMeta } from './app/session-service';
import { SessionContinuationProjector } from './app/session-continuation-projector';
import { RunChangedPathRecorder } from './app/run-changed-path-recorder';
import {
  appendSessionContinuationContext,
  shouldResumeCheckpointFromPrompt,
} from './app/session-continuation';
import {
  ScopedTaskCheckpointService,
  type TaskCheckpointRecord,
} from './app/task-checkpoint-store';
import { buildProviderRecoveryCheckpointRecord, isCheckpointableProviderRecoveryError } from './app/provider-recovery-checkpoint';
import { buildProviderRecoveryDisplay, ProviderRecoveryService } from './app/provider-recovery-service';
import { resolveProviderStatusResponse } from './app/provider-status-service';
import { PendingEditCoordinator } from './pending-edit-coordinator';
import { recordTrackedChatHistory as recordTrackedChatHistoryState } from './app/chat-history-tracker';
import { createDirectVisibleResponsePublisher } from './app/direct-visible-response-service';
import type { AgentSessionState } from './app/agent-session-context';
import { emitResponseMeta, injectFileHintsIntoResponse } from './ui/generated-artifact-ui';
import { createAgentFileWriteConstraintResolver } from './ui/agent-file-write-constraint-resolver';
import { postWebviewEvent, postWebviewMessage } from './ui/webview-event-adapter';
import { AgentTurnPresenter } from './ui/agent-turn-presenter';
import { DeepSeekViewProvider } from './ui/deepseek-view-provider';
import type { WebviewInboundMessage } from './ui/webview-protocol';
import { recordRealPluginHarnessProgress, registerRealPluginDeepSeekHarnessCommand } from './ui/real-plugin-harness';
import { buildAgentRunDisplayProfile } from './agent/agent-run-display';
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
const activeChatRunCoordinator = new ActiveChatRunCoordinator();
let lastConversationFiles: string[] = [];
let lastAnalysisText = '';
/** Workspace-relative paths of files created/modified by the last agent run */
let lastAgentChangedPaths: string[] = [];
/** DevSeek 当前 session 的显式对话历史；Bridge 网页侧历史不作为上下文来源。 */
let nonBridgeChatHistory: ChatMessage[] = [];
// ── Session memory (L1a/L1b + L2) ─────────────────────────────────────────
/** VS Code ExtensionContext，用于 workspaceState 持久化 */
let extContext: vscode.ExtensionContext;
let agentCheckpointService: ScopedTaskCheckpointService<AgentTask>;
/** L2: 文件路径字典 basename/relPath → absPath，跨轮次不清空 */
const sessionRecentFiles = new Map<string, string>();
/** 当前活跃的 session ID */
let activeSessionId = '';
const sessionContinuationProjector = new SessionContinuationProjector({
  getAgentState: () => loadAgentSessionState(),
  getLastAgentChangedPaths: () => lastAgentChangedPaths,
  getRecentFilePaths: () => sessionRecentFiles.values(),
  getHistory: () => nonBridgeChatHistory,
});
const runChangedPathRecorder = new RunChangedPathRecorder({
  replaceLastChangedPaths: (paths) => { lastAgentChangedPaths = paths; },
  registerRecentFile: registerToMemory,
  emitFilesCoChanged: (paths) => {
    emitLearningEvent({ type: 'files_cochanged', paths, sessionId: activeSessionId });
  },
});
const mcpManager = createVscodeMcpManager();
const resolveAgentFileWriteConstraint = createAgentFileWriteConstraintResolver(terminalPermissionCoordinator);
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

function loadAgentSessionState(sessionId = activeSessionId): AgentSessionState | undefined {
  if (!sessionId) return undefined;
  return getSessionService()?.getSessionAgentState<AgentSessionState>(sessionId);
}

function saveAgentSessionState(state: AgentSessionState | null, sessionId = activeSessionId): void {
  if (!sessionId) return;
  getSessionService()?.saveSessionAgentState(sessionId, state);
}

function restoreLastAgentPathsFromSession(sessionId = activeSessionId): void {
  const state = loadAgentSessionState(sessionId);
  if (state?.changedPaths?.length) {
    lastAgentChangedPaths = state.changedPaths.slice(0, 12);
    return;
  }
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const files = getSessionService()?.loadSessionState(sessionId).files ?? {};
  lastAgentChangedPaths = Object.values(files)
    .map(abs => relPathFromWorkspace(wsRoot, abs))
    .filter((rel): rel is string => Boolean(rel))
    .slice(0, 10);
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
  resumeCheckpoint?: TaskCheckpointRecord<AgentTask>,
): Promise<void> {
  const promptResumeCp = shouldResumeCheckpointFromPrompt({ userDisplay, prompt, newSession, resumeFromIndex })
    ? await agentCheckpointService.loadFresh(7_200_000)
    : undefined;
  if (promptResumeCp) {
    if (!suppressUserMessage) webview.postMessage({ type: 'userMessage', text: userDisplay, prompt, images });
    webview.postMessage({ type: 'agentCheckpointCleared' });
    await runChat(webview, promptResumeCp.displayPrompt, promptResumeCp.userPrompt, false, promptResumeCp.mode, undefined, false, promptResumeCp.startFromIndex, promptResumeCp.allTasks, undefined, intentConfirmed, true, promptResumeCp);
    return;
  }

  const activeRun = activeChatRunCoordinator.startRun({
    reason: 'superseded-by-new-run',
    source: 'run-chat-start',
  });
  try {
    await runActiveChat(activeRun, webview, userDisplay, prompt, newSession, mode, files, forceNoAgent, resumeFromIndex, resumeTasks, images, intentConfirmed, suppressUserMessage, resumeCheckpoint);
  } finally {
    activeRun.finish();
  }
}

async function runActiveChat(
  activeRun: ActiveChatRunHandle,
  webview: vscode.Webview,
  userDisplay: string,
  prompt: string,
  newSession: boolean,
  mode: 'fast' | 'r1' | undefined,
  files: string[] | undefined,
  forceNoAgent: boolean | undefined,
  resumeFromIndex: number | undefined,
  resumeTasks: AgentTask[] | undefined,
  images: string[] | undefined,
  intentConfirmed: boolean,
  suppressUserMessage: boolean,
  resumeCheckpoint: TaskCheckpointRecord<AgentTask> | undefined,
): Promise<void> {
  const chatSignal = activeRun.signal;
  const consumeAgentSteer = (): string[] => activeRun.consumeAgentSteer();

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

  if (tryPublishProjectInitTurn({
    userDisplay,
    prompt,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    publisher: directVisibleResponsePublisher,
    images,
    newSession,
    suppressUserMessage,
  })) return;

  const {
    decision: initialRouteDecision,
    semanticContext: turnSemanticContext,
  } = decideAgentTurnRoute(chatRouteController, {
    newSession,
    userDisplay,
    prompt,
    files: effectiveFiles,
    agentEnabled: vscode.workspace.getConfiguration('devseek').get<boolean>('agentEnabled', true),
    forceNoAgent,
    intentConfirmed,
    loadPreviousSemanticContract: () => loadAgentSessionState()?.semanticContract,
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
    routedIntent: initialRouteDecision.intent,
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
    return;
  }

  // If this is the first user message of a restored session (history was not pre-loaded
  // on startup to avoid cross-session bleed), lazily inject the saved summary now so the
  // LLM has the right context. This only fires once: after first injection, history is
  // non-empty and this branch is skipped going forward.
  if (!newSession && nonBridgeChatHistory.length === 0 && activeSessionId && extContext) {
    const stored = getSessionService()?.loadSessionState(activeSessionId);
    nonBridgeChatHistory = buildRestoredSessionLlmHistory(stored?.history ?? [], stored?.summary ?? '');
  }

  const activeEditorContextPath = getActiveEditorContextPath();
  const continuationPromptScope = detectWorkspacePathScope(prompt, effectiveFiles, activeEditorContextPath);
  const continuationWorkspaceRoot = getTaskWorkspaceRootFsPath(prompt, [
    ...effectiveFiles,
    ...(continuationPromptScope.promptDir ? [continuationPromptScope.promptDir] : []),
  ], activeEditorContextPath) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const initialSessionProjection = sessionContinuationProjector.project({
    workspaceRoot: continuationWorkspaceRoot,
    currentPrompt: userDisplay || prompt,
    intent: initialRouteDecision.intent,
    currentFilePaths: effectiveFiles,
    newSession,
  });
  let sessionContinuationNote = '';
  if (!newSession && !userExplicitlyAttachedFiles && effectiveFiles.length === 0) {
    const continuationFiles = initialSessionProjection.restoreFiles;
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
    semanticContext: turnSemanticContext,
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

    const agentWorkspaceRoot = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath)
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();
    const agentKernelRun = agentKernelService.startRun({
      workspaceRoot: agentWorkspaceRoot,
      source: 'vscode-extension.agent',
      userPrompt: prompt,
      semanticContract: intent.semanticContract,
      semanticRelatedPaths: effectiveFiles,
      sessionId: activeSessionId,
      mode,
      traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
      contextRefs: effectiveFiles.map(file => ({
        kind: 'file',
        uri: file,
      })),
    });
    const agentSemanticContract = agentKernelRun.semanticContract;
    if (!activeRun.bindAgentKernelRun(agentKernelRun)) return;
    const agentRunContext = agentKernelRun.runContext;
    const agentPresenter = new AgentTurnPresenter(webview, pendingEditCoordinator, agentRunContext);
    agentPresenter.beginResponse({ prompt, sessionContinuationNote, autoDiscoveredNote });
    const { postStatus: postAgent, postToolActivity: postAgentToolActivity } = agentPresenter;
    workflowRunContext = agentRunContext;
    const agentTraceRunId = agentRunContext.runId;
    const agentTraceWorkspaceRoot = agentRunContext.workspaceRoot;
    // L1a: filled inside try/catch, used after to persist agent turn in session history
    let agentHistoryText = '';
    let loopResult: AgentLoopResult | undefined;
    const agentChangedPathScope = runChangedPathRecorder.openScope(agentWorkspaceRoot);

    try {
      const kernelRoute = agentKernelService.decideExecutionRoute({
        checkpoint: projectCodingKernelCheckpointResume(resumeCheckpoint, lastAnalysisText),
      });
      {
        const agWsRootPath = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath);
        const agWsRoot = agWsRootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const kernelRecovery = kernelRoute.reason === 'checkpoint-resume'
          ? kernelRoute.recovery
          : undefined;
        const agSessionContext = sessionContinuationProjector.project({
          workspaceRoot: agWsRoot,
          currentPrompt: userDisplay || prompt,
          intent,
          currentFilePaths: effectiveFiles,
          newSession,
        }).contextText;
        const agDisplayProfile = buildAgentRunDisplayProfile(prompt);
        const contextFiles = [...new Set([
          ...effectiveFiles,
          ...(kernelRecovery ? getKernelRecoveryContextFiles(kernelRecovery, agWsRoot) : []),
        ])];
        const activeEditorPath = activeEditorContextPath ?? '';
        const agMemoryRelatedPaths = [
          ...contextFiles,
          ...pathResolutionHints,
          activeEditorPath,
        ].filter((pathValue): pathValue is string => Boolean(pathValue));
        if (kernelRecovery) {
          const remaining = kernelRecovery.tasks.length - kernelRecovery.startFromIndex;
          postAgent({
            type: 'agentStatus',
            phase: 'plan',
            state: 'completed',
            title: `断点续传：继续 ${remaining} 个未完成任务`,
            taskTotal: remaining,
            detail: kernelRecovery.tasks.slice(kernelRecovery.startFromIndex).map((task, index) => (
              `${index + 1}. [${task.action}] ${getAgentTaskDisplayTarget(task)} — ${task.desc}`
            )).join('\n'),
            progressTitle: '恢复任务上下文',
            progressDetail: `已完成 ${kernelRecovery.startFromIndex} 个，继续剩余 ${remaining} 个。`,
          });
        } else {
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
        }
        const agResult = loopResult = await agentKernelService.executeCanonicalTask({
          userPrompt: prompt,
          semanticContract: agentKernelRun.semanticContract,
          contextFiles,
          workspaceRoot: agWsRoot,
          providerType: getActiveProviderType(),
          mode,
          callbacks: {
            executionMode: workflow.toolPolicyMode,
            traceRunId: agentTraceRunId,
            traceWorkspaceRoot: agentTraceWorkspaceRoot,
            traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
            onTraceEvidenceError: error => agentRunContext?.reportEvidenceIssue(error),
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
            ...agentPresenter.runtimeObservers,
            onAppliedChange: async (c) => {
              agentChangedPathScope.add([c.path]);
              await pendingEditCoordinator.registerChange(webview, c);
            },
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
            onResolveFileWriteConstraint: (absPath: string, context?: AgentFileWriteContext) => resolveAgentFileWriteConstraint({
              webview,
              absPath,
              context,
              workspaceRoot: agWsRoot,
              toolPolicy,
              trace: agentRunContext.childTrace('vscode-extension.file-write-policy'),
            }),
            mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
            onPrepareMcpToolCall: mcpManager.hasMcpTools
              ? createEvidenceAwareMcpToolCall(agentRunContext, webview, chatSignal)
              : undefined,
            onPrepareTerminalCommand: async (command, workdir) => {
              return terminalPermissionCoordinator.prepareToolExecutionWithPermission({
                webview,
                command,
                workdir,
                workspaceRoot: agWsRoot,
                mode: intent.mode,
                toolPolicy,
                traceRunId: agentTraceRunId,
                traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
                onTraceEvidenceError: error => agentRunContext?.reportEvidenceIssue(error),
              });
            },
            onValidationCommand: terminalPermissionCoordinator.createValidationCommandRunner({
              webview,
              workspaceRoot: agWsRoot,
              mode: intent.mode,
              toolPolicy,
              traceRunId: agentTraceRunId,
              traceEvidenceParticipantToken: agentRunContext.evidenceParticipantToken,
              onTraceEvidenceError: error => agentRunContext?.reportEvidenceIssue(error),
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
            onTaskCheckpoint: async (firstUnfinishedIndex, remainingTasks, reason = 'progress', canonicalCheckpoint) => {
              agentRunContext?.recordCheckpoint(firstUnfinishedIndex, remainingTasks.length, reason);
              return createAgentCheckpointCallback({
                userPrompt: prompt,
                displayPrompt: userDisplay,
                mode,
                workspaceRoot: agWsRoot,
                sessionId: activeSessionId,
                save: agentCheckpointService.save,
                postMessage: message => { webview.postMessage(message); },
              })(firstUnfinishedIndex, remainingTasks, reason, canonicalCheckpoint);
            },
            autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
          },
          sessionContextText: agSessionContext,
          workflowMode: workflow.toolPolicyMode,
          memoryRelatedPaths: agMemoryRelatedPaths,
          recovery: kernelRecovery,
        });
        agentChangedPathScope.add(agResult.changedPaths);
        const agRunChangedPaths = agentChangedPathScope.commit();
        const agSettlement = agentKernelRun.settleAgentLoopResult(agResult, agRunChangedPaths);
        const agDurablyCompleted = agSettlement.completed;
        if (agSettlement.refused) agentPresenter.postSettlementRefusal();
        const agChangedDetails = agRunChangedPaths.length > 0
          ? '\n**涉及文件（workspace 相对路径）：**\n' + agRunChangedPaths.map(p => `  - ${p}`).join('\n')
          : '';
        agentHistoryText = agResult.historyText
          || `**[Agentic] ${agDurablyCompleted ? '已完成' : '未完成'}（${agResult.tasksTotal} 轮）**${agChangedDetails}`;
        if (agSettlement.refused) {
          agentHistoryText = `**[Agentic] 未完成：运行证据结算失败**\n\n${agentHistoryText}`;
        }
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: agRunChangedPaths.slice(0, 12),
          completed: agDurablyCompleted,
          savedAt: Date.now(),
          semanticContract: agentSemanticContract,
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
        activeRun.clearAgentKernelRun(agentKernelRun);
        return;
      }

    } catch (e) {
      agentChangedPathScope.add(loopResult?.changedPaths ?? []);
      const failedRunChangedPaths = agentChangedPathScope.commit();
      const msg = (e as Error).message;
      if (activeRun.signal.aborted) {
        const cancellationData = {
          ...(activeRun.cancellationData() ?? {}),
          changedPaths: failedRunChangedPaths,
        };
        postAgent({ type: 'agentStatus', phase: 'done', state: 'skipped', title: 'Agent run cancelled' });
        agentHistoryText = agentHistoryText || '[Agent run cancelled]';
        saveAgentSessionState({
          lastUserPrompt: userDisplay,
          lastSummary: agentHistoryText,
          changedPaths: failedRunChangedPaths.slice(0, 12),
          completed: false,
          savedAt: Date.now(),
          semanticContract: agentSemanticContract,
        });
        agentKernelRun.cancelRun(cancellationData);
      } else {
        const recovery = new ProviderRecoveryService().classify({
          providerType: getActiveProviderType(),
          message: msg,
          code: msg,
          signals: [msg],
        });
        if (recovery.kind !== 'Unknown' && isCheckpointableProviderRecoveryError(e)) {
          const savedAt = Date.now();
          const wsRootFsPath = getTaskWorkspaceRootFsPath(prompt, pathResolutionHints, activeEditorContextPath)
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? '';
          const recoveryCheckpoint = buildProviderRecoveryCheckpointRecord({
            error: e,
            prompt,
            displayPrompt: userDisplay,
            mode,
            files: effectiveFiles,
            workspaceRootFsPath: wsRootFsPath,
            savedAt,
            sessionId: activeSessionId || 'provider-recovery',
            recoveryKind: recovery.kind,
            pauseReason: recovery.pauseReason,
          });
          await agentCheckpointService.save(recoveryCheckpoint);
          webview.postMessage({
            type: 'agentCheckpointAvailable',
            resumeTaskIndex: 0,
            totalTasks: recoveryCheckpoint.allTasks.length,
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
          changedPaths: failedRunChangedPaths.slice(0, 12),
          completed: false,
          savedAt: Date.now(),
          semanticContract: agentSemanticContract,
        });
        agentKernelRun.failRun({
          reason: 'agent-error',
          changedPaths: failedRunChangedPaths,
        });
      }
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

    webview.postMessage({ type: 'endResponse' });
    activeRun.clearAgentKernelRun(agentKernelRun);
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
  let currentChatRunChangedPaths: string[] = [];
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
    const chatRunChangedPaths = runChangedPathRecorder.openScope(chatWorkspaceRoot);
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
      onTraceEvidenceError: error => chatRunContext?.reportEvidenceIssue(error),
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
      const sessionContextForChat = sessionContinuationProjector.project({
        workspaceRoot: workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        currentPrompt: userDisplay || prompt,
        intent,
        currentFilePaths: effectiveFiles,
        newSession,
      }).contextText;
      if (sessionContextForChat) {
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
        providerType: getActiveProviderType(),
        traceRunId: chatRunContext.runId,
        traceEvidenceParticipantToken: chatRunContext.evidenceParticipantToken,
        onTraceEvidenceError: error => chatRunContext?.reportEvidenceIssue(error),
        consumeAgentSteer,
        registerAppliedChange: (change) => pendingEditCoordinator.registerChange(webview, change),
        registerToMemory,
        sessionRecentFiles,
        mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
        onPrepareMcpToolCall: mcpManager.hasMcpTools
          ? createEvidenceAwareMcpToolCall(chatRunContext, webview, chatSignal)
          : undefined,
        signal: chatSignal,
        sessionId: activeSessionId,
        onChangedPaths: (paths) => { chatRunChangedPaths.add(paths); },
      });
      if (localExecutionResult.handled) {
        const requestedStatus = localExecutionResult.status ?? 'failed';
        currentChatRunChangedPaths = chatRunChangedPaths.commit();
        const settlementStatus = terminalPermissionCoordinator.completeRunContext(chatRunContext, requestedStatus, {
          reason: 'local-execution-handled',
          terminalOutcome: requestedStatus,
          changedPaths: currentChatRunChangedPaths,
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
      onTraceEvidenceError: error => chatRunContext?.reportEvidenceIssue(error),
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
          onTraceEvidenceError: error => chatRunContext?.reportEvidenceIssue(error),
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
        chatRunChangedPaths.add([change.path]);
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
          onTraceEvidenceError: error => chatRunContext?.reportEvidenceIssue(error),
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
        onAppliedChange: async (change) => {
          chatRunChangedPaths.add([change.path]);
          await pendingEditCoordinator.registerChange(webview, change);
        },
      });
      const finalApply = recoveredApply ?? firstApply;
      chatRunChangedPaths.add(finalApply.changedPaths);
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
            onTraceEvidenceError: request.onTraceEvidenceError ?? (error => chatRunContext?.reportEvidenceIssue(error)),
          }),
          registerAppliedChange: async (change) => {
            chatRunChangedPaths.add([change.path]);
            await pendingEditCoordinator.registerChange(webview, change);
          },
          getSessionId: () => activeSessionId,
          postVisibleDelta: (text) => { postWebviewMessage(webview, { type: 'delta', text }); },
          validationCommandRunner: chatValidationCommandRunner,
        });
      }
    }
    currentChatRunChangedPaths = chatRunChangedPaths.commit();
    const chatSettlementStatus = terminalPermissionCoordinator.completeRunContext(chatRunContext, 'completed', {
      intent: intent.kind,
      workflow: workflow.kind,
      changedPaths: currentChatRunChangedPaths.slice(0, 12),
    });
    if (chatSettlementStatus !== 'completed') {
      throw new Error('运行证据结算失败；本轮回复和文件候选不能标记为完成。');
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (chatRunContext) terminalPermissionCoordinator.completeRunContext(chatRunContext, 'failed', {
      reason: 'chat-error',
      message: msg,
      changedPaths: currentChatRunChangedPaths.slice(0, 12),
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
    // ActiveChatRunCoordinator releases cancellation and steer state in runChat.
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
    getFreshSummary: (sessionId) => getSessionService()?.getSessionSummary(sessionId),
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
  if (!activeSessionId) return;
  if (nonBridgeChatHistory.length === 0) return;
  const sessionService = getSessionService();
  if (!sessionService) return;
  const history = stripSessionContextPrefix(nonBridgeChatHistory).slice(-40);
  sessionService.saveSessionHistory(activeSessionId, history);
  const filesMap = Object.fromEntries(sessionRecentFiles);
  sessionService.saveSessionFiles(activeSessionId, filesMap);
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
  if (!activeSessionId) return;
  getSessionService()?.saveSessionFiles(activeSessionId, Object.fromEntries(sessionRecentFiles));
}

async function compactAndSaveHistory(history: ChatMessage[], sessionId: string): Promise<void> {
  const sessionService = getSessionService();
  if (history.length < 4 || !sessionId || !sessionService) return;
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
    sessionService.saveSessionSummary(sessionId, summary);
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
  const sessionService = getSessionService();
  if (!id || !sessionService) return;
  saveCurrentSession();
  activeSessionId = id;
  sessionService.setActiveSessionId(id);
  const state = sessionService.loadSessionState(id);
  sessionRecentFiles.clear();
  for (const [key, value] of Object.entries(state.files)) sessionRecentFiles.set(key, value);
  const loadedSummary = state.summary;
  const loadedHistory = state.history;
  nonBridgeChatHistory = buildRestoredSessionLlmHistory(loadedHistory, loadedSummary);
  lastConversationFiles = [];
  lastAnalysisText = state.analysisText;
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
    cancelActiveRun: (data) => { activeChatRunCoordinator.cancelActiveRun(data); },
    pushAgentSteer: (text) => activeChatRunCoordinator.pushAgentSteer(text),
    getActiveSessionPayload: () => {
      if (!activeSessionId) return undefined;
      const state = getSessionService()?.loadSessionState(activeSessionId);
      const history = state?.history ?? [];
      const summary = state?.summary ?? '';
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

  void initializeWorkspaceMcp(mcpManager);
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
