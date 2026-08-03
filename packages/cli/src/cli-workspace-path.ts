import { relative, resolve } from 'path';

export function resolveCliWorkspacePath(cwd: string, filePath: string): string {
  if (filePath.includes('\0')) {
    throw new Error('Refusing to write path with NUL byte');
  }
  const root = resolve(cwd);
  const target = resolve(root, filePath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error(`Refusing to write outside workspace: ${filePath}`);
  }
  return target;
}
