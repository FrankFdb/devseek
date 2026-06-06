import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';

function normalizeRelPath(relPath: string): string {
  return (relPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/#L\d+$/i, '')
    .replace(/:\d+(?::\d+)?$/i, '')
    .replace(/^\//, '');
}

export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders || [];
}

export function pickWorkspaceFolderForAbsolutePaths(paths?: string[]): vscode.WorkspaceFolder | undefined {
  if (!Array.isArray(paths) || paths.length === 0) return undefined;
  for (const filePath of paths) {
    if (!filePath || !nodePath.isAbsolute(filePath)) continue;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (folder) return folder;
  }
  return undefined;
}

export function findWorkspaceFolderForRelativePath(relPath: string, preferredFolders?: readonly vscode.WorkspaceFolder[]): vscode.WorkspaceFolder | undefined {
  const normalized = normalizeRelPath(relPath);
  if (!normalized || normalized.includes('..')) return undefined;

  const folders = preferredFolders && preferredFolders.length > 0
    ? preferredFolders
    : getWorkspaceFolders();

  // Exact file existence check
  for (const folder of folders) {
    const target = nodePath.join(folder.uri.fsPath, ...normalized.split('/'));
    if (fs.existsSync(target)) return folder;
  }

  // File not found in any folder (e.g. new file to be created). Use directory-prefix
  // heuristics so that 'huida_uav/src/pump.cpp' resolves to the workspace folder
  // that contains the 'huida_uav' directory, not blindly to folders[0].
  // Check progressively shorter prefixes (up to 3 components) until we find a match.
  const segs = normalized.split('/');
  for (let len = Math.min(segs.length - 1, 3); len >= 1; len--) {
    for (const folder of folders) {
      const dirTarget = nodePath.join(folder.uri.fsPath, ...segs.slice(0, len));
      if (fs.existsSync(dirTarget)) return folder;
    }
  }

  // Ambiguous new files in a multi-root workspace must not silently land in the
  // first folder. Let callers surface a "cannot resolve workspace" message or
  // use attached-file / prompt context to disambiguate.
  return folders.length === 1 ? folders[0] : undefined;
}

export function resolveWorkspaceFileUri(relPath: string, preferredAbsolutePaths?: string[]): vscode.Uri | undefined {
  const normalized = normalizeRelPath(relPath);
  if (!normalized || normalized.includes('..')) return undefined;

  const preferredFolder = pickWorkspaceFolderForAbsolutePaths(preferredAbsolutePaths);
  const allFolders = getWorkspaceFolders();
  const searchFolders = preferredFolder
    ? [preferredFolder, ...allFolders.filter((f) => f.uri.fsPath !== preferredFolder.uri.fsPath)]
    : allFolders;
  const folder = findWorkspaceFolderForRelativePath(normalized, searchFolders);
  if (!folder) return undefined;
  return vscode.Uri.joinPath(folder.uri, ...normalized.split('/'));
}

export function inferWorkspaceFolderFromPrompt(promptText?: string, preferredAbsolutePaths?: string[]): vscode.WorkspaceFolder | undefined {
  const fromFiles = pickWorkspaceFolderForAbsolutePaths(preferredAbsolutePaths);
  if (fromFiles) return fromFiles;

  const text = promptText || '';

  // Priority 1: labelled explicit path  (指定路径：/abs  |  路径:/abs  |  目录:/abs)
  const labeledRe = /(?:指定\s*)?(?:路径|目录|工作目录)[：:]\s*([^\s，。！？\n`'"]+)/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labeledRe.exec(text)) !== null) {
    const candidate = lm[1].trim().replace(/[，。！？：；]+$/, '');
    if (nodePath.isAbsolute(candidate)) {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(candidate));
      if (folder) return folder;
      // Try parent in case the path is a file
      const parentFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(nodePath.dirname(candidate)));
      if (parentFolder) return parentFolder;
    }
  }

  // Priority 2: absolute paths anywhere in text
  const absoluteMatches = text.match(/\/[^\s'"`，。！？；：\n]+/g) || [];
  const absFolder = pickWorkspaceFolderForAbsolutePaths(absoluteMatches);
  if (absFolder) return absFolder;

  // Priority 3: relative paths with directory structure patterns
  const relMatches = text.match(/[A-Za-z0-9_./-]+\/(?:[A-Za-z0-9_./-]+)*/g) || [];
  for (const candidate of relMatches) {
    const folder = findWorkspaceFolderForRelativePath(candidate);
    if (folder) return folder;
  }

  const folders = getWorkspaceFolders();
  return folders.length === 1 ? folders[0] : undefined;
}

export function getWorkspaceRootUri(promptText?: string, preferredAbsolutePaths?: string[]): vscode.Uri | undefined {
  return inferWorkspaceFolderFromPrompt(promptText, preferredAbsolutePaths)?.uri;
}

export function getWorkspaceRootFsPath(promptText?: string, preferredAbsolutePaths?: string[]): string | undefined {
  return getWorkspaceRootUri(promptText, preferredAbsolutePaths)?.fsPath;
}
