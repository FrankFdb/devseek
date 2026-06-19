import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import { getWorkspaceRootUri } from '../workspace-roots';

export interface WorkspacePathContext {
  root: vscode.Uri;
  preferredDirs: string[];
  hintedFiles: string[];
  scopedDirs: string[];
  strictScope: boolean;
  forceCodeDir: boolean;
}

export interface BuildWorkspacePathContextOptions {
  requestPrompt?: string;
  preferredAbsolutePaths?: string[];
  fallbackAbsoluteDirs?: string[];
}

export interface WorkspacePathScope {
  promptDir: string | undefined;
  promptDirIsExplicit: boolean;
}

export interface WorkspaceWritePathResult {
  rawPath: string;
  relPath: string;
  absPath: string;
  note?: string;
}

export interface ResolveWorkspaceWritePathOptions {
  requestPrompt?: string;
  content?: string;
  workspaceRootFsPath?: string;
  defaultWorkdir?: string;
  preferredAbsolutePaths?: string[];
}

export function normalizeWorkspaceTargetPath(path: string): string {
  return (path || '')
    .trim()
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/^\.\//, '')
    .replace(/#L\d+$/i, '')
    .replace(/:\d+(?::\d+)?$/i, '')
    .replace(/\\/g, '/');
}

export function buildWorkspacePathContext(
  root: vscode.Uri,
  requestPromptOrOptions?: string | BuildWorkspacePathContextOptions,
  preferredAbsolutePathsArg?: string[],
): WorkspacePathContext {
  const options: BuildWorkspacePathContextOptions = typeof requestPromptOrOptions === 'object'
    ? requestPromptOrOptions
    : { requestPrompt: requestPromptOrOptions, preferredAbsolutePaths: preferredAbsolutePathsArg };
  const preferredDirs: string[] = [];
  const hintedFiles: string[] = [];
  const scopedDirs: string[] = [];
  const rootPath = root.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
  const text = options.requestPrompt || '';

  if (options.preferredAbsolutePaths && options.preferredAbsolutePaths.length > 0) {
    for (const absPath of options.preferredAbsolutePaths) {
      const rel = sanitizeWorkspacePath(absPath, root);
      if (!rel) continue;
      const absCandidate = vscode.Uri.joinPath(root, ...rel.split('/')).fsPath;
      try {
        if (fs.existsSync(absCandidate) && fs.statSync(absCandidate).isDirectory()) {
          preferredDirs.push(rel);
          scopedDirs.push(rel);
          continue;
        }
      } catch {
        // Hints are advisory; stale paths fall back to file-like handling below.
      }
      hintedFiles.push(rel);
      const dir = nodePath.posix.dirname(rel);
      if (dir && dir !== '.') {
        preferredDirs.push(dir);
      }
    }
  }

  const cwdMatches = text.match(/\bcwd\s*=\s*([^\n\r]+)/gi) || [];
  for (const raw of cwdMatches) {
    const value = raw.replace(/\bcwd\s*=\s*/i, '').trim().replace(/^['"`]+|['"`]+$/g, '');
    if (!value) continue;
    const rel = sanitizeWorkspacePath(value, root);
    if (rel) {
      preferredDirs.push(rel);
      scopedDirs.push(rel);
      continue;
    }
    const normalized = value.replace(/\\/g, '/');
    if (normalized.startsWith(rootPath + '/')) {
      const dir = normalized.slice(rootPath.length + 1).replace(/\/$/, '');
      preferredDirs.push(dir);
      scopedDirs.push(dir);
    }
  }

  for (const dir of inferPromptDirectoryHints(text, root)) {
    preferredDirs.push(dir);
    scopedDirs.push(dir);
  }

  const isInternalDir = (dir: string) =>
    dir === '.devseek' || dir.startsWith('.devseek/');

  const pathRe = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(text)) !== null) {
    const candidate = (m[1] || '').trim();
    if (!candidate) continue;
    const rel = sanitizeWorkspacePath(candidate, root);
    if (rel) {
      if (isInternalDir(nodePath.posix.dirname(rel))) continue;
      hintedFiles.push(rel);
      const dir = nodePath.posix.dirname(rel);
      if (dir && dir !== '.') {
        preferredDirs.push(dir);
        scopedDirs.push(dir);
      }
      continue;
    }

    const normalized = candidate.replace(/\\/g, '/');
    if (normalized.startsWith(rootPath + '/')) {
      const relAbs = normalized.slice(rootPath.length + 1);
      hintedFiles.push(relAbs);
      const dir = nodePath.posix.dirname(relAbs);
      if (dir && dir !== '.') {
        preferredDirs.push(dir);
        scopedDirs.push(dir);
      }
    }
  }

  const FAKE_TOOL_SEGS = new Set(['list_dir', 'read_file', 'grep_search', 'run_terminal', 'get_errors', 'manage_todo_list', 'task_complete']);
  const dirTokenRe = /(?:^|[\s'"`(])([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_.-])(?=$|[\s'"`),;:])/g;
  while ((m = dirTokenRe.exec(text)) !== null) {
    const candidate = (m[1] || '').trim();
    if (!candidate) continue;
    if (candidate.split('/').every(seg => FAKE_TOOL_SEGS.has(seg))) continue;
    const rel = sanitizeWorkspacePath(candidate, root);
    if (!rel) continue;
    const uri = vscode.Uri.joinPath(root, ...rel.split('/'));
    if (fs.existsSync(uri.fsPath) && fs.statSync(uri.fsPath).isDirectory()) {
      const dir = rel.replace(/\/$/, '');
      preferredDirs.push(dir);
      scopedDirs.push(dir);
      continue;
    }

    const base = nodePath.posix.basename(rel);
    const likelyDir = !base.includes('.');
    if (likelyDir) {
      const dir = rel.replace(/\/$/, '');
      preferredDirs.push(dir);
      scopedDirs.push(dir);
    }
  }

  const commandScopedDirs = inferScopedDirsFromCommandText(text, root);
  for (const dir of commandScopedDirs) {
    preferredDirs.push(dir);
    scopedDirs.push(dir);
  }

  const forceCodeDir = promptRequestsCodeDirectory(text);
  if (forceCodeDir && !scopedDirs.some((dir) => dir === 'code' || dir.startsWith('code/'))) {
    preferredDirs.push('code');
    scopedDirs.push('code');
  }

  let preferredClean = dedupeStringList(preferredDirs).filter(d => !isInternalDir(d));
  let scopedClean = dedupeStringList(scopedDirs).filter(d => !isInternalDir(d));

  if (preferredClean.length === 0 && options.fallbackAbsoluteDirs && options.fallbackAbsoluteDirs.length > 0) {
    const fallbackDirs = options.fallbackAbsoluteDirs
      .map((dir) => sanitizeWorkspacePath(dir, root))
      .filter((dir): dir is string => !!dir && dir !== '.');
    preferredClean = dedupeStringList([...preferredClean, ...fallbackDirs]).filter(d => !isInternalDir(d));
    scopedClean = dedupeStringList([...scopedClean, ...fallbackDirs]).filter(d => !isInternalDir(d));
  }

  const compileLikePrompt = /编译|构建|运行|recompile|compile|build|run/i.test(text);

  return {
    root,
    preferredDirs: preferredClean,
    hintedFiles: dedupeStringList(hintedFiles),
    scopedDirs: scopedClean,
    strictScope: compileLikePrompt && scopedClean.length > 0,
    forceCodeDir,
  };
}

export function resolveGeneratedArtifactPathForPrompt(
  rawPath: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): string {
  const root = getWorkspaceRootUri(requestPrompt, preferredAbsolutePaths);
  if (!root) return normalizeWorkspaceTargetPath(rawPath);

  const pathContext = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);
  const resolvedPath = resolveArtifactPathInWorkspace(rawPath, root, pathContext);
  if (!resolvedPath) return normalizeWorkspaceTargetPath(rawPath);
  return alignRelPathToScope(resolvedPath, root, pathContext);
}

export function isGeneratedArtifactAllowedForPrompt(
  resolvedRelPath: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): boolean {
  const root = getWorkspaceRootUri(requestPrompt, preferredAbsolutePaths);
  if (!root) return true;

  const ctx = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);
  if (!shouldRestrictGeneratedArtifactsToHintedFiles(ctx, requestPrompt)) return true;

  const normalized = normalizeWorkspaceTargetPath(resolvedRelPath);
  return ctx.hintedFiles.some((hint) => normalizeWorkspaceTargetPath(hint) === normalized);
}

export function resolveWorkspaceWritePath(
  rawPath: string,
  options: ResolveWorkspaceWritePathOptions = {},
): WorkspaceWritePathResult | undefined {
  const original = (rawPath || '').trim();
  if (!original) return undefined;

  const root = getWorkspaceRootForWrite(options);
  if (!root) return undefined;

  const fallbackAbsoluteDirs = options.defaultWorkdir ? [options.defaultWorkdir] : undefined;
  const ctx = buildWorkspacePathContext(root, {
    requestPrompt: options.requestPrompt,
    preferredAbsolutePaths: options.preferredAbsolutePaths,
    fallbackAbsoluteDirs,
  });

  const expandedOriginal = expandHomePath(original).replace(/\\/g, '/');
  if (nodePath.isAbsolute(expandedOriginal) && !sanitizeWorkspacePath(expandedOriginal, root)) {
    return undefined;
  }

  const normalized = normalizeExplicitWritePath(original, options.requestPrompt || '', options.content || '');
  const resolved = resolveArtifactPathInWorkspace(normalized, root, ctx);
  if (!resolved) return undefined;

  const relPath = alignRelPathToScope(resolved, root, ctx);
  const drift = detectWriteDriftForRelPaths([relPath], ctx);
  if (drift) return undefined;

  const absPath = vscode.Uri.joinPath(root, ...relPath.split('/')).fsPath;
  const rawComparable = sanitizeWorkspacePath(original, root) || normalizeWorkspaceTargetPath(original);
  const note = relPath !== rawComparable
    ? `路径“${original}”已按当前工作目录解析为“${relPath}”`
    : undefined;

  return {
    rawPath: original,
    relPath,
    absPath,
    ...(note ? { note } : {}),
  };
}

export function detectWorkspacePathScope(
  userPrompt: string | undefined,
  attachedFiles: string[] = [],
  activeEditorFile?: string,
): WorkspacePathScope {
  const root = getWorkspaceRootUri(userPrompt, attachedFiles);
  if (root) {
    const ctx = buildWorkspacePathContext(root, { requestPrompt: userPrompt });
    if (ctx.scopedDirs.length > 0) {
      return {
        promptDir: vscode.Uri.joinPath(root, ...ctx.scopedDirs[0].split('/')).fsPath,
        promptDirIsExplicit: true,
      };
    }
  }

  const wsRoot0 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot0) return { promptDir: undefined, promptDirIsExplicit: false };

  const anchorFile = attachedFiles.length > 0 ? attachedFiles[0] : activeEditorFile;
  if (!anchorFile) return { promptDir: undefined, promptDirIsExplicit: false };

  let dir = nodePath.dirname(anchorFile);
  const rootNorm = wsRoot0.replace(/\\/g, '/').replace(/\/$/, '');
  let dirNorm = dir.replace(/\\/g, '/');
  const SRC_LIKE = new Set([
    'src', 'include', 'lib', 'test', 'tests', 'bin', 'cmd', 'app',
    'core', 'utils', 'components', 'views', 'pages', 'models', 'services',
    'source', 'sources', 'headers', 'impl', 'internal', 'common', 'shared',
  ]);

  while (
    dirNorm !== rootNorm &&
    dirNorm.startsWith(rootNorm + '/') &&
    SRC_LIKE.has(nodePath.basename(dirNorm).toLowerCase())
  ) {
    dir = nodePath.dirname(dir);
    dirNorm = dir.replace(/\\/g, '/');
  }

  if (dirNorm !== rootNorm && dirNorm.startsWith(rootNorm + '/')) {
    return { promptDir: dir, promptDirIsExplicit: false };
  }
  return { promptDir: undefined, promptDirIsExplicit: false };
}

export function resolveArtifactPathInWorkspace(path: string, root: vscode.Uri, ctx: WorkspacePathContext): string | undefined {
  const direct = sanitizeWorkspacePath(path, root);
  const baseName = nodePath.posix.basename((direct || path).replace(/\\/g, '/'));
  if (baseName && baseName !== '.' && baseName !== '..') {
    const hintedExact = ctx.hintedFiles.find(
      (hf) => nodePath.posix.basename(hf) === baseName,
    );
    if (hintedExact) return hintedExact;
  }

  const scopedDirect = direct ? alignRelPathToScope(direct, root, ctx) : undefined;
  if (scopedDirect && scopedDirect.includes('/')) return scopedDirect;

  if (direct && direct.includes('/')) return direct;

  if (!baseName || baseName === '.' || baseName === '..') return direct || undefined;

  const isDocDir = (dir: string) => /(^|\/)docs?(?:\/|$)/i.test(dir);
  const isCodeFile = isCodeLikeFileName(baseName);

  for (const dir of ctx.preferredDirs) {
    if (isCodeFile && isDocDir(dir)) continue;
    const candidate = nodePath.posix.join(dir, baseName);
    const uri = vscode.Uri.joinPath(root, ...candidate.split('/'));
    if (fs.existsSync(uri.fsPath)) return candidate;
  }

  const compatibleDir = ctx.preferredDirs.find((dir) => !(isCodeFile && isDocDir(dir)));
  if (compatibleDir) {
    return nodePath.posix.join(compatibleDir, baseName);
  }

  if (ctx.forceCodeDir && isCodeFile) {
    return nodePath.posix.join('code', baseName);
  }

  return direct || undefined;
}

export function alignRelPathToScope(relPath: string, root: vscode.Uri, ctx: WorkspacePathContext): string {
  const clean = relPath.replace(/\\/g, '/');
  const scoped = (ctx.scopedDirs || []).filter(Boolean);
  if (scoped.length === 0) return clean;

  if (scoped.some((dir) => clean === dir || clean.startsWith(`${dir}/`))) return clean;

  const base = nodePath.posix.basename(clean);
  if (!base || base === '.' || base === '..') return clean;

  const parentAnchored = anchorParentLevelPathToScope(clean, scoped);
  if (parentAnchored) return parentAnchored;

  const anchored = anchorRelativePathToScope(clean, root, scoped);
  if (anchored) return anchored;

  if (clean.includes('/')) return clean;

  for (const dir of scoped) {
    const candidate = nodePath.posix.join(dir, base);
    const candidateUri = vscode.Uri.joinPath(root, ...candidate.split('/'));
    if (fs.existsSync(candidateUri.fsPath)) return candidate;
  }

  return nodePath.posix.join(scoped[0], base);
}

export function detectWriteDriftForRelPaths(relPaths: string[], ctx: WorkspacePathContext | undefined): string | undefined {
  if (!ctx) return undefined;

  const preferredDirs = (ctx.preferredDirs || []).filter(Boolean);
  const scopedDirs = (ctx.scopedDirs || []).filter(Boolean);
  const isExplicitSourceRoot = /^(?:code|src|lib|test|tests|include|pkg|packages|modules)\//i;

  for (const relPath of relPaths) {
    const rel = relPath.replace(/\\/g, '/');

    if (ctx.strictScope && scopedDirs.length > 0) {
      if (!isExplicitSourceRoot.test(rel)) {
        const inScope = scopedDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
        if (!inScope) {
          const scopedParents = scopedDirs
            .map((dir) => nodePath.posix.dirname(dir))
            .filter((p) => p && p !== '.');
          const underSiblingScope = scopedParents.some(
            (parent) => rel.startsWith(`${parent}/`) || rel === parent,
          );
          if (!underSiblingScope) {
            return `严格作用域限制触发：文件 ${rel} 不在目标目录 ${scopedDirs.join(', ')} 内`;
          }
        }
      }
    }

    if (preferredDirs.length === 0) continue;
    if (isExplicitSourceRoot.test(rel)) continue;

    const underPreferred = preferredDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
    if (underPreferred) {
      const isCodeFile = /\.(?:cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|sh|bash)$/i.test(rel);
      const inDocDir = /(^|\/)docs?(?:\/|$)/i.test(nodePath.posix.dirname(rel));
      if (isCodeFile && inDocDir) {
        return `代码文件 ${rel} 被写入文档目录，疑似路径漂移（代码文件不应出现在 docs/ 目录）`;
      }
      continue;
    }

    if (!rel.includes('/')) {
      return `文件 ${rel} 被写入工作区根目录，但提示上下文偏向目录: ${preferredDirs.join(', ')}`;
    }
  }

  return undefined;
}

export function sanitizeWorkspacePath(path: string, root: vscode.Uri): string | undefined {
  let p = path.replace(/\\/g, '/').trim();
  const rootPath = root.fsPath.replace(/\\/g, '/').replace(/\/$/, '');

  p = expandHomePath(p);
  p = p.replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, '');
  p = p.replace(/^!+/, '');
  if (looksLikePathLabelNoise(p)) return undefined;
  if (p.startsWith(rootPath + '/')) p = p.slice(rootPath.length + 1);

  p = nodePath.posix.normalize(p);
  if (!p || p === '.' || p.startsWith('../') || p.includes('/../') || nodePath.posix.isAbsolute(p) || p.startsWith('~/')) return undefined;
  if (p.split('/').some((seg) => seg === 'SEARCH' || seg === 'REPLACE')) return undefined;

  const firstSegLc = p.split('/')[0].toLowerCase();
  const SYSTEM_DIRS = new Set([
    'bin', 'sbin', 'usr', 'etc', 'dev', 'proc', 'sys', 'var', 'tmp',
    'run', 'home', 'root', 'opt', 'lib', 'lib64', 'boot', 'mnt', 'media', 'srv',
  ]);
  if (SYSTEM_DIRS.has(firstSegLc)) return undefined;
  return p;
}

function looksLikePathLabelNoise(path: string): boolean {
  const normalized = (path || '').trim();
  if (!normalized) return false;
  const withoutDrive = normalized.replace(/^[A-Za-z]:\//, '');
  if (/[\u2022\uFF08\uFF09\uFF1A]/.test(withoutDrive)) return true;
  if (/[()（）][：:]\//.test(withoutDrive)) return true;
  return withoutDrive.split('/').some((seg) => /[：:]\s*$/.test(seg) || /[()（）]\s*$/.test(seg));
}

function anchorParentLevelPathToScope(clean: string, scopedDirs: string[]): string | undefined {
  if (!clean.includes('/')) return undefined;
  const base = nodePath.posix.basename(clean);
  if (!isCodeLikeFileName(base)) return undefined;
  const cleanDir = nodePath.posix.dirname(clean);
  if (!cleanDir || cleanDir === '.') return undefined;

  for (const dir of scopedDirs) {
    const parent = nodePath.posix.dirname(dir);
    if (!parent || parent === '.') continue;
    if (cleanDir === parent) return nodePath.posix.join(dir, base);
  }
  return undefined;
}

function anchorRelativePathToScope(clean: string, root: vscode.Uri, scopedDirs: string[]): string | undefined {
  if (!clean.includes('/')) return undefined;

  const firstSeg = clean.split('/')[0];
  for (const dir of scopedDirs) {
    const dirBase = nodePath.posix.basename(dir);
    if (firstSeg !== dirBase) continue;
    const parent = nodePath.posix.dirname(dir);
    const candidate = parent && parent !== '.'
      ? nodePath.posix.join(parent, clean)
      : clean;
    if (candidate !== clean) return candidate;
  }

  const directUri = vscode.Uri.joinPath(root, ...clean.split('/'));
  if (fs.existsSync(directUri.fsPath)) return undefined;

  for (const dir of scopedDirs) {
    const candidate = nodePath.posix.join(dir, clean);
    const candidateUri = vscode.Uri.joinPath(root, ...candidate.split('/'));
    const parentUri = vscode.Uri.file(nodePath.dirname(candidateUri.fsPath));
    if (fs.existsSync(candidateUri.fsPath) || fs.existsSync(parentUri.fsPath)) {
      return candidate;
    }
  }

  return undefined;
}

function inferPromptDirectoryHints(text: string, root: vscode.Uri): string[] {
  const dirs: string[] = [];
  const absolutePathRe = /(?:^|[\s`'"(（:：])((?:~\/|\/)[A-Za-z0-9_./@%+-]+)(?=$|[\s`'",，。！？；;:)）]|[中内下里])/g;
  let m: RegExpExecArray | null;

  while ((m = absolutePathRe.exec(text || '')) !== null) {
    const rawPath = (m[1] || '').replace(/\/$/, '');
    const rel = sanitizeWorkspacePath(rawPath, root);
    if (!rel) continue;
    const uri = vscode.Uri.joinPath(root, ...rel.split('/'));
    try {
      if (fs.existsSync(uri.fsPath)) {
        const stat = fs.statSync(uri.fsPath);
        dirs.push(stat.isDirectory() ? rel : nodePath.posix.dirname(rel));
        continue;
      }
    } catch {
      // Advisory path hint only.
    }

    const base = nodePath.posix.basename(rel);
    const looksLikeFilePath = base.includes('.') || ['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base);
    dirs.push(looksLikeFilePath ? nodePath.posix.dirname(rel) : rel);
  }

  return dedupeStringList(dirs.filter((dir) => dir && dir !== '.'));
}

function inferScopedDirsFromCommandText(text: string, root: vscode.Uri): string[] {
  const dirs: string[] = [];
  const commandLines = text.match(/(?:^|\n)\s*(?:command|cmd)\s*[:=].*/gi) || [];
  const compileLines = text.match(/(?:^|\n).*\b(?:g\+\+|gcc|clang\+\+|clang|cmake|make|ninja|npm\s+run\s+build)\b.*/gi) || [];
  const merged = [...commandLines, ...compileLines].join('\n');
  if (!merged.trim()) return dirs;

  const pathRe = /([A-Za-z0-9_./-]+\.(?:cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|py|java|go|rs))/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(merged)) !== null) {
    const rel = sanitizeWorkspacePath((m[1] || '').trim(), root);
    if (!rel) continue;
    const dir = nodePath.posix.dirname(rel);
    if (dir && dir !== '.') dirs.push(dir);
  }

  return dedupeStringList(dirs);
}

function getWorkspaceRootForWrite(options: ResolveWorkspaceWritePathOptions): vscode.Uri | undefined {
  if (options.workspaceRootFsPath) return vscode.Uri.file(options.workspaceRootFsPath);

  const fromPrompt = getWorkspaceRootUri(options.requestPrompt, options.preferredAbsolutePaths);
  if (fromPrompt) return fromPrompt;

  if (options.defaultWorkdir) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(options.defaultWorkdir));
    if (folder) return folder.uri;
  }

  const folders = vscode.workspace.workspaceFolders || [];
  return folders.length === 1 ? folders[0].uri : undefined;
}

function normalizeExplicitWritePath(rawPath: string, userPrompt: string, content: string): string {
  let p = rawPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || nodePath.isAbsolute(expandHomePath(p))) return expandHomePath(p);

  const original = p;
  const base = nodePath.posix.basename(p.replace(/\/$/, ''));
  const hasExt = !!nodePath.posix.extname(base) || ['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base);
  if (hasExt) return p;

  if (!promptRequestsCodeDirectory(userPrompt) && !promptLooksLikeCProgram(userPrompt) && !promptLooksLikeCppProgram(userPrompt)) {
    return original;
  }

  const wantsCpp = promptLooksLikeCppProgram(userPrompt) || contentLooksLikeCppProgram(content);
  const wantsC = !wantsCpp && (promptLooksLikeCProgram(userPrompt) || contentLooksLikeCProgram(content));
  const ext = wantsCpp ? '.cpp' : wantsC ? '.c' : '.txt';

  if (p.endsWith('/') || p === 'code' || p === 'src') {
    return nodePath.posix.join(p.replace(/\/$/, ''), `${defaultCodeArtifactBasename(userPrompt)}${ext}`);
  }

  return `${p}${ext}`;
}

function expandHomePath(value: string): string {
  if (!value.startsWith('~/')) return value;
  const homePath = process.env.HOME ? process.env.HOME.replace(/\\/g, '/').replace(/\/$/, '') : '';
  return homePath ? `${homePath}/${value.slice(2)}` : value;
}

function promptRequestsCodeDirectory(userPrompt: string): boolean {
  return /(?:code\s*目录|code目录|code\/|code\s+dir|code\s+folder)/i.test(userPrompt);
}

function shouldRestrictGeneratedArtifactsToHintedFiles(ctx: WorkspacePathContext, requestPrompt = ''): boolean {
  if (ctx.hintedFiles.length === 0) return false;
  const text = requestPrompt || '';
  const expandsScope = /(创建|新建|新增|添加|拆分|抽取|迁移|重构|改造|多文件|多个文件|整个|全部|create|add|split|extract|move|rename|refactor)/i.test(text);
  if (expandsScope) return false;
  return /(修复|修正|修改|改一下|优化|完善|fix|modify|update|repair)/i.test(text) || ctx.hintedFiles.length === 1;
}

function promptLooksLikeCppProgram(userPrompt: string): boolean {
  return /(?:c\+\+|cpp|\.cpp\b|\.cc\b|\.cxx\b|C\+\+)/i.test(userPrompt);
}

function promptLooksLikeCProgram(userPrompt: string): boolean {
  return /(?:\bC\b|C语言|c程序|\.c\b)/i.test(userPrompt) && !promptLooksLikeCppProgram(userPrompt);
}

function contentLooksLikeCProgram(content: string): boolean {
  return /#include\s*</.test(content) && /\bmain\s*\(/.test(content) && !contentLooksLikeCppProgram(content);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function defaultCodeArtifactBasename(userPrompt: string): string {
  return /(?:三维|3d|3D|OpenGL|GLUT|动画世界)/i.test(userPrompt) ? '3d_world' : 'main';
}

function isCodeLikeFileName(baseName: string): boolean {
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(baseName)) return true;
  return /\.(?:cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|sh|bash)$/i.test(baseName);
}

function dedupeStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
