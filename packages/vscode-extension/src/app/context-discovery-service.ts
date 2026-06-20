import * as vscode from 'vscode';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  DEFAULT_SOURCE_FILE_RE,
  PROJECT_CONTEXT_SOURCE_FILE_RE,
  shouldIncludeDiscoveredSourceFile,
  shouldSkipDiscoveryDir,
} from '../file-discovery';

export async function getGitDiff(staged: boolean): Promise<string> {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = gitExt.isActive ? (gitExt.exports as any).getAPI(1) : ((await gitExt.activate()) as any).getAPI(1);
    if (!api || !api.repositories || api.repositories.length === 0) return '';
    const repo = api.repositories[0];
    return (await repo.diff(staged)) as string;
  } catch {
    return '';
  }
}

export function buildWorkspaceFileTree(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return '';

  const SKIP = /^(node_modules|build|dist|out|\.git|\.cache|__pycache__|target|bin|obj|\.vscode|\.idea|coverage|log|logs)$/i;
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.name.startsWith('.') && depth > 1) continue; // skip hidden at depth>1
      if (e.isDirectory()) {
        if (SKIP.test(e.name)) continue;
        lines.push(`${prefix}${e.name}/`);
        walk(nodePath.join(dir, e.name), prefix + '  ', depth + 1);
      } else {
        lines.push(`${prefix}${e.name}`);
      }
    }
  }

  for (const folder of folders) {
    lines.push(`${folder.name}/  (${folder.uri.fsPath})`);
    walk(folder.uri.fsPath, '  ', 1);
    if (lines.length > 200) { lines.push('  ... (已截断)'); break; }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// P4: Directory-aware file discovery
// When a user mentions a directory path in the prompt without attaching @files,
// we auto-enumerate source files there and inject their content — eliminating
// the need for manual @file upload and the associated browser-upload latency.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_FILE_RE = DEFAULT_SOURCE_FILE_RE;
const MAX_AUTO_FILES = 20;
const MAX_AUTO_SCAN_DIRS = 300;
const MAX_AUTO_SCAN_MS = 120;
const MAX_PATH_TOKENS_TO_SCAN = 8;
const MAX_BARE_DIR_TOKENS_TO_SCAN = 6;
const MAX_BARE_DIR_SEARCH_DIRS = 500;
const MAX_BARE_DIR_SEARCH_MS = 120;

/**
 * Resolve a relative-or-absolute path candidate to an existing directory,
 * trying each workspace folder as root.  Also handles the common pattern where
 * the user prefixes the path with the folder name, e.g. "tars/huida_uav/…"
 * when the workspace root is /home/ff/uav/tars.
 */
function tryResolveDirectory(
  candidate: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): string | undefined {
  // 1. Absolute path
  if (nodePath.isAbsolute(candidate)) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* not found */ }
  }

  for (const folder of workspaceFolders) {
    const root = folder.uri.fsPath;

    // 2. Directly relative: <root>/<candidate>
    const direct = nodePath.join(root, candidate);
    try {
      if (fs.statSync(direct).isDirectory()) return direct;
    } catch { /* not found */ }

    // 3. User prefixed with workspace folder name: "tars/X/Y" → strip "tars/"
    const folderName = nodePath.basename(root);
    if (candidate === folderName || candidate.startsWith(folderName + '/')) {
      const stripped = candidate.slice(folderName.length).replace(/^\//, '');
      if (stripped) {
        const indirect = nodePath.join(root, stripped);
        try {
          if (fs.statSync(indirect).isDirectory()) return indirect;
        } catch { /* not found */ }
      }
    }
  }
  return undefined;
}

function resolveBareDirectoryNames(
  candidates: string[],
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  const remaining = new Set(candidates.filter(candidate =>
    candidate
    && !candidate.includes('/')
    && !candidate.includes('\\')
    && !candidate.startsWith('.'),
  ));
  if (remaining.size === 0) return resolved;

  for (const folder of workspaceFolders) {
    const root = folder.uri.fsPath;

    for (const candidate of [...remaining]) {
      const direct = nodePath.join(root, candidate);
      try {
        if (fs.statSync(direct).isDirectory()) {
          resolved.set(candidate, direct);
          remaining.delete(candidate);
        }
      } catch { /* not found */ }
    }
    if (remaining.size === 0) break;

    findDirectoriesByBasename(root, remaining, resolved);
    if (remaining.size === 0) break;
  }
  return resolved;
}

function findDirectoriesByBasename(root: string, remaining: Set<string>, resolved: Map<string, string>): void {
  const queue = [root];
  const deadline = Date.now() + MAX_BARE_DIR_SEARCH_MS;
  let visitedDirs = 0;

  while (
    queue.length > 0
    && remaining.size > 0
    && visitedDirs < MAX_BARE_DIR_SEARCH_DIRS
    && Date.now() < deadline
  ) {
    const cur = queue.shift()!;
    visitedDirs += 1;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDiscoveryDir(entry.name)) continue;
      const childPath = nodePath.join(cur, entry.name);
      if (remaining.has(entry.name)) {
        resolved.set(entry.name, childPath);
        remaining.delete(entry.name);
        if (remaining.size === 0) break;
      }
      queue.push(childPath);
    }
  }
}

/**
 * BFS-enumerate source files under dirPath, up to MAX_AUTO_FILES.
 * Skips build artifacts, documentation, and test directories.
 * If extFilter is provided, only files matching that regex are included.
 */
function enumerateSourceFilesIn(dirPath: string, extFilter?: RegExp): string[] {
  const result: string[] = [];
  const filter = extFilter ?? SOURCE_FILE_RE;
  const queue = [dirPath];
  const deadline = Date.now() + MAX_AUTO_SCAN_MS;
  let visitedDirs = 0;
  while (
    queue.length > 0
    && result.length < MAX_AUTO_FILES
    && visitedDirs < MAX_AUTO_SCAN_DIRS
    && Date.now() < deadline
  ) {
    const cur = queue.shift()!;
    visitedDirs += 1;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (result.length >= MAX_AUTO_FILES) break;
      const childPath = nodePath.join(cur, e.name);
      if (e.isFile() && shouldIncludeDiscoveredSourceFile(childPath, filter)) {
        result.push(childPath);
      } else if (e.isDirectory() && !shouldSkipDiscoveryDir(e.name)) {
        queue.push(childPath);
      }
    }
  }
  return result;
}

/**
 * Convert a list of absolute file paths to display labels for the context row.
 * Files from the same directory are collapsed into "dirname/ (N)" when ≥3.
 */
export function toContextDisplayLabels(files: string[]): string[] {
  if (files.length <= 2) return files.map(f => nodePath.basename(f));
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = nodePath.dirname(f);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }
  const labels: string[] = [];
  for (const [dir, dirFiles] of byDir) {
    if (dirFiles.length >= 2) {
      labels.push(`${nodePath.basename(dir)}/ (${dirFiles.length})`);
    } else {
      dirFiles.forEach(f => labels.push(nodePath.basename(f)));
    }
  }
  return labels;
}

export function relPathFromWorkspace(workspaceRoot: string, absPath: string): string | null {
  if (!workspaceRoot || !absPath) return null;
  try {
    const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return null;
    return rel;
  } catch {
    return null;
  }
}

export function absPathFromWorkspaceRel(workspaceRoot: string, relPath: string): string | null {
  if (!workspaceRoot || !relPath) return null;
  const abs = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(workspaceRoot, relPath);
  const resolved = nodePath.resolve(abs);
  const root = nodePath.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + nodePath.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}


/**
 * Detect an explicit file-extension filter in the user prompt, e.g. ".hpp" or "*.hpp".
 * Returns a strict regex like /\.hpp$/i when found, otherwise undefined.
 */
function detectExtensionFilter(prompt: string): RegExp | undefined {
  // Match patterns like ".hpp", "*.hpp", ".hpp文件", "hpp文件"
  const m = prompt.match(/(?:\*|\.)(\w+)(?:\s*文件|\s+files?)?(?=[^\w]|$)/i);
  if (!m) return undefined;
  const ext = m[1].toLowerCase();
  // Only treat as a filter when it looks like a known source extension
  if (!/^(hpp|h|cpp|cc|cxx|c|ts|tsx|js|jsx|py|java|go|rs|md|sh|bash|json|yaml|yml)$/.test(ext)) return undefined;
  return new RegExp(`\.${ext}$`, 'i');
}

function extractBareDirectoryCandidates(prompt: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const text = String(prompt || '');
  const tokenRe = /\b([A-Za-z][A-Za-z0-9_-]{2,})\b/g;
  for (const match of text.matchAll(tokenRe)) {
    if (candidates.length >= MAX_BARE_DIR_TOKENS_TO_SCAN) break;
    const token = match[1];
    if (seen.has(token)) continue;
    if (!looksLikeWorkspaceDirectoryToken(token, text.slice(match.index ?? 0, (match.index ?? 0) + token.length + 8))) {
      continue;
    }
    seen.add(token);
    candidates.push(token);
  }
  return candidates;
}

function looksLikeWorkspaceDirectoryToken(token: string, localContext: string): boolean {
  if (!token || token.length < 3) return false;
  if (/^(src|dist|build|node_modules|tmp|test|tests|docs|readme|package|json|true|false|null)$/i.test(token)) return false;
  if (/[_.-]/.test(token)) return true;
  return /^(?:[A-Za-z0-9_-]+)\s*(?:目录|项目|程序|模块|工程|库)/.test(localContext);
}

/**
 * Scan the prompt for directory path references and return the abs paths of
 * source files found there.  Returns [] when nothing can be resolved.
 * When the prompt names a specific extension (e.g. ".hpp"), only those files
 * are returned.
 */
export function discoverFilesFromDirectoryPrompt(
  prompt: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): string[] {
  if (!workspaceFolders.length) return [];

  const extFilter = detectExtensionFilter(prompt);

  // Extract path-like tokens, including absolute paths such as
  // "/home/me/project/code/foo中".  The trailing Chinese marker is deliberately
  // not part of the token.
  const PATH_RE = /((?:~\/|\/)?[A-Za-z0-9_.@%+\-]+(?:\/[A-Za-z0-9_.@%+\-]+){1,})\/?/g;
  const seen = new Set<string>();
  const candidates: Array<{ dir: string; files: string[] }> = [];
  for (const m of prompt.matchAll(PATH_RE)) {
    if (seen.size >= MAX_PATH_TOKENS_TO_SCAN) break;
    const candidate = m[1].replace(/\/+$/, '');
    // Skip very short paths (e.g. "a/b") and version-like tokens (e.g. "v1.0/x")
    if (candidate.split('/').length < 2) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const resolvedDir = tryResolveDirectory(candidate, workspaceFolders);
    if (!resolvedDir) continue;

    const files = enumerateSourceFilesIn(resolvedDir, extFilter);
    if (files.length > 0) candidates.push({ dir: resolvedDir, files });
  }

  const bareCandidates = extractBareDirectoryCandidates(prompt);
  const resolvedBareDirs = resolveBareDirectoryNames(bareCandidates, workspaceFolders);
  for (const candidate of bareCandidates) {
    if (seen.size >= MAX_PATH_TOKENS_TO_SCAN + MAX_BARE_DIR_TOKENS_TO_SCAN) break;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const resolvedDir = resolvedBareDirs.get(candidate);
    if (!resolvedDir) continue;

    const files = enumerateSourceFilesIn(resolvedDir, extFilter ?? PROJECT_CONTEXT_SOURCE_FILE_RE);
    if (files.length > 0) candidates.push({ dir: resolvedDir, files });
  }

  if (candidates.length === 0) return [];
  // Prefer the most specific (deepest path) match; break ties by file count.
  candidates.sort((a, b) => {
    const depthDiff = b.dir.split(nodePath.sep).length - a.dir.split(nodePath.sep).length;
    return depthDiff !== 0 ? depthDiff : b.files.length - a.files.length;
  });
  return candidates[0].files;
}


export async function collectDirectoryFiles(root: vscode.Uri, maxFiles: number, extFilter?: RegExp): Promise<vscode.Uri[]> {
  const collected: vscode.Uri[] = [];

  async function walk(dir: vscode.Uri): Promise<void> {
    if (collected.length >= maxFiles) return;
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      if (collected.length >= maxFiles) return;
      if (shouldSkipDiscoveryDir(name)) continue;

      const child = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.Directory) {
        await walk(child);
        continue;
      }
      if (type !== vscode.FileType.File) continue;
      // Apply extension filter: if caller provided one, use it; otherwise use SOURCE_FILE_RE
      const filter = extFilter ?? SOURCE_FILE_RE;
      if (!shouldIncludeDiscoveredSourceFile(child.fsPath, filter)) continue;

      collected.push(child);
    }
  }

  await walk(root);
  return collected;
}
