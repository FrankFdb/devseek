import { isCppBuildArtifactDirName, listCppBuildOutputDirNames } from '../cpp-build-layout';

const INTERNAL_OR_GENERATED_DIR_NAMES = Object.freeze([
  '.devseek',
  '.git',
  '.cache',
  '.vscode',
  '.idea',
  'node_modules',
  'backups',
  'dist',
  'out',
  'coverage',
  'tmp',
  'temp',
  'log',
  'logs',
] as const);

const INTERNAL_OR_GENERATED_DIR_NAME_SET = new Set<string>(
  INTERNAL_OR_GENERATED_DIR_NAMES.map(name => name.toLowerCase()),
);

/** One owner for directories that must not become implicit model context. */
export function isWorkspaceInternalOrGeneratedDirName(name: string): boolean {
  const normalized = String(name || '').toLowerCase();
  return INTERNAL_OR_GENERATED_DIR_NAME_SET.has(normalized)
    || isCppBuildArtifactDirName(normalized);
}

export function listWorkspaceSearchExcludedDirNames(): readonly string[] {
  return Object.freeze([
    ...INTERNAL_OR_GENERATED_DIR_NAMES,
    ...listCppBuildOutputDirNames(),
    'CMakeFiles',
  ]);
}

export function buildWorkspaceSearchExcludeGlob(): string {
  return `**/{${listWorkspaceSearchExcludedDirNames().join(',')}}/**`;
}
