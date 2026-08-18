import {
  canonicalCodingJson,
  normalizeCodingErrorCode,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import {
  type CodingOperationJournalPort,
  type CodingOperationJournalRecord,
} from './coding-operation-journal';
import { codingSemanticDigest } from './coding-semantic-digest';
import type {
  CodingDirtyWorktreeOverlapProtection,
  DirtyWorktreePolicySessionPort,
} from './coding-dirty-worktree';
import type { CodingEffectGuardPort } from './coding-run-control';

export const CODING_WORKSPACE_MUTATION_PLAN_VERSION = 'devseek.coding-workspace-mutation-plan/v1' as const;
export const CODING_WORKSPACE_MUTATION_RECEIPT_VERSION = 'devseek.coding-workspace-mutation-receipt/v1' as const;

export type CodingWorkspaceMutationStatus = 'committed' | 'rolled-back' | 'failed' | 'indeterminate';
export type CodingWorkspaceMutationFailure =
  | 'dirty-worktree-conflict'
  | 'baseline-failed'
  | 'apply-failed'
  | 'apply-evidence-missing'
  | 'readback-failed'
  | 'readback-mismatch'
  | 'reconciliation-failed'
  | 'reconciliation-indeterminate'
  | 'reconciliation-unavailable';

export interface CodingWorkspaceMutationPlan<TPayload> {
  readonly version: typeof CODING_WORKSPACE_MUTATION_PLAN_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly paths: readonly string[];
  readonly overlapProtection?: CodingDirtyWorktreeOverlapProtection;
  readonly payload: TPayload;
  readonly evidenceRefs: readonly string[];
}

export interface BuildCodingWorkspaceMutationPlanInput<TPayload> {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly paths: readonly string[];
  readonly overlapProtection?: CodingDirtyWorktreeOverlapProtection;
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
  readonly errorDetail?: string;
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

export interface CodingWorkspaceMutationReconciliation<TResult> {
  readonly status: 'not-started' | 'committed' | 'indeterminate';
  readonly result?: TResult;
  readonly readbackRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult> {
  reconcile?(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
  ): Promise<CodingWorkspaceMutationReconciliation<TResult>>;
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
  readonly errorDetail?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingWorkspaceMutationOutcome<TResult> {
  readonly receipt: CodingWorkspaceMutationReceipt<TResult>;
  readonly replayed: boolean;
}

export interface CodingWorkspaceMutationJournalPreparation {
  readonly plan: CodingWorkspaceMutationPlan<unknown>;
  readonly baseline: CodingWorkspaceBaseline<unknown>;
}

export interface WorkspaceMutationTransactionPort {
  execute<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>>;
}

export interface WorkspaceMutationTransactionSessionPort extends WorkspaceMutationTransactionPort {
  receipts(): readonly CodingWorkspaceMutationReceipt<unknown>[];
}

interface ActiveMutation {
  readonly canonicalPlan: string;
  readonly receipt: Promise<CodingWorkspaceMutationReceipt<unknown>>;
}

/** Owns baseline, apply, readback, rollback, and one terminal mutation receipt. */
export class CanonicalWorkspaceMutationTransaction implements WorkspaceMutationTransactionSessionPort {
  private readonly executions = new Map<string, ActiveMutation>();
  private readonly settledReceipts = new Map<string, CodingWorkspaceMutationReceipt<unknown>>();

  constructor(
    private readonly journal?: CodingOperationJournalPort,
    private readonly replayRunId?: string,
    private readonly dirtyWorktree?: DirtyWorktreePolicySessionPort,
    private readonly effectGuard?: CodingEffectGuardPort,
  ) {}

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
      const outcome = {
        receipt: await existing.receipt as CodingWorkspaceMutationReceipt<TResult>,
        replayed: true,
      };
      this.settledReceipts.set(key, outcome.receipt);
      return outcome;
    }

    const lease = this.effectGuard?.beginEffect(`workspace-mutation:${snapshot.actionId}`);
    const execution = this.executeOnce(snapshot, host, canonicalPlan)
      .finally(() => lease?.release());
    this.executions.set(key, {
      canonicalPlan,
      receipt: execution.then(outcome => outcome.receipt) as Promise<CodingWorkspaceMutationReceipt<unknown>>,
    });
    const outcome = await execution;
    this.settledReceipts.set(key, outcome.receipt);
    return outcome;
  }

  receipts(): readonly CodingWorkspaceMutationReceipt<unknown>[] {
    return Object.freeze([...this.settledReceipts.values()]);
  }

  private async executeOnce<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
    canonicalPlan: string,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    const operationSha256 = codingWorkspaceMutationOperationSha256(plan);
    const recovered = await this.loadRecovery<TBaseline, TResult>(plan, canonicalPlan, operationSha256);
    if (recovered?.record.state === 'settled'
      && (recovered.runId === plan.runId || recovered.record.receipt.status === 'committed'
        || recovered.record.receipt.status === 'indeterminate')) {
      const receipt = projectRecoveredReceipt<TResult>(
        plan,
        recovered.record.receipt,
        recovered.runId,
      );
      if (recovered.runId !== plan.runId) {
        return this.persistOutcome(plan, recovered.preparation.baseline, operationSha256, receipt, true);
      }
      return { receipt, replayed: true };
    }

    if (recovered) {
      return this.reconcileRecovery(
        plan,
        host,
        recovered.preparation.baseline as CodingWorkspaceBaseline<TBaseline>,
        operationSha256,
      );
    }

    const dirtyWorktreeDecision = this.dirtyWorktree?.authorize({
      actionId: plan.actionId,
      paths: plan.paths,
      overlapProtection: plan.overlapProtection,
    });
    if (dirtyWorktreeDecision?.decision === 'deny') {
      return {
        receipt: failedMutationReceipt(plan, 'dirty-worktree-conflict', dirtyWorktreeDecision.evidenceRefs),
        replayed: false,
      };
    }

    let baseline: CodingWorkspaceBaseline<TBaseline>;
    try {
      baseline = snapshotBaseline(await host.captureBaseline(plan));
    } catch {
      return {
        receipt: failedMutationReceipt(plan, 'baseline-capture-failed', [
          `mutation-baseline:${plan.actionId}:failed`,
        ]),
        replayed: false,
      };
    }
    if (this.journal) {
      try {
        await this.prepareJournal(plan, baseline, operationSha256);
      } catch {
        return {
          receipt: failedMutationReceipt(plan, 'mutation-preparation-journal-failed', [
            `mutation-journal:${plan.actionId}:prepare-failed`,
          ]),
          replayed: false,
        };
      }
    }
    const receipt = await executeMutationFromBaseline(plan, host, baseline);
    return this.persistOutcome(plan, baseline, operationSha256, receipt, false);
  }

  private async loadRecovery<TBaseline, TResult>(
    plan: CodingWorkspaceMutationPlan<unknown>,
    canonicalPlan: string,
    operationSha256: string,
  ): Promise<{
    readonly runId: string;
    readonly record: CodingOperationJournalRecord<CodingWorkspaceMutationJournalPreparation, CodingWorkspaceMutationReceipt<TResult>>;
    readonly preparation: CodingWorkspaceMutationJournalPreparation;
  } | undefined> {
    if (!this.journal) return undefined;
    const runIds = [plan.runId];
    const replayRunId = this.replayRunId?.trim();
    if (replayRunId && replayRunId !== plan.runId) runIds.push(replayRunId);
    for (const runId of runIds) {
      const record = await this.journal.load<
        CodingWorkspaceMutationJournalPreparation,
        CodingWorkspaceMutationReceipt<TResult>
      >('workspace-mutation', runId, plan.actionId);
      if (!record) continue;
      if (record.operationSha256 !== operationSha256) {
        throw new Error('coding-workspace-mutation:conflicting-action-identity');
      }
      const preparation = snapshotJournalPreparation(record.preparation);
      if (runId === plan.runId) {
        assertSamePlan(canonicalCodingJson(preparation.plan), canonicalPlan);
      } else if (codingWorkspaceMutationOperationSha256(preparation.plan) !== operationSha256) {
        throw new Error('coding-workspace-mutation:replay-operation-mismatch');
      }
      return { runId, record, preparation };
    }
    return undefined;
  }

  private async reconcileRecovery<TPayload, TBaseline, TApplied, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
    operationSha256: string,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    if (!host.reconcile) {
      const receipt = indeterminateMutationReceipt<TResult>(plan, baseline, 'reconciliation-unavailable', [
        `mutation-reconcile:${plan.actionId}:unavailable`,
      ]);
      return this.persistOutcome(plan, baseline, operationSha256, receipt, true);
    }
    let reconciliation: CodingWorkspaceMutationReconciliation<TResult>;
    try {
      reconciliation = snapshotReconciliation(await host.reconcile(plan, baseline));
    } catch {
      const receipt = indeterminateMutationReceipt<TResult>(plan, baseline, 'reconciliation-failed', [
        `mutation-reconcile:${plan.actionId}:failed`,
      ]);
      return this.persistOutcome(plan, baseline, operationSha256, receipt, true);
    }
    if (reconciliation.status === 'committed') {
      const receipt = recoveredCommittedReceipt(plan, baseline, reconciliation);
      return this.persistOutcome(plan, baseline, operationSha256, receipt, true);
    }
    if (reconciliation.status === 'indeterminate') {
      const receipt = indeterminateMutationReceipt<TResult>(
        plan,
        baseline,
        'reconciliation-indeterminate',
        reconciliation.evidenceRefs,
        reconciliation.readbackRef,
      );
      return this.persistOutcome(plan, baseline, operationSha256, receipt, true);
    }
    try {
      await this.prepareJournal(plan, baseline, operationSha256);
    } catch {
      return {
        receipt: failedMutationReceipt(plan, 'mutation-preparation-journal-failed', [
          ...reconciliation.evidenceRefs,
          `mutation-journal:${plan.actionId}:prepare-failed`,
        ]),
        replayed: true,
      };
    }
    const receipt = await executeMutationFromBaseline(plan, host, baseline);
    return this.persistOutcome(plan, baseline, operationSha256, receipt, false);
  }

  private prepareJournal<TPayload, TBaseline>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
    operationSha256: string,
  ): Promise<void> {
    if (!this.journal) return Promise.resolve();
    return this.journal.prepare({
      kind: 'workspace-mutation',
      runId: plan.runId,
      actionId: plan.actionId,
      operationSha256,
      preparation: { plan, baseline },
    });
  }

  private async persistOutcome<TPayload, TBaseline, TResult>(
    plan: CodingWorkspaceMutationPlan<TPayload>,
    baseline: CodingWorkspaceBaseline<TBaseline>,
    operationSha256: string,
    receipt: CodingWorkspaceMutationReceipt<TResult>,
    replayed: boolean,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    if (!this.journal) return { receipt, replayed };
    try {
      await this.prepareJournal(plan, baseline, operationSha256);
      await this.journal.settle({
        kind: 'workspace-mutation',
        runId: plan.runId,
        actionId: plan.actionId,
        operationSha256,
        preparation: { plan, baseline },
        receipt,
      });
      return { receipt, replayed };
    } catch {
      return {
        receipt: snapshotMutationReceipt({
          ...receipt,
          status: 'indeterminate',
          errorCode: 'mutation-receipt-journal-failed',
          evidenceRefs: uniqueCodingRefs([
            ...receipt.evidenceRefs,
            `mutation-journal:${plan.actionId}:settle-failed`,
          ]),
        }),
        replayed,
      };
    }
  }
}

function snapshotJournalPreparation(
  value: CodingWorkspaceMutationJournalPreparation,
): CodingWorkspaceMutationJournalPreparation {
  if (!value || typeof value !== 'object') {
    throw new Error('coding-workspace-mutation:invalid-journal-preparation');
  }
  return Object.freeze({
    plan: snapshotMutationPlan(value.plan),
    baseline: snapshotBaseline(value.baseline),
  });
}

export function codingWorkspaceMutationOperationSha256(
  plan: Pick<CodingWorkspaceMutationPlan<unknown>, 'paths' | 'payload'>,
): string {
  return codingSemanticDigest({
    protocol: CODING_WORKSPACE_MUTATION_RECEIPT_VERSION,
    paths: normalizeMutationPaths(plan.paths),
    payload: snapshotCodingValue(plan.payload, 'mutation-operation-payload'),
  });
}

function projectRecoveredReceipt<TResult>(
  plan: CodingWorkspaceMutationPlan<unknown>,
  receipt: CodingWorkspaceMutationReceipt<TResult>,
  sourceRunId: string,
): CodingWorkspaceMutationReceipt<TResult> {
  const recovered = snapshotMutationReceipt(receipt);
  return snapshotMutationReceipt({
    ...recovered,
    runId: plan.runId,
    sequence: plan.sequence,
    actionId: plan.actionId,
    idempotencyKey: plan.idempotencyKey,
    paths: plan.paths,
    evidenceRefs: uniqueCodingRefs([
      ...recovered.evidenceRefs,
      `mutation-replay:${sourceRunId}:${plan.actionId}`,
    ]),
  });
}

function recoveredCommittedReceipt<TResult>(
  plan: CodingWorkspaceMutationPlan<unknown>,
  baseline: CodingWorkspaceBaseline<unknown>,
  reconciliation: CodingWorkspaceMutationReconciliation<TResult>,
): CodingWorkspaceMutationReceipt<TResult> {
  if (!reconciliation.readbackRef) {
    throw new Error('coding-workspace-mutation:missing-reconciliation-readback');
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
    readbackRef: reconciliation.readbackRef,
    ...(reconciliation.result === undefined ? {} : { result: reconciliation.result }),
    evidenceRefs: uniqueCodingRefs([
      ...plan.evidenceRefs,
      ...baseline.evidenceRefs,
      ...reconciliation.evidenceRefs,
      `mutation-reconcile:${plan.actionId}:committed`,
    ]),
  });
}

function snapshotReconciliation<TResult>(
  value: CodingWorkspaceMutationReconciliation<TResult>,
): CodingWorkspaceMutationReconciliation<TResult> {
  if (!value || !['not-started', 'committed', 'indeterminate'].includes(value.status)) {
    throw new Error('coding-workspace-mutation:invalid-reconciliation');
  }
  const evidenceRefs = uniqueCodingRefs(value.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-workspace-mutation:missing-reconciliation-evidence');
  const readbackRef = value.readbackRef?.trim();
  if (value.status === 'committed' && !readbackRef) {
    throw new Error('coding-workspace-mutation:missing-reconciliation-readback');
  }
  return Object.freeze({
    status: value.status,
    ...(value.result === undefined
      ? {}
      : { result: snapshotCodingValue(value.result, 'mutation-reconciliation-result') as TResult }),
    ...(readbackRef ? { readbackRef } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

export function buildCodingWorkspaceMutationPlan<TPayload>(
  input: BuildCodingWorkspaceMutationPlanInput<TPayload>,
): CodingWorkspaceMutationPlan<TPayload> {
  return snapshotMutationPlan({
    version: CODING_WORKSPACE_MUTATION_PLAN_VERSION,
    ...input,
  });
}

async function executeMutationFromBaseline<TPayload, TBaseline, TApplied, TResult>(
  plan: CodingWorkspaceMutationPlan<TPayload>,
  host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>,
  baseline: CodingWorkspaceBaseline<TBaseline>,
): Promise<CodingWorkspaceMutationReceipt<TResult>> {
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
      return failedMutationReceipt(plan, applyOutcome.errorCode, evidenceRefs, applyOutcome.errorDetail);
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
  errorDetail?: string,
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
    ...(errorDetail ? { errorDetail } : {}),
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
    ...(plan.overlapProtection ? { overlapProtection: normalizeOverlapProtection(plan.overlapProtection) } : {}),
    payload: snapshotCodingValue(plan.payload, 'mutation-payload') as TPayload,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function normalizeOverlapProtection(
  value: CodingDirtyWorktreeOverlapProtection,
): CodingDirtyWorktreeOverlapProtection {
  if (value === 'none' || value === 'optimistic-baseline') return value;
  throw new Error('coding-workspace-mutation:invalid-overlap-protection');
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
    ...(normalizeCodingErrorDetail(outcome.errorDetail)
      ? { errorDetail: normalizeCodingErrorDetail(outcome.errorDetail) }
      : {}),
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
    ...(normalizeCodingErrorDetail(receipt.errorDetail)
      ? { errorDetail: normalizeCodingErrorDetail(receipt.errorDetail) }
      : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function normalizeCodingErrorDetail(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
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
