import * as nodePath from 'path';
import * as vscode from 'vscode';

/**
 * Lightweight glob matcher for devseek.protectedFiles.
 * Supports: ** (any path), * (any non-sep chars), ? (one non-sep char), literal.
 */
export function matchesProtectedGlob(filePath: string, pattern: string): boolean {
  const normPath = filePath.replace(/\\/g, '/');
  const normPat = pattern.replace(/\\/g, '/');
  let regStr = normPat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\./g, '\\.')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\x00/g, '.*');
  const re = new RegExp('^' + regStr + '$', 'i');
  const base = normPath.split('/').pop() ?? normPath;
  return re.test(normPath) || re.test(base);
}

export function isFileProtected(absPath: string, wsRoot: string): boolean {
  const globs = vscode.workspace.getConfiguration('devseek').get<string[]>('protectedFiles', []);
  if (globs.length === 0) return false;
  const relPath = wsRoot ? nodePath.relative(wsRoot, absPath).replace(/\\/g, '/') : absPath;
  return globs.some(g => matchesProtectedGlob(relPath, g));
}
