import * as nodePath from 'path';

export const CPP_BUILD_DIR_NAME = 'build';
export const DEVSEEK_BUILD_SUBDIR = 'devseek';

export function getCmakeBuildDir(projectDir: string): string {
  return nodePath.join(projectDir, CPP_BUILD_DIR_NAME);
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
