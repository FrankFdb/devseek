import * as fs from 'fs';
import * as nodePath from 'path';
import { getLegacyCppBuildDirs } from '../cpp-build-layout';

export interface CppBuildCleanupInput {
  command: string;
  workdir?: string;
  workspaceRoot?: string;
}

export interface CppBuildCleanupResult {
  cleaned: string[];
}

const CPP_BUILD_COMMAND_RE = /\b(?:cmake|ctest|make|ninja|g\+\+|clang\+\+|gcc|cc|c\+\+)\b/i;

export function cleanupLegacyCppBuildDirsForCommand(input: CppBuildCleanupInput): CppBuildCleanupResult {
  if (!CPP_BUILD_COMMAND_RE.test(input.command || '')) return { cleaned: [] };

  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
  const projectDirs = collectCandidateProjectDirs(input, workspaceRoot);
  const cleaned: string[] = [];
  for (const projectDir of projectDirs) {
    if (!isLikelyCppProjectDir(projectDir)) continue;
    for (const legacyDir of getLegacyCppBuildDirs(projectDir)) {
      if (!isPathInside(projectDir, legacyDir) || !isPathInside(workspaceRoot, legacyDir)) continue;
      if (!fs.existsSync(legacyDir)) continue;
      try {
        fs.rmSync(legacyDir, { recursive: true, force: true });
        cleaned.push(legacyDir);
      } catch {
        // Cleanup is best-effort; the build command remains the source of truth.
      }
    }
  }
  return { cleaned };
}

function collectCandidateProjectDirs(input: CppBuildCleanupInput, workspaceRoot: string): string[] {
  const dirs = new Set<string>();
  const baseWorkdir = resolvePath(input.workdir || workspaceRoot, workspaceRoot);
  dirs.add(baseWorkdir);
  for (const cdDir of extractShellCdDirs(input.command)) {
    dirs.add(resolvePath(cdDir, baseWorkdir));
  }
  for (const sourceDir of extractCmakeSourceDirs(input.command)) {
    dirs.add(resolvePath(sourceDir, baseWorkdir));
  }
  for (const buildDir of extractCmakeBuildDirs(input.command)) {
    dirs.add(resolveBuildParentPath(resolvePath(buildDir, baseWorkdir)));
  }
  return [...dirs]
    .map(dir => nodePath.resolve(dir))
    .filter(dir => isPathInsideOrEqual(workspaceRoot, dir));
}

function resolveWorkspaceRoot(workspaceRoot?: string): string {
  return nodePath.resolve(workspaceRoot || process.cwd());
}

function resolvePath(pathValue: string, baseDir: string): string {
  const cleanPath = stripShellQuotes(pathValue.trim());
  return nodePath.resolve(nodePath.isAbsolute(cleanPath) ? cleanPath : nodePath.join(baseDir, cleanPath));
}

function resolveBuildParentPath(buildDir: string): string {
  return nodePath.basename(buildDir) === 'build' ? nodePath.dirname(buildDir) : buildDir;
}

function extractShellCdDirs(command: string): string[] {
  return extractCommandArgs(command, /\bcd\s+((?:"[^"]+"|'[^']+'|[^;&|]+))/g);
}

function extractCmakeSourceDirs(command: string): string[] {
  return extractCommandArgs(command, /(?:^|\s)-S\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+))/g);
}

function extractCmakeBuildDirs(command: string): string[] {
  return extractCommandArgs(command, /(?:^|\s)(?:-B|--build)\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+))/g);
}

function extractCommandArgs(command: string, pattern: RegExp): string[] {
  const args: string[] = [];
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(command || '')) !== null) {
    const arg = stripShellQuotes(match[1] || '').trim();
    if (arg) args.push(arg);
  }
  return args;
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLikelyCppProjectDir(dir: string): boolean {
  try {
    if (fs.existsSync(nodePath.join(dir, 'CMakeLists.txt'))) return true;
    return fs.readdirSync(dir).some(name => /\.(?:cpp|cc|cxx|c|h|hpp|hh|hxx)$/i.test(name));
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = nodePath.relative(nodePath.resolve(parent), nodePath.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !nodePath.isAbsolute(relative);
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const relative = nodePath.relative(nodePath.resolve(parent), nodePath.resolve(child));
  return !relative || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}
