import * as nodePath from 'path';
import { isCppBuildArtifactDirName } from './cpp-build-layout';

export const DEFAULT_SOURCE_FILE_RE = /\.(cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|py|java|go|rs|md|json|yaml|yml|sh|bash)$/i;
export const EXECUTION_SOURCE_FILE_RE = /\.(cpp|cc|cxx|c|h|hpp|py|js)$/i;
export const PROJECT_CONTEXT_SOURCE_FILE_RE = /(?:^|[/\\])(?:Makefile|Dockerfile|CMakeLists\.txt|package\.json|tsconfig\.json|jsconfig\.json|pyproject\.toml|Cargo\.toml|go\.mod|go\.sum|pom\.xml|build\.gradle|settings\.gradle|composer\.json|Gemfile)$|\.(cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|mjs|py|java|go|rs|cs|rb|php|swift|kt|scala|dart|lua|r|sh|bash)$/i;

export const DISCOVERY_SKIP_DIR_RE = /^(dist|node_modules|\.git|\.cache|__pycache__|target|out|bin|obj|\.vscode|\.idea|docs|test|tests|cmake-build-[A-Za-z0-9_.-]+)$/i;

const GENERATED_BUILD_FILE_RE = /^(?:CMake(?:C|CXX|CUDA)?CompilerId|CMakeCompilerId)\.(?:c|cc|cpp|cxx|cu)$|^compiler_depend(?:ent)?(?:\..*)?$/i;

export function shouldSkipDiscoveryDir(name: string): boolean {
  return isCppBuildArtifactDirName(name || '') || DISCOVERY_SKIP_DIR_RE.test(name || '');
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
