import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { AgentLoopResult } from './agent/loop-types';
import { decideAgentAutopilotAccept } from './app/agent-autopilot-policy';
import { settleRunContextDirect } from './app/agent-run-settlement';
import { ProductMutationCoordinator, ProductMutationIndeterminateError } from './app/product-mutation-coordinator';
import { createDevSeekRunContext } from './app/run-context';
import {
  buildPendingEditResolutionProof,
  buildPendingEditUndoProof,
  type PendingEditResolutionScope,
  type PendingEditUndoPostcondition,
  type PendingEditUndoTransaction,
} from './app/pending-edit-undo-receipt';
import {
  allHunksResolved,
  computePendingHunks,
  PendingEditService,
  renderPendingContentFromHunks,
  summarizePendingEditHunkResolution,
  summarizePendingEditHunkResolutions,
  type PendingEditHunk,
} from './app/pending-edit-service';
import type { AppliedChangeRecord } from './workspace-applier';
import { resolveWorkspaceFileUri } from './workspace-roots';
import { DiffDecorationManager, type DiffRecordInfo } from './diff-decorator';
import { closePendingEditDiffTabAsync, DeepSeekOriginalContentProvider } from './ui/pending-edit-diff';
import { openWorkspacePathInEditor, revealEditorLine } from './ui/generated-artifact-ui';
import { WorkspaceEditService, type WorkspaceTextFileCommitToken } from './workspace/edit-service';

export interface PendingEditRecord {
  id: string;
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
  hunks: PendingEditHunk[];
  sourceCommitToken?: WorkspaceTextFileCommitToken;
  createdAt: number;
}

interface PendingActionNotice {
  action: 'keep' | 'undo';
  scope: 'file' | 'hunk' | 'all';
  path?: string;
  detail: string;
  queueTotal?: number;
}

export interface PendingEditCoordinatorOptions {
  getContextFiles: () => string[];
  getActiveWebview: () => vscode.Webview | undefined;
}

export class PendingEditCoordinator {
  private readonly pendingEdits = new PendingEditService<PendingEditRecord>();
  private readonly originalContentProvider = new DeepSeekOriginalContentProvider((editId) => this.pendingEdits.get(editId));
  private readonly decorationProvider = new PendingEditDecorationProvider(() => Array.from(this.pendingEdits.values()));
  private diffDecoManager: DiffDecorationManager | undefined;
  private keepUndoStatusBar: vscode.StatusBarItem | undefined;
  private autoAcceptTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PendingEditCoordinatorOptions) {}

  get size(): number {
    return this.pendingEdits.size;
  }

  activate(context: vscode.ExtensionContext): void {
    this.diffDecoManager = new DiffDecorationManager(
      (relPath) => resolveWorkspaceFileUri(relPath, this.options.getContextFiles())?.fsPath,
      context.subscriptions,
    );
    this.diffDecoManager.setResolveCallback(async (editId, hunkId, action) => {
      const wv = this.options.getActiveWebview();
      if (action === 'keep') {
        await this.keepHunk(editId, undefined, hunkId);
      } else {
        await this.undoHunk(editId, undefined, hunkId);
      }
      if (wv) this.post(wv);
    });

    this.keepUndoStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
    this.keepUndoStatusBar.command = 'devseek.keepOrUndoActive';

    context.subscriptions.push(
      vscode.commands.registerCommand('_devseek.diffKeepHunk', (editId: string, hunkId: string) => {
        void this.diffDecoManager?.handleKeepHunk(editId, hunkId);
      }),
      vscode.commands.registerCommand('_devseek.diffUndoHunk', (editId: string, hunkId: string) => {
        void this.diffDecoManager?.handleUndoHunk(editId, hunkId);
      }),
      this.keepUndoStatusBar,
      vscode.window.onDidChangeActiveTextEditor((editor) => this.updateKeepUndoBar(editor)),
      vscode.commands.registerCommand('devseek.keepOrUndoActive', () => this.handleKeepUndoActive()),
      vscode.workspace.registerTextDocumentContentProvider('deepseek-original', this.originalContentProvider),
      vscode.window.registerFileDecorationProvider(this.decorationProvider),
    );
  }

  post(webview: vscode.Webview): void {
    const items = Array.from(this.pendingEdits.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => {
        const delta = estimateLineDelta(record.oldContent, record.newContent);
        const pendingCount = record.hunks.filter((hunk) => hunk.resolution === 'pending').length;
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
      .filter((item) => (item.added || 0) > 0 || (item.removed || 0) > 0 || (item.pendingHunks || 0) > 0);

    webview.postMessage({ type: 'pendingEdits', items, total: items.length });
    this.updateKeepUndoBar(vscode.window.activeTextEditor);
    this.decorationProvider.refresh();
  }

  beginReviewScope(webview: vscode.Webview): void {
    const staleRecords = this.pendingEdits.resetForNewScope();
    for (const record of staleRecords) closePendingEditDiffTabAsync(record);
    this.diffDecoManager?.deactivateAll();
    this.post(webview);
    webview.postMessage({ type: 'todoUpdate', items: [] });
  }

  async registerChange(webview: vscode.Webview, change: AppliedChangeRecord): Promise<void> {
    if (!hasMeaningfulEdit(change.oldContent, change.newContent)) {
      this.post(webview);
      return;
    }

    const normalizedPath = this.normalizePath(change.path);
    const existing = Array.from(this.pendingEdits.values())
      .filter((record) => this.normalizePath(record.path) === normalizedPath)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    let recordToShow: PendingEditRecord;
    if (existing) {
      existing.existed = existing.existed || change.existed;
      existing.newContent = change.newContent;
      existing.hunks = computePendingHunks(existing.id, existing.oldContent, change.newContent);
      existing.sourceCommitToken = change.commitToken ?? existing.sourceCommitToken;
      existing.createdAt = Date.now();
      this.pendingEdits.set(existing.id, existing);
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
        sourceCommitToken: change.commitToken,
        createdAt: Date.now(),
      };
      this.pendingEdits.set(id, newRecord);
      recordToShow = newRecord;
    }

    this.post(webview);
    this.diffDecoManager?.activate(recordToShow as DiffRecordInfo);
    this.openInEditor(recordToShow).catch(() => { /* editor preview is best-effort */ });
  }

  async open(editId?: string, path?: string, hunkId?: string, hunkLine?: number): Promise<void> {
    const { record, hunk } = this.resolveHunk(editId, path, hunkId);
    if (record) {
      const targetLine = hunkLine || (hunk ? (hunk.newStart > 0 ? hunk.newStart : hunk.oldStart) : undefined);
      await this.openInEditor(record, targetLine);
      return;
    }
    if (path) {
      await openWorkspacePathInEditor({ rawPath: path, fallbackAbsolutePaths: this.options.getContextFiles() });
    }
  }

  async keepHunkWithNotice(webview: vscode.Webview, editId?: string, path?: string, hunkId?: string): Promise<void> {
    const { record, hunk } = this.resolveHunk(editId, path, hunkId);
    await this.keepHunk(editId, path, hunkId);
    this.post(webview);
    if (record && hunk) {
      this.postNotice(webview, {
        action: 'keep',
        scope: 'hunk',
        path: record.path,
        detail: `已保留 ${record.path} 的${hunk.title}。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  async undoHunkWithNotice(webview: vscode.Webview, editId?: string, path?: string, hunkId?: string): Promise<void> {
    const { record, hunk } = this.resolveHunk(editId, path, hunkId);
    await this.undoHunk(editId, path, hunkId);
    this.post(webview);
    if (record && hunk) {
      this.postNotice(webview, {
        action: 'undo',
        scope: 'hunk',
        path: record.path,
        detail: `已撤销 ${record.path} 的${hunk.title}。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  async keepEditWithNotice(webview: vscode.Webview, editId?: string, path?: string): Promise<void> {
    const record = this.resolveRecord(editId, path);
    await this.keepEdit(editId, path);
    this.post(webview);
    if (record) {
      this.postNotice(webview, {
        action: 'keep',
        scope: 'file',
        path: record.path,
        detail: `修改已保留：${record.path}。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  async undoEditWithNotice(webview: vscode.Webview, editId?: string, path?: string): Promise<void> {
    const record = this.resolveRecord(editId, path);
    await this.undoEdit(editId, path);
    this.post(webview);
    if (record) {
      this.postNotice(webview, {
        action: 'undo',
        scope: 'file',
        path: record.path,
        detail: record.existed ? `已撤销 ${record.path}，文件已恢复到修改前状态。` : `已撤销 ${record.path}，新建文件已删除。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  async keepAllWithNotice(webview: vscode.Webview): Promise<void> {
    this.cancelAutoAccept();
    const count = this.pendingEdits.size;
    await this.keepAll();
    this.post(webview);
    if (count > 0) {
      this.postNotice(webview, {
        action: 'keep',
        scope: 'all',
        detail: `修改已保留：${count} 个文件。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  async undoAllWithNotice(webview: vscode.Webview): Promise<void> {
    this.cancelAutoAccept();
    const count = this.pendingEdits.size;
    await this.undoAll();
    this.post(webview);
    if (count > 0) {
      this.postNotice(webview, {
        action: 'undo',
        scope: 'all',
        detail: `已撤销全部修改（${count} 个文件）。`,
        queueTotal: this.pendingEdits.size,
      });
    }
  }

  handleAgentAutopilot(webview: vscode.Webview, result: AgentLoopResult): boolean {
    const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
    if (!isAutopilot || this.pendingEdits.size === 0) return false;
    const decision = decideAgentAutopilotAccept(result, this.pendingEdits.size);
    if (decision.accept) {
      void this.acceptAll(webview, '[自动驾驶] 已自动接受全部文件改动。');
    } else if (decision.notice) {
      this.postAutoAcceptBlockedNotice(webview, decision.notice);
    }
    return true;
  }

  scheduleAutoAccept(webview: vscode.Webview, result?: AgentLoopResult, alreadyHandled = false): void {
    const delaySec = vscode.workspace.getConfiguration('devseek').get<number>('editAutoAcceptDelay', 0);
    if (!delaySec || delaySec <= 0 || this.pendingEdits.size === 0) return;
    const decision = decideAgentAutopilotAccept(result, this.pendingEdits.size);
    if (!decision.accept) {
      if (!alreadyHandled && decision.notice) this.postAutoAcceptBlockedNotice(webview, decision.notice);
      return;
    }
    if (this.autoAcceptTimer) clearTimeout(this.autoAcceptTimer);
    this.autoAcceptTimer = setTimeout(() => {
      this.autoAcceptTimer = undefined;
      if (this.pendingEdits.size === 0) return;
      void this.acceptAll(webview, `已自动接受全部 AI 修改 (${this.pendingEdits.size} 个文件)。`);
    }, delaySec * 1000);
  }

  cancelAutoAccept(): void {
    if (this.autoAcceptTimer) {
      clearTimeout(this.autoAcceptTimer);
      this.autoAcceptTimer = undefined;
    }
  }

  private async keepHunk(editId?: string, path?: string, hunkId?: string): Promise<void> {
    const { record, hunk } = this.resolveHunk(editId, path, hunkId);
    if (!record || !hunk) return;
    if (hunk.resolution !== 'pending') return;
    await this.recordPendingEditKeepResolution(record, 'keep pending edit hunk', 'hunk', hunk);
    hunk.resolution = 'kept';
    this.settleHunkRecord(record);
  }

  private async undoHunk(editId?: string, path?: string, hunkId?: string): Promise<void> {
    const { record, hunk } = this.resolveHunk(editId, path, hunkId);
    if (!record || !hunk) return;
    if (hunk.resolution !== 'pending') return;
    const previousResolution = hunk.resolution;
    hunk.resolution = 'undone';
    try {
      await this.applyRecordSnapshot(record, 'hunk', hunk);
    } catch (error) {
      hunk.resolution = previousResolution;
      throw error;
    }
    this.settleHunkRecord(record);
  }

  private async keepEdit(editId?: string, path?: string): Promise<void> {
    const id = this.resolveId(editId, path);
    if (!id) return;
    const record = this.pendingEdits.get(id);
    if (record) {
      await this.recordPendingEditKeepResolution(record, 'keep pending edit file', 'file');
      markPendingHunks(record, 'kept');
      closePendingEditDiffTabAsync(record);
      this.diffDecoManager?.deactivate(id);
      void this.showDocument(record.path);
    }
    this.pendingEdits.delete(id);
  }

  private async undoEdit(editId?: string, path?: string): Promise<void> {
    const id = this.resolveId(editId, path);
    if (!id) return;
    const record = this.pendingEdits.get(id);
    if (!record) return;
    await this.restoreRecord(record, 'file');
    closePendingEditDiffTabAsync(record);
    this.diffDecoManager?.deactivate(id);
    this.pendingEdits.delete(id);
  }

  private async undoAll(): Promise<void> {
    const records = Array.from(this.pendingEdits.values()).sort((a, b) => b.createdAt - a.createdAt);
    const allRecordIds = records.map(record => record.id);
    for (const record of records) {
      await this.restoreRecord(record, 'all', allRecordIds);
      closePendingEditDiffTabAsync(record);
      this.pendingEdits.delete(record.id);
      this.diffDecoManager?.deactivate(record.id);
    }
  }

  private async keepAll(): Promise<void> {
    const records = Array.from(this.pendingEdits.values()).sort((a, b) => b.createdAt - a.createdAt);
    const allRecordIds = records.map(record => record.id);
    for (const record of records) {
      await this.recordPendingEditKeepResolution(record, 'keep all pending edits', 'all', undefined, allRecordIds);
      markPendingHunks(record, 'kept');
      closePendingEditDiffTabAsync(record);
      this.pendingEdits.delete(record.id);
      this.diffDecoManager?.deactivate(record.id);
    }
    this.diffDecoManager?.deactivateAll();
  }

  private async acceptAll(webview: vscode.Webview, detail: string): Promise<void> {
    if (this.pendingEdits.size === 0) return;
    try {
      await this.keepAll();
      this.post(webview);
      this.postNotice(webview, {
        action: 'keep',
        scope: 'all',
        detail,
        queueTotal: 0,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`DeepSeek: 保留修改失败，证据未完成：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private settleHunkRecord(record: PendingEditRecord): void {
    if (allHunksResolved(record)) {
      this.pendingEdits.delete(record.id);
      this.diffDecoManager?.deactivate(record.id);
    } else {
      this.diffDecoManager?.refresh(record as DiffRecordInfo);
      this.diffDecoManager?.revealNextPendingHunk(record as DiffRecordInfo);
    }
  }

  private async applyRecordSnapshot(
    record: PendingEditRecord,
    scope: PendingEditResolutionScope,
    selectedHunk?: PendingEditHunk,
  ): Promise<void> {
    const { target, workspaceRoot } = this.resolveMutationTarget(record);
    const content = renderPendingContentFromHunks(record);
    if (!record.existed && content.length === 0) {
      await this.runPendingEditMutation(record, 'undo pending edit by deleting the generated file', async (editService) => {
        const result = editService.deleteTextFile(target.fsPath, workspaceRoot);
        return { operation: 'delete-created-file', targetPath: target.fsPath, result };
      }, () => !fs.existsSync(target.fsPath), content.length, 'absent', scope, selectedHunk);
      return;
    }
    await this.runPendingEditMutation(record, 'undo pending edit hunk by restoring the selected snapshot', async (editService) => {
      const baseline = editService.captureTextFileBaseline(target.fsPath, workspaceRoot);
      const proposal = editService.proposeTextFileWrite(target.fsPath, content);
      const result = editService.commitTextFileProposal(proposal, baseline);
      return { operation: 'restore-text-file', targetPath: target.fsPath, result };
    }, () => readTextFileEquals(target.fsPath, content), content.length, 'content-readback', scope, selectedHunk);
  }

  private async restoreRecord(
    record: PendingEditRecord,
    scope: PendingEditResolutionScope,
    allRecordIds?: string[],
  ): Promise<void> {
    const { target, workspaceRoot } = this.resolveMutationTarget(record);
    if (record.existed) {
      await this.runPendingEditMutation(record, 'undo pending edit by restoring the original file', async (editService) => {
        const baseline = editService.captureTextFileBaseline(target.fsPath, workspaceRoot);
        const proposal = editService.proposeTextFileWrite(target.fsPath, record.oldContent);
        const result = editService.commitTextFileProposal(proposal, baseline);
        return { operation: 'restore-text-file', targetPath: target.fsPath, result };
      }, () => readTextFileEquals(target.fsPath, record.oldContent), record.oldContent.length, 'content-readback', scope, undefined, allRecordIds);
      return;
    }
    await this.runPendingEditMutation(record, 'undo pending edit by deleting the generated file', async (editService) => {
      const result = editService.deleteTextFile(target.fsPath, workspaceRoot);
      return { operation: 'delete-created-file', targetPath: target.fsPath, result };
    }, () => !fs.existsSync(target.fsPath), 0, 'absent', scope, undefined, allRecordIds);
  }

  private async recordPendingEditKeepResolution(
    record: PendingEditRecord,
    label: string,
    scope: PendingEditResolutionScope,
    selectedHunk?: PendingEditHunk,
    allRecordIds?: string[],
  ): Promise<void> {
    const { target, workspaceRoot } = this.resolveMutationTarget(record);
    const expectedContent = renderPendingContentFromHunks(record);
    const selectedHunkSummary = selectedHunk
      ? summarizePendingEditHunkResolution(selectedHunk, undefined, 'kept')
      : undefined;
    const runContext = createDevSeekRunContext({
      workspaceRoot,
      source: 'vscode-extension.pending-edit',
      userPrompt: label,
      mode: 'pending-edit-user-action',
    });
    const mutation = new ProductMutationCoordinator(runContext, 'vscode-pending-edit');
    try {
      await mutation.run({
        kind: 'pending-edit-resolution',
        label,
        authorize: () => ({ allowed: true, source: 'explicit-user-action' }),
        invoke: () => ({ targetPath: target.fsPath }),
        completionEvidence: {
          kind: 'invocation-receipt',
          proof: value => buildPendingEditResolutionProof({
            action: 'keep',
            recordId: record.id,
            recordPath: record.path,
            scope,
            selectedHunk: selectedHunkSummary,
            resolvedHunks: scope === 'hunk'
              ? (selectedHunkSummary ? [selectedHunkSummary] : undefined)
              : summarizePendingEditHunkResolutions(record, 'kept'),
            allRecordIds,
            targetPath: value.targetPath,
            expectedContentLength: expectedContent.length,
            sourceCommitToken: record.sourceCommitToken,
          }),
        },
      });
      if (!settleRunContextDirect(runContext, 'completed', { mutationKind: 'pending-edit-resolution' }).completed) {
        throw new ProductMutationIndeterminateError('Pending edit keep receipt could not be sealed as completed');
      }
    } catch (error) {
      settleRunContextDirect(runContext, 'failed', { mutationKind: 'pending-edit-resolution' });
      throw error;
    }
  }

  private resolveMutationTarget(record: PendingEditRecord): { target: vscode.Uri; workspaceRoot: string } {
    const target = resolveWorkspaceFileUri(record.path, this.options.getContextFiles());
    if (!target) throw new Error(`Unable to resolve pending edit inside a workspace: ${record.path}`);
    const folder = vscode.workspace.getWorkspaceFolder(target);
    if (!folder) throw new Error(`Pending edit is not owned by an open workspace: ${record.path}`);
    return { target, workspaceRoot: folder.uri.fsPath };
  }

  private async runPendingEditMutation(
    record: PendingEditRecord,
    label: string,
    invoke: (editService: WorkspaceEditService) => PendingEditUndoTransaction | Promise<PendingEditUndoTransaction>,
    verify: () => boolean | Promise<boolean>,
    expectedContentLength: number,
    postcondition: PendingEditUndoPostcondition,
    scope: PendingEditResolutionScope,
    selectedHunk?: PendingEditHunk,
    allRecordIds?: string[],
  ): Promise<void> {
    const { workspaceRoot } = this.resolveMutationTarget(record);
    const runContext = createDevSeekRunContext({
      workspaceRoot,
      source: 'vscode-extension.pending-edit',
      userPrompt: label,
      mode: 'pending-edit-user-action',
    });
    const mutation = new ProductMutationCoordinator(runContext, 'vscode-pending-edit');
    const editService = new WorkspaceEditService();
    try {
      await mutation.run({
        kind: 'pending-edit-undo',
        label,
        authorize: () => ({ allowed: true, source: 'explicit-user-action' }),
        invoke: () => invoke(editService),
        completionEvidence: {
          kind: 'verified-postcondition',
          verify,
          proof: value => buildPendingEditUndoProof({
            recordId: record.id,
            recordPath: record.path,
            scope,
            selectedHunk: selectedHunk
              ? summarizePendingEditHunkResolution(selectedHunk)
              : undefined,
            resolvedHunks: scope === 'hunk'
              ? undefined
              : summarizePendingEditHunkResolutions(record, undefined, 'undone'),
            allRecordIds,
            expectedContentLength,
            postcondition,
            transaction: value,
            sourceCommitToken: record.sourceCommitToken,
          }),
        },
      });
      if (!settleRunContextDirect(runContext, 'completed', { mutationKind: 'pending-edit-undo' }).completed) {
        throw new ProductMutationIndeterminateError('Pending edit mutation could not be sealed as completed');
      }
    } catch (error) {
      settleRunContextDirect(runContext, 'failed', { mutationKind: 'pending-edit-undo' });
      throw error;
    }
  }

  private async openInEditor(record: PendingEditRecord, hunkLine?: number): Promise<void> {
    const workspaceUri = resolveWorkspaceFileUri(record.path, this.options.getContextFiles());
    if (!workspaceUri) {
      vscode.window.showWarningMessage('DeepSeek: 无法定位文件，无法打开编辑器。');
      return;
    }
    this.diffDecoManager?.activate(record as DiffRecordInfo);
    const doc = await vscode.workspace.openTextDocument(workspaceUri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
    this.diffDecoManager?.activate(record as DiffRecordInfo);
    const revealLine = hunkLine || record.hunks.find((hunk) => hunk.resolution === 'pending')?.newStart || record.hunks[0]?.newStart;
    revealEditorLine(editor, revealLine);
  }

  private async showDocument(path: string): Promise<void> {
    const fileUri = resolveWorkspaceFileUri(path, this.options.getContextFiles());
    if (!fileUri) return;
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async handleKeepUndoActive(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const relPath = activeEditorRelativePath(editor);
    const record = Array.from(this.pendingEdits.values()).find((item) => item.path === relPath);
    if (!record) {
      this.keepUndoStatusBar?.hide();
      return;
    }
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(check) Keep', description: '保留此文件的 AI 修改', value: 'keep' },
        { label: '$(discard) Undo', description: '撤销此文件的 AI 修改', value: 'undo' },
      ],
      { title: `AI 修改：${nodePath.basename(relPath)}`, placeHolder: '选择操作' },
    );
    if (!choice) return;
    const activeWebview = this.options.getActiveWebview();
    if (choice.value === 'keep') {
      await this.keepEdit(record.id);
      if (activeWebview) {
        this.post(activeWebview);
        activeWebview.postMessage({ type: 'pendingAction', action: 'keep', path: relPath });
      }
    } else {
      await this.undoEdit(record.id);
      if (activeWebview) {
        this.post(activeWebview);
        activeWebview.postMessage({ type: 'pendingAction', action: 'undo', path: relPath });
      }
    }
  }

  private updateKeepUndoBar(editor?: vscode.TextEditor): void {
    if (!this.keepUndoStatusBar) return;
    if (!editor) {
      this.keepUndoStatusBar.hide();
      return;
    }
    const relPath = activeEditorRelativePath(editor);
    const hasPending = relPath ? Array.from(this.pendingEdits.values()).some((record) => record.path === relPath) : false;
    if (hasPending) {
      this.keepUndoStatusBar.text = '$(check) Keep  $(discard) Undo';
      this.keepUndoStatusBar.tooltip = `保留或撤销对 ${nodePath.basename(relPath)} 的 AI 修改`;
      this.keepUndoStatusBar.show();
    } else {
      this.keepUndoStatusBar.hide();
    }
  }

  private resolveHunk(editId?: string, path?: string, hunkId?: string): { record?: PendingEditRecord; hunk?: PendingEditHunk } {
    const record = this.resolveRecord(editId, path);
    if (!record) return {};
    if (!hunkId) return { record };
    return { record, hunk: record.hunks.find((item) => item.id === hunkId) };
  }

  private resolveRecord(editId?: string, path?: string): PendingEditRecord | undefined {
    const id = this.resolveId(editId, path);
    return id ? this.pendingEdits.get(id) : undefined;
  }

  private resolveId(editId?: string, path?: string): string | undefined {
    if (editId && this.pendingEdits.has(editId)) return editId;
    if (!path) return undefined;
    const wanted = this.normalizePath(path);
    let candidates = Array.from(this.pendingEdits.values())
      .filter((record) => this.normalizePath(record.path) === wanted)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (candidates.length === 0) {
      const wantedBase = nodePath.basename(wanted);
      const baseMatches = Array.from(this.pendingEdits.values())
        .filter((record) => nodePath.basename(this.normalizePath(record.path)) === wantedBase)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (baseMatches.length === 1) candidates = baseMatches;
    }
    return candidates[0]?.id;
  }

  private normalizePath(pathValue: string): string {
    let normalized = pathValue.replace(/\\/g, '/');
    for (const contextFile of this.options.getContextFiles()) {
      const ctx = contextFile.replace(/\\/g, '/');
      if (ctx.endsWith(`/${normalized}`) || ctx === normalized) {
        normalized = ctx;
        break;
      }
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = folder.uri.fsPath.replace(/\\/g, '/');
      if (normalized.startsWith(`${root}/`)) {
        normalized = normalized.slice(root.length + 1);
        break;
      }
    }
    return normalized.replace(/^\.\//, '');
  }

  private postNotice(webview: vscode.Webview, notice: PendingActionNotice): void {
    webview.postMessage({ type: 'pendingActionNotice', ...notice });
  }

  private postAutoAcceptBlockedNotice(webview: vscode.Webview, notice: string): void {
    this.postNotice(webview, {
      action: 'keep',
      scope: 'all',
      detail: notice,
      queueTotal: this.pendingEdits.size,
    });
  }
}

class PendingEditDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private readonly getRecords: () => PendingEditRecord[]) {}

  refresh(uris?: vscode.Uri[]): void {
    this.emitter.fire(uris);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const fsPath = uri.fsPath;
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const hasPending = this.getRecords().some((record) => {
      const absPath = nodePath.isAbsolute(record.path)
        ? record.path
        : wsRoot ? nodePath.join(wsRoot, record.path) : record.path;
      return absPath === fsPath || record.path === fsPath;
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

function readTextFileEquals(absPath: string, expected: string): boolean {
  try {
    return fs.readFileSync(absPath, 'utf8') === expected;
  } catch {
    return false;
  }
}

function markPendingHunks(record: PendingEditRecord, resolution: 'kept' | 'undone'): void {
  for (const hunk of record.hunks) {
    if (hunk.resolution === 'pending') hunk.resolution = resolution;
  }
}

function activeEditorRelativePath(editor: vscode.TextEditor): string {
  const fsPath = editor.document.uri.fsPath;
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  return fsPath.startsWith(`${wsRoot}/`) ? fsPath.slice(wsRoot.length + 1) : nodePath.basename(fsPath);
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
