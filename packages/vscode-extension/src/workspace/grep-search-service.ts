import * as nodePath from 'path';
import { listWorkspaceSearchExcludedDirNames } from './generated-path-policy';

export type GrepCommandRunner = (args: { command: string; timeoutMs?: number }) => Promise<{ stdout?: string }>;

export interface WorkspaceGrepSearchOptions {
  pattern: string;
  path?: string;
  workDir?: string;
  includePattern?: string;
  fileTypes?: string;
}

export class WorkspaceGrepSearchService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly runCommand: GrepCommandRunner,
  ) {}

  async search(options: WorkspaceGrepSearchOptions): Promise<string> {
    const pattern = options.pattern.trim();
    if (!pattern) return '（无匹配结果）';

    const searchDir = this.resolveSearchDir(options.path, options.workDir);
    const includes = buildGrepIncludes(options.includePattern ?? options.fileTypes);
    const cmd = [
      'grep -r -n -E',
      `'${shellSingleQuote(pattern).slice(0, 200)}'`,
      includes,
      buildGrepExcludes(),
      `'${shellSingleQuote(searchDir)}'`,
      '2>/dev/null | head -60',
    ].filter(Boolean).join(' ');
    const result = await this.runCommand({ command: cmd, timeoutMs: 15000 });
    return result.stdout || '（无匹配结果）';
  }

  private resolveSearchDir(path?: string, workDir?: string): string {
    const workspaceRoot = nodePath.resolve(this.workspaceRoot);
    const baseDir = workDir ? nodePath.resolve(workDir) : workspaceRoot;
    if (!isInsideOrSame(baseDir, workspaceRoot)) throw new Error('grep_search: workdir outside workspace');

    let rawDir: string;
    if (path) {
      rawDir = nodePath.isAbsolute(path) ? path : nodePath.join(baseDir, path);
    } else {
      rawDir = baseDir;
    }
    const searchDir = nodePath.resolve(rawDir);
    if (!isInsideOrSame(searchDir, workspaceRoot)) throw new Error('grep_search: path outside workspace');
    return searchDir;
  }
}

function buildGrepExcludes(): string {
  return listWorkspaceSearchExcludedDirNames()
    .map(name => `--exclude-dir='${shellSingleQuote(name)}'`)
    .join(' ');
}

function buildGrepIncludes(includePattern?: string): string {
  const extensions = parseFileTypeExtensions(includePattern);
  const effectiveExtensions = extensions.length > 0
    ? extensions
    : ['ts', 'tsx', 'js', 'jsx', 'cpp', 'c', 'h', 'hpp', 'py', 'java', 'go', 'rs', 'cs', 'log', 'txt', 'csv', 'json', 'md'];
  return effectiveExtensions.map(ext => `--include='*.${shellSingleQuote(ext)}'`).join(' ');
}

function parseFileTypeExtensions(value?: string): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(/[,\s]+/)) {
    const ext = part.trim()
      .replace(/^\*\./, '')
      .replace(/^\./, '')
      .replace(/^\*/, '')
      .replace(/[^A-Za-z0-9_+-]/g, '');
    if (ext) seen.add(ext);
  }
  return [...seen];
}

function isInsideOrSame(candidate: string, root: string): boolean {
  const relative = nodePath.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function shellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}
