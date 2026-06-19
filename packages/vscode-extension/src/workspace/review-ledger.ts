import { ChangeSet, ChangeSetSummary } from './change-set';

export { ChangeSet, createChangeSet } from './change-set';

export interface ReviewValidationInput {
  ran: boolean;
  ok?: boolean;
  command?: string;
  exitCode?: number | null;
  output?: string;
  cwd?: string;
  mode?: string;
  reason?: string;
}

export interface ReviewValidationRecord {
  ran: boolean;
  ok: boolean | null;
  command: string;
  exitCode: number | null;
  cwd: string;
  mode?: string;
  reason?: string;
  summary: string;
  failureFiles: string[];
}

export interface ReviewLedgerSnapshot {
  files: ChangeSetSummary;
  validation: ReviewValidationRecord;
  unfinishedItems: string[];
}

export class ReviewLedger {
  private changeSet = new ChangeSet([]);
  private validation: ReviewValidationRecord = makeSkippedValidation('not-run');
  private unfinishedItems: string[] = [];

  recordChangeSet(changeSet: ChangeSet): void {
    this.changeSet = changeSet;
  }

  recordValidation(validation: ReviewValidationInput): void {
    this.validation = normalizeValidationRecord(validation, this.changeSet.changedPaths);
  }

  recordValidationSkipped(reason: string): void {
    this.validation = makeSkippedValidation(reason);
  }

  addUnfinishedItem(item: string): void {
    const trimmed = item.trim();
    if (trimmed) this.unfinishedItems.push(trimmed);
  }

  snapshot(): ReviewLedgerSnapshot {
    return {
      files: this.changeSet.summary(),
      validation: this.validation,
      unfinishedItems: [...this.unfinishedItems],
    };
  }
}

export function normalizeValidationRecord(
  validation: ReviewValidationInput,
  changedPaths: string[] = [],
): ReviewValidationRecord {
  if (!validation.ran) return makeSkippedValidation(validation.reason || 'not-run');

  const command = validation.command || '';
  const exitCode = validation.exitCode ?? null;
  const ok = validation.ok === true;
  return {
    ran: true,
    ok,
    command,
    exitCode,
    cwd: validation.cwd || '',
    mode: validation.mode,
    reason: validation.reason,
    summary: summarizeValidation(validation),
    failureFiles: ok ? [] : extractFailureFilePaths(validation.output || '', changedPaths),
  };
}

export function summarizeValidation(validation: ReviewValidationInput): string {
  if (!validation.ran) return `未执行自动验证: ${validation.reason || 'not-run'}`;

  const status = validation.ok ? '验证通过' : '验证失败';
  const exit = validation.exitCode ?? 'null';
  const command = validation.command ? `: ${validation.command}` : '';
  return `${status} (exitCode=${exit})${command}`;
}

export function extractFailureFilePaths(output: string, changedPaths: string[] = []): string[] {
  const found = new Set<string>();
  const normalizedOutput = normalizePath(output);

  for (const changedPath of changedPaths) {
    const normalizedChangedPath = normalizePath(changedPath);
    if (normalizedChangedPath && normalizedOutput.includes(normalizedChangedPath)) {
      found.add(changedPath);
    }
  }

  const pathRe = /(?:^|[\s("'`])((?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql|txt))(?:[:)]|\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(output)) !== null) {
    const candidate = normalizePath(match[1]);
    if (!candidate || candidate.includes('/node_modules/')) continue;
    const changedMatch = changedPaths.find(path => candidate.endsWith(normalizePath(path)));
    found.add(changedMatch || candidate.replace(/^\.\//, ''));
    if (found.size >= 10) break;
  }

  return [...found];
}

function makeSkippedValidation(reason: string): ReviewValidationRecord {
  return {
    ran: false,
    ok: null,
    command: '',
    exitCode: null,
    cwd: '',
    reason,
    summary: summarizeValidation({ ran: false, reason }),
    failureFiles: [],
  };
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
