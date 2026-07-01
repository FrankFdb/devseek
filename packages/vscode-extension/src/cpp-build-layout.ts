import * as nodePath from 'path';

export const CPP_BUILD_DIR_NAME = 'build';
export const DEVSEEK_BUILD_SUBDIR = 'devseek';
export const LEGACY_CPP_BUILD_DIR_NAMES = ['devseek-build', '.devseek-build', '.devseek-builds'] as const;
export const CMAKE_GENERATED_DIR_NAME = 'CMakeFiles';

const CPP_BUILD_OUTPUT_DIR_NAME_SET = new Set<string>(
  [CPP_BUILD_DIR_NAME, ...LEGACY_CPP_BUILD_DIR_NAMES].map(name => name.toLowerCase()),
);
const CPP_BUILD_ARTIFACT_DIR_NAME_SET = new Set<string>(
  [CPP_BUILD_DIR_NAME, ...LEGACY_CPP_BUILD_DIR_NAMES, CMAKE_GENERATED_DIR_NAME].map(name => name.toLowerCase()),
);

export function listCppBuildOutputDirNames(): readonly string[] {
  return [CPP_BUILD_DIR_NAME, ...LEGACY_CPP_BUILD_DIR_NAMES];
}

export function isCppBuildOutputDirName(name: string): boolean {
  return CPP_BUILD_OUTPUT_DIR_NAME_SET.has((name || '').toLowerCase());
}

export function isLegacyCppBuildOutputDirName(name: string): boolean {
  const normalized = (name || '').toLowerCase();
  return LEGACY_CPP_BUILD_DIR_NAMES.some(legacyName => legacyName.toLowerCase() === normalized);
}

export function isCppBuildArtifactDirName(name: string): boolean {
  return CPP_BUILD_ARTIFACT_DIR_NAME_SET.has((name || '').toLowerCase());
}

export function getCmakeBuildDir(projectDir: string): string {
  return nodePath.join(projectDir, CPP_BUILD_DIR_NAME);
}

export function getLegacyCppBuildDirs(projectDir: string): string[] {
  return LEGACY_CPP_BUILD_DIR_NAMES.map(name => nodePath.join(projectDir, name));
}

export function getDevSeekBuildDir(projectDir: string): string {
  return nodePath.join(getCmakeBuildDir(projectDir), DEVSEEK_BUILD_SUBDIR);
}

export function getCppCompileOnlyDir(projectDir: string): string {
  return nodePath.join(getDevSeekBuildDir(projectDir), 'compile-only');
}

export function getCppAutoExecutablePath(projectDir: string): string {
  return nodePath.join(getDevSeekBuildDir(projectDir), 'deepseek_auto_exec');
}

export function getCmakeExecutableCandidatePaths(buildDir: string, executableTarget: string): string[] {
  return platformExecutableNames(executableTarget).flatMap((name) => [
    nodePath.join(buildDir, 'bin', name),
    nodePath.join(buildDir, name),
    nodePath.join(buildDir, 'Debug', name),
    nodePath.join(buildDir, 'Release', name),
    nodePath.join(buildDir, 'RelWithDebInfo', name),
    nodePath.join(buildDir, 'MinSizeRel', name),
  ]);
}

function platformExecutableNames(name: string): string[] {
  if (process.platform !== 'win32' || /\.exe$/i.test(name)) return [name];
  return [name, `${name}.exe`];
}
