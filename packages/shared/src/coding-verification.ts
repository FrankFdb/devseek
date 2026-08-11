import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingToolExecutionReceipt } from './coding-tool-execution';

export const CODING_VERIFICATION_PLAN_VERSION = 'devseek.coding-verification-plan/v1' as const;
export const CODING_VERIFICATION_RECEIPT_VERSION = 'devseek.coding-verification-receipt/v1' as const;

export type CodingVerificationReceiptStatus = 'passed' | 'failed' | 'unverified' | 'indeterminate';
export type CodingVerificationCheckStatus = 'passed' | 'failed' | 'unavailable';

export interface CodingVerificationCriterion {
  readonly id: string;
  readonly statement: string;
}

export interface CodingVerificationPlan<TPayload> {
  readonly version: typeof CODING_VERIFICATION_PLAN_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly payload: TPayload;
  readonly evidenceRefs: readonly string[];
}

export interface BuildCodingVerificationPlanInput<TPayload> {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly payload: TPayload;
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationCheckResult {
  readonly checkId: string;
  readonly status: CodingVerificationCheckStatus;
  readonly acceptanceIds: readonly string[];
  readonly summary: string;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationHostResult {
  readonly verifier: string;
  readonly checks: readonly CodingVerificationCheckResult[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationHostPort<TPayload> {
  verify(plan: CodingVerificationPlan<TPayload>): Promise<CodingVerificationHostResult>;
}

export interface CodingVerificationAcceptanceResult {
  readonly criterionId: string;
  readonly status: 'passed' | 'failed' | 'unverified';
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationReceipt {
  readonly version: typeof CODING_VERIFICATION_RECEIPT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly verifier: string;
  readonly status: CodingVerificationReceiptStatus;
  readonly scopePaths: readonly string[];
  readonly checks: readonly CodingVerificationCheckResult[];
  readonly acceptance: readonly CodingVerificationAcceptanceResult[];
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationOutcome {
  readonly receipt: CodingVerificationReceipt;
  readonly replayed: boolean;
}

export interface VerificationPort {
  verify<TPayload>(
    plan: CodingVerificationPlan<TPayload>,
    host: CodingVerificationHostPort<TPayload>,
  ): Promise<CodingVerificationOutcome>;
}

export interface CodingVerificationSessionPort extends VerificationPort {
  readonly runId: string;
  receipts(): readonly CodingVerificationReceipt[];
}

export interface VerificationServicePort extends VerificationPort {
  bind(input: {
    readonly runId: string;
    readonly acceptance: readonly CodingVerificationCriterion[];
  }): CodingVerificationSessionPort;
}

/** Resolves repaired verification attempts without hiding an unsettled terminal failure. */
export function settledCodingVerificationReceipts(
  receipts: readonly CodingVerificationReceipt[],
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): readonly CodingVerificationReceipt[] {
  return receipts.filter(previous => (
    previous.status === 'passed'
    || !receipts.some(candidate => verificationSupersedes(candidate, previous, toolExecutions))
  ));
}

/** Determines whether a failed verification process has a later, evidenced successful retry. */
export function codingVerificationToolFailureWasRecovered(
  failed: CodingToolExecutionReceipt<unknown>,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  verifications: readonly CodingVerificationReceipt[],
): boolean {
  if (failed.purpose !== 'verify' || !failed.effects.includes('process')) return false;
  return toolExecutions.some(candidate => (
    candidate.runId === failed.runId
      && candidate.sequence > failed.sequence
      && candidate.status === 'completed'
      && candidate.purpose === 'verify'
      && candidate.effects.includes('process')
      && verifications.some(receipt => (
        receipt.runId === failed.runId
          && receipt.actionId === candidate.actionId
          && receipt.status === 'passed'
          && receipt.acceptance.length > 0
          && receipt.acceptance.every(result => result.status === 'passed')
      ))
  ));
}

interface ActiveVerification {
  readonly canonicalPlan: string;
  readonly receipt: Promise<CodingVerificationReceipt>;
}

/** Owns acceptance coverage and verification terminal semantics across Surfaces. */
export class CanonicalVerificationService implements VerificationServicePort {
  private readonly executions = new Map<string, ActiveVerification>();

  bind(input: {
    readonly runId: string;
    readonly acceptance: readonly CodingVerificationCriterion[];
  }): CodingVerificationSessionPort {
    return new CanonicalVerificationSession(this, input.runId, input.acceptance);
  }

  async verify<TPayload>(
    plan: CodingVerificationPlan<TPayload>,
    host: CodingVerificationHostPort<TPayload>,
  ): Promise<CodingVerificationOutcome> {
    const snapshot = snapshotVerificationPlan(plan);
    const key = verificationIdentity(snapshot);
    const canonicalPlan = canonicalCodingJson(snapshot);
    const existing = this.executions.get(key);
    if (existing) {
      assertSamePlan(existing.canonicalPlan, canonicalPlan);
      return { receipt: await existing.receipt, replayed: true };
    }

    const receipt = executeVerification(snapshot, host);
    this.executions.set(key, { canonicalPlan, receipt });
    return { receipt: await receipt, replayed: false };
  }
}

class CanonicalVerificationSession implements CodingVerificationSessionPort {
  readonly runId: string;
  private readonly acceptance: readonly CodingVerificationCriterion[];
  private readonly settledReceipts = new Map<string, CodingVerificationReceipt>();

  constructor(
    private readonly service: VerificationPort,
    runId: string,
    acceptance: readonly CodingVerificationCriterion[],
  ) {
    this.runId = normalizedCodingId(runId, 'verification-session-run-id');
    this.acceptance = Object.freeze(acceptance.map(criterion => Object.freeze({
      id: normalizedCodingId(criterion.id, 'verification-session-acceptance-id'),
      statement: normalizedCodingId(
        criterion.statement,
        'verification-session-acceptance-statement',
      ),
    })));
    if (new Set(this.acceptance.map(criterion => criterion.id)).size !== this.acceptance.length) {
      throw new Error('coding-verification:duplicate-session-acceptance-id');
    }
  }

  async verify<TPayload>(
    plan: CodingVerificationPlan<TPayload>,
    host: CodingVerificationHostPort<TPayload>,
  ): Promise<CodingVerificationOutcome> {
    if (plan.runId !== this.runId) throw new Error('coding-verification:session-run-mismatch');
    if (canonicalCodingJson(plan.acceptance) !== canonicalCodingJson(this.acceptance)) {
      throw new Error('coding-verification:session-acceptance-mismatch');
    }
    const outcome = await this.service.verify(plan, host);
    this.settledReceipts.set(outcome.receipt.actionId, outcome.receipt);
    return outcome;
  }

  receipts(): readonly CodingVerificationReceipt[] {
    return Object.freeze([...this.settledReceipts.values()]);
  }
}

export function buildCodingVerificationPlan<TPayload>(
  input: BuildCodingVerificationPlanInput<TPayload>,
): CodingVerificationPlan<TPayload> {
  return snapshotVerificationPlan({ version: CODING_VERIFICATION_PLAN_VERSION, ...input });
}

async function executeVerification<TPayload>(
  plan: CodingVerificationPlan<TPayload>,
  host: CodingVerificationHostPort<TPayload>,
): Promise<CodingVerificationReceipt> {
  let hostResult: CodingVerificationHostResult;
  try {
    hostResult = snapshotHostResult(await host.verify(plan), plan.acceptance);
  } catch {
    return snapshotVerificationReceipt({
      version: CODING_VERIFICATION_RECEIPT_VERSION,
      runId: plan.runId,
      sequence: plan.sequence,
      actionId: plan.actionId,
      idempotencyKey: plan.idempotencyKey,
      verifier: 'unresolved',
      status: 'indeterminate',
      scopePaths: plan.scopePaths,
      checks: [],
      acceptance: plan.acceptance.map(criterion => ({
        criterionId: criterion.id,
        status: 'unverified',
        evidenceRefs: [],
      })),
      errorCode: 'verification-host-failed',
      evidenceRefs: uniqueCodingRefs([
        ...plan.evidenceRefs,
        `verification-host:${plan.actionId}:failed`,
      ]),
    });
  }

  const acceptance = projectAcceptance(plan.acceptance, hostResult.checks);
  const hasFailedCheck = hostResult.checks.some(check => check.status === 'failed');
  const hasPassedCheck = hostResult.checks.some(check => check.status === 'passed');
  const allAcceptancePassed = acceptance.every(result => result.status === 'passed');
  const status: CodingVerificationReceiptStatus = hasFailedCheck
    ? 'failed'
    : hasPassedCheck && allAcceptancePassed
      ? 'passed'
      : 'unverified';
  return snapshotVerificationReceipt({
    version: CODING_VERIFICATION_RECEIPT_VERSION,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    verifier: hostResult.verifier,
    status,
    scopePaths: plan.scopePaths,
    checks: hostResult.checks,
    acceptance,
    ...(status === 'unverified' ? { errorCode: 'verification-acceptance-uncovered' } : {}),
    evidenceRefs: uniqueCodingRefs([
      ...plan.evidenceRefs,
      ...hostResult.evidenceRefs,
      ...hostResult.checks.flatMap(check => check.evidenceRefs),
    ]),
  });
}

function projectAcceptance(
  criteria: readonly CodingVerificationCriterion[],
  checks: readonly CodingVerificationCheckResult[],
): CodingVerificationAcceptanceResult[] {
  return criteria.map(criterion => {
    const covering = checks.filter(check => check.acceptanceIds.includes(criterion.id));
    const failed = covering.filter(check => check.status === 'failed');
    const passed = covering.filter(check => check.status === 'passed');
    return {
      criterionId: criterion.id,
      status: failed.length > 0 ? 'failed' : passed.length > 0 ? 'passed' : 'unverified',
      evidenceRefs: uniqueCodingRefs((failed.length > 0 ? failed : passed).flatMap(check => check.evidenceRefs)),
    };
  });
}

function snapshotVerificationPlan<TPayload>(
  plan: CodingVerificationPlan<TPayload>,
): CodingVerificationPlan<TPayload> {
  const runId = normalizedCodingId(plan.runId, 'verification-run-id');
  const actionId = normalizedCodingId(plan.actionId, 'verification-action-id');
  const idempotencyKey = normalizedCodingId(plan.idempotencyKey, 'verification-idempotency-key');
  if (!Number.isSafeInteger(plan.sequence) || plan.sequence < 0) {
    throw new Error('coding-verification:invalid-sequence');
  }
  const acceptance = plan.acceptance.map(criterion => Object.freeze({
    id: normalizedCodingId(criterion.id, 'verification-acceptance-id'),
    statement: normalizedCodingId(criterion.statement, 'verification-acceptance-statement'),
  }));
  if (new Set(acceptance.map(criterion => criterion.id)).size !== acceptance.length) {
    throw new Error('coding-verification:duplicate-acceptance-id');
  }
  return Object.freeze({
    version: CODING_VERIFICATION_PLAN_VERSION,
    runId,
    sequence: plan.sequence,
    actionId,
    idempotencyKey,
    scopePaths: Object.freeze(uniqueCodingRefs(plan.scopePaths)),
    acceptance: Object.freeze(acceptance),
    payload: snapshotCodingValue(plan.payload, 'verification-payload') as TPayload,
    evidenceRefs: Object.freeze(uniqueCodingRefs(plan.evidenceRefs)),
  });
}

function snapshotHostResult(
  result: CodingVerificationHostResult,
  criteria: readonly CodingVerificationCriterion[],
): CodingVerificationHostResult {
  if (!result || typeof result !== 'object') throw new Error('coding-verification:invalid-host-result');
  const acceptanceIds = new Set(criteria.map(criterion => criterion.id));
  const checkIds = new Set<string>();
  const checks = result.checks.map(check => {
    const checkId = normalizedCodingId(check.checkId, 'verification-check-id');
    if (checkIds.has(checkId)) throw new Error('coding-verification:duplicate-check-id');
    checkIds.add(checkId);
    const covered = uniqueCodingRefs(check.acceptanceIds);
    if (covered.some(id => !acceptanceIds.has(id))) {
      throw new Error('coding-verification:unknown-acceptance-id');
    }
    const evidenceRefs = uniqueCodingRefs(check.evidenceRefs);
    if (check.status === 'passed' && evidenceRefs.length === 0) {
      throw new Error('coding-verification:passed-check-missing-evidence');
    }
    return Object.freeze({
      checkId,
      status: check.status,
      acceptanceIds: Object.freeze(covered),
      summary: normalizedCodingId(check.summary, 'verification-check-summary'),
      ...(check.command ? { command: normalizedCodingId(check.command, 'verification-command') } : {}),
      ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
      evidenceRefs: Object.freeze(evidenceRefs),
    });
  });
  return Object.freeze({
    verifier: normalizedCodingId(result.verifier, 'verification-verifier'),
    checks: Object.freeze(checks),
    evidenceRefs: Object.freeze(uniqueCodingRefs(result.evidenceRefs)),
  });
}

function snapshotVerificationReceipt(receipt: CodingVerificationReceipt): CodingVerificationReceipt {
  return snapshotCodingValue(receipt, 'verification-receipt') as CodingVerificationReceipt;
}

function verificationIdentity(value: Pick<CodingVerificationPlan<unknown>, 'runId' | 'actionId'>): string {
  return `${value.runId}\u0000${value.actionId}`;
}

function verificationSupersedes(
  candidate: CodingVerificationReceipt,
  previous: CodingVerificationReceipt,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
): boolean {
  if (candidate.status !== 'passed'
    || candidate.runId !== previous.runId
    || candidate.sequence <= previous.sequence) {
    return false;
  }
  const candidatePaths = new Set(candidate.scopePaths.map(normalizeVerificationPath));
  if (!previous.scopePaths.every(path => candidatePaths.has(normalizeVerificationPath(path)))) {
    return false;
  }
  const passedAcceptance = new Set(
    candidate.acceptance
      .filter(result => result.status === 'passed')
      .map(result => result.criterionId),
  );
  if (previous.acceptance.length === 0
    || !previous.acceptance.every(result => passedAcceptance.has(result.criterionId))) {
    return false;
  }
  const failedTool = matchingVerificationTool(previous, toolExecutions, 'failed');
  return !failedTool
    || matchingVerificationTool(candidate, toolExecutions, 'completed') !== undefined;
}

function matchingVerificationTool(
  verification: CodingVerificationReceipt,
  toolExecutions: readonly CodingToolExecutionReceipt<unknown>[],
  status: 'completed' | 'failed',
): CodingToolExecutionReceipt<unknown> | undefined {
  return toolExecutions.find(receipt => (
    receipt.runId === verification.runId
      && receipt.sequence === verification.sequence
      && receipt.actionId === verification.actionId
      && receipt.tool === 'run_terminal'
      && receipt.purpose === 'verify'
      && receipt.effects.length === 1
      && receipt.effects[0] === 'process'
      && receipt.status === status
  ));
}

function normalizeVerificationPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function assertSamePlan(existing: string, incoming: string): void {
  if (existing !== incoming) throw new Error('coding-verification:conflicting-action-identity');
}
