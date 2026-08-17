import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

export interface RepositoryMemoryLocationOptions {
  memoryHome?: string;
}

export interface RepositoryMemoryLocation {
  repositoryId: string;
  repositoryLabel: string;
  identitySource: 'git-common-dir' | 'workspace-root';
  identityPath: string;
  memoryHome: string;
  memoryRoot: string;
  statePath: string;
  pipelinePath: string;
  summaryPath: string;
  indexPath: string;
  rolloutsRoot: string;
  adHocNotesRoot: string;
  legacyStructuredPath: string;
  legacyMarkdownPath: string;
}

let configuredMemoryHome: string | undefined;

/** The extension composition root may bind VS Code globalStorageUri once. */
export function configureMemoryStorageHome(memoryHome: string): void {
  configuredMemoryHome = requireAbsolutePath(memoryHome, 'memory-home');
}

export function resolveRepositoryMemoryLocation(
  workspaceRoot: string,
  options: RepositoryMemoryLocationOptions = {},
): RepositoryMemoryLocation {
  const workspace = canonicalPath(requireAbsolutePath(workspaceRoot, 'workspace-root'));
  const gitCommonDir = findGitCommonDir(workspace);
  const identityPath = gitCommonDir ?? workspace;
  const identitySource = gitCommonDir ? 'git-common-dir' : 'workspace-root';
  const repositoryId = createHash('sha256')
    .update(`${identitySource}\0${normalizeIdentityPath(identityPath)}`)
    .digest('hex');
  const repositoryLabel = sanitizeLabel(nodePath.basename(gitCommonDir
    ? nodePath.dirname(gitCommonDir)
    : workspace));
  const memoryHome = canonicalPath(nodePath.resolve(
    options.memoryHome
      ?? configuredMemoryHome
      ?? process.env.DEVSEEK_MEMORY_HOME
      ?? nodePath.join(os.homedir(), '.devseek', 'memories'),
  ));
  const memoryRoot = nodePath.join(
    memoryHome,
    'repositories',
    `${repositoryLabel}-${repositoryId.slice(0, 16)}`,
  );

  return {
    repositoryId,
    repositoryLabel,
    identitySource,
    identityPath,
    memoryHome,
    memoryRoot,
    statePath: nodePath.join(memoryRoot, 'state.json'),
    pipelinePath: nodePath.join(memoryRoot, 'pipeline.json'),
    summaryPath: nodePath.join(memoryRoot, 'memory_summary.md'),
    indexPath: nodePath.join(memoryRoot, 'MEMORY.md'),
    rolloutsRoot: nodePath.join(memoryRoot, 'rollouts'),
    adHocNotesRoot: nodePath.join(memoryRoot, 'extensions', 'ad_hoc', 'notes'),
    legacyStructuredPath: nodePath.join(workspace, '.devseek', 'memory.json'),
    legacyMarkdownPath: nodePath.join(workspace, '.devseek', 'memory.md'),
  };
}

function findGitCommonDir(startPath: string): string | undefined {
  let current = startPath;
  while (true) {
    const dotGit = nodePath.join(current, '.git');
    const resolvedGitDir = resolveGitDir(dotGit);
    if (resolvedGitDir) {
      const commonDirPath = nodePath.join(resolvedGitDir, 'commondir');
      if (isRegularFile(commonDirPath)) {
        const relative = fs.readFileSync(commonDirPath, 'utf8').trim();
        if (relative) return canonicalPath(nodePath.resolve(resolvedGitDir, relative));
      }
      return canonicalPath(resolvedGitDir);
    }
    const parent = nodePath.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolveGitDir(dotGit: string): string | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dotGit);
  } catch {
    return undefined;
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) return dotGit;
  if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
  const content = fs.readFileSync(dotGit, 'utf8').trim();
  const match = /^gitdir:\s*(.+)$/iu.exec(content);
  return match ? nodePath.resolve(nodePath.dirname(dotGit), match[1].trim()) : undefined;
}

function isRegularFile(path: string): boolean {
  try {
    const stat = fs.lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function canonicalPath(path: string): string {
  try {
    return fs.realpathSync.native(path);
  } catch {
    return nodePath.resolve(path);
  }
}

function normalizeIdentityPath(path: string): string {
  const normalized = nodePath.normalize(path);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function requireAbsolutePath(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || !nodePath.isAbsolute(normalized)) {
    throw new Error(`memory-location:invalid-${label}`);
  }
  return normalized;
}

function sanitizeLabel(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return normalized || 'repository';
}
