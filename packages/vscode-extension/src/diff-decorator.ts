/**
 * diff-decorator.ts
 *
 * Provides per-hunk inline editor decorations (green/yellow highlights) and
 * CodeLens "Keep / Undo" buttons for pending AI edits — Copilot-parity feature.
 *
 * Registered in extension.ts, where `DiffDecorationManager` is instantiated once
 * and wired into the pending-edit lifecycle (registerPendingEditChange,
 * keepPendingHunk, undoPendingHunk, keepPendingEdit, undoPendingEdit, etc.).
 */
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Minimal interface copies — structurally compatible with extension.ts types
// (TypeScript structural typing ensures safe assignment across the module boundary.)
// ---------------------------------------------------------------------------

export interface DiffHunkInfo {
  id: string;
  index: number;
  title: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  oldLines: string[];
  newLines: string[];
  resolution: 'pending' | 'kept' | 'undone';
}

export interface DiffRecordInfo {
  id: string;
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
  hunks: DiffHunkInfo[];
  createdAt: number;
}

/** Resolves a workspace-relative path to an absolute filesystem path. */
export type DiffPathResolver = (relPath: string) => string | undefined;

/** Called when user clicks Keep/Undo in the editor for a specific hunk. */
export type HunkResolveCallback = (
  editId: string,
  hunkId: string,
  action: 'keep' | 'undo',
) => Promise<void>;

// ---------------------------------------------------------------------------
// DiffDecorationManager
// ---------------------------------------------------------------------------

/**
 * Manages inline editor decorations + CodeLens for pending AI edits.
 *
 * Lifecycle:
 *   activate(record)   — called when a pending edit is registered/updated
 *   refresh(record)    — called after a single hunk is resolved
 *   deactivate(id)     — called after all hunks resolved or file-level keep/undo
 *   deactivateAll()    — called on "undo all" / "keep all"
 */
export class DiffDecorationManager implements vscode.CodeLensProvider {
  // Decoration types — green for pure additions, yellow for modifications
  private readonly _addedDecType: vscode.TextEditorDecorationType;
  private readonly _modifiedDecType: vscode.TextEditorDecorationType;

  private readonly _codeLensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._codeLensEmitter.event;

  /** fsPath → active pending record */
  private readonly _active = new Map<string, DiffRecordInfo>();

  private readonly _pathResolver: DiffPathResolver;
  private _onResolve: HunkResolveCallback | undefined;

  constructor(pathResolver: DiffPathResolver, disposables: vscode.Disposable[]) {
    this._pathResolver = pathResolver;

    this._addedDecType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
    });

    this._modifiedDecType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.modifiedContentBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
    });

    // CodeLens provider for all files in the workspace
    disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
    );
    disposables.push(this._addedDecType, this._modifiedDecType, this._codeLensEmitter);

    // Re-apply decorations when editors first become visible
    disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) this._applyToEditor(editor);
      }),
    );
  }

  /** Set the callback invoked when user resolves a hunk via CodeLens. */
  setResolveCallback(cb: HunkResolveCallback): void {
    this._onResolve = cb;
  }

  // -------------------------------------------------------------------------
  // Public API — called from extension.ts pending-edit lifecycle
  // -------------------------------------------------------------------------

  /** Register/update a pending edit record and refresh editor decorations. */
  activate(record: DiffRecordInfo): void {
    const fsPath = this._pathResolver(record.path);
    if (!fsPath) return;
    this._active.set(fsPath, record);
    this._refreshForPath(fsPath);
    this._codeLensEmitter.fire();
  }

  /** Update decorations after a hunk resolution (remaining hunks still pending). */
  refresh(record: DiffRecordInfo): void {
    const fsPath = this._pathResolver(record.path);
    if (!fsPath || !this._active.has(fsPath)) return;
    this._active.set(fsPath, record);
    this._refreshForPath(fsPath);
    this._codeLensEmitter.fire();
  }

  /** Remove decorations for an edit once it is fully resolved. */
  deactivate(recordId: string): void {
    for (const [fsPath, rec] of this._active) {
      if (rec.id === recordId) {
        this._active.delete(fsPath);
        this._clearForPath(fsPath);
        break;
      }
    }
    this._codeLensEmitter.fire();
  }

  /** Remove all decorations (undo-all / keep-all). */
  deactivateAll(): void {
    for (const fsPath of this._active.keys()) this._clearForPath(fsPath);
    this._active.clear();
    this._codeLensEmitter.fire();
  }

  /**
   * Scroll the editor to the first remaining pending hunk in this record.
   * Safe to call even if the file is not currently open.
   */
  revealNextPendingHunk(record: DiffRecordInfo): void {
    const fsPath = this._pathResolver(record.path);
    if (!fsPath) return;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === fsPath,
    );
    if (!editor) return;
    const nextHunk = record.hunks.find((h) => h.resolution === 'pending');
    if (!nextHunk) return;
    const line = Math.max(0, nextHunk.newStart - 1);
    const range = new vscode.Range(line, 0, line, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(line, 0, line, 0);
  }

  // -------------------------------------------------------------------------
  // Internal command handlers — called from registered VS Code commands
  // -------------------------------------------------------------------------

  async handleKeepHunk(editId: string, hunkId: string): Promise<void> {
    await this._onResolve?.(editId, hunkId, 'keep');
  }

  async handleUndoHunk(editId: string, hunkId: string): Promise<void> {
    await this._onResolve?.(editId, hunkId, 'undo');
  }

  // -------------------------------------------------------------------------
  // CodeLensProvider implementation
  // -------------------------------------------------------------------------

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const record = this._active.get(document.uri.fsPath);
    if (!record) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const hunk of record.hunks) {
      if (hunk.resolution !== 'pending') continue;

      const line = Math.max(0, hunk.newStart - 1);
      const range = new vscode.Range(line, 0, line, 0);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(check) Keep',
          command: '_devseek.diffKeepHunk',
          arguments: [record.id, hunk.id],
          tooltip: `Keep this change (${hunk.title})`,
        }),
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(discard) Undo',
          command: '_devseek.diffUndoHunk',
          arguments: [record.id, hunk.id],
          tooltip: `Undo this change (${hunk.title})`,
        }),
      );

      const adds = hunk.newLines.length;
      const dels = hunk.oldLines.length;
      const diff = [adds > 0 ? `+${adds}` : '', dels > 0 ? `-${dels}` : '']
        .filter(Boolean)
        .join(' ');
      lenses.push(
        new vscode.CodeLens(range, {
          title: `AI change · ${hunk.title}${diff ? `  [${diff}]` : ''}`,
          command: '',
        }),
      );
    }
    return lenses;
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    return lens;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _refreshForPath(fsPath: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === fsPath) this._applyToEditor(editor);
    }
  }

  private _clearForPath(fsPath: string): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === fsPath) {
        editor.setDecorations(this._addedDecType, []);
        editor.setDecorations(this._modifiedDecType, []);
      }
    }
  }

  private _applyToEditor(editor: vscode.TextEditor): void {
    const record = this._active.get(editor.document.uri.fsPath);
    if (!record) {
      // Editor has no pending record — ensure stale decorations are cleared.
      editor.setDecorations(this._addedDecType, []);
      editor.setDecorations(this._modifiedDecType, []);
      return;
    }

    const addedRanges: vscode.Range[] = [];
    const modifiedRanges: vscode.Range[] = [];

    for (const hunk of record.hunks) {
      if (hunk.resolution !== 'pending') continue;
      if (hunk.newLines.length === 0) continue; // pure deletion — nothing to highlight

      const startLine = Math.max(0, hunk.newStart - 1); // convert to 0-based
      const endLine = Math.min(
        editor.document.lineCount - 1,
        startLine + hunk.newLines.length - 1,
      );

      for (let l = startLine; l <= endLine; l++) {
        const r = editor.document.lineAt(l).range;
        if (hunk.oldLines.length > 0) {
          modifiedRanges.push(r); // replacement — use modified colour
        } else {
          addedRanges.push(r); // pure addition — use added colour
        }
      }
    }

    editor.setDecorations(this._addedDecType, addedRanges);
    editor.setDecorations(this._modifiedDecType, modifiedRanges);
  }
}
