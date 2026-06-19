import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import { chat, ping, cancel, relogin, status, readWorkspaceFile, ensureBridgeRunning, preattachFiles, setBridgeExtensionRoot } from './bridge-client';
import { createProviderStatusBar, getActiveProvider, getActiveProviderType, promptUpdateApiKey } from './llm/provider-router';
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
  type ApplyWorkflowResult,
} from './workspace-applier';
import { detectWorkspacePathScope, isGeneratedArtifactAllowedForPrompt } from './workspace/path-resolver';
import { parseGeneratedArtifacts, type GeneratedArtifact } from './generated-file-parser';
import {
  buildExecutionRepairPrompt,
  buildLocalExecutionFailureMessage,
  buildLocalExecutionSuccessMessage,
  isRepeatExecutionRequest,
  LocalExecutionPlan,
  planLocalExecution,
  runLocalExecution,
  shouldRepairLocalExecutionFailure,
  shouldPreferLocalExecution,
} from './execution-planner';
import { AutoApplyPolicy, shouldAutoApplyFromResponse } from './intent-router';
import { clearSessionHabits, lookupLearnedIntent, recordIntentOutcome } from './intent-learner';
import {
  initAgentLearner, clearLearnerSession, emitLearningEvent,
  getCommandHints, getErrorFixHint, fingerprintError,
} from './agent-learner';
import { decomposeTask, inferTasksFromFiles } from './agent-task-decomposer';
import { runAgentLoop, runAgenticLoop, AgentStatusMessage, extractAnalysisFindings } from './agent-loop';
import { getWorkspaceRootFsPath, resolveWorkspaceFileUri } from './workspace-roots';
import { McpManager } from './mcp/client';
import { fenceLangForFile } from './utils';
import { DiffDecorationManager, type DiffRecordInfo } from './diff-decorator';
import { isFileProtected } from './protected-files';
import { decideToolPermission, type ToolPolicy } from './app/permission-service';
import { decideTerminalCommandPermission, type TerminalCommandRiskClass } from './app/terminal-command-policy';
import { ChatRouteController } from './app/chat-controller';
import { buildPreExecutionInteraction } from './app/interaction-service';
import { buildLocalAttachmentContextPrompt } from './app/local-attachment-context';
import { MemoryService } from './app/memory-service';
import { isProjectInitRequest, ProjectInitService, renderProjectInitDraftMarkdown } from './app/project-init-service';
import { SessionService, type SessionMeta } from './app/session-service';
import {
  appendSessionContinuationContext,
  shouldInjectSessionContinuationForIntent,
  shouldRestoreSessionFiles,
} from './app/session-continuation';
import {
  allHunksResolved,
  computePendingHunks,
  PendingEditService,
  renderPendingContentFromHunks,
  type PendingEditHunk,
} from './app/pending-edit-service';
import type { WebviewInboundMessage } from './ui/webview-protocol';
import { stripToolCallBlocks } from './agent/fake-tool-parser';
import {
  buildLocalExecutionAgentCallbacks,
  buildLocalExecutionAgentRepairPrompt,
  buildLocalExecutionRepairTasks,
  relPathFromRepairWorkspace,
} from './local-execution-repair';
import {
  DEFAULT_SOURCE_FILE_RE,
  shouldIncludeDiscoveredSourceFile,
  shouldSkipDiscoveryDir,
} from './file-discovery';

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

interface PendingEditRecord {
  id: string;
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
  hunks: PendingEditHunk[];
  createdAt: number;
}

// ----------------------------------------------------------------
// Sidebar chat view state (single-level entry, no launcher page)
// ----------------------------------------------------------------
let extensionUriGlobal: vscode.Uri;
let viewProvider: DeepSeekViewProvider;
let lastLocalExecutionPlan: LocalExecutionPlan | undefined;
const pendingEdits = new PendingEditService<PendingEditRecord>();
const chatRouteController = new ChatRouteController();
/** G-2: pending terminal confirm Promises keyed by confirmId */
const pendingTerminalConfirms = new Map<string, (allow: boolean, alwaysAllow?: boolean) => void>();
/** Session-scoped terminal classes explicitly trusted by the user. */
const trustedTerminalRiskClasses = new Set<TerminalCommandRiskClass>();
/** G-5: Keep/Undo status bar item (shown when active file has pending AI edits) */
let keepUndoStatusBar: vscode.StatusBarItem | undefined;
/** Inline editor decorations + CodeLens for pending AI edits (Copilot-parity) */
let diffDecoManager: DiffDecorationManager;
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
const AGENT_CODE_FILE_RE = /(?:^|\/)(?:Makefile|CMakeLists\.txt)$|\.(cpp|c|h|hpp|cc|cxx|ts|tsx|js|jsx|mjs|py|rs|go|java|cs|rb|php|swift|kt|scala|dart|lua|r)$/i;
// P3-5: MCP manager (singleton; initialized lazily in activate)
const mcpManager = new McpManager();

function getSessionService(): SessionService | undefined {
  return extContext ? new SessionService(extContext.workspaceState) : undefined;
}

const CONFIG_KEYS_TO_MIGRATE = [
  'serverPort',
  'newSessionPerRequest',
  'language',
  'maxContextLines',
  'requestTimeoutMs',
  'autoFixRounds',
  'autoApplyPolicy',
  'localExecutionFirst',
  'executionApproval',
  'cppValidationPolicy',
  'completionEnabled',
  'completionTriggerDelay',
  'contextTokenBudget',
  'generatedContentDisplayMode',
  'workingCopyStyle',
  'provider',
  'apiKey',
  'model',
  'openaiCompatBaseUrl',
  'openaiCompatApiKey',
  'openaiCompatModel',
  'autopilotMode',
  'autoInjectActiveEditor',
  'agentEnabled',
  'maxAgentRounds',
  'editAutoAcceptDelay',
  'protectedFiles',
] as const;

async function migrateLegacyDeepseekConfiguration(): Promise<void> {
  const legacy = vscode.workspace.getConfiguration('deepseek');
  const current = vscode.workspace.getConfiguration('devseek');

  for (const key of CONFIG_KEYS_TO_MIGRATE) {
    const oldValue = legacy.inspect<unknown>(key);
    if (!oldValue) continue;

    const newValue = current.inspect<unknown>(key);
    if (newValue?.globalValue === undefined && oldValue.globalValue !== undefined) {
      await current.update(key, oldValue.globalValue, vscode.ConfigurationTarget.Global);
    }
    if (newValue?.workspaceValue === undefined && oldValue.workspaceValue !== undefined) {
      await current.update(key, oldValue.workspaceValue, vscode.ConfigurationTarget.Workspace);
    }
  }
}

// ── Agent task checkpoint (断点续传) ────────────────────────────────────────
/** workspaceState key for persisting the interrupted-task checkpoint */
const CHECKPOINT_KEY = 'devseek.agentTaskCheckpoint';
/** Shape of the persisted checkpoint */
interface AgentTaskCheckpoint {
  userPrompt: string;
  displayPrompt: string;
  mode: 'fast' | 'r1' | undefined;
  wsRootFsPath: string;
  allTasks: import('./agent-task-decomposer').AgentTask[];
  startFromIndex: number;       // the task that was interrupted (re-run from here)
  completedCount: number;       // tasks already done before interruption
  savedAt: number;
  sessionId: string;
}

interface AgentSessionState {
  lastUserPrompt: string;
  lastSummary: string;
  changedPaths: string[];
  completed: boolean;
  savedAt: number;
}

/** Save or clear the agent task checkpoint. Pass null to clear (completed). */
function saveAgentCheckpoint(data: AgentTaskCheckpoint | null): void {
  if (!extContext) return;
  extContext.workspaceState.update(CHECKPOINT_KEY, data ?? undefined);
}

/** Load the checkpoint if one exists for the current session. */
function loadAgentCheckpoint(): AgentTaskCheckpoint | undefined {
  if (!extContext) return undefined;
  return extContext.workspaceState.get<AgentTaskCheckpoint>(CHECKPOINT_KEY);
}

function normalizeConversationFiles(files?: string[]): string[] {
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of files) {
    const value = (item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizePendingEditPath(pathValue: string): string {
  const raw = (pathValue || '').trim();
  if (!raw) return '';
  let normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const root = folder.uri.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === root) return '';
    if (normalized.startsWith(root + '/')) {
      normalized = normalized.slice(root.length + 1);
      break;
    }
  }
  return normalized.replace(/^\.\//, '');
}

function estimateLineDelta(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = (oldContent || '').split('\n').length;
  const newLines = (newContent || '').split('\n').length;
  return {
    added: Math.max(0, newLines - oldLines),
    removed: Math.max(0, oldLines - newLines),
  };
}

function hasMeaningfulEdit(oldContent: string, newContent: string): boolean {
  const oldNorm = (oldContent || '').replace(/\r\n/g, '\n');
  const newNorm = (newContent || '').replace(/\r\n/g, '\n');
  if (oldNorm === newNorm) return false;

  const oldTrimmed = oldNorm.endsWith('\n') ? oldNorm.slice(0, -1) : oldNorm;
  const newTrimmed = newNorm.endsWith('\n') ? newNorm.slice(0, -1) : newNorm;
  return oldTrimmed !== newTrimmed;
}

async function applyPendingRecordSnapshot(record: PendingEditRecord): Promise<void> {
  const target = resolveWorkspaceFileUri(record.path, lastConversationFiles);
  if (!target) return;
  const content = renderPendingContentFromHunks(record);
  const shouldDelete = !record.existed && content.length === 0;

  if (shouldDelete) {
    try {
      await vscode.workspace.fs.delete(target, { useTrash: false });
    } catch {
      // Ignore delete failures when the file does not exist.
    }
    return;
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(nodePath.dirname(target.fsPath)));
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
}

function resolvePendingEditId(editId?: string, path?: string): string | undefined {
  if (editId && pendingEdits.has(editId)) return editId;
  if (!path) return undefined;
  const wanted = normalizePendingEditPath(path);
  let candidates = Array.from(pendingEdits.values())
    .filter((record) => normalizePendingEditPath(record.path) === wanted)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (candidates.length === 0) {
    const wantedBase = nodePath.basename(wanted);
    const baseMatches = Array.from(pendingEdits.values())
      .filter((record) => nodePath.basename(normalizePendingEditPath(record.path)) === wantedBase)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (baseMatches.length === 1) candidates = baseMatches;
  }
  return candidates[0]?.id;
}

/** G-5: Refresh the Keep/Undo status bar based on the currently active editor. */
function updateKeepUndoBar(editor?: vscode.TextEditor): void {
  if (!keepUndoStatusBar) return;
  if (!editor) { keepUndoStatusBar.hide(); return; }
  const fsPath = editor.document.uri.fsPath;
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const relPath = fsPath.startsWith(wsRoot + '/') ? fsPath.slice(wsRoot.length + 1) : nodePath.basename(fsPath);
  const hasPending = relPath ? Array.from(pendingEdits.values()).some(r => r.path === relPath) : false;
  if (hasPending) {
    keepUndoStatusBar.text = '$(check) Keep  $(discard) Undo';
    keepUndoStatusBar.tooltip = `保留或撤销对 ${nodePath.basename(relPath)} 的 AI 修改`;
    keepUndoStatusBar.show();
  } else {
    keepUndoStatusBar.hide();
  }
}

function postPendingEdits(webview: vscode.Webview): void {
  const items = Array.from(pendingEdits.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => {
      const delta = estimateLineDelta(record.oldContent, record.newContent);
      const pendingCount = record.hunks.filter((h) => h.resolution === 'pending').length;
      return {
        id: record.id,
        path: record.path,
        existed: record.existed,
        added: delta.added,
        removed: delta.removed,
        pendingHunks: pendingCount,
        hunks: record.hunks.map((hunk) => ({
          id: hunk.id,
          title: hunk.title,
          line: hunk.newStart > 0 ? hunk.newStart : hunk.oldStart,
          added: hunk.newLines.length,
          removed: hunk.oldLines.length,
          resolution: hunk.resolution,
        })),
        createdAt: record.createdAt,
      };
    })
    .filter((item) => {
      const hasDelta = (item.added || 0) > 0 || (item.removed || 0) > 0;
      const hasPending = (item.pendingHunks || 0) > 0;
      return hasDelta || hasPending;
    });
  webview.postMessage({ type: 'pendingEdits', items, total: items.length });
  updateKeepUndoBar(vscode.window.activeTextEditor);
  // Refresh Explorer file decorations (⬝ badge on pending-edit files)
  pendingEditDecorationProvider?.refresh();
}

function beginAgentRunReviewScope(webview: vscode.Webview): void {
  const staleRecords = pendingEdits.resetForNewScope();
  for (const record of staleRecords) closePendingEditDiffTabAsync(record);
  diffDecoManager?.deactivateAll();
  postPendingEdits(webview);
  webview.postMessage({ type: 'todoUpdate', items: [] });
}

function postPendingActionNotice(
  webview: vscode.Webview,
  notice: {
    action: 'keep' | 'undo';
    scope: 'file' | 'hunk' | 'all';
    path?: string;
    detail: string;
    queueTotal?: number;
  },
): void {
  webview.postMessage({ type: 'pendingActionNotice', ...notice });
}

async function registerPendingEditChange(webview: vscode.Webview, change: AppliedChangeRecord): Promise<void> {
  if (!hasMeaningfulEdit(change.oldContent, change.newContent)) {
    postPendingEdits(webview);
    return;
  }

  const normalizedPath = normalizePendingEditPath(change.path);
  const existing = Array.from(pendingEdits.values())
    .filter((record) => normalizePendingEditPath(record.path) === normalizedPath)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  let recordToShow: PendingEditRecord;
  if (existing) {
    const mergedOld = existing.oldContent;
    const mergedNew = change.newContent;
    existing.existed = existing.existed || change.existed;
    existing.newContent = mergedNew;
    existing.hunks = computePendingHunks(existing.id, mergedOld, mergedNew);
    existing.createdAt = Date.now();
    pendingEdits.set(existing.id, existing);
    recordToShow = existing;
  } else {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRecord: PendingEditRecord = {
      id,
      path: normalizedPath,
      existed: change.existed,
      oldContent: change.oldContent,
      newContent: change.newContent,
      hunks: computePendingHunks(id, change.oldContent, change.newContent),
      createdAt: Date.now(),
    };
    pendingEdits.set(id, newRecord);
    recordToShow = newRecord;
  }
  postPendingEdits(webview);
  // Inline editor decorations + CodeLens (Copilot-parity)
  diffDecoManager?.activate(recordToShow as DiffRecordInfo);
  // Auto-open the changed file in the regular editor so per-hunk Keep/Undo
  // appears beside the affected lines, matching Copilot's editor-first review.
  openPendingEditInEditor(recordToShow).catch(() => {/* silent */});
}

function keepPendingEditByPath(path: string): void {
  const id = resolvePendingEditId(undefined, path);
  if (!id) return;
  const record = pendingEdits.get(id);
  if (record) {
    closePendingEditDiffTabAsync(record);
    diffDecoManager?.deactivate(id);
    const fileUri = resolveWorkspaceFileUri(record.path, lastConversationFiles);
    if (fileUri) {
      void vscode.workspace.openTextDocument(fileUri)
        .then(doc => vscode.window.showTextDocument(doc, { preview: false }))
        .then(undefined, () => { /* silence */ });
    }
  }
  pendingEdits.delete(id);
}

function keepPendingEdit(editId?: string, path?: string): void {
  const id = resolvePendingEditId(editId, path);
  if (!id) return;
  const record = pendingEdits.get(id);
  if (record) {
    closePendingEditDiffTabAsync(record);
    diffDecoManager?.deactivate(id);
    const fileUri = resolveWorkspaceFileUri(record.path, lastConversationFiles);
    if (fileUri) {
      void vscode.workspace.openTextDocument(fileUri)
        .then(doc => vscode.window.showTextDocument(doc, { preview: false }))
        .then(undefined, () => { /* silence */ });
    }
  }
  pendingEdits.delete(id);
}

async function restorePendingEdit(record: PendingEditRecord): Promise<void> {
  const target = resolveWorkspaceFileUri(record.path, lastConversationFiles);
  if (!target) return;
  if (record.existed) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(nodePath.dirname(target.fsPath)));
    await vscode.workspace.fs.writeFile(target, Buffer.from(record.oldContent, 'utf8'));
  } else {
    try {
      await vscode.workspace.fs.delete(target, { useTrash: false });
    } catch {
      // Ignore when file already does not exist.
    }
  }
}

async function undoPendingEditByPath(path: string): Promise<void> {
  const id = resolvePendingEditId(undefined, path);
  if (!id) return;
  const record = pendingEdits.get(id);
  if (!record) return;
  closePendingEditDiffTabAsync(record);
  diffDecoManager?.deactivate(id);
  await restorePendingEdit(record);
  pendingEdits.delete(id);
}

async function undoPendingEdit(editId?: string, path?: string): Promise<void> {
  const id = resolvePendingEditId(editId, path);
  if (!id) return;
  const record = pendingEdits.get(id);
  if (!record) return;
  closePendingEditDiffTabAsync(record);
  diffDecoManager?.deactivate(id);
  await restorePendingEdit(record);
  pendingEdits.delete(id);
}

async function undoAllPendingEdits(): Promise<void> {
  const records = Array.from(pendingEdits.values()).sort((a, b) => b.createdAt - a.createdAt);
  for (const record of records) {
    closePendingEditDiffTabAsync(record);
    await restorePendingEdit(record);
  }
  pendingEdits.clear();
  diffDecoManager?.deactivateAll();
}

function resolvePendingHunk(editId: string | undefined, path: string | undefined, hunkId: string | undefined): { record?: PendingEditRecord; hunk?: PendingEditHunk } {
  const id = resolvePendingEditId(editId, path);
  if (!id) return {};
  const record = pendingEdits.get(id);
  if (!record) return {};
  if (!hunkId) return { record };
  const hunk = record.hunks.find((item) => item.id === hunkId);
  return { record, hunk };
}

function keepPendingHunk(editId?: string, path?: string, hunkId?: string): void {
  const { record, hunk } = resolvePendingHunk(editId, path, hunkId);
  if (!record || !hunk) return;
  hunk.resolution = 'kept';
  if (allHunksResolved(record)) {
    pendingEdits.delete(record.id);
    diffDecoManager?.deactivate(record.id);
  } else {
    diffDecoManager?.refresh(record as DiffRecordInfo);
    diffDecoManager?.revealNextPendingHunk(record as DiffRecordInfo);
  }
}

// ---------------------------------------------------------------
// P-DEC: FileDecorationProvider — show ⬝ badge on pending-edit
// files in Explorer + Source Control (Copilot § indicator pattern)
// ---------------------------------------------------------------
let pendingEditDecorationProvider: PendingEditDecorationProvider | undefined;

class PendingEditDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._emitter.event;

  refresh(uris?: vscode.Uri[]): void {
    this._emitter.fire(uris);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const fsPath = uri.fsPath;
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const hasPending = Array.from(pendingEdits.values()).some((r) => {
      const absPath = nodePath.isAbsolute(r.path)
        ? r.path
        : wsRoot ? nodePath.join(wsRoot, r.path) : r.path;
      return absPath === fsPath || r.path === fsPath;
    });
    if (!hasPending) return undefined;
    return {
      badge: '●',
      color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
      tooltip: 'Pending AI edit — Keep or Undo in DevSeek panel',
      propagate: false,
    };
  }
}

// Auto-accept timer — fires after `devseek.editAutoAcceptDelay` seconds
// (0 = disabled). Cancelled if user interacts with pending edits first.
let _autoAcceptTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutoAccept(webview: vscode.Webview): void {
  const delaySec = vscode.workspace.getConfiguration('devseek').get<number>('editAutoAcceptDelay', 0);
  if (!delaySec || delaySec <= 0 || pendingEdits.size === 0) return;
  if (_autoAcceptTimer) clearTimeout(_autoAcceptTimer);
  _autoAcceptTimer = setTimeout(() => {
    _autoAcceptTimer = undefined;
    if (pendingEdits.size === 0) return;
    const count = pendingEdits.size;
    for (const record of pendingEdits.values()) closePendingEditDiffTabAsync(record);
    pendingEdits.clear();
    postPendingEdits(webview);
    pendingEditDecorationProvider?.refresh();
    webview.postMessage({
      type: 'pendingActionNotice',
      action: 'keep',
      scope: 'all',
      detail: `已自动接受全部 AI 修改 (${count} 个文件)。`,
      queueTotal: 0,
    });
  }, delaySec * 1000);
}
function cancelAutoAccept(): void {
  if (_autoAcceptTimer) { clearTimeout(_autoAcceptTimer); _autoAcceptTimer = undefined; }
}


async function undoPendingHunk(editId?: string, path?: string, hunkId?: string): Promise<void> {
  const { record, hunk } = resolvePendingHunk(editId, path, hunkId);
  if (!record || !hunk) return;
  hunk.resolution = 'undone';
  await applyPendingRecordSnapshot(record);
  if (allHunksResolved(record)) {
    pendingEdits.delete(record.id);
    diffDecoManager?.deactivate(record.id);
  } else {
    diffDecoManager?.refresh(record as DiffRecordInfo);
    diffDecoManager?.revealNextPendingHunk(record as DiffRecordInfo);
  }
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
      await registerPendingEditChange(this._view.webview, change);
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
    webviewView.webview.html = getChatHtml(webviewView.webview);

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
        postPendingEdits(wv);
        this._flushQueue();
        // Restore active session to webview UI on reload.
        // NOTE: nonBridgeChatHistory is intentionally empty on startup (clean LLM context).
        // We read the stored history directly for UI display only.
        if (activeSessionId) {
          const _storedHistForUI = extContext?.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
          const _storedSumForUI = extContext?.workspaceState.get<string>(`deepseek.session.${activeSessionId}.summary`, '') ?? '';
          let _restoreHistory: ChatMessage[] = _storedHistForUI;
          let _restoreSummary = _storedSumForUI;
          // Strip any injected prefix so UI shows clean conversation
          if (_restoreHistory.length >= 2 && _restoreHistory[0].role === 'user'
              && _restoreHistory[0].content.startsWith('[上次会话背景')
              && _restoreHistory[1].role === 'assistant'
              && _restoreHistory[1].content === '好的，我已了解上次的工作进展，可以继续。') {
            _restoreHistory = _restoreHistory.slice(2);
          } else if (_restoreHistory.length > 0 && _restoreHistory[0].role === 'assistant'
              && (_restoreHistory[0].content.startsWith('【上次 session 摘要】\n') || _restoreHistory[0].content.startsWith('【历史摘要】\n'))) {
            const _legacyPrefix = _restoreHistory[0].content.startsWith('【上次 session 摘要】\n') ? '【上次 session 摘要】\n' : '【历史摘要】\n';
            _restoreSummary = _restoreHistory[0].content.slice(_legacyPrefix.length);
            _restoreHistory = _restoreHistory.slice(1);
          }
          if (_restoreHistory.length > 0 || _restoreSummary) {
            const _activeMeta = getSessions().find(s => s.id === activeSessionId);
            wv.postMessage({ type: 'sessionLoaded', id: activeSessionId, history: _restoreHistory, summary: _restoreSummary,
              changedFiles: _activeMeta?.changedFiles ?? [],
              messageCount: _activeMeta?.messageCount ?? _restoreHistory.filter(m => m.role === 'user').length,
              createdAt: _activeMeta?.createdAt ?? 0 });
          }
        }
        // 断点续传：notify webview if there is a fresh unfinished task checkpoint
        {
          const _cp = loadAgentCheckpoint();
          // Show banner only if checkpoint is < 2 hours old
          if (_cp && _cp.savedAt > Date.now() - 7_200_000) {
            wv.postMessage({
              type: 'agentCheckpointAvailable',
              resumeTaskIndex: _cp.startFromIndex,
              totalTasks: _cp.allTasks.length,
              userPrompt: _cp.displayPrompt,
              savedAt: _cp.savedAt,
            });
          } else if (_cp) {
            // Stale checkpoint — discard silently
            saveAgentCheckpoint(null);
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
            wv.postMessage({ type: 'workflowStatus', ...status });
          }, msg.autoApply === true, async (change) => {
            await registerPendingEditChange(wv, change);
          }, msg.files, { rollbackOnValidationFailure: msg.autoApply !== true });

          if (result.applied && result.validation && !result.validation.ok) {
            const originalPrompt = msg.prompt || '请根据自动验证失败结果继续修复，直到通过。';
            await runClosedLoopRepair(wv, async (status: ApplyWorkflowStatus) => {
              wv.postMessage({ type: 'workflowStatus', ...status });
            }, originalPrompt, msg.mode, result, msg.files);
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
              wv.postMessage({ type: 'workflowStatus', ...status });
            },
            msg.autoApply === true,
            async (change) => {
              await registerPendingEditChange(wv, change);
            },
            msg.files,
          );

          if (result.applied && result.validation && !result.validation.ok) {
            const originalPrompt = msg.prompt || `请继续修复文件 ${msg.path} 的验证失败问题，直到通过。`;
            await runClosedLoopRepair(wv, async (status: ApplyWorkflowStatus) => {
              wv.postMessage({ type: 'workflowStatus', ...status });
            }, originalPrompt, msg.mode, result, msg.files);
          }
        }
        break;
      case 'openPendingEdit':
        if (msg.editId || msg.path) {
          const id = resolvePendingEditId(msg.editId, msg.path);
          const record = id ? pendingEdits.get(id) : undefined;
          const hunk = record && msg.hunkId ? record.hunks.find((item) => item.id === msg.hunkId) : undefined;
          if (record) {
            const requestedLine = typeof msg.hunkLine === 'number' ? msg.hunkLine : undefined;
            const hunkLine = requestedLine || (hunk ? (hunk.newStart > 0 ? hunk.newStart : hunk.oldStart) : undefined);
            await openPendingEditInEditor(record, hunkLine);
          } else if (msg.path) {
            await openWorkspacePathInEditor({ rawPath: msg.path });
          }
        }
        break;
      case 'keepPendingHunk':
        if (msg.editId || msg.path) {
          const { record, hunk } = resolvePendingHunk(msg.editId, msg.path, msg.hunkId);
          keepPendingHunk(msg.editId, msg.path, msg.hunkId);
          postPendingEdits(wv);
          if (record && hunk) {
            postPendingActionNotice(wv, {
              action: 'keep',
              scope: 'hunk',
              path: record.path,
              detail: `已保留 ${record.path} 的${hunk.title}。`,
              queueTotal: pendingEdits.size,
            });
          }
        }
        break;
      case 'undoPendingHunk':
        if (msg.editId || msg.path) {
          const { record, hunk } = resolvePendingHunk(msg.editId, msg.path, msg.hunkId);
          await undoPendingHunk(msg.editId, msg.path, msg.hunkId);
          postPendingEdits(wv);
          if (record && hunk) {
            postPendingActionNotice(wv, {
              action: 'undo',
              scope: 'hunk',
              path: record.path,
              detail: `已撤销 ${record.path} 的${hunk.title}。`,
              queueTotal: pendingEdits.size,
            });
          }
        }
        break;
      case 'keepPendingEdit':
        if (msg.editId || msg.path) {
          const id = resolvePendingEditId(msg.editId, msg.path);
          const record = id ? pendingEdits.get(id) : undefined;
          keepPendingEdit(msg.editId, msg.path);
          postPendingEdits(wv);
          if (record) {
            postPendingActionNotice(wv, {
              action: 'keep',
              scope: 'file',
              path: record.path,
              detail: `已保留 ${record.path} 的修改。`,
              queueTotal: pendingEdits.size,
            });
          }
        }
        break;
      case 'undoPendingEdit':
        if (msg.editId || msg.path) {
          const id = resolvePendingEditId(msg.editId, msg.path);
          const record = id ? pendingEdits.get(id) : undefined;
          await undoPendingEdit(msg.editId, msg.path);
          postPendingEdits(wv);
          if (record) {
            const detail = record.existed
              ? `已撤销 ${record.path}，文件已恢复到修改前状态。`
              : `已撤销 ${record.path}，新建文件已删除。`;
            postPendingActionNotice(wv, {
              action: 'undo',
              scope: 'file',
              path: record.path,
              detail,
              queueTotal: pendingEdits.size,
            });
          }
        }
        break;
      case 'keepAllPendingEdits':
        {
          cancelAutoAccept();
          const count = pendingEdits.size;
          for (const record of pendingEdits.values()) {
            closePendingEditDiffTabAsync(record);
          }
          pendingEdits.clear();
          diffDecoManager?.deactivateAll();
          postPendingEdits(wv);
          if (count > 0) {
            postPendingActionNotice(wv, {
              action: 'keep',
              scope: 'all',
              detail: `已保留全部修改（${count} 个文件）。`,
              queueTotal: pendingEdits.size,
            });
          }
        }
        break;
      case 'undoAllPendingEdits':
        {
          cancelAutoAccept();
          const count = pendingEdits.size;
          await undoAllPendingEdits();
          postPendingEdits(wv);
          if (count > 0) {
            postPendingActionNotice(wv, {
              action: 'undo',
              scope: 'all',
              detail: `已撤销全部修改（${count} 个文件）。`,
              queueTotal: pendingEdits.size,
            });
          }
        }
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
        const tcResolve = pendingTerminalConfirms.get(msg.confirmId as string);
        if (tcResolve) {
          pendingTerminalConfirms.delete(msg.confirmId as string);
          tcResolve(msg.allow === true, msg.alwaysAllow === true);
        }
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
        // Keep full history (with summary prefix) for LLM context; send clean history + summary for display
        // Strip any stale prefix from stored history before re-injecting the fresh one
        const _cleanHistory = (h: ChatMessage[]) => {
          if (h[0]?.role === 'user' && h[0]?.content?.startsWith('[上次会话背景') &&
              h[1]?.role === 'assistant' && h[1]?.content === '好的，我已了解上次的工作进展，可以继续。') return h.slice(2);
          if (h[0]?.role === 'assistant' && (h[0]?.content?.startsWith('【上次 session 摘要】\n') || h[0]?.content?.startsWith('【历史摘要】\n'))) return h.slice(1);
          return h;
        };
        const _baseHistory = _cleanHistory(loadedHistory).slice(-20);
        nonBridgeChatHistory = loadedSummary
          ? [
              { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${loadedSummary}` },
              { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' },
              ..._baseHistory,
            ]
          : _baseHistory;
        lastConversationFiles = [];
        lastAnalysisText = extContext.workspaceState.get<string>(`deepseek.session.${id}.analysisText`, '') ?? '';
        restoreLastAgentPathsFromSession(id);
        // Send full history for rich session display, include changedFiles from meta
        const loadedMeta = getSessions().find(s => s.id === id);
        wv.postMessage({ type: 'sessionLoaded', id, history: loadedHistory, summary: loadedSummary,
          changedFiles: loadedMeta?.changedFiles ?? [],
          messageCount: loadedMeta?.messageCount ?? loadedHistory.filter(m => m.role === 'user').length,
          createdAt: loadedMeta?.createdAt ?? 0 });
        break;
      }
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
        saveAgentCheckpoint(null);
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
async function getGitDiff(staged: boolean): Promise<string> {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = gitExt.isActive ? (gitExt.exports as any).getAPI(1) : ((await gitExt.activate()) as any).getAPI(1);
    if (!api || !api.repositories || api.repositories.length === 0) return '';
    const repo = api.repositories[0];
    return (await repo.diff(staged)) as string;
  } catch {
    return '';
  }
}

function buildWorkspaceFileTree(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';

  const SKIP = /^(node_modules|build|dist|out|\.git|\.cache|__pycache__|target|bin|obj|\.vscode|\.idea|coverage|log|logs)$/i;
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.name.startsWith('.') && depth > 1) continue; // skip hidden at depth>1
      if (e.isDirectory()) {
        if (SKIP.test(e.name)) continue;
        lines.push(`${prefix}${e.name}/`);
        walk(nodePath.join(dir, e.name), prefix + '  ', depth + 1);
      } else {
        lines.push(`${prefix}${e.name}`);
      }
    }
  }

  for (const folder of folders) {
    lines.push(`${folder.name}/  (${folder.uri.fsPath})`);
    walk(folder.uri.fsPath, '  ', 1);
    if (lines.length > 200) { lines.push('  ... (已截断)'); break; }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// P4: Directory-aware file discovery
// When a user mentions a directory path in the prompt without attaching @files,
// we auto-enumerate source files there and inject their content — eliminating
// the need for manual @file upload and the associated browser-upload latency.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_FILE_RE = DEFAULT_SOURCE_FILE_RE;
const MAX_AUTO_FILES = 20;
const MAX_AUTO_SCAN_DIRS = 300;
const MAX_AUTO_SCAN_MS = 120;
const MAX_PATH_TOKENS_TO_SCAN = 8;

/**
 * Resolve a relative-or-absolute path candidate to an existing directory,
 * trying each workspace folder as root.  Also handles the common pattern where
 * the user prefixes the path with the folder name, e.g. "tars/huida_uav/…"
 * when the workspace root is /home/ff/uav/tars.
 */
function tryResolveDirectory(
  candidate: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): string | undefined {
  // 1. Absolute path
  if (nodePath.isAbsolute(candidate)) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* not found */ }
  }

  for (const folder of workspaceFolders) {
    const root = folder.uri.fsPath;

    // 2. Directly relative: <root>/<candidate>
    const direct = nodePath.join(root, candidate);
    try {
      if (fs.statSync(direct).isDirectory()) return direct;
    } catch { /* not found */ }

    // 3. User prefixed with workspace folder name: "tars/X/Y" → strip "tars/"
    const folderName = nodePath.basename(root);
    if (candidate === folderName || candidate.startsWith(folderName + '/')) {
      const stripped = candidate.slice(folderName.length).replace(/^\//, '');
      if (stripped) {
        const indirect = nodePath.join(root, stripped);
        try {
          if (fs.statSync(indirect).isDirectory()) return indirect;
        } catch { /* not found */ }
      }
    }
  }
  return undefined;
}

/**
 * BFS-enumerate source files under dirPath, up to MAX_AUTO_FILES.
 * Skips build artifacts, documentation, and test directories.
 * If extFilter is provided, only files matching that regex are included.
 */
function enumerateSourceFilesIn(dirPath: string, extFilter?: RegExp): string[] {
  const result: string[] = [];
  const filter = extFilter ?? SOURCE_FILE_RE;
  const queue = [dirPath];
  const deadline = Date.now() + MAX_AUTO_SCAN_MS;
  let visitedDirs = 0;
  while (
    queue.length > 0
    && result.length < MAX_AUTO_FILES
    && visitedDirs < MAX_AUTO_SCAN_DIRS
    && Date.now() < deadline
  ) {
    const cur = queue.shift()!;
    visitedDirs += 1;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (result.length >= MAX_AUTO_FILES) break;
      const childPath = nodePath.join(cur, e.name);
      if (e.isFile() && shouldIncludeDiscoveredSourceFile(childPath, filter)) {
        result.push(childPath);
      } else if (e.isDirectory() && !shouldSkipDiscoveryDir(e.name)) {
        queue.push(childPath);
      }
    }
  }
  return result;
}

/**
 * Convert a list of absolute file paths to display labels for the context row.
 * Files from the same directory are collapsed into "dirname/ (N)" when ≥3.
 */
function toContextDisplayLabels(files: string[]): string[] {
  if (files.length <= 2) return files.map(f => nodePath.basename(f));
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = nodePath.dirname(f);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }
  const labels: string[] = [];
  for (const [dir, dirFiles] of byDir) {
    if (dirFiles.length >= 2) {
      labels.push(`${nodePath.basename(dir)}/ (${dirFiles.length})`);
    } else {
      dirFiles.forEach(f => labels.push(nodePath.basename(f)));
    }
  }
  return labels;
}

function relPathFromWorkspace(workspaceRoot: string, absPath: string): string | null {
  if (!workspaceRoot || !absPath) return null;
  try {
    const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return null;
    return rel;
  } catch {
    return null;
  }
}

function absPathFromWorkspaceRel(workspaceRoot: string, relPath: string): string | null {
  if (!workspaceRoot || !relPath) return null;
  const abs = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(workspaceRoot, relPath);
  const resolved = nodePath.resolve(abs);
  const root = nodePath.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + nodePath.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

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
  if (!workspaceRoot || !shouldRestoreSessionFiles(prompt, intent)) return [];

  const candidates: string[] = [];
  const state = loadAgentSessionState();
  for (const rel of state?.changedPaths ?? []) candidates.push(rel);
  for (const rel of lastAgentChangedPaths) candidates.push(rel);
  for (const abs of sessionRecentFiles.values()) {
    const rel = relPathFromWorkspace(workspaceRoot, abs);
    if (rel) candidates.push(rel);
  }

  const resolved = [...new Set(candidates)]
    .map(rel => absPathFromWorkspaceRel(workspaceRoot, rel))
    .filter((abs): abs is string => Boolean(abs));
  const codeFirst = resolved.filter(p => AGENT_CODE_FILE_RE.test(p));
  if (codeFirst.length === 0) return [];
  const supporting = resolved.filter(p => !AGENT_CODE_FILE_RE.test(p)).slice(0, 3);
  return [...codeFirst.slice(0, 6), ...supporting];
}

function buildAgenticSessionContext(workspaceRoot: string, currentPrompt: string): string {
  if (!workspaceRoot) return '';
  const state = loadAgentSessionState();

  const recentHistory = nonBridgeChatHistory
    .slice(-6)
    .map((entry) => {
      const role = entry.role === 'user' ? '用户' : '助手';
      const content = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      return `- ${role}: ${content.replace(/\s+/g, ' ').slice(0, 700)}`;
    });

  const recentFiles = [...new Set(sessionRecentFiles.values())]
    .filter(Boolean)
    .map(abs => relPathFromWorkspace(workspaceRoot, abs) ?? abs)
    .filter(p => p && !p.startsWith('..'))
    .slice(0, 12);

  if (recentHistory.length === 0 && recentFiles.length === 0 && !state?.lastSummary) return '';

  const lines: string[] = [
    '这是同一个聊天 session 的后续消息。当前用户消息如果是短句、追问、纠错或反馈，必须优先基于下面的上一轮上下文继续处理；不要把它当作全新任务，也不要默认扫描整个工作区目录。',
    `当前用户消息：${currentPrompt}`,
  ];
  if (state?.lastSummary) {
    lines.push('上一轮 Agent 状态：');
    lines.push(`- 用户目标：${state.lastUserPrompt}`);
    lines.push(`- 执行结果：${state.completed ? '已完成' : '未完成或需要复核'}`);
    lines.push(`- 摘要：${state.lastSummary.slice(0, 800)}`);
    if (state.changedPaths.length > 0) {
      lines.push('- 涉及文件：');
      lines.push(...state.changedPaths.slice(0, 12).map(p => `  - ${p}`));
    }
  }
  if (lastAgentChangedPaths.length > 0) {
    lines.push('上一轮 Agent 涉及/修改的文件：');
    lines.push(...lastAgentChangedPaths.slice(0, 10).map(p => `- ${p}`));
  }
  if (recentFiles.length > 0) {
    lines.push('本 session 最近文件记忆：');
    lines.push(...recentFiles.map(p => `- ${p}`));
  }
  if (recentHistory.length > 0) {
    lines.push('最近对话摘要：');
    lines.push(...recentHistory);
  }
  lines.push('执行要求：若用户反馈“没有看到/找不到/不对/继续/重新编译/运行”等，先核查上一轮目标文件和目录的真实状态，再修复或验证；不要泛化为分析整个 code 目录。');
  return lines.join('\n').slice(0, 6000);
}

/**
 * Detect an explicit file-extension filter in the user prompt, e.g. ".hpp" or "*.hpp".
 * Returns a strict regex like /\.hpp$/i when found, otherwise undefined.
 */
function detectExtensionFilter(prompt: string): RegExp | undefined {
  // Match patterns like ".hpp", "*.hpp", ".hpp文件", "hpp文件"
  const m = prompt.match(/(?:\*|\.)(\w+)(?:\s*文件|\s+files?)?(?=[^\w]|$)/i);
  if (!m) return undefined;
  const ext = m[1].toLowerCase();
  // Only treat as a filter when it looks like a known source extension
  if (!/^(hpp|h|cpp|cc|cxx|c|ts|tsx|js|jsx|py|java|go|rs|md|sh|bash|json|yaml|yml)$/.test(ext)) return undefined;
  return new RegExp(`\.${ext}$`, 'i');
}

/**
 * Scan the prompt for directory path references and return the abs paths of
 * source files found there.  Returns [] when nothing can be resolved.
 * When the prompt names a specific extension (e.g. ".hpp"), only those files
 * are returned.
 */
function discoverFilesFromDirectoryPrompt(
  prompt: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): string[] {
  if (!workspaceFolders.length) return [];

  const extFilter = detectExtensionFilter(prompt);

  // Extract path-like tokens, including absolute paths such as
  // "/home/me/project/code/foo中".  The trailing Chinese marker is deliberately
  // not part of the token.
  const PATH_RE = /((?:~\/|\/)?[A-Za-z0-9_.@%+\-]+(?:\/[A-Za-z0-9_.@%+\-]+){1,})\/?/g;
  const seen = new Set<string>();
  const candidates: Array<{ dir: string; files: string[] }> = [];
  for (const m of prompt.matchAll(PATH_RE)) {
    if (seen.size >= MAX_PATH_TOKENS_TO_SCAN) break;
    const candidate = m[1].replace(/\/+$/, '');
    // Skip very short paths (e.g. "a/b") and version-like tokens (e.g. "v1.0/x")
    if (candidate.split('/').length < 2) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const resolvedDir = tryResolveDirectory(candidate, workspaceFolders);
    if (!resolvedDir) continue;

    const files = enumerateSourceFilesIn(resolvedDir, extFilter);
    if (files.length > 0) candidates.push({ dir: resolvedDir, files });
  }
  if (candidates.length === 0) return [];
  // Prefer the most specific (deepest path) match; break ties by file count.
  candidates.sort((a, b) => {
    const depthDiff = b.dir.split(nodePath.sep).length - a.dir.split(nodePath.sep).length;
    return depthDiff !== 0 ? depthDiff : b.files.length - a.files.length;
  });
  return candidates[0].files;
}

function buildSmalltalkReply(prompt: string): string {
  const text = (prompt || '').trim().toLowerCase();
  if (/^(?:hi|hello|ello|hey)[\s!.?]*$/.test(text)) return 'Hello! 我在。';
  return '你好，我在。';
}

async function requestInlineTerminalConfirmation(
  webview: vscode.Webview,
  command: string,
  workdir = '',
  timeoutMs = 60000,
): Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string }> {
  const confirmId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve) => {
    pendingTerminalConfirms.set(confirmId, (allow, alwaysAllow) => resolve({ allow, alwaysAllow }));
    webview.postMessage({ type: 'terminalConfirm', command, workdir, confirmId });
    setTimeout(() => {
      if (pendingTerminalConfirms.delete(confirmId)) {
        resolve({ allow: false, reason: '您未在 60 秒内确认，命令未执行。' });
      }
    }, timeoutMs);
  });
}

async function runAgentTerminalCommandWithPermission(input: {
  webview: vscode.Webview;
  command: string;
  workdir?: string;
  workspaceRoot?: string;
  mode: string;
  toolPolicy: ToolPolicy;
}): Promise<string> {
  const { webview, command, workdir, workspaceRoot, mode, toolPolicy } = input;
  const terminalPermission = decideToolPermission(toolPolicy, 'terminal');
  if (terminalPermission.action === 'deny') {
    return `（命令未执行：当前 ${mode} 模式不允许终端工具：${terminalPermission.reason}）`;
  }

  const terminalDecision = decideTerminalCommandPermission({
    command,
    workdir,
    workspaceRoot,
  });
  const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
  const remembered = terminalDecision.canRememberDecision && trustedTerminalRiskClasses.has(terminalDecision.risk);
  let confirmedByUser = false;

  if (!isAutopilot && terminalPermission.action === 'requireConfirm' && terminalDecision.requiresConfirmation && !remembered) {
    const confirmResult = await requestInlineTerminalConfirmation(webview, command, workdir ?? '');
    if (confirmResult.alwaysAllow && terminalDecision.canRememberDecision) {
      trustedTerminalRiskClasses.add(terminalDecision.risk);
    }
    if (!confirmResult.allow) {
      return `（命令未执行：${confirmResult.reason ?? '用户拒绝'}）`;
    }
    confirmedByUser = true;
  }

  const { runCommand, formatTerminalOutputForPrompt } = await import('./tools/terminal');
  const result = await runCommand({
    command,
    cwd: workdir,
    visible: false,
    allowRisky: !isAutopilot && (confirmedByUser || remembered),
  });
  const outputPreview = result.output.slice(0, 4000);
  webview.postMessage({
    type: 'terminalRanNotice',
    command,
    workdir: workdir ?? '',
    exitCode: result.exitCode,
    output: outputPreview,
  });
  return formatTerminalOutputForPrompt(command, result);
}

async function runChat(
  webview: vscode.Webview,
  userDisplay: string,
  prompt: string,
  newSession: boolean,
  mode?: 'fast' | 'r1',
  files?: string[],
  forceNoAgent?: boolean,
  /** When set, skip decomposeTask and resume from this task index using resumeTasks */
  resumeFromIndex?: number,
  /** Task list to use when resuming (must be set when resumeFromIndex is set) */
  resumeTasks?: import('./agent-task-decomposer').AgentTask[],
  /** base64 image data URLs for vision input */
  images?: string[],
  intentConfirmed = false,
  suppressUserMessage = false,
): Promise<void> {
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
    if (_storedSummary) {
      const _storedHistory = extContext.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
      const _stripPrefix = (h: ChatMessage[]) => {
        if (h[0]?.role === 'user' && h[0]?.content?.startsWith('[上次会话背景') &&
            h[1]?.role === 'assistant' && h[1]?.content === '好的，我已了解上次的工作进展，可以继续。') return h.slice(2);
        if (h[0]?.role === 'assistant' && (h[0]?.content?.startsWith('【上次 session 摘要】\n') || h[0]?.content?.startsWith('【历史摘要】\n'))) return h.slice(1);
        return h;
      };
      nonBridgeChatHistory = [
        { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${_storedSummary}` },
        { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' },
        ..._stripPrefix(_storedHistory).slice(-20),
      ];
    } else {
      // No compact summary yet (short session < 4 messages): inject raw history directly.
      const _rawHistory = extContext.workspaceState.get<ChatMessage[]>(`deepseek.session.${activeSessionId}.history`, []) ?? [];
      if (_rawHistory.length > 0) {
        nonBridgeChatHistory = _rawHistory.slice(-20);
      }
    }
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
  const workflowReporter = async (status: ApplyWorkflowStatus): Promise<void> => {
    webview.postMessage({ type: 'workflowStatus', ...status });
  };
  const localPreflightConfig = vscode.workspace.getConfiguration('devseek');
  const shouldBypassAgentForLocalExecution = (() => {
    if (!localPreflightConfig.get<boolean>('localExecutionFirst', true)) return false;
    if (intent.mode !== 'run') return false;
    const workspaceRootForLocal = getWorkspaceRootFsPath(prompt, pathResolutionHints);
    if (shouldPreferLocalExecution(prompt, effectiveFiles, workspaceRootForLocal)) {
      return !!planLocalExecution(prompt, effectiveFiles || [], workspaceRootForLocal);
    }
    return isRepeatExecutionRequest(prompt) && !!lastLocalExecutionPlan;
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

    beginAgentRunReviewScope(webview);
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

    try {
      // ── Agentic routing: no code files → free-explore loop (Claude Code style) ──
      // This mirrors Copilot's principle: "no Working Set → no Architect phase".
      // The LLM drives tool exploration directly; we skip decomposeTask entirely.
      const hasCodeFiles = effectiveFiles.some(f => AGENT_CODE_FILE_RE.test(f));
      // Unified agentic loop handles all tasks without attached code files:
      // investigation (log/CSV analysis), pure code creation (no attached files),
      // and mixed data-file tasks. The loop now has create_file + all read tools,
      // so the LLM can self-route — read, explore, plan, then write as needed.
      // Only skip to Architect+Editor when user explicitly attached code files to edit.
      if (!hasCodeFiles && !resumeFromIndex) {
        // No code file attachments → agentic free-explore (investigate) mode
        const agWsRootPath = getWorkspaceRootFsPath(prompt, pathResolutionHints);
        const agWsRoot = agWsRootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const agSessionContext = buildAgenticSessionContext(agWsRoot, userDisplay);
        // Non-code files (logs, csvs, etc.) are passed directly
        const dataFiles = effectiveFiles.filter(f => !AGENT_CODE_FILE_RE.test(f));
        // Free-explore mode has no Architect decomposition phase, but the UI still
        // needs a visible beginning before the model's first tool call arrives.
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'started',
          title: '分析任务，准备探索工作区',
          taskTotal: 0,
          detail: '正在理解请求，并准备读取相关文件、生成执行步骤。',
        });
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: '已确定执行方式：Agent 自主探索',
          taskTotal: 0,
          detail: [
            '1. 理解需求和工作区范围',
            '2. 读取或搜索相关文件',
            '3. 按需创建或修改文件',
            '4. 编译、运行或验证结果',
          ].join('\n'),
        });
        postAgent({
          type: 'agentStatus',
          phase: 'execute',
          state: 'started',
          title: '开始执行：等待模型返回任务列表和工具调用',
          detail: '后续读取、搜索、写入和终端命令会继续显示在这里。',
        });
        const agResult = await runAgenticLoop(prompt, dataFiles, agWsRoot, mode, {
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
          onWorkflowStatus: async (s) => { webview.postMessage({ type: 'workflowStatus', ...s }); },
          onAgentStatus: async (s) => { postAgent(s); },
          onAppliedChange: async (c) => { await registerPendingEditChange(webview, c); },
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
            const confirmId = `sf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const confirmResult = await new Promise<{ allow: boolean }>((resolve) => {
              pendingTerminalConfirms.set(confirmId, (allow) => resolve({ allow }));
              webview.postMessage({ type: 'terminalConfirm', command: `⚠️ 写入敏感文件：${relPath}`, workdir: '', confirmId });
              setTimeout(() => {
                if (pendingTerminalConfirms.delete(confirmId)) resolve({ allow: false });
              }, 60000);
            });
            return confirmResult.allow;
          },
          mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
          onMcpToolCall: mcpManager.hasMcpTools
            ? (fakeName, args) => mcpManager.callTool(fakeName, args)
            : undefined,
          onTerminalCommand: async (command, workdir) => {
            return runAgentTerminalCommandWithPermission({
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
          onGetErrors: async () => {
            const allDiags = vscode.languages.getDiagnostics();
            const errors: string[] = [];
            for (const [uri, diags] of allDiags) {
              for (const d of diags) {
                if (d.severity === vscode.DiagnosticSeverity.Error) {
                  errors.push(`${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1}: ${d.message}`);
                }
              }
            }
            return errors.length > 0 ? errors.join('\n') : '（当前无诊断错误）';
          },
          onFileSearch: async (glob: string) => {
            const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50);
            if (uris.length === 0) return '（无匹配文件）';
            const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            return uris.map(u => wsRoot0 ? nodePath.relative(wsRoot0, u.fsPath) : u.fsPath).join('\n');
          },
          // get_changed_files — Copilot #search/changes: git status + diff summary
          onGetChangedFiles: async () => {
            const { runCommand } = await import('./tools/terminal');
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            if (!cwd) return '（无工作区）';
            try {
              const status = await runCommand({ command: 'git status --short', cwd, timeoutMs: 5000 });
              const diff = await runCommand({ command: 'git diff --stat HEAD', cwd, timeoutMs: 5000 });
              const statusText = status.stdout.trim() || '（无变更）';
              const diffText = diff.stdout.trim();
              return diffText ? `${statusText}\n\n${diffText}` : statusText;
            } catch { return '（非 git 工作区或无变更）'; }
          },
          // create_directory — Copilot #edit/createDirectory: mkdir recursively
          onCreateDirectory: async (dirPath: string) => {
            const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            const absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(wsRoot0, dirPath);
            if (wsRoot0 && !absPath.startsWith(wsRoot0)) throw new Error('禁止在工作区外创建目录');
            fs.mkdirSync(absPath, { recursive: true });
            return `目录已创建: ${dirPath}`;
          },
          // fetch_webpage — Copilot #web/fetch: HTTP GET webpage content
          onFetchWebpage: async (url: string) => {
            let parsedUrl: URL;
            try { parsedUrl = new URL(url); } catch { throw new Error(`无效 URL: ${url}`); }
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('仅支持 http/https 协议');
            const host = parsedUrl.hostname.toLowerCase();
            if (/^(localhost|127\.|0\.0\.0\.0|::1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) throw new Error('拒绝访问内部网络地址');
            const mod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
            return new Promise<string>((resolve, reject) => {
              const req = mod.request(url, { headers: { 'User-Agent': 'DevSeek-Agent/1.0' }, timeout: 8000 }, (res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => { if (data.length < 50000) data += chunk; });
                res.on('end', () => {
                  const text = data
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 20000);
                  resolve(text || '（页面内容为空）');
                });
              });
              req.on('error', (e: Error) => reject(e));
              req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
              req.end();
            });
          },
          // vscode_listCodeUsages — Copilot #search/usages: LSP semantic references + grep fallback
          onListCodeUsages: async (symbol: string, filePath?: string) => {
            const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            let targetUri: vscode.Uri | undefined;
            let targetPos: vscode.Position | undefined;
            const lookupPath = filePath
              ? (nodePath.isAbsolute(filePath) ? filePath : nodePath.join(wsRoot0, filePath))
              : null;
            if (lookupPath && fs.existsSync(lookupPath)) {
              targetUri = vscode.Uri.file(lookupPath);
            } else if (wsRoot0) {
              const { runCommand: rc } = await import('./tools/terminal');
              const esc0 = symbol.replace(/'/g, "'\\''" ).slice(0, 80);
              const exts0 = ['ts','tsx','js','jsx','py','java','go','rs','cs','cpp','c','h'];
              const incs0 = exts0.map(e => `--include='*.${e}'`).join(' ');
              const r0 = await rc({ command: `grep -r -l -w '${esc0}' ${incs0} '${wsRoot0.replace(/'/g, "'\\''")}' 2>/dev/null | head -3`, timeoutMs: 8000 });
              const first = r0.stdout.trim().split('\n')[0];
              if (first && fs.existsSync(first)) targetUri = vscode.Uri.file(first);
            }
            if (targetUri) {
              try {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
                for (let i = 0; i < Math.min(doc.lineCount, 3000); i++) {
                  const m = re.exec(doc.lineAt(i).text);
                  if (m) { targetPos = new vscode.Position(i, m.index); break; }
                }
                if (targetPos) {
                  const locs = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider', targetUri, targetPos
                  );
                  if (locs && locs.length > 0) {
                    const lines = locs.slice(0, 30).map(l =>
                      `${vscode.workspace.asRelativePath(l.uri)}:${l.range.start.line + 1}`
                    );
                    return `"${symbol}" 共 ${locs.length} 处引用：\n${lines.join('\n')}${
                      locs.length > 30 ? '\n（仅显示前 30 条）' : ''
                    }`;
                  }
                }
              } catch { /* fall through to grep */ }
            }
            // Fallback: word-boundary grep
            const { runCommand: rc2 } = await import('./tools/terminal');
            const esc2 = symbol.replace(/'/g, "'\\''" ).slice(0, 80);
            const exts2 = ['ts','tsx','js','jsx','py','java','go','rs','cs','cpp','c','h','hpp'];
            const incs2 = exts2.map(e => `--include='*.${e}'`).join(' ');
            const r2 = await rc2({ command: `grep -r -n -w '${esc2}' ${incs2} '${wsRoot0.replace(/'/g, "'\\''")}' 2>/dev/null | head -40`, timeoutMs: 10000 });
            return r2.stdout
              ? `"${symbol}" 引用（grep fallback）:\n${r2.stdout}`
              : '（未找到引用）';
          },
          // run_vscode_command — Copilot #vscode/runCommand: trigger VS Code commands safely
          onRunVscodeCommand: async (command: string, args?: unknown[]) => {
            if (!/^[\w.-]+$/.test(command)) throw new Error(`无效命令 ID: ${command}`);
            const SAFE = new Set([
              'editor.action.formatDocument','editor.action.formatSelection',
              'editor.action.organizeImports','editor.action.fixAll',
              'workbench.action.files.saveAll','workbench.action.files.save',
              'workbench.files.action.refreshFilesExplorer',
              'typescript.restartTsServer','eslint.executeAutofix',
              'workbench.action.tasks.runTask','workbench.action.tasks.build',
              'testing.runAll','testing.refreshTests',
              'editor.action.triggerSuggest','rust-analyzer.reloadWorkspace',
              'python.execInTerminal','C_Cpp.BuildAndDebugActiveFile',
            ]);
            const isAuto0 = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
            if (!isAuto0 && !SAFE.has(command)) {
              const cid0 = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const ok0 = await new Promise<boolean>((resolve) => {
                pendingTerminalConfirms.set(cid0, (allow) => resolve(allow));
                webview.postMessage({ type: 'terminalConfirm', command: `⚡ VS Code: ${command}`, workdir: '', confirmId: cid0 });
                setTimeout(() => { if (pendingTerminalConfirms.delete(cid0)) resolve(false); }, 60000);
              });
              if (!ok0) return '（命令未执行：用户拒绝）';
            }
            try {
              const res0 = await vscode.commands.executeCommand(command, ...(args ?? []));
              return res0 !== undefined
                ? `命令已执行: ${command}\n返回: ${JSON.stringify(res0).slice(0, 500)}`
                : `命令已执行: ${command}`;
            } catch (err) {
              throw new Error(`命令执行失败: ${(err as Error).message}`);
            }
          },
          signal: chatSignal,
          onTaskCheckpoint: (completedUpToIndex, _remainingTasks) => {
            if (completedUpToIndex === null) { saveAgentCheckpoint(null); webview.postMessage({ type: 'agentCheckpointCleared' }); }
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
        scheduleAutoAccept(webview);
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

      if (resumeFromIndex !== undefined && resumeTasks && resumeTasks.length > 0) {
        // ── Resume path: restore tasks from checkpoint, skip LLM decompose ──
        tasks = resumeTasks;
        const remaining = tasks.length - resumeFromIndex;
        postAgent({
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: `断点续传：从第 ${resumeFromIndex + 1} 个任务继续（共 ${tasks.length} 个）`,
          taskTotal: tasks.length,
          detail: `已完成 ${resumeFromIndex} 个，剩余 ${remaining} 个：\n` +
            tasks.slice(resumeFromIndex).map((t, i) =>
              `${resumeFromIndex + i + 1}. [${t.action}] ${nodePath.basename(t.file)} — ${t.desc}`).join('\n'),
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
          detail: tasks.map((t, i) => `${i + 1}. [${t.action}] ${nodePath.basename(t.file)} — ${t.desc}`).join('\n'),
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
      if (wsRoot) {
        const editorSessionContext = shouldInjectSessionContext
          ? [lastAnalysisText, sessionContextForAgent].filter(Boolean).join('\n\n')
          : (lastAnalysisText || undefined);
        const loopResult = await runAgentLoop(tasks, promptForAgent, mode, wsRoot, {
          onDelta: (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              webview.postMessage({ type: 'resetResponse', text: delta.slice(7) });
            } else {
              webview.postMessage({ type: 'delta', text: delta });
            }
          },
          onWorkflowStatus: async (s) => { webview.postMessage({ type: 'workflowStatus', ...s }); },
          onAgentStatus: async (s) => { postAgent(s); },
          onAppliedChange: async (c) => { await registerPendingEditChange(webview, c); },
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
            const confirmId = `sf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const confirmResult = await new Promise<{ allow: boolean }>((resolve) => {
              pendingTerminalConfirms.set(confirmId, (allow) => resolve({ allow }));
              webview.postMessage({ type: 'terminalConfirm', command: `⚠️ 写入敏感文件：${relPath}`, workdir: '', confirmId });
              setTimeout(() => {
                if (pendingTerminalConfirms.delete(confirmId)) resolve({ allow: false });
              }, 60000);
            });
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
            return runAgentTerminalCommandWithPermission({
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
          // get_errors tool — AI can check current VS Code diagnostics
          onGetErrors: async () => {
            const allDiags = vscode.languages.getDiagnostics();
            const errors: string[] = [];
            for (const [uri, diags] of allDiags) {
              for (const d of diags) {
                if (d.severity === vscode.DiagnosticSeverity.Error) {
                  errors.push(`${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1}: ${d.message}`);
                }
              }
            }
            return errors.length > 0 ? errors.join('\n') : '（当前无诊断错误）';
          },
          // file_search tool — find files matching a glob pattern (Copilot #search/fileSearch)
          onFileSearch: async (glob: string) => {
            const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50);
            if (uris.length === 0) return '（无匹配文件）';
            return uris.map(u => vscode.workspace.asRelativePath(u)).join('\n');
          },
          // get_changed_files — Copilot #search/changes: git status + diff summary
          onGetChangedFiles: async () => {
            const { runCommand } = await import('./tools/terminal');
            try {
              const status = await runCommand({ command: 'git status --short', cwd: wsRoot.fsPath, timeoutMs: 5000 });
              const diff = await runCommand({ command: 'git diff --stat HEAD', cwd: wsRoot.fsPath, timeoutMs: 5000 });
              const statusText = status.stdout.trim() || '（无变更）';
              const diffText = diff.stdout.trim();
              return diffText ? `${statusText}\n\n${diffText}` : statusText;
            } catch { return '（非 git 工作区或无变更）'; }
          },
          // create_directory — Copilot #edit/createDirectory: mkdir recursively
          onCreateDirectory: async (dirPath: string) => {
            const absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(wsRoot.fsPath, dirPath);
            if (!absPath.startsWith(wsRoot.fsPath)) throw new Error('禁止在工作区外创建目录');
            fs.mkdirSync(absPath, { recursive: true });
            return `目录已创建: ${dirPath}`;
          },
          // fetch_webpage — Copilot #web/fetch: HTTP GET webpage content (SSRF-safe)
          onFetchWebpage: async (url: string) => {
            let parsedUrl: URL;
            try { parsedUrl = new URL(url); } catch { throw new Error(`无效 URL: ${url}`); }
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('仅支持 http/https 协议');
            const host = parsedUrl.hostname.toLowerCase();
            if (/^(localhost|127\.|0\.0\.0\.0|::1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) throw new Error('拒绝访问内部网络地址');
            const mod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
            return new Promise<string>((resolve, reject) => {
              const req = mod.request(url, { headers: { 'User-Agent': 'DevSeek-Agent/1.0' }, timeout: 8000 }, (res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => { if (data.length < 50000) data += chunk; });
                res.on('end', () => {
                  const text = data
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 20000);
                  resolve(text || '（页面内容为空）');
                });
              });
              req.on('error', (e: Error) => reject(e));
              req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
              req.end();
            });
          },
          // vscode_listCodeUsages — Copilot #search/usages: LSP semantic references + grep fallback
          onListCodeUsages: async (symbol: string, filePath?: string) => {
            let targetUri: vscode.Uri | undefined;
            let targetPos: vscode.Position | undefined;
            const lookupPath = filePath
              ? (nodePath.isAbsolute(filePath) ? filePath : nodePath.join(wsRoot.fsPath, filePath))
              : null;
            if (lookupPath && fs.existsSync(lookupPath)) {
              targetUri = vscode.Uri.file(lookupPath);
            } else {
              const { runCommand: rc } = await import('./tools/terminal');
              const esc0 = symbol.replace(/'/g, "'\\''" ).slice(0, 80);
              const exts0 = ['ts','tsx','js','jsx','py','java','go','rs','cs','cpp','c','h'];
              const incs0 = exts0.map(e => `--include='*.${e}'`).join(' ');
              const r0 = await rc({ command: `grep -r -l -w '${esc0}' ${incs0} '${wsRoot.fsPath.replace(/'/g, "'\\''")}' 2>/dev/null | head -3`, timeoutMs: 8000 });
              const first = r0.stdout.trim().split('\n')[0];
              if (first && fs.existsSync(first)) targetUri = vscode.Uri.file(first);
            }
            if (targetUri) {
              try {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
                for (let i = 0; i < Math.min(doc.lineCount, 3000); i++) {
                  const m = re.exec(doc.lineAt(i).text);
                  if (m) { targetPos = new vscode.Position(i, m.index); break; }
                }
                if (targetPos) {
                  const locs = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider', targetUri, targetPos
                  );
                  if (locs && locs.length > 0) {
                    const lines = locs.slice(0, 30).map(l =>
                      `${vscode.workspace.asRelativePath(l.uri)}:${l.range.start.line + 1}`
                    );
                    return `"${symbol}" 共 ${locs.length} 处引用：\n${lines.join('\n')}${
                      locs.length > 30 ? '\n（仅显示前 30 条）' : ''
                    }`;
                  }
                }
              } catch { /* fall through to grep */ }
            }
            // Fallback: word-boundary grep
            const { runCommand: rc2 } = await import('./tools/terminal');
            const esc2 = symbol.replace(/'/g, "'\\''" ).slice(0, 80);
            const exts2 = ['ts','tsx','js','jsx','py','java','go','rs','cs','cpp','c','h','hpp'];
            const incs2 = exts2.map(e => `--include='*.${e}'`).join(' ');
            const r2 = await rc2({ command: `grep -r -n -w '${esc2}' ${incs2} '${wsRoot.fsPath.replace(/'/g, "'\\''")}' 2>/dev/null | head -40`, timeoutMs: 10000 });
            return r2.stdout
              ? `"${symbol}" 引用（grep fallback）:\n${r2.stdout}`
              : '（未找到引用）';
          },
          // run_vscode_command — Copilot #vscode/runCommand: trigger VS Code commands safely
          onRunVscodeCommand: async (command: string, args?: unknown[]) => {
            if (!/^[\w.-]+$/.test(command)) throw new Error(`无效命令 ID: ${command}`);
            const SAFE = new Set([
              'editor.action.formatDocument','editor.action.formatSelection',
              'editor.action.organizeImports','editor.action.fixAll',
              'workbench.action.files.saveAll','workbench.action.files.save',
              'workbench.files.action.refreshFilesExplorer',
              'typescript.restartTsServer','eslint.executeAutofix',
              'workbench.action.tasks.runTask','workbench.action.tasks.build',
              'testing.runAll','testing.refreshTests',
              'editor.action.triggerSuggest','rust-analyzer.reloadWorkspace',
              'python.execInTerminal','C_Cpp.BuildAndDebugActiveFile',
            ]);
            const isAuto1 = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
            if (!isAuto1 && !SAFE.has(command)) {
              const cid1 = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const ok1 = await new Promise<boolean>((resolve) => {
                pendingTerminalConfirms.set(cid1, (allow) => resolve(allow));
                webview.postMessage({ type: 'terminalConfirm', command: `⚡ VS Code: ${command}`, workdir: '', confirmId: cid1 });
                setTimeout(() => { if (pendingTerminalConfirms.delete(cid1)) resolve(false); }, 60000);
              });
              if (!ok1) return '（命令未执行：用户拒绝）';
            }
            try {
              const res1 = await vscode.commands.executeCommand(command, ...(args ?? []));
              return res1 !== undefined
                ? `命令已执行: ${command}\n返回: ${JSON.stringify(res1).slice(0, 500)}`
                : `命令已执行: ${command}`;
            } catch (err) {
              throw new Error(`命令执行失败: ${(err as Error).message}`);
            }
          },
          // Stop button support: abort in-progress LLM calls
          signal: chatSignal,
          // 断点续传：save/clear checkpoint after each task and on network failure
          autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
          onTaskCheckpoint: (completedUpToIndex, _remainingTasks) => {
            if (completedUpToIndex === null) {
              // Loop completed successfully — clear any stale checkpoint
              saveAgentCheckpoint(null);
              // Tell webview to hide the checkpoint banner (if shown)
              webview.postMessage({ type: 'agentCheckpointCleared' });
              return;
            }
            // Save current progress so the user can resume later
            saveAgentCheckpoint({
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
            // Notify webview so it can show the resume banner
            webview.postMessage({
              type: 'agentCheckpointAvailable',
              resumeTaskIndex: completedUpToIndex,
              totalTasks: tasks.length,
              userPrompt: userDisplay,
              savedAt: Date.now(),
            });
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
        // L-5: Autopilot mode — auto-accept all pending edits when loop completes
        const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
        if (isAutopilot && pendingEdits.size > 0) {
          pendingEdits.clear();
          webview.postMessage({ type: 'pendingEdits', items: [] });
          webview.postMessage({ type: 'pendingActionNotice', action: 'keep', scope: 'all', detail: `[自动驾驶] 已自动接受全部文件改动。`, queueTotal: 0 });
        }
        // L1a: build rich summary text for session history
        // Include: task plan, each file with workspace-relative path, analysis summary.
        // This is the key data the user needs to continue work after loading a session.
        const _wsRootFs2 = wsRoot ? wsRoot.fsPath : '';
        const _taskPlanLines = tasks.map((t, i) =>
          `  ${i + 1}. [${t.action}] ${
            (t.absPath && _wsRootFs2 && t.absPath.startsWith(_wsRootFs2))
              ? t.absPath.slice(_wsRootFs2.length + 1).replace(/\\/g, '/')
              : nodePath.basename(t.file)
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
      const msg = (e as Error).message;
      postAgent({ type: 'agentStatus', phase: 'error', state: 'failed', title: `Agent 执行出错：${msg}` });
      webview.postMessage({ type: 'error', text: msg, loginRequired: msg === 'LOGIN_REQUIRED' });
      agentHistoryText = agentHistoryText || `[Agent 执行出错] ${msg.slice(0, 200)}`;
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

    scheduleAutoAccept(webview);
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
      let localPlan: LocalExecutionPlan | undefined;
      if (shouldPreferLocalExecution(prompt, effectiveFiles, workspaceRoot)) {
        localPlan = planLocalExecution(prompt, effectiveFiles || [], workspaceRoot) || undefined;
      } else if (isRepeatExecutionRequest(prompt) && lastLocalExecutionPlan) {
        localPlan = { ...lastLocalExecutionPlan, reason: 'repeat-last-local-plan' };
      }

      if (localPlan) {
        lastLocalExecutionPlan = localPlan;

        if (executionApproval === 'confirm') {
          const confirmResult = await requestInlineTerminalConfirmation(webview, localPlan.command, localPlan.cwd);
          if (confirmResult.alwaysAllow) {
            await vscode.workspace.getConfiguration('devseek').update('autopilotMode', true, vscode.ConfigurationTarget.Global);
          }
          if (!confirmResult.allow) {
            await workflowReporter({
              phase: 'validate',
              state: 'skipped',
              title: '本地执行已取消',
              detail: confirmResult.reason ?? '用户取消了本地编译/运行命令。',
            });
            webview.postMessage({ type: 'endResponse' });
            return;
          }
        }

        await workflowReporter({
          phase: 'validate',
          state: 'started',
          title: localPlan.mode === 'run-only' ? '插件正在本地执行已有程序' : '插件正在本地编译/执行',
          detail: `模式: ${localPlan.mode}\n原因: ${localPlan.reason}\n命令: ${localPlan.command}`,
        });

        let maxRounds = Math.max(0, Math.min(6, config.get<number>('autoFixRounds', 6)));
        for (let round = 0; round <= maxRounds; round += 1) {
          const localResult = await runLocalExecution(localPlan);
          await workflowReporter({
            phase: 'validate',
            state: localResult.ok ? 'passed' : 'failed',
            title: localResult.ok ? '本地执行通过' : '本地执行失败',
            detail: `命令: ${localResult.command}\nexitCode: ${localResult.exitCode ?? 'null'}\n${localResult.output.slice(0, 1200)}`,
          });

          if (localResult.ok) {
            emitLearningEvent({ type: 'command_succeeded', command: localPlan.command, context: prompt.slice(0, 80), sessionId: activeSessionId });
            webview.postMessage({ type: 'delta', text: buildLocalExecutionSuccessMessage(localPlan, localResult) });
            webview.postMessage({ type: 'endResponse' });
            return;
          }

          if (!shouldRepairLocalExecutionFailure(localPlan, localResult)) {
            webview.postMessage({ type: 'delta', text: buildLocalExecutionFailureMessage(localPlan, localResult) });
            webview.postMessage({ type: 'endResponse' });
            return;
          }

          if (round >= maxRounds) {
            const action = await askRepairExhaustedAction('本地执行闭环达到上限', `已执行 ${maxRounds} 轮，仍未通过本地命令。`);
            if (action === 'continue') {
              maxRounds += 3;
              await workflowReporter({
                phase: 'repair',
                state: 'started',
                title: '用户选择继续修复',
                detail: `修复上限已扩展到 ${maxRounds} 轮。`,
              });
              continue;
            }

            if (action === 'guide') {
              const guidance = await requestManualFixGuidance(prompt, localResult.command, localResult.output);
              webview.postMessage({ type: 'delta', text: `\n\n[手动修复建议]\n${guidance}\n` });
            }

            await workflowReporter({
              phase: 'repair',
              state: 'failed',
              title: '本地执行闭环结束（NG）',
              detail: `已达到最大修复轮次 ${maxRounds}，仍未通过本地命令。`,
            });
            webview.postMessage({ type: 'endResponse' });
            return;
          }

          await workflowReporter({
            phase: 'repair',
            state: 'started',
            title: `第 ${round + 1} 轮本地失败修复`,
            detail: '将本地失败输出升级为 Agent 闭环：读取文件、定位根因、修改并重新验证。',
          });

          const repairPrompt = buildLocalExecutionAgentRepairPrompt(prompt, localPlan, localResult, round + 1);
          const _errHint = getErrorFixHint(localResult.output);
          const repairPromptWithHint = _errHint
            ? `${repairPrompt}\n\n【历史同类错误修复参考】\n${_errHint}`
            : repairPrompt;
          const repairWsRoot = workspaceRoot
            || vscode.workspace.getWorkspaceFolder(vscode.Uri.file(localPlan.cwd))?.uri.fsPath
            || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            || localPlan.cwd;
          const repairTasks = buildLocalExecutionRepairTasks(localPlan, localResult, repairWsRoot);

          if (repairTasks.length === 0) {
            await workflowReporter({
              phase: 'repair',
              state: 'failed',
              title: '未找到可交给 Agent 修复的源码文件',
              detail: '本地执行失败后，未能从执行计划中解析出可修改文件。',
            });
            webview.postMessage({ type: 'endResponse' });
            return;
          }

          webview.postMessage({
            type: 'agentStatus',
            phase: 'plan',
            state: 'started',
            title: '本地执行失败，进入 Agent 修复',
            detail: '参考 Claude Code / Codex 的闭环策略：失败输出 → 读/搜源码 → 修改 → 重跑验证。',
            taskTotal: repairTasks.length,
          });
          webview.postMessage({
            type: 'agentStatus',
            phase: 'plan',
            state: 'completed',
            title: `已生成 ${repairTasks.length} 个修复子任务`,
            detail: repairTasks.map((t, i) => `${i + 1}. [${t.action}] ${nodePath.basename(t.file)} — ${t.desc}`).join('\n'),
            taskTotal: repairTasks.length,
          });

          const repairLoop = await runAgentLoop(
            repairTasks,
            repairPromptWithHint,
            mode,
            vscode.Uri.file(repairWsRoot),
            buildLocalExecutionAgentCallbacks({
              webview,
              workflowReporter,
              workspaceRoot: repairWsRoot,
              defaultWorkdir: localPlan.cwd,
              toolPolicy,
              consumeAgentSteer,
              confirmTerminal: (command, workdir) => requestInlineTerminalConfirmation(webview, command, workdir ?? ''),
              registerAppliedChange: (change) => registerPendingEditChange(webview, change),
              registerToMemory,
              sessionRecentFiles,
              repairFiles: repairTasks.map((task) => task.absPath).filter((absPath): absPath is string => Boolean(absPath)),
              mcpToolRefs: mcpManager.hasMcpTools ? mcpManager.toolRefs : undefined,
              onMcpToolCall: mcpManager.hasMcpTools
                ? (fakeName, args) => mcpManager.callTool(fakeName, args)
                : undefined,
              signal: chatSignal,
            }),
            undefined,
            0,
          );

          if (repairLoop.changedPaths.length > 0) {
            repairLoop.changedPaths.forEach((p) => {
              const absPath = nodePath.isAbsolute(p) ? p : nodePath.join(repairWsRoot, p);
              registerToMemory(absPath);
            });
            lastAgentChangedPaths = repairLoop.changedPaths
              .map(p => relPathFromRepairWorkspace(repairWsRoot, nodePath.isAbsolute(p) ? p : nodePath.join(repairWsRoot, p)))
              .filter((rel): rel is string => Boolean(rel));
          }

          if (repairLoop.tasksApplied === 0 && repairLoop.tasksFailed > 0) {
            await workflowReporter({
              phase: 'repair',
              state: 'failed',
              title: 'Agent 未能落地修复',
              detail: '本轮没有产生可应用的文件修改，停止本地执行闭环。',
            });
            webview.postMessage({ type: 'endResponse' });
            return;
          }
        }
      }
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
        await registerPendingEditChange(webview, change);
      }, pathResolutionHints, { rollbackOnValidationFailure: false });
      if (firstApply.applied && firstApply.validation && !firstApply.validation.ok) {
        await runClosedLoopRepair(webview, workflowReporter, prompt, mode, firstApply, pathResolutionHints);
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

async function runClosedLoopRepair(
  webview: vscode.Webview,
  reporter: (status: ApplyWorkflowStatus) => Promise<void>,
  originalPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  initialApply: ApplyWorkflowResult,
  preferredAbsolutePaths: string[] = lastConversationFiles,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('devseek');
  let maxRounds = Math.max(0, Math.min(6, config.get<number>('autoFixRounds', 6)));
  let current = initialApply;
  let priorRepairRejection = '';

  for (let round = 1; round <= maxRounds; round += 1) {
    const validation = current.validation;
    if (!validation || validation.ok) {
      if (validation?.ok) {
        await reporter({
          phase: 'repair',
          state: 'completed',
          title: '闭环修正完成（OK）',
          detail: `第 ${round - 1} 轮修正后通过自动验证。`,
        });
        emitLearningEvent({
          type: 'error_fixed',
          errorFingerprint: fingerprintError(validation.output ?? ''),
          fixSummary: `round=${round - 1} cmd=${validation.command}`,
          sessionId: activeSessionId,
        });
      }
      return;
    }

    await reporter({
      phase: 'repair',
      state: 'started',
      title: `第 ${round} 轮自动修正`,
      detail: `基于验证失败结果回传 DeepSeek：\n命令: ${validation.command}\nexitCode: ${validation.exitCode ?? 'null'}`,
    });

    const repairPrompt = buildRepairPrompt(originalPrompt, current.changedPaths, validation, round, priorRepairRejection);
    priorRepairRejection = '';
    let repairResponse = '';
    let resetNoticeSent = false;

    try {
      repairResponse = await routeChat({
        prompt: repairPrompt,
        newSession: false,
        mode,
        onDelta: (delta) => {
          if (delta.startsWith('\x00RESET\x00') && !resetNoticeSent) {
            resetNoticeSent = true;
            webview.postMessage({ type: 'delta', text: '\n\n[自动修正] 已收到修正草案（全量覆盖）。\n' });
          }
        },
      });
    } catch (error) {
      await reporter({
        phase: 'repair',
        state: 'failed',
        title: '自动修正请求失败',
        detail: (error as Error).message,
      });
      return;
    }

    const repairApply = await applyGeneratedArtifactsWithPrompt(
      repairResponse,
      repairPrompt,
      reporter,
      true,
      async (change) => {
        await registerPendingEditChange(webview, change);
      },
      preferredAbsolutePaths,
      { rollbackOnValidationFailure: false },
    );
    if (!repairApply.applied) {
      if (responseClaimsStatusOk(repairResponse) && !validation.ok && round < maxRounds) {
        priorRepairRejection = [
          '上一轮 DeepSeek 只返回 STATUS: OK 或“无需修改”，但 DevSeek 本地验证仍是失败状态。',
          `失败命令: ${validation.command}`,
          `exitCode: ${validation.exitCode ?? 'null'}`,
          '请不要再自判 OK；必须输出至少一个可应用的文件变更，或输出 STATUS: NG。',
        ].join('\n');
        await reporter({
          phase: 'repair',
          state: 'started',
          title: '已拒绝模型 STATUS: OK，自验证仍失败',
          detail: priorRepairRejection,
        });
        continue;
      }
      await reporter({
        phase: 'repair',
        state: 'failed',
        title: '自动修正未产出可应用文件',
        detail: 'DeepSeek 返回内容无法解析为文件变更，请手动调整提示词。',
      });
      return;
    }
    current = repairApply;

    if (round >= maxRounds) {
      const validationNow = current.validation;
      if (validationNow && !validationNow.ok) {
        const action = await askRepairExhaustedAction('自动修复达到上限', `已执行 ${maxRounds} 轮自动修复，仍未通过验证。`);
        if (action === 'continue') {
          maxRounds += 3;
          await reporter({
            phase: 'repair',
            state: 'started',
            title: '用户选择继续修复',
            detail: `修复上限已扩展到 ${maxRounds} 轮。`,
          });
          continue;
        }

        if (action === 'guide') {
          const guidance = await requestManualFixGuidance(originalPrompt, validationNow.command, validationNow.output);
          webview.postMessage({ type: 'delta', text: `\n\n[手动修复建议]\n${guidance}\n` });
        }
      }
    }
  }

  const finalValidation = current.validation;
  if (finalValidation && !finalValidation.ok) {
    await reporter({
      phase: 'repair',
      state: 'failed',
      title: '闭环修正结束（NG）',
      detail: `达到最大修正轮次后仍未通过。\n命令: ${finalValidation.command}\nexitCode: ${finalValidation.exitCode ?? 'null'}\n${finalValidation.output.slice(0, 1000)}`,
    });
  }
}

async function askRepairExhaustedAction(title: string, detail: string): Promise<'continue' | 'guide' | 'stop'> {
  const choice = await vscode.window.showWarningMessage(
    `${title}：${detail}`,
    '继续 3 轮',
    '给出手动修改建议',
    '停止',
  );
  if (choice === '继续 3 轮') return 'continue';
  if (choice === '给出手动修改建议') return 'guide';
  return 'stop';
}

async function requestManualFixGuidance(originalPrompt: string, command: string, output: string): Promise<string> {
  try {
    const guidancePrompt = [
      '请给出简洁的人工修复建议（分步骤），用于开发者手动修改代码。',
      '要求：只给操作步骤和可能修改的文件，不输出大段代码。',
      '',
      '原始需求：',
      originalPrompt,
      '',
      '失败命令：',
      command,
      '',
      '错误输出：',
      '```text',
      (output || '（无输出）').slice(0, 5000),
      '```',
    ].join('\n');

    const reply = await routeChat({
      prompt: guidancePrompt,
      newSession: false,
      stream: false,
    });
    return (reply || '未能生成建议。').trim();
  } catch {
    return '建议：先定位首个编译错误对应文件与符号，再最小化修改后重新编译。';
  }
}

function buildRepairPrompt(
  originalPrompt: string,
  changedPaths: string[],
  validation: { command: string; exitCode: number | null; output: string; cwd: string; ok?: boolean; mode?: string; reason?: string },
  round: number,
  priorRepairRejection = '',
): string {
  const paths = changedPaths.length > 0 ? changedPaths.join('\n') : '（未知）';
  const output = (validation.output || '').trim().slice(0, 6000);
  return [
    '你是一个严格执行修复闭环的高级编程助手。',
    `这是第 ${round} 轮自动修复。上一次自动验证失败，请直接修复。`,
    '注意：本地验证状态为 FAILED。即使 stdout 中出现成功文本，或旧日志里出现 exitCode=0，也不能把本轮判定为 OK；验证是否通过只由 DevSeek 下一轮本地命令决定。',
    priorRepairRejection ? `\n上一轮无效修复反馈：\n${priorRepairRejection}` : '',
    '',
    '原始需求：',
    originalPrompt,
    '',
    '已落地文件：',
    paths,
    '',
    `自动验证命令（cwd=${validation.cwd}）：`,
    validation.command,
    '',
    `验证状态：FAILED${validation.mode ? ` mode=${validation.mode}` : ''}${validation.reason ? ` reason=${validation.reason}` : ''}`,
    `验证结果：exitCode=${validation.exitCode ?? 'null'}`,
    '```text',
    output || '（无输出）',
    '```',
    '',
    '请只输出可直接应用的文件变更，不要解释。',
    '输出格式要求：',
    '1. 多文件时，按“文件 1：path/to/file.ext”+ 对应代码块 输出。',
    '2. 不要输出目录树、流程图、编译命令说明。',
    '3. 当前本地验证已失败，禁止只输出 STATUS: OK 或“无需修改”。',
    '4. 若能修复，必须输出至少一个已落地文件的完整源码或可应用补丁。',
    '5. 若无法修复，在末尾单独输出一行：STATUS: NG',
  ].join('\n');
}

function responseClaimsStatusOk(text: string): boolean {
  return /(?:^|\n)\s*STATUS\s*:\s*OK\s*(?:\n|$)/i.test(text || '');
}

function appendStructuredGenerationHint(prompt: string): string {
  return [
    prompt,
    '',
    '【输出格式要求（用于自动落地）】',
    '1. 如果是多文件，请按“文件 1：相对路径”+ 代码块逐个输出。',
    '2. 禁止把目录树、层次图、编译命令放进代码块。',
    '3. 每个代码块只包含该文件源码，不要附加说明文字。',
    '4. 路径请使用相对路径，且与文件名一一对应。',
  ].join('\n');
}

/**
 * 当附件文件已知时，生成包含实际路径示例的具体格式提示（参考 Aider strict-format 思路）。
 * 比泛化提示更能引导 DeepSeek 输出可解析格式。
 */
function appendFileAwareFormatHint(prompt: string, absoluteFilePaths: string[]): string {
  // 只向 DeepSeek 提供文件名（不含路径），由插件自己负责路径映射
  const basenames = absoluteFilePaths.map(f => nodePath.basename(f));
  const exampleLang = (i: number) => fenceLangForFile(basenames[i] ?? '');
  const examples = basenames.slice(0, 3).map((name, i) =>
    `文件 ${i + 1}: ${name}\n\`\`\`${exampleLang(i)}\n// 文件完整内容\n\`\`\``
  );
  if (basenames.length > 3) {
    examples.push(`……（其余 ${basenames.length - 3} 个文件依此格式）`);
  }
  return [
    prompt,
    '',
    '【必须遵守的输出格式（用于自动落地文件）】',
    `涉及以下 ${basenames.length} 个文件的修改，每个代码块前必须有单独文件名标注行，示例：`,
    '',
    examples.join('\n\n'),
    '',
    `文件名列表（共 ${basenames.length} 个）：`,
    basenames.map(n => `  ${n}`).join('\n'),
    '',
    '禁止省略文件名标注，禁止合并多文件输出到一个代码块。',
  ].join('\n');
}

/** 解析失败后发追问，要求 DeepSeek 按标准格式重新整理输出 */
function buildReformatPrompt(absoluteFilePaths: string[]): string {
  const basenames = absoluteFilePaths.map(f => nodePath.basename(f));
  const examples = basenames.slice(0, 3).map((name, i) => {
    const lang = fenceLangForFile(name);
    return `文件 ${i + 1}: ${name}\n\`\`\`${lang}\n// 文件完整内容\n\`\`\``;
  });
  const extraNote = basenames.length > 3
    ? `\n……（其余 ${basenames.length - 3} 个文件同样格式）`
    : '';
  return [
    '请将上面的修改按以下格式重新整理输出，每个代码块前必须有文件名行，只输出代码，不要解释：',
    '',
    examples.join('\n\n') + extraNote,
    '',
    `文件名从以下列表中选取（共 ${basenames.length} 个）：`,
    basenames.map(n => `  ${n}`).join('\n'),
  ].join('\n');
}


// ----------------------------------------------------------------
// ChatPanel — 保持与 commands/index.ts 的兼容接口
// ----------------------------------------------------------------
export class ChatPanel {
  /** 从代码命令分发消息到面板 */
  static push(userDisplay: string, prompt: string, newSession: boolean): void {
    viewProvider.push(userDisplay, prompt, newSession);
  }
}

function getChatHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const markedJs = fs.readFileSync(
        nodePath.join(extensionUriGlobal.fsPath, 'media', 'marked.umd.js'),
        'utf8',
    );
    const webviewJs = fs.readFileSync(
        nodePath.join(extensionUriGlobal.fsPath, 'media', 'webview.js'),
        'utf8',
    );
    const mermaidUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUriGlobal, 'media', 'mermaid.min.js'),
    );
    const codiconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUriGlobal, 'media', 'codicon.css'),
    );
    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           script-src 'nonce-${nonce}';
           style-src 'unsafe-inline' ${webview.cspSource};
           font-src ${webview.cspSource};
           img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevSeek</title>
<link rel="stylesheet" href="${codiconUri}">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html { height: 100%; overflow: hidden; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
#messages {
  background: var(--vscode-sideBar-background);
}
.turn.enter { animation: turnIn .18s ease-out; }
@keyframes turnIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
#toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}
#ready-progress {
  height: 2px;
  width: 100%;
  background: transparent;
  overflow: hidden;
  flex-shrink: 0;
}
#ready-progress .bar {
  height: 100%;
  width: 34%;
  background: linear-gradient(90deg, rgba(99,179,255,0), rgba(99,179,255,.95), rgba(99,179,255,0));
  animation: loadingSlide 1.1s ease-in-out infinite;
}
#ready-progress.done { opacity: 0; height: 0; transition: opacity .2s ease, height .2s ease; }
@keyframes loadingSlide {
  from { transform: translateX(-120%); }
  to { transform: translateX(320%); }
}
#toolbar .title { flex: 1; font-size: 11px; font-weight: 600; opacity: .65; text-transform: uppercase; letter-spacing: .05em; }
#toolbar button {
  font-size: 11px; padding: 2px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 3px; cursor: pointer;
}
#toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
#toolbar button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
#toolbar #sessions-btn { padding: 2px 8px; display:inline-flex; align-items:center; gap:5px; }
/* ── Sessions Panel (history drawer, scoped below toolbar) ── */
#content-area {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#sessions-panel {
  display: none; flex-direction: column;
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--vscode-sideBar-background);
  z-index: 100;
}
#sessions-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}
#sessions-panel-header span {
  font-size: 11px; font-weight: 600; opacity: .65; text-transform: uppercase; letter-spacing: .05em;
}
#sessions-panel-header button {
  background: none; border: none; cursor: pointer; padding: 2px 6px;
  color: var(--vscode-foreground); font-size: 14px; opacity: .5; border-radius: 3px;
}
#sessions-panel-header button:hover { background: var(--vscode-button-secondaryHoverBackground); opacity: 1; }
#sessions-list { flex: 1 1 0; overflow-y: auto; padding: 4px 0; }
.session-item {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px;
  cursor: pointer; border-radius: 4px; margin: 1px 4px;
  border: 1px solid transparent;
}
.session-item:hover { background: var(--vscode-list-hoverBackground); }
.session-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  border-color: var(--vscode-focusBorder, rgba(99,179,255,.4));
}
.session-item-body { flex: 1; min-width: 0; }
.session-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-date { font-size: 10px; opacity: .5; margin-top: 1px; }
.session-delete-btn {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--vscode-foreground); opacity: 0; padding: 2px 5px;
  border-radius: 3px; font-size: 13px; line-height: 1;
}
.session-item:hover .session-delete-btn { opacity: .4; }
.session-delete-btn:hover { opacity: 1 !important; background: var(--vscode-inputValidation-errorBackground); }
.sessions-empty { padding: 20px 12px; text-align: center; font-size: 12px; opacity: .45; }
#sessions-panel-footer {
  flex-shrink: 0; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border);
}
#sessions-panel-footer button {
  width: 100%; font-size: 11px; padding: 4px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; border-radius: 3px; cursor: pointer;
}
#sessions-panel-footer button:hover { background: var(--vscode-button-secondaryHoverBackground); }
/* restored session banner */
.session-restore-banner {
  display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
  font-size: 11px; padding: 5px 8px;
  background: rgba(127,127,127,.08);
  border-radius: 6px; margin: 0 0 4px;
  border-left: 2px solid var(--vscode-charts-blue, #4fc1ff);
}
.srb-label { font-weight: 600; opacity: .7; }
.srb-date { opacity: .45; font-size: 10px; }
.srb-hint { margin-left: auto; opacity: .4; font-size: 10px; font-style: italic; }
.srb-summary-wrap { margin: 2px 0 4px; }
.srb-summary-toggle {
  background: none; border: none; cursor: pointer; font-size: 11px;
  color: var(--vscode-foreground); opacity: .5; padding: 2px 0;
}
.srb-summary-toggle:hover { opacity: .85; }
.srb-summary-body {
  margin-top: 4px; padding: 6px 10px;
  background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.06));
  border-radius: 4px; font-size: 11.5px; line-height: 1.55;
}
.srb-summary-body h2 { font-size: 12px; opacity: .8; margin: 6px 0 2px; }
.srb-summary-body ul { margin: 2px 0 4px; padding-left: 16px; }
.srb-summary-body li { margin: 1px 0; }
.srb-files-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; padding: 0 2px; }
/* Session list item enhancements */
.session-title-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.session-title { font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.session-badge {
  flex-shrink: 0; font-size: 9px; background: rgba(127,127,127,.15);
  border-radius: 3px; padding: 1px 4px; opacity: .7; white-space: nowrap;
}
.session-badge.file-badge { background: rgba(78,201,176,.12); color: var(--vscode-charts-green, #4ec9b0); opacity: 1; }
.session-digest {
  font-size: 10px; opacity: .5; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.3;
}
/* shared chip / badge */
.soc-badge {
  font-size: 9px; background: rgba(127,127,127,.15);
  border-radius: 3px; padding: 1px 5px; opacity: .7;
}
.soc-badge.file-badge { background: rgba(78,201,176,.12); color: var(--vscode-charts-green, #4ec9b0); opacity: 1; }
.soc-file-chip {
  display: inline-block; font-size: 10px; font-family: var(--vscode-editor-font-family, monospace);
  background: rgba(127,127,127,.12); border-radius: 3px;
  padding: 1px 5px; margin: 1px 0;
}
.soc-history-wrap { margin-top: 4px; border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.15)); padding-top: 4px; }
#messages { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 8px; display: flex; flex-direction: column; gap: 12px; }
.turn { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.turn.user-turn  { align-items: flex-end; }
.turn.assistant-turn { align-items: flex-start; width: 100%; }
.user-bubble {
  max-width: 90%;
  width: fit-content;
  background: var(--vscode-chat-requestBubbleBackground, var(--vscode-chat-requestBackground, var(--vscode-input-background)));
  color: var(--vscode-foreground);
  border-radius: var(--vscode-cornerRadius-xLarge, 12px);
  padding: 8px 12px; font-size: .92em; line-height: 1.5;
  word-break: break-word;
}
.user-bubble-wrap { display:flex; flex-direction:column; align-items:flex-end; gap:4px; max-width: 90%; }
.user-msg-actions { display:flex; gap:6px; opacity:.78; }
.user-msg-actions button {
  border:none; border-radius:4px; padding:1px 7px; cursor:pointer;
  font-size:10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
}
.user-msg-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); opacity:1; }
.user-edit-wrap {
  width: 100%;
  background: rgba(127,127,127,.12);
  border: 1px solid rgba(127,127,127,.32);
  border-radius: 8px;
  padding: 6px;
}
.user-edit-wrap textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 6px 8px;
  font: inherit;
}
.user-edit-actions { display:flex; justify-content:flex-end; gap:6px; margin-top:6px; }
.user-edit-actions button {
  border:none; border-radius:4px; padding:3px 10px; cursor:pointer; font-size:11px;
  background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
}
.user-edit-actions button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.user-bubble pre { background: rgba(127,127,127,.14); border-radius: 4px; padding: 6px 8px; margin: 4px 0; overflow-x: auto; font-size: .88em; }
.user-bubble code { font-family: var(--vscode-editor-font-family, monospace); }
.user-bubble p { margin: 0 0 4px; }
.user-bubble p:last-child { margin-bottom: 0; }
.user-bubble-images { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; max-width:100%; }
.user-bubble-img { max-width:min(180px, 100%); max-height:120px; border-radius:4px; border:1px solid var(--vscode-widget-border,#ccc); object-fit:contain; cursor:zoom-in; background:var(--vscode-editor-background); }
.user-bubble-img:hover { opacity:.85; }
.assistant-bubble {
  max-width: 100%;
  width: 100%;
  font-size: .92em;
  line-height: 1.68;
  word-break: break-word;
  padding: 2px 0;
}
.assistant-bubble p { margin: 0 0 6px; }
.assistant-bubble ul,.assistant-bubble ol { padding-left: 1.3em; margin: 0 0 6px; }
.assistant-bubble h1,.assistant-bubble h2,.assistant-bubble h3 { margin: 8px 0 4px; font-size: 1em; font-weight: 600; }
.assistant-bubble h1,.assistant-bubble h2,.assistant-bubble h3,.assistant-bubble h4 {
  border-bottom: 1px solid rgba(127,127,127,.23);
  padding-bottom: 4px;
}
.assistant-bubble blockquote {
  margin: 8px 0;
  padding: 6px 10px;
  border-left: 3px solid rgba(110, 168, 255, .65);
  background: rgba(127,127,127,.08);
  border-radius: 0 8px 8px 0;
  opacity: .95;
}
.assistant-bubble hr {
  border: none;
  border-top: 1px dashed rgba(127,127,127,.35);
  margin: 10px 0;
}
.assistant-bubble pre {
  position: relative;
  background: linear-gradient(180deg, rgba(127,127,127,0.12), rgba(127,127,127,0.04));
  border: 1px solid rgba(127,127,127,0.35);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 18px rgba(0,0,0,0.14);
  padding: 10px 12px; padding-top: 34px;
  margin: 8px 0; overflow-x: auto; font-size: .9em;
  line-height: 1.6;
}
.assistant-bubble code { font-family: var(--vscode-editor-font-family, monospace); }
.assistant-bubble :not(pre) > code {
  background: var(--vscode-textPreformat-background, rgba(127,127,127,.16));
  border: 1px solid var(--vscode-textPreformat-border, rgba(127,127,127,.2));
  color: var(--vscode-textPreformat-foreground);
  padding: 1px 3px;
  border-radius: 4px;
  font-size: .9em;
}
.code-toolbar {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--vscode-textCodeBlock-background, rgba(40,44,52,.95));
  border-bottom: 1px solid rgba(127,127,127,.18);
  border-radius: 10px 10px 0 0;
}
.code-lang {
  font-size: 10px;
  letter-spacing: .04em;
  text-transform: uppercase;
  font-weight: 600;
  opacity: .52;
  color: var(--vscode-descriptionForeground);
}
.code-actions { display: inline-flex; gap: 4px; }
.code-toolbar button { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; cursor: pointer; }
.code-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.insert-btn { background: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; }
.assistant-bubble code .tok-keyword { color: #e28bff; font-weight: 600; }
.assistant-bubble code .tok-type { color: #7cc9ff; }
.assistant-bubble code .tok-string { color: #9ad97c; }
.assistant-bubble code .tok-number { color: #f7c66f; }
.assistant-bubble code .tok-comment { color: #7f8b99; font-style: italic; }
.assistant-bubble code .tok-preproc { color: #f4a261; }
.assistant-bubble code .tok-fn { color: #65d6c2; }
.cursor::after { content: '\u25ae'; animation: blink .7s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.thinking-dots { display:inline-flex; gap:3px; align-items:center; opacity:.55; padding:2px 0; }
.thinking-dots span { width:5px; height:5px; border-radius:50%; background:currentColor; display:inline-block; animation:tdot 1.2s ease-in-out infinite; }
.thinking-dots span:nth-child(2) { animation-delay:.2s; }
.thinking-dots span:nth-child(3) { animation-delay:.4s; }
@keyframes tdot { 0%,80%,100%{ opacity:.2; transform:scale(.7); } 40%{ opacity:1; transform:scale(1); } }
.error-msg { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; padding: 6px 10px; font-size: .85em; white-space: pre-wrap; }
.generated-files-panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(127,127,127,.3);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(127,127,127,.12), rgba(127,127,127,.05));
  font-size: .83em;
}
.generated-files-panel .gfp-label {
  opacity: .88;
  margin-right: 0;
}
.generated-files-panel .gfp-btn {
  border: none;
  border-radius: 4px;
  padding: 2px 9px;
  cursor: pointer;
  font-size: .95em;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.generated-files-panel .gfp-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.generated-files-panel .gfp-btn.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.generated-files-panel .gfp-btn.path-ref {
  background: linear-gradient(180deg, rgba(90, 170, 255, .30), rgba(60, 140, 240, .22));
  color: var(--vscode-button-foreground);
  border: 1px solid rgba(90, 170, 255, .55);
  font-weight: 600;
}
.generated-files-panel .gfp-btn.path-ref:hover {
  background: linear-gradient(180deg, rgba(90, 170, 255, .42), rgba(60, 140, 240, .32));
}
.generated-files-panel .gfp-map {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.generated-files-panel .gfp-map-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid rgba(127,127,127,.22);
  border-radius: 7px;
  background: rgba(127,127,127,.06);
}
.generated-files-panel .gfp-item-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.generated-files-panel .gfp-main-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.assistant-generated-summary {
  padding: 4px 8px;
  border: 1px solid rgba(127,127,127,.18);
  border-radius: 6px;
  background: rgba(127,127,127,.05);
  font-size: .82em;
  opacity: .65;
}
.workflow-card {
  max-width: 100%;
  padding: 9px 11px;
  border-radius: 9px;
  font-size: .84em;
  line-height: 1.58;
  white-space: pre-wrap;
  border: 1px solid rgba(127,127,127,.28);
  background: linear-gradient(180deg, rgba(127,127,127,.12), rgba(127,127,127,.05));
}
.workflow-card.state-failed {
  border-color: rgba(255, 120, 120, .45);
  background: linear-gradient(180deg, rgba(255,120,120,.11), rgba(127,127,127,.05));
}
.workflow-card.state-passed {
  border-color: rgba(120, 220, 150, .42);
  background: linear-gradient(180deg, rgba(120,220,150,.11), rgba(127,127,127,.05));
}
.workflow-card .wf-head {
  font-weight: 700;
  margin-bottom: 5px;
}
#input-area { position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--vscode-panel-border); padding: 6px; flex-shrink: 0; }
#input-row { display: flex; gap: 4px; }
#file-badges { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 2px; min-height: 0; }
#file-badges:empty { display: none; }
.file-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px 2px 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; font-size: .78em; max-width: 220px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file-badge .badge-remove { cursor: pointer; opacity: .7; margin-left: 2px; font-size: .9em; flex-shrink: 0; }
.file-badge .badge-remove:hover { opacity: 1; }
#context-files-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0 1px; align-items: center; min-height: 0; }
#context-files-row:empty { display: none; }
.ctx-label { font-size: .72em; opacity: .45; margin-right: 2px; flex-shrink: 0; white-space: nowrap; }
.ctx-file-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 7px; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); border-radius: 8px; font-size: .75em; opacity: .75; }
.ctx-file-badge .ctx-remove { cursor: pointer; opacity: .55; margin-left: 1px; font-size: .9em; flex-shrink: 0; }
.ctx-file-badge .ctx-remove:hover { opacity: 1; }
#input { flex: 1; resize: none; font-family: inherit; font-size: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 6px 8px; min-height: 38px; max-height: 160px; overflow-y: auto; line-height: 1.4; }
#input:focus { outline: 1px solid var(--vscode-focusBorder); }
#send-btn { padding: 0 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; font-size: 16px; flex-shrink: 0; }
#send-btn:hover { background: var(--vscode-button-hoverBackground); }
#input-hint { font-size: 10px; opacity: .45; margin-top: 3px; text-align: right; }
#jump-latest {
  position: absolute;
  right: 14px;
  bottom: 104px;
  z-index: 5;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  display: none;
}
#jump-latest.show { display: inline-block; }
#suggest-popup { display: none; position: absolute; bottom: 100%; left: 0; right: 0; background: var(--vscode-editorSuggestWidget-background, var(--vscode-input-background)); border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-panel-border)); border-radius: 6px; max-height: 180px; overflow-y: auto; z-index: 999; margin-bottom: 2px; }
#suggest-popup .item { padding: 5px 10px; cursor: pointer; display: flex; gap: 8px; align-items: center; font-size: .88em; }
#suggest-popup .item:hover, #suggest-popup .item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
#suggest-popup .item .lbl { font-weight: 600; min-width: 90px; }
#suggest-popup .item .desc { opacity: .65; font-size: .9em; }
/* ---- 状态栏 ---- */
#status-bar { display: flex; align-items: center; gap: 5px; padding: 3px 8px 4px; border-top: 1px solid var(--vscode-panel-border); font-size: 10px; flex-shrink: 0; background: var(--vscode-sideBar-background); min-width: 0; overflow: hidden; }
.s-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.s-online { background: #4caf50; }
.s-offline { background: #f44336; }
.s-pending { background: #ff9800; animation: blink .9s step-end infinite; }
#status-text { opacity: .7; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#login-btn { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; }
#login-btn:hover { background: var(--vscode-button-hoverBackground); }
.s-spacer { flex: 1; }
#mode-switcher { display: flex; gap: 2px; flex-shrink: 0; }
.mode-btn { font-size: 10px; padding: 1px 9px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .65; }
.mode-btn:hover { opacity: 1; }
.mode-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: transparent; }
#autopilot-btn { font-size: 10px; padding: 1px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .55; }
#autopilot-btn:hover { opacity: 1; }
#autopilot-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: rgba(90,170,255,.5); }
#agent-toggle-btn { font-size: 10px; padding: 1px 9px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; border-radius: 3px; cursor: pointer; opacity: .65; }
#agent-toggle-btn:hover { opacity: 1; }
#agent-toggle-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; border-color: rgba(90,170,255,.5); }
#status-bar button { white-space: nowrap; }
@media (max-width: 360px) {
  .mode-btn, #autopilot-btn, #agent-toggle-btn, #switch-provider-btn, #login-btn { padding-left: 5px; padding-right: 5px; }
  #agent-toggle-btn, #autopilot-btn { max-width: 58px; overflow: hidden; text-overflow: ellipsis; }
}
.mermaid-block { margin: 8px 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; width: 100%; box-sizing: border-box; }
.mermaid-tabs { display: flex; background: var(--vscode-textCodeBlock-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 0 4px; }
.mermaid-tab { padding: 5px 14px; font-size: .82em; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--vscode-foreground); opacity: .55; }
.mermaid-tab.active { opacity: 1; border-bottom-color: var(--vscode-button-background); font-weight: 600; }
.mermaid-tab:hover { opacity: .85; }
.mermaid-render-panel { overflow: hidden; position: relative; cursor: grab; width: 100%; box-sizing: border-box; min-height: 60px; }
.mermaid-render-panel svg { display:block; }
.mermaid-zoom-bar { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--vscode-textCodeBlock-background); border-top: 1px solid var(--vscode-panel-border); }
.mermaid-zoom-btn { padding: 1px 8px; font-size: 13px; line-height: 1.4; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; font-family: monospace; }
.mermaid-zoom-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.mermaid-zoom-label { font-size: .78em; min-width: 38px; text-align: center; color: var(--vscode-descriptionForeground); }
.mermaid-render-error { color: var(--vscode-errorForeground); font-size: .82em; padding: 8px; }
.mermaid-code-panel { position: relative; }
.mermaid-code-panel pre { margin: 0; background: var(--vscode-textCodeBlock-background); padding: 10px 12px; padding-top: 30px; overflow-x: auto; font-size: .87em; font-family: var(--vscode-editor-font-family, monospace); white-space: pre; }
.mermaid-copy-btn { position: absolute; top: 4px; right: 6px; font-size: 10px; padding: 2px 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; }
.mermaid-copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
/* ---- 表格样式 ---- */
.assistant-bubble table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: .9em; }
.assistant-bubble th, .assistant-bubble td { border: 1px solid var(--vscode-panel-border); padding: 5px 12px; text-align: left; vertical-align: top; }
.assistant-bubble th { background: var(--vscode-textCodeBlock-background); font-weight: 600; }
.assistant-bubble tr:nth-child(even) td { background: rgba(128,128,128,.04); }
</style>
</head>
<body style="position:relative;">
<div id="toolbar">
  <button id="sessions-btn" title="历史对话"><i class="codicon codicon-history"></i> 历史对话</button>
  <button id="new-session-btn" title="开启新 AI 对话">+ 新对话</button>
  <button id="clear-btn" title="清空界面消息">清空</button>
</div>
<div id="content-area">
<div id="sessions-panel">
  <div id="sessions-panel-header">
    <span>历史对话</span>
    <button id="sessions-close-btn" title="关闭" style="margin-left:auto">×</button>
  </div>
  <div id="sessions-list"></div>
  <div id="sessions-panel-footer">
    <button id="sessions-new-btn">+ 新建对话</button>
  </div>
</div>
<div id="ready-progress"><div class="bar"></div></div>
<div id="messages"></div>
<button id="jump-latest" title="跳到最新消息">⬇ 新内容</button>
<div id="input-area">
  <div id="suggest-popup"></div>
  <div id="file-badges"></div>
  <div id="context-files-row"></div>
  <div id="agent-queue-indicator"></div>
  <div id="input-row">
    <textarea id="input" rows="1" placeholder="问 DevSeek...  / 命令  @文件  #problems"></textarea>
    <button id="send-btn" title="发送 (Enter)">&#x27a4;</button>
  </div>
  <div id="input-hint">Shift+Enter 换行 &middot; ⏹ 停止生成 &middot; / 命令 &middot; @文件 &middot; #problems</div>
</div>
</div>
<div id="status-bar">
  <span class="s-dot s-pending" id="s-dot"></span>
  <span id="status-text">连接中...</span>
  <button id="login-btn" style="display:none">🔑 登录</button>
  <button id="switch-provider-btn" title="切换 LLM Provider / 设置">&#9881;</button>
  <span class="s-spacer"></span>
  <div id="mode-switcher">
    <button class="mode-btn active" data-mode="fast">⚡ 快速</button>
    <button class="mode-btn" data-mode="r1">🧠 专家 R1</button>
  </div>
  <button id="agent-toggle-btn" title="Agent 模式：开启时自动解析意图和执行多轮编辑，关闭时强制走普通对话">🤖 Agent</button>
  <button id="autopilot-btn" title="自动驾驶：开启后 Agent 完成时自动接受所有文件改动">🤖 自动</button>
</div>
<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}">/*MARKED_PLACEHOLDER*/</script>
<script nonce="${nonce}">window.__wsFolderName = ${JSON.stringify(vscode.workspace.workspaceFolders?.[0]?.name ?? '')};</script>
<script nonce="${nonce}">/*WEBVIEW_PLACEHOLDER*/</script>
</body>
</html>`;
    return html
        .replace('/*MARKED_PLACEHOLDER*/', () => markedJs)
        .replace('/*WEBVIEW_PLACEHOLDER*/', () => webviewJs);
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

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
  if (!opts.trackHistory) return;

  const displayText = opts.displayPrompt ?? opts.prompt;
  nonBridgeChatHistory.push({ role: 'user', content: displayText });
  nonBridgeChatHistory.push({ role: 'assistant', content: response });

  // T3: Auto-compact checkpoint when history reaches 20 turns (40 messages)
  // Fires LLM summary in background, keeps newest 20 in-memory, summary persists for session restore.
  if (nonBridgeChatHistory.length >= 40 && activeSessionId) {
    const _toCompact = nonBridgeChatHistory.slice(0, 20);
    nonBridgeChatHistory = nonBridgeChatHistory.slice(20);
    const _compactId = activeSessionId;
    void (async () => {
      await compactAndSaveHistory(_toCompact, _compactId);
      const freshSummary = extContext?.workspaceState.get<string>(`deepseek.session.${_compactId}.summary`);
      if (freshSummary && _compactId === activeSessionId) {
        const _hasPair = nonBridgeChatHistory[0]?.role === 'user' && nonBridgeChatHistory[0]?.content?.startsWith('[上次会话背景');
        const _hasLegacy = nonBridgeChatHistory[0]?.role === 'assistant' && (nonBridgeChatHistory[0]?.content?.startsWith('【历史摘要】\n') || nonBridgeChatHistory[0]?.content?.startsWith('【上次 session 摘要】\n'));
        if (_hasPair) {
          nonBridgeChatHistory[0] = { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${freshSummary}` };
        } else if (_hasLegacy) {
          nonBridgeChatHistory[0] = { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${freshSummary}` };
          nonBridgeChatHistory.splice(1, 0, { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' });
        } else {
          nonBridgeChatHistory.unshift(
            { role: 'user' as const, content: `[上次会话背景，请基于此继续工作]\n${freshSummary}` },
            { role: 'assistant' as const, content: '好的，我已了解上次的工作进展，可以继续。' },
          );
        }
      }
    })();
  } else if (nonBridgeChatHistory.length > 40) {
    nonBridgeChatHistory = nonBridgeChatHistory.slice(-40);
  }

  // L1a: auto-save session history + update updatedAt.
  if (activeSessionId) {
    const existing = getSessions().find(s => s.id === activeSessionId);
    if (existing) {
      saveSessionMeta({ ...existing, updatedAt: Date.now() });
    }
  }
  saveCurrentSession();

  // L2: ensure session metadata title is set from first user message.
  if (nonBridgeChatHistory.length === 2 && activeSessionId) {
    const sessions = getSessions();
    if (!sessions.some(s => s.id === activeSessionId)) {
      saveSessionMeta({ id: activeSessionId, title: displayText.slice(0, 50), createdAt: Date.now(), updatedAt: Date.now() });
    }
  }
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
    (opts.images && opts.images.length > 0 && pType !== 'bridge')
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

function getNonce(): string {
  return require('crypto').randomBytes(16).toString('hex');
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
  if (_histToSave[0]?.role === 'user' && _histToSave[0]?.content?.startsWith('[上次会话背景') &&
      _histToSave[1]?.role === 'assistant' && _histToSave[1]?.content === '好的，我已了解上次的工作进展，可以继续。') {
    _histToSave = _histToSave.slice(2);
  } else if (_histToSave[0]?.role === 'assistant' && (_histToSave[0]?.content?.startsWith('【上次 session 摘要】\n') || _histToSave[0]?.content?.startsWith('【历史摘要】\n'))) {
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

function initOrRestoreSession(): void {
  if (!extContext) return;
  const sessionService = getSessionService();
  const savedId = sessionService?.getActiveSessionId() ?? '';
  const sessions = getSessions();
  if (savedId && sessions.some(s => s.id === savedId)) {
    activeSessionId = savedId;
    const files = extContext.workspaceState.get<Record<string, string>>(
      `deepseek.session.${savedId}.files`, {},
    ) ?? {};
    sessionRecentFiles.clear();
    for (const [k, v] of Object.entries(files)) sessionRecentFiles.set(k, v);
    // On startup, do NOT inject the previous session's summary into the LLM context.
    // nonBridgeChatHistory starts empty — the user sees the last session's history in the
    // UI (via the 'ready' → 'sessionLoaded' flow) but the LLM context is fresh.
    // The summary is only injected when the user explicitly continues a session via
    // loadSession handler or sends a first message with newSession=false in that session.
    nonBridgeChatHistory = [];
    // L2: restore analysis context from workspaceState (persists analyze findings across reload)
    const savedAnalysis = extContext.workspaceState.get<string>(`deepseek.session.${savedId}.analysisText`, '') ?? '';
    if (savedAnalysis) lastAnalysisText = savedAnalysis;
    restoreLastAgentPathsFromSession(savedId);
  } else {
    activeSessionId = generateSessionId();
    sessionService?.setActiveSessionId(activeSessionId);
  }
}

function insertCodeToEditor(code: string): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DeepSeek: 请先在编辑器中打开一个文件并定位光标');
    return;
  }
  editor.edit(eb => {
    if (editor.selection.isEmpty) {
      eb.insert(editor.selection.active, code);
    } else {
      eb.replace(editor.selection, code);
    }
  });
}

async function addResourceToChat(resource?: vscode.Uri): Promise<void> {
  let uri = resource;
  if (!uri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Add to DevSeek',
    });
    if (!picked || picked.length === 0) return;
    uri = picked[0];
  }

  const stat = await vscode.workspace.fs.stat(uri);
  const rel = vscode.workspace.asRelativePath(uri, false);

  if (stat.type === vscode.FileType.File) {
    viewProvider.addToChat(nodePath.basename(rel), '', uri.fsPath);
    return;
  }

  if (stat.type === vscode.FileType.Directory) {
    const files = await collectDirectoryFiles(uri, 30);
    if (files.length === 0) {
      vscode.window.showWarningMessage(`DeepSeek: 目录 ${rel} 下没有可发送的文件`);
      return;
    }
    // Show single directory badge; send all file paths in background when message is submitted
    const label = `${nodePath.basename(rel)}/ (${files.length})`;
    const filePaths = files.map(f => f.fsPath);
    viewProvider.addDirectoryToChat(label, filePaths);
  }
}

async function collectDirectoryFiles(root: vscode.Uri, maxFiles: number, extFilter?: RegExp): Promise<vscode.Uri[]> {
  const collected: vscode.Uri[] = [];

  async function walk(dir: vscode.Uri): Promise<void> {
    if (collected.length >= maxFiles) return;
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      if (collected.length >= maxFiles) return;
      if (shouldSkipDiscoveryDir(name)) continue;

      const child = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.Directory) {
        await walk(child);
        continue;
      }
      if (type !== vscode.FileType.File) continue;
      // Apply extension filter: if caller provided one, use it; otherwise use SOURCE_FILE_RE
      const filter = extFilter ?? SOURCE_FILE_RE;
      if (!shouldIncludeDiscoveredSourceFile(child.fsPath, filter)) continue;

      collected.push(child);
    }
  }

  await walk(root);
  return collected;
}

type GeneratedContentDisplayMode = 'hidden' | 'collapsed' | 'full';
type WorkingCopyStyle = 'concise' | 'detailed';

interface OpenGeneratedPathOptions {
  rawPath: string;
  line?: number;
  generatedText?: string;
  requestPrompt?: string;
  preferredAbsolutePaths?: string[];
}

function getGeneratedContentDisplayMode(): GeneratedContentDisplayMode {
  const config = vscode.workspace.getConfiguration('devseek');
  const mode = config.get<string>('generatedContentDisplayMode', 'collapsed');
  if (mode === 'hidden' || mode === 'full') return mode;
  return 'collapsed';
}

function getWorkingCopyStyle(): WorkingCopyStyle {
  const config = vscode.workspace.getConfiguration('devseek');
  const style = config.get<string>('workingCopyStyle', 'detailed');
  return style === 'concise' ? 'concise' : 'detailed';
}

function pushUiSettings(webview: vscode.Webview): void {
  const cfg = vscode.workspace.getConfiguration('devseek');
  webview.postMessage({
    type: 'uiSettings',
    generatedContentDisplayMode: getGeneratedContentDisplayMode(),
    workingCopyStyle: getWorkingCopyStyle(),
    autopilotMode: cfg.get<boolean>('autopilotMode', false),
    agentEnabled: cfg.get<boolean>('agentEnabled', true),
    maxAgentRounds: cfg.get<number>('maxAgentRounds', 25),
  });
}

interface GeneratedPathMeta {
  path: string;
  kind: 'file' | 'patch';
  operation: 'create' | 'update' | 'patch';
  exists: boolean;
}

async function emitResponseMeta(
  webview: vscode.Webview,
  rawResponse: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): Promise<void> {
  const artifacts = parseGeneratedArtifacts(rawResponse || '');
  const generatedPaths: GeneratedPathMeta[] = [];
  const seen = new Set<string>();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

  for (const artifact of artifacts) {
    const normalized = normalizePathForMeta(
      resolveGeneratedArtifactPathForPrompt(artifact.path, requestPrompt, preferredAbsolutePaths),
    );
    if (!isGeneratedArtifactAllowedForPrompt(normalized, requestPrompt, preferredAbsolutePaths)) continue;
    const key = `${artifact.type}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const exists = workspaceRoot ? await workspacePathExists(workspaceRoot, normalized) : false;
    const operation: 'create' | 'update' | 'patch' = artifact.type === 'patch'
      ? 'patch'
      : exists
        ? 'update'
        : 'create';

    generatedPaths.push({
      path: normalized,
      kind: artifact.type,
      operation,
      exists,
    });
  }

  webview.postMessage({
    type: 'responseMeta',
    hasGeneratedArtifacts: generatedPaths.length > 0,
    generatedPaths,
    pathHints: preferredAbsolutePaths ?? [],
  });
}

function normalizePathForMeta(pathValue: string): string {
  return (pathValue || '')
    .trim()
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
}

async function workspacePathExists(workspaceRoot: vscode.Uri, relativePath: string): Promise<boolean> {
  if (!relativePath) return false;
  const safe = relativePath.replace(/^\/+/, '').replace(/\.\.(?:\/|$)/g, '');
  if (!safe) return false;
  const target = vscode.Uri.joinPath(workspaceRoot, ...safe.split('/'));
  try {
    await vscode.workspace.fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function openWorkspacePathInEditor(options: OpenGeneratedPathOptions): Promise<void> {
  const parsed = parsePathRef(options.rawPath, options.line);
  const preferredAbsolutePaths = options.preferredAbsolutePaths && options.preferredAbsolutePaths.length > 0
    ? options.preferredAbsolutePaths
    : lastConversationFiles;
  const normalized = normalizePathForMeta(
    resolveGeneratedArtifactPathForPrompt(parsed.path, options.requestPrompt, preferredAbsolutePaths),
  );
  const targetLine = parsed.line;
  const target = resolveWorkspaceFileUri(normalized, preferredAbsolutePaths);
  if (!target) {
    vscode.window.showWarningMessage('DeepSeek: 当前没有打开工作区，无法定位文件。');
    return;
  }

  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    vscode.window.showWarningMessage(`DeepSeek: 非法路径，无法打开：${options.rawPath}`);
    return;
  }

  try {
    await vscode.workspace.fs.stat(target);
    const doc = await vscode.workspace.openTextDocument(target);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    revealEditorLine(editor, targetLine);
    return;
  } catch {
    // Fallback to virtual preview for generated but not yet applied content.
  }

  const preview = buildVirtualPreviewFromGenerated(normalized, options.generatedText || '', options.requestPrompt);
  if (!preview) {
    vscode.window.showInformationMessage(`DeepSeek: 文件尚未落地：${normalized}。可先点击“预览”或“应用”。`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    content: preview.content,
    language: preview.language,
  });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  revealEditorLine(editor, targetLine);
  vscode.window.showInformationMessage(`DeepSeek: 打开了 ${normalized} 的虚拟预览（尚未写入工作区）。`);
}

async function openPendingEditInEditor(record: PendingEditRecord, hunkLine?: number): Promise<void> {
  const workspaceUri = resolveWorkspaceFileUri(record.path, lastConversationFiles);
  if (!workspaceUri) {
    vscode.window.showWarningMessage('DeepSeek: 无法定位文件，无法打开编辑器。');
    return;
  }

  diffDecoManager?.activate(record as DiffRecordInfo);
  const doc = await vscode.workspace.openTextDocument(workspaceUri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  diffDecoManager?.activate(record as DiffRecordInfo);
  const revealLine = hunkLine || record.hunks.find((hunk) => hunk.resolution === 'pending')?.newStart || record.hunks[0]?.newStart;
  revealEditorLine(editor, revealLine);
}

function parsePathRef(rawPath: string, lineHint?: number): { path: string; line?: number } {
  let path = (rawPath || '').replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, '');
  let line = normalizeLine(lineHint);

  const hashRef = path.match(/#L(\d+)$/i);
  if (hashRef) {
    path = path.slice(0, hashRef.index).trim();
    line = normalizeLine(Number(hashRef[1])) || line;
  }

  const colonRef = path.match(/:(\d+)(?::\d+)?$/);
  if (colonRef) {
    path = path.slice(0, colonRef.index).trim();
    line = normalizeLine(Number(colonRef[1])) || line;
  }

  return { path, line };
}

function normalizeLine(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return rounded >= 1 ? rounded : undefined;
}

function revealEditorLine(editor: vscode.TextEditor, line?: number): void {
  if (!line) return;
  const target = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(target, target);
  editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
}

function buildVirtualPreviewFromGenerated(path: string, rawText: string, requestPrompt?: string): { content: string; language?: string } | undefined {
  if (!rawText.trim()) return undefined;
  const targetKey = normalizePathKey(path);
  const artifacts = parseGeneratedArtifacts(rawText);

  const direct = findArtifactByPath(artifacts, targetKey, requestPrompt);
  if (direct) return artifactToPreview(direct);

  const targetBase = nodePath.posix.basename(targetKey);
  const byBase = artifacts.filter((artifact) => nodePath.posix.basename(normalizePathKey(artifact.path)) === targetBase);
  if (byBase.length === 1) return artifactToPreview(byBase[0]);

  // Fallback for prompts that mention the path without strict artifact structure.
  const promptPath = extractPreviewPathFromPrompt(requestPrompt || '', targetBase);
  if (promptPath) {
    const promptHit = findArtifactByPath(artifacts, normalizePathKey(promptPath), requestPrompt);
    if (promptHit) return artifactToPreview(promptHit);
  }

  return undefined;
}

function findArtifactByPath(artifacts: GeneratedArtifact[], targetKey: string, requestPrompt?: string): GeneratedArtifact | undefined {
  for (const artifact of artifacts) {
    if (normalizePathKey(artifact.path) === targetKey) return artifact;
    const resolved = resolveGeneratedArtifactPathForPrompt(artifact.path, requestPrompt, lastConversationFiles);
    if (normalizePathKey(resolved) === targetKey) return artifact;
  }
  return undefined;
}

function artifactToPreview(artifact: GeneratedArtifact): { content: string; language?: string } {
  if (artifact.type === 'file') {
    return {
      content: artifact.content,
      language: artifact.language || guessLanguageFromPath(artifact.path),
    };
  }
  return {
    content: artifact.diff,
    language: 'diff',
  };
}

function normalizePathKey(path: string): string {
  return (path || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '');
}

function extractPreviewPathFromPrompt(prompt: string, baseName: string): string | undefined {
  if (!prompt || !baseName) return undefined;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = prompt.match(new RegExp(`([A-Za-z0-9_./-]+/${escaped})`, 'i'));
  return m ? m[1] : undefined;
}

function guessLanguageFromPath(path: string): string | undefined {
  const ext = nodePath.posix.extname(path).toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    sh: 'shellscript',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    java: 'java',
  };
  return map[ext];
}

/**
 * 当 parser 无法从回复中识别文件路径时，尝试把附加文件路径注入到无标识代码块前，
 * 以便 parser 能关联代码块和文件。仅对语言扩展匹配的代码块注入，且只处理单文件匹配。
 */
function injectFileHintsIntoResponse(response: string, absoluteFilePaths: string[]): string {
  if (!response || absoluteFilePaths.length === 0) return response;

  // 获取相对路径和扩展名映射
  const fileInfos = absoluteFilePaths.map((abs) => {
    const rel = vscode.workspace.asRelativePath(abs, false).replace(/\\/g, '/');
    const ext = rel.split('.').pop()?.toLowerCase() ?? '';
    return { abs, rel, ext };
  });

  // 逐个代码块检测：如果该代码块前面的文本没有路径标签，且语言扩展匹配唯一文件，则注入
  const codeBlockRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  type Injection = { index: number; label: string };
  const injections: Injection[] = [];
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(response)) !== null) {
    const fenceLang = m[1].trim().toLowerCase();
    // 检查此代码块前 200 字符内是否已有文件路径标签
    const preText = response.slice(Math.max(0, m.index - 200), m.index);
    const alreadyLabeled = fileInfos.some(({ rel }) =>
      preText.includes(rel) || preText.includes(rel.split('/').pop() ?? ''),
    );
    if (alreadyLabeled) continue;

    // 按语言扩展找匹配文件（支持同义别名：cpp/cc/cxx/h → cpp, js/ts → js/ts）
    const EXT_ALIASES: Record<string, string[]> = {
      cpp: ['cpp', 'cc', 'cxx', 'c++'],
      c: ['c'],
      h: ['h', 'hpp'],
      hpp: ['h', 'hpp'],
      ts: ['ts', 'tsx'],
      js: ['js', 'jsx', 'mjs', 'cjs'],
    };
    const aliases = EXT_ALIASES[fenceLang] ?? [fenceLang];
    const matched = fileInfos.filter(({ ext }) => aliases.includes(ext));

    // 只在唯一匹配时注入，避免歧义；注入文件名（basename），applier 负责映射到完整路径
    if (matched.length === 1) {
      const basename = matched[0].rel.split('/').pop() ?? matched[0].rel;
      injections.push({ index: m.index, label: `${basename}\n` });
    }
  }

  // 顺序注入兜底：唯一性匹配全部失败，但代码块数 == 文件数时，按顺序对应注入
  // 这是处理多个同扩展名文件（如 6 个 .hpp）的关键路径
  if (injections.length === 0) {
    const seqBlocks: number[] = [];
    const seqRe = /```[^\n`]*\n[\s\S]*?```/g;
    let seqM: RegExpExecArray | null;
    while ((seqM = seqRe.exec(response)) !== null) {
      seqBlocks.push(seqM.index);
    }
    if (seqBlocks.length === fileInfos.length && seqBlocks.length > 0) {
      for (let i = 0; i < seqBlocks.length; i++) {
        const basename = fileInfos[i].rel.split('/').pop() ?? fileInfos[i].rel;
        injections.push({ index: seqBlocks[i], label: `${basename}\n` });
      }
    }
  }

  if (injections.length === 0) return response;

  // 从后向前注入，保持偏移正确
  let result = response;
  for (const inj of injections.reverse()) {
    result = result.slice(0, inj.index) + inj.label + result.slice(inj.index);
  }
  return result;
}

// ----------------------------------------------------------------
// DeepSeek original-content provider (for diff views)
// ----------------------------------------------------------------
class DeepSeekOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    // URI: deepseek-original://edit/<editId>/<relpath>
    const parts = uri.path.replace(/^\//, '').split('/');
    const editId = parts[0];
    const record = pendingEdits.get(editId);
    return record ? record.oldContent : '';
  }

  notify(uri: vscode.Uri): void {
    this._emitter.fire(uri);
  }
}

const originalContentProvider = new DeepSeekOriginalContentProvider();

function makeOriginalUri(record: PendingEditRecord): vscode.Uri {
  const safePath = record.path.replace(/\\/g, '/');
  return vscode.Uri.from({
    scheme: 'deepseek-original',
    path: `/${record.id}/${safePath}`,
  });
}

function closePendingEditDiffTabAsync(record: PendingEditRecord): void {
  const originalUri = makeOriginalUri(record);
  const uriStr = originalUri.toString();
  void (async () => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff) {
          if ((input.original as vscode.Uri).toString() === uriStr) {
            await vscode.window.tabGroups.close(tab, true).then(undefined, () => { /* silence */ });
          }
        }
      }
    }
  })();
}

async function openPendingEditDiff(record: PendingEditRecord, hunkLine?: number): Promise<void> {
  const workspaceUri = resolveWorkspaceFileUri(record.path, lastConversationFiles);
  if (!workspaceUri) {
    vscode.window.showWarningMessage('DeepSeek: 无法定位文件，无法打开 Diff 视图。');
    return;
  }

  const originalUri = makeOriginalUri(record);
  originalContentProvider.notify(originalUri);

  const fileName = nodePath.basename(record.path);
  const title = `${fileName}: Original ↔ DevSeek (${record.existed ? '修改' : '新建'})`;  

  await vscode.commands.executeCommand('vscode.diff', originalUri, workspaceUri, title, {
    preview: true,
    viewColumn: vscode.ViewColumn.Active,
  });

  const revealLine = hunkLine || record.hunks.find((hunk) => hunk.resolution === 'pending')?.newStart || record.hunks[0]?.newStart;
  if (revealLine) {
    // Give VS Code a moment to open the diff before revealing the line
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const editor = vscode.window.activeTextEditor;
    if (editor) revealEditorLine(editor, revealLine);
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
  initAgentLearner(context);

  // ── Inline diff decorations + CodeLens (Copilot-parity) ───────────
  diffDecoManager = new DiffDecorationManager(
    (relPath) => resolveWorkspaceFileUri(relPath, lastConversationFiles)?.fsPath,
    context.subscriptions,
  );
  diffDecoManager.setResolveCallback(async (editId, hunkId, action) => {
    const wv = viewProvider.webview;
    if (action === 'keep') {
      keepPendingHunk(editId, undefined, hunkId);
    } else {
      await undoPendingHunk(editId, undefined, hunkId);
    }
    if (wv) postPendingEdits(wv);
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('_devseek.diffKeepHunk', (editId: string, hunkId: string) => {
      void diffDecoManager.handleKeepHunk(editId, hunkId);
    }),
    vscode.commands.registerCommand('_devseek.diffUndoHunk', (editId: string, hunkId: string) => {
      void diffDecoManager.handleUndoHunk(editId, hunkId);
    }),
  );

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

  // ── G-5: Keep/Undo 状态栏（当前文件有 AI 待决修改时显示）─────────
  keepUndoStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
  keepUndoStatusBar.command = 'devseek.keepOrUndoActive';
  context.subscriptions.push(keepUndoStatusBar);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => updateKeepUndoBar(editor)),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('devseek.keepOrUndoActive', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const fsPath = editor.document.uri.fsPath;
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const relPath = fsPath.startsWith(wsRoot + '/') ? fsPath.slice(wsRoot.length + 1) : nodePath.basename(fsPath);
      const record = Array.from(pendingEdits.values()).find(r => r.path === relPath);
      if (!record) { keepUndoStatusBar?.hide(); return; }
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(check) Keep', description: '保留此文件的 AI 修改', value: 'keep' },
          { label: '$(discard) Undo', description: '撤销此文件的 AI 修改', value: 'undo' },
        ],
        { title: `AI 修改：${nodePath.basename(relPath)}`, placeHolder: '选择操作' },
      );
      if (!choice) return;
      const activeWebview = viewProvider.webview;
      if (choice.value === 'keep') {
        keepPendingEdit(record.id);
        if (activeWebview) {
          postPendingEdits(activeWebview);
          activeWebview.postMessage({ type: 'pendingAction', action: 'keep', path: relPath });
        }
      } else {
        await undoPendingEdit(record.id);
        if (activeWebview) {
          postPendingEdits(activeWebview);
          activeWebview.postMessage({ type: 'pendingAction', action: 'undo', path: relPath });
        }
      }
    }),
  );

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

  // Register the virtual document provider for diff views (old content)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('deepseek-original', originalContentProvider),
  );

  // P-DEC: Register file decoration provider (⬝ badge on pending-edit files in Explorer)
  pendingEditDecorationProvider = new PendingEditDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(pendingEditDecorationProvider));

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
        ChatPanel.push(userDisplay, prompt, newSession);
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
      await ChatPanel.push(
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
      await addResourceToChat(resource);
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
              ChatPanel.push(`⚡ **${instruction}** · \`${ctx.filename}\``, prompt, false);
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
