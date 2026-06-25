import * as nodePath from 'path';

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

const CPP_SOURCE_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_HEADER_RE = /\.(h|hpp)$/i;
const CMAKE_LISTS_RE = /(?:^|\/)CMakeLists\.txt$/;

export function planCppValidation(
  changedPaths: string[],
  rootFsPath: string,
  fsNode: { existsSync: (p: string) => boolean; readdirSync: (p: string) => string[]; readFileSync: (p: string, enc: string) => string },
  policy: CppValidationPolicy = 'conservative',
  options: CppValidationOptions = {},
): PlannedValidation | null {
  const cppRelated = changedPaths.filter((p) => /\.(cpp|cc|cxx|c|h|hpp)$/i.test(p) || CMAKE_LISTS_RE.test(p.replace(/\\/g, '/')));
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
    const buildDir = nodePath.join(targetDir, '.devseek-build');
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
      const exeOut = nodePath.join(targetDir, 'deepseek_auto_exec');
      return {
        command: `g++ ${linkSet.map(q).join(' ')} -o ${q(exeOut)} && ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-run',
        reason: options.run ? 'multi-main-single-entry-run-requested' : 'multi-main-aggressive-single-entry-run',
      };
    }

    return {
      command: buildCompileOnlyCommand(compileTargets),
      cwd: targetDir,
      mode: 'compile-only',
      reason: 'multi-main-minimal-compile-only',
    };
  }

  // Case 2: single-main project; avoid run by default, escalate only with aggressive policy.
  if (mainSources.length === 1) {
    const compileSet = uniqueAbsPaths(sourceFiles);
    const exeOut = nodePath.join(targetDir, 'deepseek_auto_exec');

    if (options.run || (policy === 'aggressive' && changedSources.length > 0)) {
      return {
        command: `g++ ${compileSet.map(q).join(' ')} -o ${q(exeOut)} && ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-run',
        reason: options.run ? 'single-main-run-requested' : 'single-main-aggressive-run',
      };
    }

    if (policy === 'balanced' && changedSources.length > 0) {
      return {
        command: `g++ ${compileSet.map(q).join(' ')} -o ${q(exeOut)}`,
        cwd: targetDir,
        mode: 'compile-link',
        reason: 'single-main-link-check-no-run',
      };
    }

    const compileTargets = fallbackCompileTargets.length > 0 ? fallbackCompileTargets : compileSet;
    if (compileTargets.length > 0) {
      return {
        command: buildCompileOnlyCommand(compileTargets),
        cwd: targetDir,
        mode: 'compile-only',
        reason: changedHeaders.length > 0 ? 'header-change-minimal-compile-only' : 'single-main-safe-compile-only',
      };
    }
  }

  // Case 3: library-like (no main) or unresolved shape.
  const fallbackTargets = fallbackCompileTargets.length > 0 ? fallbackCompileTargets : sourceFiles.slice(0, 4);
  return {
    command: buildCompileOnlyCommand(fallbackTargets),
    cwd: targetDir,
    mode: 'compile-only',
    reason: 'fallback-minimal-compile-only',
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
  const executablePath = nodePath.join(buildDir, executableTarget);
  return `if test -x ${q(executablePath)}; then ${q(executablePath)}; else ctest --test-dir ${q(buildDir)} --output-on-failure; fi`;
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
  fsNode: { readFileSync: (p: string, enc: string) => string },
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

function hasMainFunction(absPath: string, fsNode: { readFileSync: (p: string, enc: string) => string }): boolean {
  try {
    const content = fsNode.readFileSync(absPath, 'utf8');
    return /\bint\s+main\s*\(/.test(content);
  } catch {
    return false;
  }
}

function buildCompileOnlyCommand(targets: string[]): string {
  const objDir = `/tmp/deepseek_obj_${Date.now()}`;
  return `mkdir -p ${q(objDir)} && ${targets.map((abs, idx) => `g++ -fsyntax-only ${q(abs)} && g++ -c ${q(abs)} -o ${q(nodePath.join(objDir, `obj_${idx}.o`))}`).join(' && ')}`;
}

function q(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
