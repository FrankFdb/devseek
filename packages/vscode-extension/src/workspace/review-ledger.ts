import { ChangeSet, ChangeSetSummary, ChangeSetSymbolSummary } from './change-set';

export { ChangeSet, createChangeSet, createChangeSetFromActions } from './change-set';

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

export interface ReviewQualityGateRiskAcceptance {
  source: 'user' | 'policy';
  note?: string;
  acceptedAt: number;
}

export interface ReviewQualityGateInput {
  status: 'pass' | 'fail' | 'blocked';
  summary: string;
  evidenceRefs?: string[];
  risks?: string[];
  alternativeChecks?: string[];
  requiredActions?: string[];
  acceptedRisk?: ReviewQualityGateRiskAcceptance;
}

export interface ReviewQualityGateRecord {
  status: 'pass' | 'fail' | 'blocked';
  summary: string;
  evidenceRefs: string[];
  risks: string[];
  alternativeChecks: string[];
  requiredActions: string[];
  acceptedRisk?: ReviewQualityGateRiskAcceptance;
}

export type IndependentReviewSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface IndependentReviewFinding {
  id: string;
  severity: IndependentReviewSeverity;
  summary: string;
  evidenceRefs?: string[];
}

export interface IndependentReviewInput {
  reviewerId: string;
  writerId: string;
  completionJudgeId: string;
  contextRefs?: string[];
  findings?: IndependentReviewFinding[];
  risks?: string[];
  requiredActions?: string[];
}

export interface IndependentReviewRecord {
  version: 'devseek.independent-review/v1';
  status: 'passed' | 'blocked';
  summary: string;
  independence: {
    independent: boolean;
    roles: {
      reviewerId: string;
      writerId: string;
      completionJudgeId: string;
    };
    violations: string[];
  };
  contextRefs: string[];
  findingCounts: Record<IndependentReviewSeverity, number>;
  findings: Array<Required<IndependentReviewFinding>>;
  risks: string[];
  requiredActions: string[];
}

export type DeliveryManifestStatus = 'ready' | 'blocked';
export type DeliveryManifestCheckStatus = 'passed' | 'failed' | 'blocked' | 'not-run';
export type DeliveryManifestAcceptanceStatus = 'satisfied' | 'not-run' | 'refused' | 'blocked';

export interface DeliveryManifestVerificationInput {
  evidenceRef: string;
  command?: string;
  status?: DeliveryManifestCheckStatus;
  summary?: string;
}

export interface DeliveryManifestVerificationRecord {
  evidenceRef: string;
  command: string;
  status: DeliveryManifestCheckStatus;
  summary: string;
}

export interface DeliveryManifestNotRunInput {
  scope: string;
  reason: string;
  evidenceRef?: string;
}

export interface DeliveryManifestNotRunRecord {
  scope: string;
  reason: string;
  evidenceRef: string;
}

export interface DeliveryManifestAcceptanceInput {
  id: string;
  summary: string;
  status: DeliveryManifestAcceptanceStatus;
  evidenceRefs?: string[];
  refusalReason?: string;
  risks?: string[];
  followUps?: string[];
}

export interface DeliveryManifestAcceptanceRecord {
  id: string;
  summary: string;
  status: DeliveryManifestAcceptanceStatus;
  evidenceRefs: string[];
  refusalReason?: string;
  risks: string[];
  followUps: string[];
}

export interface DeliveryManifestInput {
  completionClaimed?: boolean;
  changedPaths?: string[];
  verified?: DeliveryManifestVerificationInput[];
  notRun?: DeliveryManifestNotRunInput[];
  risks?: string[];
  followUps?: string[];
  acceptances?: DeliveryManifestAcceptanceInput[];
  requiredActions?: string[];
}

export interface DeliveryManifestRecord {
  version: 'devseek.delivery-manifest/v1';
  status: DeliveryManifestStatus;
  completionClaimed: boolean;
  falseCompletionRisk: boolean;
  changed: {
    total: number;
    paths: string[];
  };
  verified: DeliveryManifestVerificationRecord[];
  notRun: DeliveryManifestNotRunRecord[];
  risks: string[];
  followUps: string[];
  acceptances: DeliveryManifestAcceptanceRecord[];
  requiredActions: string[];
}

export interface ReviewLedgerSnapshot {
  files: ChangeSetSummary;
  symbols: ChangeSetSymbolSummary;
  validation: ReviewValidationRecord;
  qualityGate: ReviewQualityGateRecord;
  independentReview: IndependentReviewRecord;
  deliveryManifest: DeliveryManifestRecord;
  unfinishedItems: string[];
}

export class ReviewLedger {
  private changeSet = new ChangeSet([]);
  private validation: ReviewValidationRecord = makeSkippedValidation('not-run');
  private qualityGate: ReviewQualityGateRecord = makeQualityGateNotEvaluated();
  private independentReview: IndependentReviewRecord = makeIndependentReviewNotRecorded();
  private deliveryManifest: DeliveryManifestRecord = makeDeliveryManifestNotRecorded();
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

  recordQualityGate(qualityGate: ReviewQualityGateInput): void {
    this.qualityGate = normalizeQualityGateRecord(qualityGate);
  }

  recordIndependentReview(review: IndependentReviewInput | IndependentReviewRecord): void {
    this.independentReview = isIndependentReviewRecord(review)
      ? cloneIndependentReviewRecord(review)
      : normalizeIndependentReviewRecord(review);
  }

  recordDeliveryManifest(manifest: DeliveryManifestInput | DeliveryManifestRecord): void {
    this.deliveryManifest = isDeliveryManifestRecord(manifest)
      ? cloneDeliveryManifestRecord(manifest)
      : normalizeDeliveryManifest(manifest);
  }

  addUnfinishedItem(item: string): void {
    const trimmed = item.trim();
    if (trimmed) this.unfinishedItems.push(trimmed);
  }

  snapshot(): ReviewLedgerSnapshot {
    return {
      files: this.changeSet.summary(),
      symbols: this.changeSet.symbolSummary(),
      validation: this.validation,
      qualityGate: this.qualityGate,
      independentReview: cloneIndependentReviewRecord(this.independentReview),
      deliveryManifest: cloneDeliveryManifestRecord(this.deliveryManifest),
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

export function normalizeQualityGateRecord(input: ReviewQualityGateInput): ReviewQualityGateRecord {
  return {
    status: input.status,
    summary: input.summary || `QualityGate ${input.status}`,
    evidenceRefs: input.evidenceRefs ?? [],
    risks: input.risks ?? [],
    alternativeChecks: input.alternativeChecks ?? [],
    requiredActions: input.requiredActions ?? [],
    ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
  };
}

export function normalizeIndependentReviewRecord(input: IndependentReviewInput): IndependentReviewRecord {
  const roles = {
    reviewerId: normalizeId(input.reviewerId),
    writerId: normalizeId(input.writerId),
    completionJudgeId: normalizeId(input.completionJudgeId),
  };
  const contextRefs = uniqueStrings(input.contextRefs ?? []);
  const findings = normalizeFindings(input.findings ?? []);
  const findingCounts = countFindings(findings);
  const violations = independentReviewViolations(roles, contextRefs);
  const p0p1Blocked = findingCounts.P0 > 0 || findingCounts.P1 > 0;
  const status = violations.length === 0 && !p0p1Blocked ? 'passed' : 'blocked';
  const risks = [
    ...independentReviewRisks(violations, findingCounts),
    ...(input.risks ?? []),
  ];
  return {
    version: 'devseek.independent-review/v1',
    status,
    summary: summarizeIndependentReview(status, findingCounts, violations),
    independence: {
      independent: violations.length === 0,
      roles,
      violations,
    },
    contextRefs,
    findingCounts,
    findings,
    risks,
    requiredActions: status === 'passed'
      ? (input.requiredActions ?? [])
      : uniqueStrings([
        ...independentReviewRequiredActions(violations, p0p1Blocked),
        ...(input.requiredActions ?? []),
      ]),
  };
}

export function normalizeDeliveryManifest(input: DeliveryManifestInput): DeliveryManifestRecord {
  const changedPaths = uniqueStrings(input.changedPaths ?? []);
  const verified = normalizeDeliveryManifestVerifications(input.verified ?? []);
  const notRun = normalizeDeliveryManifestNotRun(input.notRun ?? []);
  const acceptances = normalizeDeliveryManifestAcceptances(input.acceptances ?? []);
  const requiredActions = uniqueStrings([
    ...deliveryManifestRequiredActions(acceptances, verified, notRun),
    ...(input.requiredActions ?? []),
  ]);
  const ready = requiredActions.length === 0
    && acceptances.length > 0
    && acceptances.every(acceptance => acceptance.status === 'satisfied');
  const completionClaimed = input.completionClaimed === true;
  const falseCompletionRisk = completionClaimed && !ready;
  const risks = uniqueStrings([
    ...(input.risks ?? []),
    ...acceptances.flatMap(acceptance => acceptance.risks),
    ...(falseCompletionRisk
      ? ['False completion risk: completion was claimed before every acceptance had evidence or refusal.']
      : []),
  ]);

  return {
    version: 'devseek.delivery-manifest/v1',
    status: ready ? 'ready' : 'blocked',
    completionClaimed,
    falseCompletionRisk,
    changed: {
      total: changedPaths.length,
      paths: changedPaths,
    },
    verified,
    notRun,
    risks,
    followUps: uniqueStrings([
      ...(input.followUps ?? []),
      ...acceptances.flatMap(acceptance => acceptance.followUps),
    ]),
    acceptances,
    requiredActions,
  };
}

function makeQualityGateNotEvaluated(): ReviewQualityGateRecord {
  return {
    status: 'blocked',
    summary: 'QualityGate 未评估。',
    evidenceRefs: [],
    risks: ['尚未生成 QualityGate 结果。'],
    alternativeChecks: [],
    requiredActions: ['运行验证或记录阻塞原因。'],
  };
}

function makeIndependentReviewNotRecorded(): IndependentReviewRecord {
  return normalizeIndependentReviewRecord({
    reviewerId: '',
    writerId: '',
    completionJudgeId: '',
    contextRefs: [],
    findings: [],
    risks: ['尚未记录独立 review，不能证明 P0/P1 已归零。'],
    requiredActions: ['记录独立 review 的 reviewer/writer/completion judge 身份和 contract/diff/evidence/risk 上下文。'],
  });
}

function makeDeliveryManifestNotRecorded(): DeliveryManifestRecord {
  return normalizeDeliveryManifest({
    completionClaimed: false,
    risks: ['尚未记录交付清单，不能证明 changed/verified/not-run/risk/follow-up 完整。'],
  });
}

function isIndependentReviewRecord(value: IndependentReviewInput | IndependentReviewRecord): value is IndependentReviewRecord {
  return (value as IndependentReviewRecord).version === 'devseek.independent-review/v1';
}

function isDeliveryManifestRecord(value: DeliveryManifestInput | DeliveryManifestRecord): value is DeliveryManifestRecord {
  return (value as DeliveryManifestRecord).version === 'devseek.delivery-manifest/v1';
}

function cloneIndependentReviewRecord(record: IndependentReviewRecord): IndependentReviewRecord {
  return {
    ...record,
    independence: {
      independent: record.independence.independent,
      roles: { ...record.independence.roles },
      violations: [...record.independence.violations],
    },
    contextRefs: [...record.contextRefs],
    findingCounts: { ...record.findingCounts },
    findings: record.findings.map(finding => ({
      ...finding,
      evidenceRefs: [...finding.evidenceRefs],
    })),
    risks: [...record.risks],
    requiredActions: [...record.requiredActions],
  };
}

function cloneDeliveryManifestRecord(record: DeliveryManifestRecord): DeliveryManifestRecord {
  return {
    ...record,
    changed: {
      total: record.changed.total,
      paths: [...record.changed.paths],
    },
    verified: record.verified.map(item => ({ ...item })),
    notRun: record.notRun.map(item => ({ ...item })),
    risks: [...record.risks],
    followUps: [...record.followUps],
    acceptances: record.acceptances.map(acceptance => ({
      ...acceptance,
      evidenceRefs: [...acceptance.evidenceRefs],
      risks: [...acceptance.risks],
      followUps: [...acceptance.followUps],
    })),
    requiredActions: [...record.requiredActions],
  };
}

function normalizeDeliveryManifestVerifications(
  items: DeliveryManifestVerificationInput[],
): DeliveryManifestVerificationRecord[] {
  return items.map((item): DeliveryManifestVerificationRecord => {
    const status = normalizeDeliveryManifestCheckStatus(item.status);
    return {
      evidenceRef: normalizeId(item.evidenceRef),
      command: String(item.command || '').trim(),
      status,
      summary: String(item.summary || `Verification ${status}`).trim(),
    };
  });
}

function normalizeDeliveryManifestNotRun(items: DeliveryManifestNotRunInput[]): DeliveryManifestNotRunRecord[] {
  return items.map((item): DeliveryManifestNotRunRecord => ({
    scope: normalizeId(item.scope),
    reason: String(item.reason || '').trim(),
    evidenceRef: normalizeId(item.evidenceRef || ''),
  }));
}

function normalizeDeliveryManifestAcceptances(
  items: DeliveryManifestAcceptanceInput[],
): DeliveryManifestAcceptanceRecord[] {
  return items.map((item, index): DeliveryManifestAcceptanceRecord => {
    const refusalReason = String(item.refusalReason || '').trim();
    return {
      id: normalizeId(item.id) || `acceptance-${index + 1}`,
      summary: String(item.summary || '').trim(),
      status: normalizeDeliveryManifestAcceptanceStatus(item.status),
      evidenceRefs: uniqueStrings(item.evidenceRefs ?? []),
      ...(refusalReason ? { refusalReason } : {}),
      risks: uniqueStrings(item.risks ?? []),
      followUps: uniqueStrings(item.followUps ?? []),
    };
  });
}

function deliveryManifestRequiredActions(
  acceptances: DeliveryManifestAcceptanceRecord[],
  verified: DeliveryManifestVerificationRecord[],
  notRun: DeliveryManifestNotRunRecord[],
): string[] {
  const actions: string[] = [];
  if (acceptances.length === 0) {
    actions.push('Record delivery acceptances with evidence or refusal.');
  }
  for (const acceptance of acceptances) {
    if (!acceptance.summary) {
      actions.push(`Summarize delivery acceptance ${acceptance.id}.`);
    }
    if (acceptance.status === 'satisfied' && acceptance.evidenceRefs.length === 0) {
      actions.push('Bind every acceptance to evidence or refusal before claiming delivery complete.');
    }
    if (acceptance.status !== 'satisfied') {
      if (!acceptance.refusalReason) {
        actions.push('Bind every acceptance to evidence or refusal before claiming delivery complete.');
      }
      actions.push(`Resolve delivery acceptance ${acceptance.id} before delivery can be ready.`);
    }
  }
  if (verified.length === 0 && notRun.length === 0) {
    actions.push('Record verified checks or not-run rationale before delivery.');
  }
  if (verified.some(item => !item.evidenceRef)) {
    actions.push('Record evidenceRef for each verified delivery check.');
  }
  if (notRun.some(item => !item.scope || !item.reason)) {
    actions.push('Record scope and reason for each not-run delivery check.');
  }
  return actions;
}

function normalizeDeliveryManifestCheckStatus(
  value: DeliveryManifestCheckStatus | undefined,
): DeliveryManifestCheckStatus {
  return value === 'passed' || value === 'failed' || value === 'blocked' || value === 'not-run'
    ? value
    : 'passed';
}

function normalizeDeliveryManifestAcceptanceStatus(
  value: DeliveryManifestAcceptanceStatus,
): DeliveryManifestAcceptanceStatus {
  return value === 'satisfied' || value === 'not-run' || value === 'refused' || value === 'blocked'
    ? value
    : 'blocked';
}

function normalizeId(value: string): string {
  return String(value || '').trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeFindings(findings: IndependentReviewFinding[]): Array<Required<IndependentReviewFinding>> {
  return findings.map((finding, index) => ({
    id: normalizeId(finding.id) || `finding-${index + 1}`,
    severity: normalizeSeverity(finding.severity),
    summary: String(finding.summary || '').trim(),
    evidenceRefs: uniqueStrings(finding.evidenceRefs ?? []),
  }));
}

function normalizeSeverity(value: IndependentReviewSeverity): IndependentReviewSeverity {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3'
    ? value
    : 'P3';
}

function countFindings(findings: Array<Required<IndependentReviewFinding>>): Record<IndependentReviewSeverity, number> {
  const counts: Record<IndependentReviewSeverity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function independentReviewViolations(
  roles: IndependentReviewRecord['independence']['roles'],
  contextRefs: string[],
): string[] {
  const violations: string[] = [];
  if (!roles.reviewerId) violations.push('reviewer:missing');
  if (!roles.writerId) violations.push('writer:missing');
  if (!roles.completionJudgeId) violations.push('completion-judge:missing');
  if (roles.reviewerId && roles.reviewerId === roles.writerId) {
    violations.push('reviewer-matches-writer');
  }
  if (roles.reviewerId && roles.reviewerId === roles.completionJudgeId) {
    violations.push('reviewer-matches-completion-judge');
  }
  for (const required of ['contract:', 'diff:', 'validation:', 'risk:']) {
    if (!contextRefs.some(ref => ref.startsWith(required))) {
      violations.push(`context:${required.slice(0, -1)}:missing`);
    }
  }
  return violations;
}

function independentReviewRisks(
  violations: string[],
  findingCounts: Record<IndependentReviewSeverity, number>,
): string[] {
  const risks: string[] = [];
  if (violations.includes('reviewer-matches-writer')) {
    risks.push('Independent review blocked: reviewer must not match writer.');
  }
  if (violations.includes('reviewer-matches-completion-judge')) {
    risks.push('Independent review blocked: reviewer must not match completion judge.');
  }
  if (violations.some(violation => violation.startsWith('context:'))) {
    risks.push('Independent review lacks contract/diff/evidence/risk context refs.');
  }
  if (violations.some(violation => violation.endsWith(':missing') && !violation.startsWith('context:'))) {
    risks.push('Independent review role identity is incomplete.');
  }
  if (findingCounts.P0 > 0 || findingCounts.P1 > 0) {
    risks.push(`Independent review has unresolved P0/P1 findings: P0=${findingCounts.P0}, P1=${findingCounts.P1}.`);
  }
  return risks;
}

function independentReviewRequiredActions(violations: string[], p0p1Blocked: boolean): string[] {
  const actions: string[] = [];
  if (violations.length > 0) {
    actions.push('补齐独立 reviewer/writer/completion judge 身份，并绑定 contract/diff/evidence/risk 上下文。');
  }
  if (p0p1Blocked) {
    actions.push('修复或明确阻塞所有 P0/P1 finding，直到 independent review 达到 P0=0/P1=0。');
  }
  return actions;
}

function summarizeIndependentReview(
  status: IndependentReviewRecord['status'],
  findingCounts: Record<IndependentReviewSeverity, number>,
  violations: string[],
): string {
  const counts = `P0=${findingCounts.P0}/P1=${findingCounts.P1}/P2=${findingCounts.P2}/P3=${findingCounts.P3}`;
  if (status === 'passed') return `Independent review passed: ${counts}.`;
  return `Independent review blocked: ${counts}; P0=0/P1=0 required; violations=${violations.join(',') || 'none'}.`;
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
