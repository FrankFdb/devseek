import * as nodePath from 'path';

const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const CPP_PATH_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu;
const GCC_CLANG_DIAGNOSTIC_RE = /^(.*?):(\d+):(?:(\d+):)?\s*(warning|note|error|fatal error):\s*(.+)$/iu;

export interface ScopedCompilerWarning {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly message: string;
  readonly originPath?: string;
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
  let activeWarning: ScopedCompilerWarning | undefined;
  for (const rawLine of String(input.output || '').split(/\r?\n/gu)) {
    const line = rawLine.replace(ANSI_ESCAPE_RE, '').trim();
    const match = line.match(GCC_CLANG_DIAGNOSTIC_RE);
    if (!match) continue;
    const relativePath = workspaceRelativePath(input.cwd, match[1]);
    const diagnostic: ScopedCompilerWarning = {
      path: relativePath ?? normalizeRelativePath(match[1]),
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      message: normalizeMessage(match[5]),
    };
    const kind = match[4].toLowerCase();
    if (kind === 'warning') {
      activeWarning = diagnostic;
      if (relativePath && scopedPaths.has(relativePath)) recordWarning(warnings, diagnostic);
      continue;
    }
    if (kind !== 'note') {
      activeWarning = undefined;
      continue;
    }
    if (!activeWarning || !relativePath || !scopedPaths.has(relativePath)) continue;
    recordWarning(warnings, {
      path: relativePath,
      line: diagnostic.line,
      ...(diagnostic.column !== undefined ? { column: diagnostic.column } : {}),
      message: activeWarning.message,
      originPath: activeWarning.path,
    });
  }

  const findings = [...warnings.values()];
  if (findings.length === 0) return { warnings: [], evidenceRefs: [] };
  const first = findings[0];
  const location = `${first.path}:${first.line}${first.column === undefined ? '' : `:${first.column}`}`;
  return {
    warnings: Object.freeze(findings),
    summary: `Compiler reported ${findings.length} warning(s) in or caused by changed source; first at ${location}: ${first.message}`,
    evidenceRefs: Object.freeze(findings.map(warning => (
      `compiler-warning:${warning.path}:${warning.line}:${warning.column ?? 0}`
    ))),
  };
}

function recordWarning(warnings: Map<string, ScopedCompilerWarning>, warning: ScopedCompilerWarning): void {
  warnings.set(`${warning.path}:${warning.line}:${warning.column ?? 0}:${warning.message}`, warning);
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
