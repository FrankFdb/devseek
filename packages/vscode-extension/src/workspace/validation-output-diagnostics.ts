import * as nodePath from 'path';

const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const CPP_PATH_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu;
const GCC_CLANG_WARNING_RE = /^(.*?):(\d+):(?:(\d+):)?\s*warning:\s*(.+)$/iu;

export interface ScopedCompilerWarning {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly message: string;
}

export interface ValidationOutputDiagnosticAssessment {
  readonly warnings: readonly ScopedCompilerWarning[];
  readonly summary?: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessValidationOutputInput {
  readonly cwd: string;
  readonly scopePaths: readonly string[];
  readonly output: string;
}

/** Interprets successful compiler output without changing project build policy. */
export function assessValidationOutputDiagnostics(
  input: AssessValidationOutputInput,
): ValidationOutputDiagnosticAssessment {
  const scopedPaths = new Set(input.scopePaths.map(normalizeRelativePath).filter(path => CPP_PATH_RE.test(path)));
  if (scopedPaths.size === 0) return { warnings: [], evidenceRefs: [] };

  const warnings = new Map<string, ScopedCompilerWarning>();
  for (const rawLine of String(input.output || '').split(/\r?\n/gu)) {
    const line = rawLine.replace(ANSI_ESCAPE_RE, '').trim();
    const match = line.match(GCC_CLANG_WARNING_RE);
    if (!match) continue;
    const relativePath = workspaceRelativePath(input.cwd, match[1]);
    if (!relativePath || !scopedPaths.has(relativePath)) continue;
    const warning: ScopedCompilerWarning = {
      path: relativePath,
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      message: normalizeMessage(match[4]),
    };
    warnings.set(`${warning.path}:${warning.line}:${warning.column ?? 0}:${warning.message}`, warning);
  }

  const findings = [...warnings.values()];
  if (findings.length === 0) return { warnings: [], evidenceRefs: [] };
  const first = findings[0];
  const location = `${first.path}:${first.line}${first.column === undefined ? '' : `:${first.column}`}`;
  return {
    warnings: Object.freeze(findings),
    summary: `Compiler reported ${findings.length} warning(s) in changed source; first at ${location}: ${first.message}`,
    evidenceRefs: Object.freeze(findings.map(warning => (
      `compiler-warning:${warning.path}:${warning.line}:${warning.column ?? 0}`
    ))),
  };
}

function workspaceRelativePath(root: string, compilerPath: string): string | undefined {
  const workspace = nodePath.resolve(root);
  const absolute = nodePath.resolve(workspace, compilerPath.trim());
  const relative = nodePath.relative(workspace, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    return undefined;
  }
  return normalizeRelativePath(relative);
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function normalizeMessage(value: string): string {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 500);
}
