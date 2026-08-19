import * as nodePath from 'path';

const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const CPP_PATH_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu;
const GCC_CLANG_DIAGNOSTIC_RE = /^(.*?):(\d+):(?:(\d+):)?\s*(warning|note|error|fatal error):\s*(.+)$/iu;
const COUNTED_FAILURE_PATTERNS = Object.freeze([
  { kind: 'failed-count', pattern: /\b(\d+)\s+(?:tests?\s+)?failed\b/giu },
  { kind: 'failing-count', pattern: /\b(\d+)\s+(?:tests?\s+)?failing\b/giu },
  { kind: 'tap-fail-count', pattern: /^\s*#\s*fail\s+(\d+)\s*$/giu },
  { kind: 'labeled-failure-count', pattern: /\b(?:failures?|errors?)\s*[:=]\s*(\d+)\b/giu },
  { kind: 'zh-labeled-failure-count', pattern: /(?:失败|错误)\s*[:：=]\s*(\d+)\b/gu },
  { kind: 'zh-failed-count', pattern: /(\d+)\s*(?:个|项|条|例)?\s*(?:测试)?失败\b/gu },
]);
const EXPLICIT_FAILURE_PATTERNS = Object.freeze([
  { kind: 'failed-status', pattern: /^\s*(?:FAIL|FAILED)(?:\s|$)/iu },
  { kind: 'rust-test-result', pattern: /\btest result:\s*FAILED\b/iu },
]);

export interface ScopedCompilerWarning {
  readonly path: string;
  readonly line: number;
  readonly column?: number;
  readonly message: string;
  readonly originPath?: string;
}

export interface ValidationOutputFailureSignal {
  readonly kind: string;
  readonly count?: number;
  readonly excerpt: string;
}

export interface ValidationOutputDiagnosticAssessment {
  readonly failures: readonly ValidationOutputFailureSignal[];
  readonly warnings: readonly ScopedCompilerWarning[];
  readonly summary?: string;
  readonly evidenceRefs: readonly string[];
}

export interface AssessValidationOutputInput {
  readonly cwd: string;
  readonly scopePaths: readonly string[];
  readonly output: string;
}

/** Interprets nominally successful process output before it becomes verification evidence. */
export function assessValidationOutputDiagnostics(
  input: AssessValidationOutputInput,
): ValidationOutputDiagnosticAssessment {
  const normalizedOutput = String(input.output || '').replace(ANSI_ESCAPE_RE, '');
  const failures = findFailureSignals(normalizedOutput);
  const scopedPaths = new Set(input.scopePaths.map(normalizeRelativePath).filter(path => CPP_PATH_RE.test(path)));
  if (scopedPaths.size === 0) return assessment(failures, []);

  const warnings = new Map<string, ScopedCompilerWarning>();
  let activeWarning: ScopedCompilerWarning | undefined;
  for (const rawLine of normalizedOutput.split(/\r?\n/gu)) {
    const line = rawLine.trim();
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
  return assessment(failures, findings);
}

function assessment(
  failures: readonly ValidationOutputFailureSignal[],
  warnings: readonly ScopedCompilerWarning[],
): ValidationOutputDiagnosticAssessment {
  const firstFailure = failures[0];
  if (firstFailure) {
    return {
      failures: Object.freeze([...failures]),
      warnings: Object.freeze([...warnings]),
      summary: firstFailure.count === undefined
        ? `Validation output reported an explicit failure status: ${firstFailure.excerpt}`
        : `Validation output reported ${firstFailure.count} failure(s): ${firstFailure.excerpt}`,
      evidenceRefs: Object.freeze([
        ...failures.map(failure => `validation-output-failure:${failure.kind}:${failure.count ?? 'explicit'}`),
        ...warningEvidenceRefs(warnings),
      ]),
    };
  }
  const firstWarning = warnings[0];
  if (!firstWarning) return { failures: [], warnings: [], evidenceRefs: [] };
  const location = `${firstWarning.path}:${firstWarning.line}${firstWarning.column === undefined ? '' : `:${firstWarning.column}`}`;
  return {
    failures: [],
    warnings: Object.freeze([...warnings]),
    summary: `Compiler reported ${warnings.length} warning(s) in or caused by changed source; first at ${location}: ${firstWarning.message}`,
    evidenceRefs: Object.freeze(warningEvidenceRefs(warnings)),
  };
}

function findFailureSignals(output: string): readonly ValidationOutputFailureSignal[] {
  const failures = new Map<string, ValidationOutputFailureSignal>();
  for (const rawLine of output.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const detector of COUNTED_FAILURE_PATTERNS) {
      detector.pattern.lastIndex = 0;
      for (const match of line.matchAll(detector.pattern)) {
        const count = Number(match[1]);
        if (!Number.isSafeInteger(count) || count <= 0) continue;
        const signal = { kind: detector.kind, count, excerpt: normalizeMessage(line) };
        failures.set(`${signal.kind}:${signal.count}:${signal.excerpt}`, signal);
      }
    }
    for (const detector of EXPLICIT_FAILURE_PATTERNS) {
      if (!detector.pattern.test(line)) continue;
      const signal = { kind: detector.kind, excerpt: normalizeMessage(line) };
      failures.set(`${signal.kind}:${signal.excerpt}`, signal);
    }
  }
  return Object.freeze([...failures.values()]);
}

function warningEvidenceRefs(warnings: readonly ScopedCompilerWarning[]): string[] {
  return warnings.map(warning => `compiler-warning:${warning.path}:${warning.line}:${warning.column ?? 0}`);
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
