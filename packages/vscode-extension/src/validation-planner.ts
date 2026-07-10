import * as nodePath from 'path';
import {
  getCmakeBuildDir,
  getCmakeExecutableCandidatePaths,
  getCppAutoExecutablePath,
  getCppCompileOnlyDir,
  getDevSeekBuildDir,
} from './cpp-build-layout';

export interface PlannedValidation {
  command: string;
  cwd: string;
  mode: 'compile-only' | 'compile-link' | 'compile-run' | 'cmake';
  reason: string;
}

export type CppValidationPolicy = 'conservative' | 'balanced' | 'aggressive';

export interface CppValidationOptions {
  run?: boolean;
}

export interface CppDependencyClosureIssue {
  file: string;
  include: string;
  reason: 'missing-local-include' | 'missing-standard-include';
  expectedPath?: string;
}

export interface CppDependencyClosureReport {
  ok: boolean;
  targetDir?: string;
  checkedFiles: string[];
  issues: CppDependencyClosureIssue[];
}

type CppValidationFsNode = {
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: string) => string;
};

const CPP_SOURCE_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_HEADER_RE = /\.(h|hpp)$/i;
const CMAKE_LISTS_RE = /(?:^|\/)CMakeLists\.txt$/;
const CPP_RELATED_RE = /\.(cpp|cc|cxx|c|h|hpp)$/i;

const COMMON_CPP_SYMBOL_INCLUDES: Array<{ include: string; symbol: RegExp; includeRe: RegExp }> = [
  { include: '<memory>', symbol: /\bstd::(?:unique_ptr|shared_ptr|weak_ptr|make_unique|make_shared)\b/, includeRe: /^\s*#include\s*<memory>/m },
  { include: '<vector>', symbol: /\bstd::vector\b/, includeRe: /^\s*#include\s*<vector>/m },
  { include: '<string>', symbol: /\bstd::(?:string|string_view)\b/, includeRe: /^\s*#include\s*<(?:string|string_view)>/m },
  { include: '<map>', symbol: /\bstd::(?:map|multimap)\b/, includeRe: /^\s*#include\s*<map>/m },
  { include: '<unordered_map>', symbol: /\bstd::unordered_map\b/, includeRe: /^\s*#include\s*<unordered_map>/m },
  { include: '<unordered_set>', symbol: /\bstd::unordered_set\b/, includeRe: /^\s*#include\s*<unordered_set>/m },
  { include: '<set>', symbol: /\bstd::(?:set|multiset)\b/, includeRe: /^\s*#include\s*<set>/m },
  { include: '<optional>', symbol: /\bstd::optional\b/, includeRe: /^\s*#include\s*<optional>/m },
  { include: '<variant>', symbol: /\bstd::variant\b/, includeRe: /^\s*#include\s*<variant>/m },
  { include: '<functional>', symbol: /\bstd::function\b/, includeRe: /^\s*#include\s*<functional>/m },
  { include: '<thread>', symbol: /\bstd::thread\b/, includeRe: /^\s*#include\s*<thread>/m },
  { include: '<mutex>', symbol: /\bstd::(?:mutex|lock_guard|unique_lock)\b/, includeRe: /^\s*#include\s*<mutex>/m },
  { include: '<atomic>', symbol: /\bstd::atomic\b/, includeRe: /^\s*#include\s*<atomic>/m },
  { include: '<chrono>', symbol: /\bstd::chrono::/, includeRe: /^\s*#include\s*<chrono>/m },
];

export function planCppValidation(
  changedPaths: string[],
  rootFsPath: string,
  fsNode: CppValidationFsNode,
  policy: CppValidationPolicy = 'conservative',
  options: CppValidationOptions = {},
): PlannedValidation | null {
  const cppRelated = changedPaths.filter((p) => CPP_RELATED_RE.test(p) || CMAKE_LISTS_RE.test(p.replace(/\\/g, '/')));
  if (cppRelated.length === 0) return null;

  const dirCount = new Map<string, number>();
  for (const rel of cppRelated) {
    const dir = nodePath.posix.dirname(rel);
    dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
  }
  const targetRelDir = [...dirCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'code';
  const targetDir = nodePath.join(rootFsPath, targetRelDir);
  if (!fsNode.existsSync(targetDir)) return null;

  const cmakeFile = nodePath.join(targetDir, 'CMakeLists.txt');
  if (fsNode.existsSync(cmakeFile)) {
    const buildDir = getCmakeBuildDir(targetDir);
    const buildOnly = `cmake -S ${q(targetDir)} -B ${q(buildDir)} && cmake --build ${q(buildDir)}`;
    const shouldRun = !!options.run || policy === 'aggressive';
    if (shouldRun) {
      const runCommand = buildCmakeRunCommand(cmakeFile, buildDir, fsNode);
      return {
        command: `${buildOnly} && ${runCommand}`,
        cwd: rootFsPath,
        mode: 'cmake',
        reason: options.run ? 'cmake-build-and-run-requested' : 'cmake-build-and-test',
      };
    }
    return {
      command: buildOnly,
      cwd: rootFsPath,
      mode: 'cmake',
      reason: 'cmake-build-only-safe-default',
    };
  }

  const fileNames = fsNode.readdirSync(targetDir);
  const sourceFiles = fileNames
    .filter((name) => CPP_SOURCE_RE.test(name))
    .map((name) => nodePath.join(targetDir, name));
  if (sourceFiles.length === 0) return null;

  const changedInDir = cppRelated.filter((p) => nodePath.posix.dirname(p) === targetRelDir);
  const changedSources = changedInDir
    .filter((p) => CPP_SOURCE_RE.test(p))
    .map((p) => nodePath.join(rootFsPath, p));
  const changedHeaders = changedInDir.filter((p) => CPP_HEADER_RE.test(p));

  const mainSources = sourceFiles.filter((abs) => hasMainFunction(abs, fsNode));
  const changedMainSources = changedSources.filter((abs) => hasMainFunction(abs, fsNode));

  const impactedByHeader = inferImpactedSourcesByHeader(changedHeaders, sourceFiles, fsNode);
  const minimalTargets = uniqueAbsPaths(changedSources.length > 0 ? changedSources : impactedByHeader);
  const fallbackCompileTargets = uniqueAbsPaths(
    minimalTargets.length > 0
      ? minimalTargets
      : sourceFiles.filter((abs) => !hasMainFunction(abs, fsNode)).slice(0, 4),
  );

  // Case 1: multi-main project should default to compile-only minimal targets.
  if (mainSources.length > 1) {
    const compileTargets = fallbackCompileTargets.length > 0 ? fallbackCompileTargets : sourceFiles.slice(0, 4);
    if (compileTargets.length === 0) return null;

    if ((options.run || policy === 'aggressive') && changedMainSources.length === 1) {
      const chosenMain = changedMainSources[0];
      const nonMain = sourceFiles.filter((abs) => abs !== chosenMain && !hasMainFunction(abs, fsNode));
      const linkSet = uniqueAbsPaths([...nonMain, chosenMain]);
      const exeOut = getCppAutoExecutablePath(targetDir);
      const exeDir = getDevSeekBuildDir(targetDir);
      return {
        command: `mkdir -p ${q(exeDir)} && g++ ${linkSet.map(q).join(' ')} -o ${q(exeOut)} && ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-run',
        reason: options.run ? 'multi-main-single-entry-run-requested' : 'multi-main-aggressive-single-entry-run',
      };
    }

    return {
      command: buildCompileOnlyCommand(compileTargets, targetDir),
      cwd: targetDir,
      mode: 'compile-only',
      reason: 'multi-main-minimal-compile-only',
    };
  }

  // Case 2: single-main project; avoid run by default, escalate only with aggressive policy.
  if (mainSources.length === 1) {
    const compileSet = uniqueAbsPaths(sourceFiles);
    const exeOut = getCppAutoExecutablePath(targetDir);
    const exeDir = getDevSeekBuildDir(targetDir);

    if (options.run || (policy === 'aggressive' && changedSources.length > 0)) {
      return {
        command: `mkdir -p ${q(exeDir)} && g++ ${compileSet.map(q).join(' ')} -o ${q(exeOut)} && ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-run',
        reason: options.run ? 'single-main-run-requested' : 'single-main-aggressive-run',
      };
    }

    if (policy === 'balanced' && changedSources.length > 0) {
      return {
        command: `mkdir -p ${q(exeDir)} && g++ ${compileSet.map(q).join(' ')} -o ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-link',
        reason: 'single-main-link-check-no-run',
      };
    }

    const compileTargets = fallbackCompileTargets.length > 0 ? fallbackCompileTargets : compileSet;
    if (compileTargets.length > 0) {
      return {
        command: buildCompileOnlyCommand(compileTargets, targetDir),
        cwd: targetDir,
        mode: 'compile-only',
        reason: changedHeaders.length > 0 ? 'header-change-minimal-compile-only' : 'single-main-safe-compile-only',
      };
    }
  }

  // Case 3: library-like (no main) or unresolved shape.
  const fallbackTargets = fallbackCompileTargets.length > 0 ? fallbackCompileTargets : sourceFiles.slice(0, 4);
  return {
    command: buildCompileOnlyCommand(fallbackTargets, targetDir),
    cwd: targetDir,
    mode: 'compile-only',
    reason: 'fallback-minimal-compile-only',
  };
}

export function inspectCppDependencyClosure(
  changedPaths: string[],
  rootFsPath: string,
  fsNode: CppValidationFsNode,
): CppDependencyClosureReport {
  const cppRelated = changedPaths.filter((p) => CPP_RELATED_RE.test(p));
  const targetDir = resolveDominantCppTargetDir(cppRelated, rootFsPath, fsNode);
  if (!targetDir) {
    return { ok: true, checkedFiles: [], issues: [] };
  }

  const fileNames = safeReadDir(targetDir, fsNode);
  const checkedFiles = fileNames
    .filter((name) => CPP_SOURCE_RE.test(name) || CPP_HEADER_RE.test(name))
    .map((name) => nodePath.join(targetDir, name));
  const issues: CppDependencyClosureIssue[] = [];

  for (const file of checkedFiles) {
    const content = readText(file, fsNode);
    if (!content) continue;
    issues.push(...findMissingLocalIncludes(file, content, targetDir, rootFsPath, fsNode));
    issues.push(...findMissingStandardIncludes(file, content));
  }

  return {
    ok: issues.length === 0,
    targetDir,
    checkedFiles,
    issues: uniqueDependencyIssues(issues),
  };
}

function buildCmakeRunCommand(
  cmakeFile: string,
  buildDir: string,
  fsNode: { readFileSync: (p: string, enc: string) => string },
): string {
  const executableTarget = detectCmakeExecutableTarget(cmakeFile, fsNode);
  if (!executableTarget) {
    return `ctest --test-dir ${q(buildDir)} --output-on-failure`;
  }
  return buildRunFirstExistingExecutableCommand(
    getCmakeExecutableCandidatePaths(buildDir, executableTarget),
    `ctest --test-dir ${q(buildDir)} --output-on-failure`,
  );
}

function detectCmakeExecutableTarget(
  cmakeFile: string,
  fsNode: { readFileSync: (p: string, enc: string) => string },
): string | null {
  try {
    const content = fsNode.readFileSync(cmakeFile, 'utf8');
    const match = content.match(/\badd_executable\s*\(\s*([A-Za-z0-9_.+-]+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function inferImpactedSourcesByHeader(
  changedHeaders: string[],
  sourceFiles: string[],
  fsNode: CppValidationFsNode,
): string[] {
  if (changedHeaders.length === 0) return [];
  const matched = new Set<string>();

  for (const headerRel of changedHeaders) {
    const base = nodePath.basename(headerRel).replace(/\.(h|hpp)$/i, '');
    for (const source of sourceFiles) {
      const sourceBase = nodePath.basename(source).replace(/\.(cpp|cc|cxx|c)$/i, '');
      if (sourceBase === base) {
        matched.add(source);
      }
    }
  }

  if (matched.size > 0) return [...matched];

  const nonMain = sourceFiles.filter((abs) => !hasMainFunction(abs, fsNode));
  if (nonMain.length > 0) return nonMain.slice(0, 3);
  return sourceFiles.slice(0, 2);
}

function uniqueAbsPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function hasMainFunction(absPath: string, fsNode: CppValidationFsNode): boolean {
  try {
    const content = fsNode.readFileSync(absPath, 'utf8');
    return /\bint\s+main\s*\(/.test(content);
  } catch {
    return false;
  }
}

function buildCompileOnlyCommand(targets: string[], targetDir: string): string {
  const objDir = getCppCompileOnlyDir(targetDir);
  return `mkdir -p ${q(objDir)} && ${targets.map((abs, idx) => `g++ -fsyntax-only ${q(abs)} && g++ -c ${q(abs)} -o ${q(nodePath.join(objDir, `obj_${idx}.o`))}`).join(' && ')}`;
}

function buildRunFirstExistingExecutableCommand(candidates: string[], fallbackCommand: string): string {
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  if (uniqueCandidates.length === 0) return fallbackCommand;
  const clauses = uniqueCandidates.map((candidate, index) => {
    const prefix = index === 0 ? 'if' : 'elif';
    return `${prefix} test -x ${q(candidate)}; then ${q(candidate)}`;
  });
  return `${clauses.join('; ')}; else ${fallbackCommand}; fi`;
}

function q(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function resolveDominantCppTargetDir(
  cppRelated: string[],
  rootFsPath: string,
  fsNode: CppValidationFsNode,
): string | undefined {
  if (cppRelated.length === 0) return undefined;
  const dirCount = new Map<string, number>();
  for (const rel of cppRelated) {
    const dir = nodePath.posix.dirname(rel.replace(/\\/g, '/'));
    dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
  }
  const targetRelDir = [...dirCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!targetRelDir) return undefined;
  const targetDir = nodePath.join(rootFsPath, targetRelDir);
  return fsNode.existsSync(targetDir) ? targetDir : undefined;
}

function safeReadDir(dir: string, fsNode: CppValidationFsNode): string[] {
  try {
    return fsNode.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(absPath: string, fsNode: CppValidationFsNode): string {
  try {
    return fsNode.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

function findMissingLocalIncludes(
  file: string,
  content: string,
  targetDir: string,
  rootFsPath: string,
  fsNode: CppValidationFsNode,
): CppDependencyClosureIssue[] {
  const issues: CppDependencyClosureIssue[] = [];
  const includeRe = /^\s*#include\s*"([^"]+)"/gm;
  let match: RegExpExecArray | null;
  while ((match = includeRe.exec(content)) !== null) {
    const include = match[1]?.trim();
    if (!include) continue;
    const candidates = [
      nodePath.resolve(nodePath.dirname(file), include),
      nodePath.resolve(targetDir, include),
      nodePath.resolve(rootFsPath, include),
    ];
    if (candidates.some(candidate => fsNode.existsSync(candidate))) continue;
    issues.push({
      file,
      include: `"${include}"`,
      reason: 'missing-local-include',
      expectedPath: candidates[0],
    });
  }
  return issues;
}

function findMissingStandardIncludes(file: string, content: string): CppDependencyClosureIssue[] {
  return COMMON_CPP_SYMBOL_INCLUDES
    .filter(rule => rule.symbol.test(content) && !rule.includeRe.test(content))
    .map(rule => ({
      file,
      include: rule.include,
      reason: 'missing-standard-include' as const,
    }));
}

function uniqueDependencyIssues(issues: CppDependencyClosureIssue[]): CppDependencyClosureIssue[] {
  const seen = new Set<string>();
  const out: CppDependencyClosureIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.reason}:${issue.file}:${issue.include}:${issue.expectedPath || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
