import * as nodePath from 'path';
import * as vscode from 'vscode';
import { collectDirectoryFiles } from './context-discovery-service';

export interface ChatResourceTarget {
  addToChat(label: string, content: string, filePath?: string): void;
  addDirectoryToChat(label: string, filePaths: string[]): void;
}

export function insertCodeToEditor(code: string): void {
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

export async function addResourceToChat(target: ChatResourceTarget, resource?: vscode.Uri): Promise<void> {
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
    target.addToChat(nodePath.basename(rel), '', uri.fsPath);
    return;
  }

  if (stat.type === vscode.FileType.Directory) {
    const files = await collectDirectoryFiles(uri, 30);
    if (files.length === 0) {
      vscode.window.showWarningMessage(`DeepSeek: 目录 ${rel} 下没有可发送的文件`);
      return;
    }
    const label = `${nodePath.basename(rel)}/ (${files.length})`;
    target.addDirectoryToChat(label, files.map(f => f.fsPath));
  }
}
