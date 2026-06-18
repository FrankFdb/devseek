import * as nodePath from 'path';

export const DEFAULT_SOURCE_FILE_RE = /\.(cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|py|java|go|rs|md|json|yaml|yml|sh|bash)$/i;
export const EXECUTION_SOURCE_FILE_RE = /\.(cpp|cc|cxx|c|h|hpp|py|js)$/i;

export const DISCOVERY_SKIP_DIR_RE = /^(build|dist|node_modules|\.git|\.cache|__pycache__|target|out|bin|obj|\.vscode|\.idea|docs|test|tests|devseek-build|\.devseek-build|\.devseek-builds|CMakeFiles|cmake-build-[A-Za-z0-9_.-]+)$/i;

const GENERATED_BUILD_FILE_RE = /^(?:CMake(?:C|CXX|CUDA)?CompilerId|CMakeCompilerId)\.(?:c|cc|cpp|cxx|cu)$|^compiler_depend(?:ent)?(?:\..*)?$/i;

export function shouldSkipDiscoveryDir(name: string): boolean {
  return DISCOVERY_SKIP_DIR_RE.test(name || '');
}

export function isGeneratedBuildArtifactPath(filePath: string): boolean {
  const normalized = (filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => shouldSkipDiscoveryDir(segment))) return true;

  return GENERATED_BUILD_FILE_RE.test(nodePath.basename(normalized));
}

export function shouldIncludeDiscoveredSourceFile(filePath: string, filter: RegExp): boolean {
  return filter.test(filePath) && !isGeneratedBuildArtifactPath(filePath);
}
