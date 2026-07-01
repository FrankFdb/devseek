import * as fs from 'fs';
import * as nodePath from 'path';
import { isLegacyCppBuildOutputDirName } from '../cpp-build-layout';

const FORBIDDEN_ABSOLUTE_DIR_PREFIXES = ['/etc/', '/proc/', '/sys/', '/dev/', '/boot/'];
const LEGACY_BUILD_NOTICE = '（旧构建目录已隐藏；DevSeek 统一使用项目内 build/，不要读取或执行旧构建产物。）';

export function listWorkspaceDirectoryForAi(workspaceRootFsPath: string, requestedPath: string): string {
  const target = resolveListDirTarget(workspaceRootFsPath, requestedPath);
  if (pathContainsLegacyBuildDir(target)) {
    return LEGACY_BUILD_NOTICE;
  }

  try {
    const names = fs.readdirSync(target);
    const visibleNames = names.filter(name => !isLegacyCppBuildOutputDirName(name));
    return visibleNames.map((name: string) => formatDirectoryEntry(target, name)).join('\n') || '（空目录）';
  } catch (e) {
    throw new Error(`list_dir 失败: ${(e as Error).message}`);
  }
}

function resolveListDirTarget(workspaceRootFsPath: string, requestedPath: string): string {
  const pathValue = (requestedPath || '.').trim() || '.';
  if (nodePath.isAbsolute(pathValue)) {
    if (FORBIDDEN_ABSOLUTE_DIR_PREFIXES.some(prefix => pathValue.startsWith(prefix))) {
      throw new Error(`禁止列出系统目录: ${pathValue}`);
    }
    return pathValue;
  }
  return nodePath.join(workspaceRootFsPath, pathValue);
}

function pathContainsLegacyBuildDir(filePath: string): boolean {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some(segment => isLegacyCppBuildOutputDirName(segment));
}

function formatDirectoryEntry(target: string, name: string): string {
  try {
    return fs.statSync(nodePath.join(target, name)).isDirectory() ? `[dir]  ${name}` : `[file] ${name}`;
  } catch {
    return `[?]    ${name}`;
  }
}
