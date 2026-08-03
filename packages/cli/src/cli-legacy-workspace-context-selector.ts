import type { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, relative, resolve } from 'path';
import { resolveCliWorkspacePath } from './cli-workspace-path';

const MAX_CONTEXT_FILES = 20;
const MAX_MENTIONED_FILE_BYTES = 256 * 1024;
const MAX_IMPLICIT_FILE_BYTES = 128 * 1024;
const CONTEXT_SCAN_DIRS = ['src', 'test', 'tests', 'lib', 'app'];
const CONTEXT_MANIFESTS = [
  'package.json',
  'devseek.verify.json',
  'tsconfig.json',
  'pyproject.toml',
  'pytest.ini',
  'Cargo.toml',
  'go.mod',
  'Makefile',
];
const IGNORED_CONTEXT_DIRS = new Set([
  '.devseek',
  '.git',
  'backups',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

export class CliLegacyWorkspaceContextSelector {
  async select(cwd: string, prompt: string): Promise<string[]> {
    const files: string[] = [];
    for (const candidate of extractMentionedFilePaths(prompt)) {
      await addWorkspaceContextFile(cwd, candidate, files, MAX_MENTIONED_FILE_BYTES);
    }

    if (shouldAttachImplicitProjectContext(prompt)) {
      for (const candidate of await discoverImplicitProjectContextFiles(cwd)) {
        await addWorkspaceContextFile(cwd, candidate, files, MAX_IMPLICIT_FILE_BYTES);
      }
    }

    return [...new Set(files)].slice(0, MAX_CONTEXT_FILES);
  }
}

function extractMentionedFilePaths(prompt: string): string[] {
  const matches = prompt.matchAll(
    /(?:^|[\s`'":：])((?:\/|\.{0,2}\/)?[^\s`'"<>，。；;、)）\]}]+?\.(?:cpp|cxx|cc|hpp|tsx|jsx|mjs|cjs|toml|yaml|json|java|yml|ts|js|py|rs|go|markdown|md|h|c))(?=$|[\s`'")）\]}，。；;、])/giu,
  );
  return [...new Set([...matches]
    .map(match => cleanMentionedFilePath(match[1]))
    .filter((candidate): candidate is string => Boolean(candidate)))];
}

function cleanMentionedFilePath(value: string | undefined): string {
  return String(value || '')
    .replace(/[)\]}>，。；;、]+$/gu, '')
    .trim();
}

function shouldAttachImplicitProjectContext(prompt: string): boolean {
  return /\b(add|build|change|compile|debug|fix|implement|modify|project|refactor|run|test|update)\b/i.test(prompt)
    || /代码|项目|实现|修改|修复|测试|编译|运行/.test(prompt);
}

async function discoverImplicitProjectContextFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  for (const manifest of CONTEXT_MANIFESTS) {
    await addWorkspaceContextFile(cwd, manifest, files, MAX_IMPLICIT_FILE_BYTES);
  }
  await collectTopLevelContextFiles(cwd, files);
  for (const dir of CONTEXT_SCAN_DIRS) {
    await collectContextFiles(cwd, dir, files, 3);
  }
  return files.slice(0, MAX_CONTEXT_FILES);
}

async function collectTopLevelContextFiles(cwd: string, files: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(resolve(cwd), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= MAX_CONTEXT_FILES) return;
    if (!entry.isFile() || !isTopLevelContextFile(entry.name)) continue;
    await addWorkspaceContextFile(cwd, entry.name, files, MAX_IMPLICIT_FILE_BYTES);
  }
}

async function collectContextFiles(cwd: string, dirRel: string, files: string[], depth: number): Promise<void> {
  if (files.length >= MAX_CONTEXT_FILES || depth < 0) return;
  let entries: Dirent[];
  try {
    entries = await readdir(resolveCliWorkspacePath(cwd, dirRel), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= MAX_CONTEXT_FILES) return;
    if (entry.name.startsWith('.') || IGNORED_CONTEXT_DIRS.has(entry.name)) continue;
    const relPath = toPosixPath(join(dirRel, entry.name));
    if (entry.isDirectory()) {
      await collectContextFiles(cwd, relPath, files, depth - 1);
    } else if (entry.isFile() && isContextSourceFile(relPath)) {
      await addWorkspaceContextFile(cwd, relPath, files, MAX_IMPLICIT_FILE_BYTES);
    }
  }
}

async function addWorkspaceContextFile(cwd: string, candidate: string, files: string[], maxBytes: number): Promise<void> {
  let target: string;
  try {
    target = resolveCliWorkspacePath(cwd, candidate);
    const info = await stat(target);
    if (!info.isFile() || info.size > maxBytes) return;
  } catch {
    return;
  }

  const relPath = toPosixPath(relative(resolve(cwd), target));
  if (!files.includes(relPath)) {
    files.push(relPath);
  }
}

function isTopLevelContextFile(fileName: string): boolean {
  return CONTEXT_MANIFESTS.includes(fileName)
    || /^(app|cli|index|main|server|spec|test)\.(cjs|js|mjs|py|ts)$/i.test(fileName);
}

function isContextSourceFile(filePath: string): boolean {
  return /\.(c|cc|cpp|cxx|go|h|hpp|java|js|jsx|json|mjs|py|rs|ts|tsx|yaml|yml)$/i.test(filePath);
}

function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}
