import {
  canonicalCodingJson,
  normalizeCodingErrorCode,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';

export const CODING_WORKSPACE_MUTATION_PLAN_VERSION = 'devseek.coding-workspace-mutation-plan/v1' as const;
export const CODING_WORKSPACE_MUTATION_RECEIPT_VERSION = 'devseek.coding-workspace-mutation-receipt/v1' as const;

export type CodingWorkspaceMutationStatus = 'committed' | 'rolled-back' | 'failed' | 'indeterminate';
export type CodingWorkspaceMutationFailure =
  | 'baseline-failed'
  | 'apply-failed'
  | 'apply-evidence-missing'
  | 'readback-failed'
  | 'readback-mismatch';

export interface CodingWorkspaceMutationPlan<TPayload> {
  readonly version: typeof CODING_WORKSPACE_MUTATION_PLAN_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly paths: readonly string[];
  readonly payload: TPayload;
  readonly evidenceRefs: readonly string[];
}

export interface BuildCodingWorkspaceMutationPlanInput<TPayload> {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly paths: readonly string[];
  readonly payload: TPayload;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceBaseline<TBaseline> {
  readonly baselineRef: string;
  readonly state: TBaseline;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceAppliedMutation<TApplied, TResult> {
  readonly state: TApplied;
  readonly result?: TResult;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceApplySuccess<TApplied, TResult> {
  readonly status: 'applied';
  readonly applied: CodingWorkspaceAppliedMutation<TApplied, TResult>;
}

export interface CodingWorkspaceApplyRejection<TApplied, TResult> {
  readonly status: 'rejected';
  readonly mutationState: 'unchanged' | 'possibly-changed';
  readonly errorCode: string;
  readonly applied?: CodingWorkspaceAppliedMutation<TApplied, TResult>;
  readonly evidenceRefs: readonly string[];
}

export type CodingWorkspaceApplyOutcome<TApplied, TResult> =
  | CodingWorkspaceApplySuccess<TApplied, TResult>
  | CodingWorkspaceApplyRejection<TApplied, TResult>;

export interface CodingWorkspaceReadback {
  readonly matches: boolean;
  readonly readbackRef: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceRollback {
  readonly rolledBack: boolean;
  readonly rollbackRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult> {
  captureBaseline(
    plan: CodingWorkspaceMutationPlan<TPayload>,
  ): Promise<CodingWorkspaceBaseline<TBaseline>>;
  apply(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
  ): Promise<CodingWorkspaceApplyOutcome<TApplied, TResult>>;
  readback(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
    applied: CodingWorkspaceAppliedMutation<TApplied, TResult>,
  ): Promise<CodingWorkspaceReadback>;
  rollback(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
    applied: CodingWorkspaceAppliedMutation<TApplied, TResult> | undefined,
    cause: CodingWorkspaceMutationFailure,
  ): Promise<CodingWorkspaceRollback>;
}

export interface CodingWorkspaceMutationReceipt<TResult> {
  readonly version: typeof CODING_WORKSPACE_MUTATION_RECEIPT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly status: CodingWorkspaceMutationStatus;
  readonly paths: readonly string[];
  readonly baselineRef?: string;
  readonly readbackRef?: string;
  readonly rollbackRef?: string;
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceMutationOutcome<TResult> {
  readonly receipt: CodingWorkspaceMutationReceipt<TResult>;
  readonly replayed: boolean;
}

export interface CodingWorkspaceMutationJournalRecord {
  readonly plan: CodingWorkspaceMutationPlan<unknown>;
  readonly receipt: CodingWorkspaceMutationReceipt<unknown>;
}

export interface CodingWorkspaceMutationJournalPort {
  load(runId: string, actionId: string): Promise<CodingWorkspaceMutationJournalRecord | undefined>;
  append(record: CodingWorkspaceMutationJournalRecord): Promise<void>;
}

export interface WorkspaceMutationTransactionPort {
  execute<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>>;
}

interface ActiveMutation {
  readonly canonicalPlan: string;
  readonly receipt: Promise<CodingWorkspaceMutationReceipt<unknown>>;
}

/** Owns baseline, apply, readback, rollback, and one terminal mutation receipt. */
export class CanonicalWorkspaceMutationTransaction implements WorkspaceMutationTransactionPort {
  private readonly executions = new Map<string, ActiveMutation>();

  constructor(private readonly journal?: CodingWorkspaceMutationJournalPort) {}

  async execute<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    const snapshot = snapshotMutationPlan(plan);
    const key = mutationIdentity(snapshot);
    const canonicalPlan = canonicalCodingJson(snapshot);
    const existing = this.executions.get(key);
    if (existing) {
      assertSamePlan(existing.canonicalPlan, canonicalPlan);
      return {
        receipt: await existing.receipt as CodingWorkspaceMutationReceipt<TResult>,
        replayed: true,
      };
    }

    const execution = this.executeOnce(snapshot, host, canonicalPlan);
    this.executions.set(key, {
      canonicalPlan,
      receipt: execution.then(outcome => outcome.receipt) as Promise<CodingWorkspaceMutationReceipt<unknown>>,
    });
    return execution;
  }

  private async executeOnce<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
    canonicalPlan: string,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    const replay = await this.journal?.load(plan.runId, plan.actionId);
    if (replay) {
      assertSamePlan(canonicalCodingJson(replay.plan), canonicalPlan);
      return {
        receipt: snapshotMutationReceipt(replay.receipt) as CodingWorkspaceMutationReceipt<TResult>,
        replayed: true,
      };
    }

    const receipt = await executeMutation(plan, host);
    if (!this.journal) return { receipt, replayed: false };
    try {
      await this.journal.append({ plan, receipt });
      return { receipt, replayed: false };
    } catch {
      return {
        receipt: snapshotMutationReceipt({
          ...receipt,
          status: 'indeterminate',
          errorCode: 'mutation-receipt-journal-failed',
          evidenceRefs: uniqueCodingRefs([
            ...receipt.evidenceRefs,
            `mutation-journal:${plan.actionId}:failed`,
          ]),
        }),
        replayed: false,
      };
    }
  }
}

export class InMemoryCodingWorkspaceMutationJournal implements CodingWorkspaceMutationJournalPort {
  private readonly records = new Map<string, CodingWorkspaceMutationJournalRecord>();

  async load(runId: string, actionId: string): Promise<CodingWorkspaceMutationJournalRecord | undefined> {
    const record = this.records.get(mutationIdentity({ runId, actionId }));
    if (!record) return undefined;
    return {
      plan: snapshotMutationPlan(record.plan),
      receipt: snapshotMutationReceipt(record.receipt),
    };
  }

  async append(record: CodingWorkspaceMutationJournalRecord): Promise<void> {
    const plan = snapshotMutationPlan(record.plan);
    const receipt = snapshotMutationReceipt(record.receipt);
    const key = mutationIdentity(plan);
    const existing = this.records.get(key);
    if (existing) {
      assertSamePlan(canonicalCodingJson(existing.plan), canonicalCodingJson(plan));
      if (canonicalCodingJson(existing.receipt) !== canonicalCodingJson(receipt)) {
        throw new Error('coding-workspace-mutation:conflicting-terminal-receipt');
      }
      return;
    }
    this.records.set(key, Object.freeze({ plan, receipt }));
  }
}

export function buildCodingWorkspaceMutationPlan<TPayload>(
  input: BuildCodingWorkspaceMutationPlanInput<TPayload>,
): CodingWorkspaceMutationPlan<TPayload> {
  return snapshotMutationPlan({
    version: CODING_WORKSPACE_MUTATION_PLAN_VERSION,
    ...input,
  });
}

async function executeMutation<TPayload, TBaseline, TApplied, TResult>(
  plan: CodingWorkspaceMutationPlan<TPayload>,
  host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
): Promise<CodingWorkspaceMutationReceipt<TResult>> {
  let baseline: CodingWorkspaceBaseline<TBaseline>;
  try {
    baseline = snapshotBaseline(await host.captureBaseline(plan));
  } catch {
    return failedMutationReceipt(plan, 'baseline-capture-failed', [
      `mutation-baseline:${plan.actionId}:failed`,
    ]);
  }

  let applyOutcome: CodingWorkspaceApplyOutcome<TApplied, TResult>;
  try {
    applyOutcome = snapshotApplyOutcome(await host.apply(plan, baseline));
  } catch {
    return rollbackMutation(plan, host, baseline, undefined, 'apply-failed', [
      ...baseline.evidenceRefs,
      `mutation-apply:${plan.actionId}:failed`,
    ]);
  }
  if (applyOutcome.status === 'rejected') {
    const evidenceRefs = uniqueCodingRefs([
      ...baseline.evidenceRefs,
      ...applyOutcome.evidenceRefs,
    ]);
    if (applyOutcome.mutationState === 'unchanged') {
      return failedMutationReceipt(plan, applyOutcome.errorCode, evidenceRefs);
    }
    return rollbackMutation(plan, host, baseline, applyOutcome.applied, 'apply-failed', evidenceRefs);
  }
  const applied = applyOutcome.applied;
  if (applied.evidenceRefs.length === 0) {
    return rollbackMutation(plan, host, baseline, applied, 'apply-evidence-missing', [
      ...baseline.evidenceRefs,
      `mutation-apply:${plan.actionId}:evidence-missing`,
    ]);
  }

  let readback: CodingWorkspaceReadback;
  try {
    readback = snapshotReadback(await host.readback(plan, baseline, applied));
  } catch {
    return rollbackMutation(plan, host, baseline, applied, 'readback-failed', [
      ...baseline.evidenceRefs,
      ...applied.evidenceRefs,
      `mutation-readback:${plan.actionId}:failed`,
    ]);
  }
  if (!readback.matches) {
    return rollbackMutation(plan, host, baseline, applied, 'readback-mismatch', [
      ...baseline.evidenceRefs,
      ...applied.evidenceRefs,
      ...readback.evidenceRefs,
    ], readback.readbackRef);
  }

  return snapshotMutationReceipt({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    status: 'committed',
    paths: plan.paths,
    baselineRef: baseline.baselineRef,
    readbackRef: readback.readbackRef,
    ...(applied.result === undefined ? {} : { result: applied.result }),
    evidenceRefs: uniqueCodingRefs([
      ...plan.evidenceRefs,
      ...baseline.evidenceRefs,
      ...applied.evidenceRefs,
      ...readback.evidenceRefs,
    ]),
  });
}

async function rollbackMutation<TPayload, TBaseline, TApplied, TResult>(
  plan: CodingWorkspaceMutationPlan<TPayload>,
  host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  baseline: CodingWorkspaceBaseline<TBaseline>,
  applied: CodingWorkspaceAppliedMutation<TApplied, TResult> | undefined,
  cause: CodingWorkspaceMutationFailure,
  evidenceRefs: readonly string[],
  readbackRef?: string,
): Promise<CodingWorkspaceMutationReceipt<TResult>> {
  let rollback: CodingWorkspaceRollback;
  try {
    rollback = snapshotRollback(await host.rollback(plan, baseline, applied, cause));
  } catch {
    return indeterminateMutationReceipt(plan, baseline, cause, evidenceRefs, readbackRef);
  }
  const combinedEvidence = uniqueCodingRefs([
    ...plan.evidenceRefs,
    ...evidenceRefs,
    ...rollback.evidenceRefs,
  ]);
  if (!rollback.rolledBack || !rollback.rollbackRef) {
    return indeterminateMutationReceipt(plan, baseline, cause, combinedEvidence, readbackRef);
  }
  return snapshotMutationReceipt({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    status: 'rolled-back',
    paths: plan.paths,
    baselineRef: baseline.baselineRef,
    ...(readbackRef ? { readbackRef } : {}),
    rollbackRef: rollback.rollbackRef,
    errorCode: cause,
    evidenceRefs: combinedEvidence,
  });
}

function failedMutationReceipt<TResult>(
  plan: CodingWorkspaceMutationPlan<unknown>,
  errorCode: string,
  evidenceRefs: readonly string[],
): CodingWorkspaceMutationReceipt<TResult> {
  return snapshotMutationReceipt({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    status: 'failed',
    paths: plan.paths,
    errorCode,
    evidenceRefs: uniqueCodingRefs([...plan.evidenceRefs, ...evidenceRefs]),
  });
}

function indeterminateMutationReceipt<TResult>(
  plan: CodingWorkspaceMutationPlan<unknown>,
  baseline: CodingWorkspaceBaseline<unknown>,
  cause: CodingWorkspaceMutationFailure,
  evidenceRefs: readonly string[],
  readbackRef?: string,
): CodingWorkspaceMutationReceipt<TResult> {
  return snapshotMutationReceipt({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    status: 'indeterminate',
    paths: plan.paths,
    baselineRef: baseline.baselineRef,
    ...(readbackRef ? { readbackRef } : {}),
    errorCode: cause,
    evidenceRefs: uniqueCodingRefs([
      ...plan.evidenceRefs,
      ...evidenceRefs,
      `mutation-rollback:${plan.actionId}:indeterminate`,
    ]),
  });
}

function snapshotMutationPlan<TPayload>(
  plan: CodingWorkspaceMutationPlan<TPayload>,
): CodingWorkspaceMutationPlan<TPayload> {
  if (!plan || typeof plan !== 'object') throw new Error('coding-workspace-mutation:invalid-plan');
  if (plan.version !== CODING_WORKSPACE_MUTATION_PLAN_VERSION) {
    throw new Error('coding-workspace-mutation:unsupported-plan-version');
  }
  if (!Number.isInteger(plan.sequence) || plan.sequence < 1) {
    throw new Error('coding-workspace-mutation:invalid-sequence');
  }
  const paths = normalizeMutationPaths(plan.paths);
  const evidenceRefs = uniqueCodingRefs(plan.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-plan-evidence');
  return Object.freeze({
    version: CODING_WORKSPACE_MUTATION_PLAN_VERSION,
    runId: normalizedCodingId(plan.runId, 'mutation-run-id'),
    sequence: plan.sequence,
    actionId: normalizedCodingId(plan.actionId, 'mutation-action-id'),
    idempotencyKey: normalizedCodingId(plan.idempotencyKey, 'mutation-idempotency-key'),
    paths,
    payload: snapshotCodingValue(plan.payload, 'mutation-payload') as TPayload,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function snapshotBaseline<TBaseline>(baseline: CodingWorkspaceBaseline<TBaseline>): CodingWorkspaceBaseline<TBaseline> {
  if (!baseline || typeof baseline !== 'object') throw new Error('coding-workspace-mutation:invalid-baseline');
  const evidenceRefs = uniqueCodingRefs(baseline.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-baseline-evidence');
  return Object.freeze({
    baselineRef: normalizedCodingId(baseline.baselineRef, 'mutation-baseline-ref'),
    state: snapshotCodingValue(baseline.state, 'mutation-baseline-state') as TBaseline,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function snapshotAppliedMutation<TApplied, TResult>(
  applied: CodingWorkspaceAppliedMutation<TApplied, TResult>,
): CodingWorkspaceAppliedMutation<TApplied, TResult> {
  if (!applied || typeof applied !== 'object') throw new Error('coding-workspace-mutation:invalid-apply-result');
  return Object.freeze({
    state: snapshotCodingValue(applied.state, 'mutation-apply-state') as TApplied,
    ...(applied.result === undefined
      ? {}
      : { result: snapshotCodingValue(applied.result, 'mutation-result') as TResult }),
    evidenceRefs: Object.freeze(uniqueCodingRefs(applied.evidenceRefs ?? [])),
  });
}

function snapshotApplyOutcome<TApplied, TResult>(
  outcome: CodingWorkspaceApplyOutcome<TApplied, TResult>,
): CodingWorkspaceApplyOutcome<TApplied, TResult> {
  if (outcome.status === 'applied') {
    return Object.freeze({
      status: 'applied',
      applied: snapshotAppliedMutation(outcome.applied),
    });
  }
  return Object.freeze({
    status: 'rejected',
    mutationState: outcome.mutationState,
    errorCode: normalizeCodingErrorCode(outcome.errorCode),
    ...(outcome.applied ? { applied: snapshotAppliedMutation(outcome.applied) } : {}),
    evidenceRefs: uniqueCodingRefs(outcome.evidenceRefs),
  });
}

function snapshotReadback(readback: CodingWorkspaceReadback): CodingWorkspaceReadback {
  if (!readback || typeof readback !== 'object') throw new Error('coding-workspace-mutation:invalid-readback');
  const evidenceRefs = uniqueCodingRefs(readback.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-readback-evidence');
  return Object.freeze({
    matches: readback.matches === true,
    readbackRef: normalizedCodingId(readback.readbackRef, 'mutation-readback-ref'),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function snapshotRollback(rollback: CodingWorkspaceRollback): CodingWorkspaceRollback {
  if (!rollback || typeof rollback !== 'object') throw new Error('coding-workspace-mutation:invalid-rollback');
  const evidenceRefs = uniqueCodingRefs(rollback.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-rollback-evidence');
  const rollbackRef = rollback.rollbackRef?.trim();
  return Object.freeze({
    rolledBack: rollback.rolledBack === true,
    ...(rollbackRef ? { rollbackRef } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function snapshotMutationReceipt<TResult>(
  receipt: CodingWorkspaceMutationReceipt<TResult>,
): CodingWorkspaceMutationReceipt<TResult> {
  if (!receipt || typeof receipt !== 'object' || receipt.version !== CODING_WORKSPACE_MUTATION_RECEIPT_VERSION) {
    throw new Error('coding-workspace-mutation:invalid-receipt');
  }
  if (!['committed', 'rolled-back', 'failed', 'indeterminate'].includes(receipt.status)) {
    throw new Error('coding-workspace-mutation:invalid-receipt-status');
  }
  const evidenceRefs = uniqueCodingRefs(receipt.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-receipt-evidence');
  if (receipt.status === 'committed' && (!receipt.baselineRef || !receipt.readbackRef)) {
    throw new Error('coding-workspace-mutation:incomplete-committed-receipt');
  }
  if (receipt.status === 'rolled-back' && (!receipt.baselineRef || !receipt.rollbackRef)) {
    throw new Error('coding-workspace-mutation:incomplete-rollback-receipt');
  }
  return Object.freeze({
    version: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    runId: normalizedCodingId(receipt.runId, 'mutation-receipt-run-id'),
    sequence: receipt.sequence,
    actionId: normalizedCodingId(receipt.actionId, 'mutation-receipt-action-id'),
    idempotencyKey: normalizedCodingId(receipt.idempotencyKey, 'mutation-receipt-idempotency-key'),
    status: receipt.status,
    paths: normalizeMutationPaths(receipt.paths),
    ...(receipt.baselineRef ? { baselineRef: receipt.baselineRef.trim() } : {}),
    ...(receipt.readbackRef ? { readbackRef: receipt.readbackRef.trim() } : {}),
    ...(receipt.rollbackRef ? { rollbackRef: receipt.rollbackRef.trim() } : {}),
    ...(receipt.result === undefined
      ? {}
      : { result: snapshotCodingValue(receipt.result, 'mutation-receipt-result') as TResult }),
    ...(receipt.errorCode ? { errorCode: normalizeCodingErrorCode(receipt.errorCode) } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function normalizeMutationPaths(paths: readonly string[]): readonly string[] {
  if (!Array.isArray(paths)) throw new Error('coding-workspace-mutation:invalid-paths');
  const normalized = [...new Set(paths.map(path => normalizeMutationPath(path)))];
  if (normalized.length === 0) throw new Error('coding-workspace-mutation:missing-paths');
  return Object.freeze(normalized);
}

function normalizeMutationPath(value: string): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  const segments = normalized.split('/');
  if (!normalized
    || normalized.includes('\u0000')
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
    || segments.includes('..')
    || segments.includes('')) {
    throw new Error('coding-workspace-mutation:unsafe-path');
  }
  return segments.filter(segment => segment !== '.').join('/');
}

function mutationIdentity(value: { readonly runId: string; readonly actionId: string }): string {
  return `${value.runId}\u0000${value.actionId}`;
}

function assertSamePlan(existing: string, candidate: string): void {
  if (existing !== candidate) throw new Error('coding-workspace-mutation:conflicting-action-identity');
}
