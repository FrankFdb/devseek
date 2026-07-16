export type FailureDiagnosisKind =
  | 'validation-command-failed'
  | 'validation-blocked'
  | 'missing-validation-evidence'
  | 'unknown';

export type FailureRootCauseStatus = 'known' | 'unknown';

export interface FailureDiagnosis {
  version: 'devseek.failure-diagnosis/v1';
  kind: FailureDiagnosisKind;
  rootCauseStatus: FailureRootCauseStatus;
  sticky: true;
  summary: string;
  evidenceRefs: string[];
  relatedPaths: string[];
  command?: string;
  exitCode?: number | null;
  reason?: string;
  mode?: string;
}

export interface ValidationFailureDiagnosisInput {
  status: 'failed' | 'blocked' | 'missing';
  changedPaths?: string[];
  command?: string;
  exitCode?: number | null;
  output?: string;
  reason?: string;
  mode?: string;
  evidenceRef?: string;
}

export function buildValidationFailureDiagnosis(input: ValidationFailureDiagnosisInput): FailureDiagnosis {
  const evidenceRef = input.evidenceRef || defaultValidationEvidenceRef(input);
  const base = {
    version: 'devseek.failure-diagnosis/v1' as const,
    sticky: true as const,
    evidenceRefs: [evidenceRef],
    relatedPaths: [] as string[],
    ...(input.command ? { command: input.command } : {}),
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
  };

  if (input.status === 'missing') {
    return {
      ...base,
      kind: 'missing-validation-evidence',
      rootCauseStatus: 'unknown',
      summary: '失败诊断：缺少自动验证证据，无法定位可证明的根因。',
    };
  }

  if (input.status === 'blocked') {
    return {
      ...base,
      kind: 'validation-blocked',
      rootCauseStatus: input.reason ? 'known' : 'unknown',
      summary: input.reason
        ? `失败诊断：验证被阻塞（${input.reason}）。`
        : '失败诊断：验证被阻塞，但缺少可归因原因。',
    };
  }

  const relation = findFailureRelation(input.output || '', input.changedPaths || []);
  if (relation.relatedPaths.length === 0) {
    return {
      ...base,
      kind: 'unknown',
      rootCauseStatus: 'unknown',
      summary: [
        '失败诊断：验证命令失败，但输出与本次变更路径的相关性不足，根因保持 unknown。',
        input.command ? `命令: ${input.command}` : '',
        input.exitCode !== undefined ? `exitCode=${input.exitCode ?? 'null'}` : '',
      ].filter(Boolean).join(' '),
    };
  }

  return {
    ...base,
    kind: 'validation-command-failed',
    rootCauseStatus: 'known',
    relatedPaths: relation.relatedPaths,
    summary: `失败诊断：验证失败定位到 ${relation.relatedPaths.join(', ')}；${relation.line}`,
  };
}

export function buildTerminalFailureDiagnosis(input: {
  evidenceRef: string;
  command?: string;
  exitCode?: number | null;
  detail?: string;
  kind?: string;
  changedPaths?: string[];
}): FailureDiagnosis {
  return buildValidationFailureDiagnosis({
    status: 'failed',
    command: input.command,
    exitCode: input.exitCode,
    output: input.detail || '',
    reason: input.kind,
    changedPaths: input.changedPaths || [],
    evidenceRef: input.evidenceRef,
  });
}

function defaultValidationEvidenceRef(input: ValidationFailureDiagnosisInput): string {
  if (input.status === 'failed') return `validation:failed:${input.command || input.reason || 'unknown'}`;
  if (input.status === 'missing') return 'validation:blocked:no-validation-evidence';
  return `validation:blocked:${input.reason || input.command || 'unknown'}`;
}

function findFailureRelation(output: string, changedPaths: string[]): { relatedPaths: string[]; line: string } {
  const normalizedPaths = [...new Set(changedPaths.map(normalizePath).filter(Boolean))];
  if (normalizedPaths.length === 0) return { relatedPaths: [], line: '' };
  const basenameCounts = new Map<string, number>();
  for (const relPath of normalizedPaths) {
    const basename = relPath.split('/').pop() || relPath;
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 80);
  for (const line of lines) {
    const related = normalizedPaths.filter(relPath => lineReferencesPath(line, relPath, basenameCounts));
    if (related.length > 0) {
      return {
        relatedPaths: related.slice(0, 4),
        line: line.slice(0, 240),
      };
    }
  }
  return { relatedPaths: [], line: '' };
}

function lineReferencesPath(line: string, relPath: string, basenameCounts: Map<string, number>): boolean {
  const normalizedLine = normalizePath(line);
  if (normalizedLine.includes(relPath)) return true;
  const basename = relPath.split('/').pop() || relPath;
  if ((basenameCounts.get(basename) || 0) !== 1) return false;
  const escaped = escapeRegExp(basename);
  return new RegExp(`(?:^|[/\\s:("'\`])${escaped}(?:$|[\\s:),;"'\`])`).test(normalizedLine);
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
