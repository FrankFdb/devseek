import * as vscode from 'vscode';
import * as nodePath from 'path';

export interface PendingDiffHunk {
  resolution: 'pending' | 'kept' | 'undone';
  newStart: number;
}

export interface PendingDiffRecord {
  id: string;
  path: string;
  oldContent: string;
  existed: boolean;
  hunks: PendingDiffHunk[];
}

export class DeepSeekOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly getRecord: (editId: string) => PendingDiffRecord | undefined) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parts = uri.path.replace(/^\//, '').split('/');
    const editId = parts[0];
    return this.getRecord(editId)?.oldContent ?? '';
  }

  notify(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }
}

export function makeOriginalUri(record: PendingDiffRecord): vscode.Uri {
  const safePath = record.path.replace(/\\/g, '/');
  return vscode.Uri.from({
    scheme: 'deepseek-original',
    path: `/${record.id}/${safePath}`,
  });
}

export function closePendingEditDiffTabAsync(record: PendingDiffRecord): void {
  const originalUri = makeOriginalUri(record);
  const uriStr = originalUri.toString();
  void (async () => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff && (input.original as vscode.Uri).toString() === uriStr) {
          await vscode.window.tabGroups.close(tab, true).then(undefined, () => { /* silence */ });
        }
      }
    }
  })();
}

export interface OpenPendingEditDiffOptions {
  record: PendingDiffRecord;
  hunkLine?: number;
  provider: DeepSeekOriginalContentProvider;
  resolveWorkspaceUri: (path: string) => vscode.Uri | undefined;
  revealEditorLine: (editor: vscode.TextEditor, line?: number) => void;
}

export async function openPendingEditDiff(options: OpenPendingEditDiffOptions): Promise<void> {
  const { record, hunkLine, provider, resolveWorkspaceUri, revealEditorLine } = options;
  const workspaceUri = resolveWorkspaceUri(record.path);
  if (!workspaceUri) {
    vscode.window.showWarningMessage('DeepSeek: 无法定位文件，无法打开 Diff 视图。');
    return;
  }

  const originalUri = makeOriginalUri(record);
  provider.notify(originalUri);

  const fileName = nodePath.basename(record.path);
  const title = `${fileName}: Original ↔ DevSeek (${record.existed ? '修改' : '新建'})`;

  await vscode.commands.executeCommand('vscode.diff', originalUri, workspaceUri, title, {
    preview: true,
    viewColumn: vscode.ViewColumn.Active,
  });

  const revealLine = hunkLine || record.hunks.find((hunk) => hunk.resolution === 'pending')?.newStart || record.hunks[0]?.newStart;
  if (!revealLine) return;

  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  const editor = vscode.window.activeTextEditor;
  if (editor) revealEditorLine(editor, revealLine);
}
