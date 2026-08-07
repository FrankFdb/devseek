import type { CodingToolEffect } from './coding-conformance';
import {
  canonicalCodingJson,
  normalizeCodingErrorCode,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type {
  CodingResumeEffectClass,
  CodingResumeIdempotencySessionPort,
  CodingResumeReceiptStatus,
} from './coding-resume-idempotency';
import { codingSemanticDigest } from './coding-semantic-digest';
import type {
  CodingToolAuthorityReceipt,
  CodingToolAuthoritySessionPort,
  CodingToolPurpose,
  CodingToolRisk,
  CodingToolSurfaceConstraint,
} from './coding-tool-authority';
import {
  CanonicalToolExecutor,
  buildCodingToolAction,
  type CodingToolAction,
  type CodingToolExecutionReceipt,
  type ToolExecutorPort,
} from './coding-tool-execution';

export const CODING_EXTERNAL_EFFECT_RECEIPT_VERSION = 'devseek.coding-external-effect-receipt/v1' as const;

export type CodingExternalEffectNature = 'observational' | 'mutating';
export type CodingExternalEffectStatus = 'committed' | 'failed-no-effect' | 'denied' | 'indeterminate';

export interface CodingExternalEffectHostResult<TResult> {
  readonly status: 'committed' | 'failed-no-effect' | 'indeterminate';
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingExternalEffectReconciliation<TResult> {
  readonly status: 'not-started' | 'committed' | 'indeterminate';
  readonly result?: TResult;
  readonly evidenceRefs: readonly string[];
}

export interface ExternalEffectHostPort<TInput, TResult> {
  reconcile?(action: CodingToolAction<TInput>): Promise<CodingExternalEffectReconciliation<TResult>>;
  execute(action: CodingToolAction<TInput>): Promise<CodingExternalEffectHostResult<TResult>>;
}

export interface CodingExternalEffectExecutionInput<TInput> {
  readonly sequence: number;
  readonly actionId: string;
  readonly tool: string;
  readonly purpose: Exclude<CodingToolPurpose, 'workspace-mutation'>;
  readonly nature: CodingExternalEffectNature;
  readonly effects: readonly CodingToolEffect[];
  readonly input: TInput;
  readonly risk?: CodingToolRisk;
  readonly protectedPath?: boolean;
  readonly surfaceConstraint?: CodingToolSurfaceConstraint;
  readonly resumeUnitId?: string;
}

type CodingExternalEffectOperationInput<TInput> = Pick<
  CodingExternalEffectExecutionInput<TInput>,
  'tool' | 'purpose' | 'nature' | 'effects' | 'input'
>;

interface CodingExternalEffectReceiptBase {
  readonly version: typeof CODING_EXTERNAL_EFFECT_RECEIPT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly tool: string;
  readonly purpose: CodingExternalEffectExecutionInput<unknown>['purpose'];
  readonly nature: CodingExternalEffectNature;
  readonly effects: readonly CodingToolEffect[];
  readonly status: CodingExternalEffectStatus;
  readonly evidenceRefs: readonly string[];
}

export interface CodingExternalEffectAttemptReceipt<TResult> extends CodingExternalEffectReceiptBase {
  readonly settlement: 'attempt';
  readonly permission: CodingToolAuthorityReceipt;
  readonly toolReceipt: CodingToolExecutionReceipt<TResult>;
  readonly result?: TResult;
  readonly errorCode?: string;
}

export interface CodingExternalEffectReplayReceipt extends CodingExternalEffectReceiptBase {
  readonly settlement: 'resume-replay';
  readonly status: 'committed';
  readonly resumeUnitId: string;
  readonly resumeReceiptSha256: string;
}

export type CodingExternalEffectReceipt<TResult> =
  | CodingExternalEffectAttemptReceipt<TResult>
  | CodingExternalEffectReplayReceipt;

export interface CodingExternalEffectOutcome<TResult> {
  readonly receipt: CodingExternalEffectReceipt<TResult>;
  readonly replayed: boolean;
}

export interface CodingExternalEffectSessionPort {
  execute<TInput, TResult>(
    input: CodingExternalEffectExecutionInput<TInput>,
    host: ExternalEffectHostPort<TInput, TResult>,
  ): Promise<CodingExternalEffectOutcome<TResult>>;
  receipts(): readonly CodingExternalEffectReceipt<unknown>[];
}

export interface ExternalEffectPort {
  bind(input: {
    readonly runId: string;
    readonly authority: CodingToolAuthoritySessionPort;
    readonly resume?: CodingResumeIdempotencySessionPort;
  }): CodingExternalEffectSessionPort;
}

interface SettledEffect {
  readonly canonicalInput: string;
  readonly outcome: Promise<CodingExternalEffectOutcome<unknown>>;
}

/** Owns reconciliation, execution, receipt mapping, and resume settlement for non-workspace effects. */
export class CanonicalExternalEffectService implements ExternalEffectPort {
  constructor(
    private readonly createExecutor: () => ToolExecutorPort = () => new CanonicalToolExecutor(),
  ) {}

  bind(input: Parameters<ExternalEffectPort['bind']>[0]): CodingExternalEffectSessionPort {
    const runId = normalizedCodingId(input.runId, 'run-id');
    const executor = this.createExecutor();
    const settled = new Map<string, SettledEffect>();
    const receipts: CodingExternalEffectReceipt<unknown>[] = [];

    return Object.freeze({
      execute: <TInput, TResult>(
        candidate: CodingExternalEffectExecutionInput<TInput>,
        host: ExternalEffectHostPort<TInput, TResult>,
      ) => {
        const execution = snapshotExecutionInput(candidate);
        const canonicalInput = canonicalCodingJson(execution);
        const existing = settled.get(execution.actionId);
        if (existing) {
          if (existing.canonicalInput !== canonicalInput) {
            throw new Error('coding-external-effect:conflicting-action-identity');
          }
          return existing.outcome.then(outcome => ({
            receipt: outcome.receipt as CodingExternalEffectReceipt<TResult>,
            replayed: true,
          }));
        }

        const outcome = this.executeOnce(runId, execution, host, executor, input.authority, input.resume)
          .then(value => {
            receipts.push(value.receipt as CodingExternalEffectReceipt<unknown>);
            return value;
          });
        settled.set(execution.actionId, {
          canonicalInput,
          outcome: outcome as Promise<CodingExternalEffectOutcome<unknown>>,
        });
        return outcome;
      },
      receipts: () => Object.freeze([...receipts]),
    });
  }

  private async executeOnce<TInput, TResult>(
    runId: string,
    input: CodingExternalEffectExecutionInput<TInput>,
    host: ExternalEffectHostPort<TInput, TResult>,
    executor: ToolExecutorPort,
    authority: CodingToolAuthoritySessionPort,
    resume?: CodingResumeIdempotencySessionPort,
  ): Promise<CodingExternalEffectOutcome<TResult>> {
    const operationSha256 = codingExternalEffectOperationSha256(input);
    const resumed = resumeDisposition(resume, input.resumeUnitId, input.purpose, operationSha256);
    const identity = resumed?.idempotencyKey ?? codingSemanticDigest({
      protocol: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
      actionId: input.actionId,
      tool: input.tool,
      purpose: input.purpose,
      nature: input.nature,
      effects: input.effects,
      input: input.input,
    });
    if (resumed?.disposition === 'skip-completed') {
      if (!resumed.receiptSha256) {
        throw new Error('coding-external-effect:resume-completion-receipt-missing');
      }
      return {
        receipt: snapshotReceipt({
          version: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
          runId,
          sequence: input.sequence,
          actionId: input.actionId,
          idempotencyKey: identity,
          tool: input.tool,
          purpose: input.purpose,
          nature: input.nature,
          effects: input.effects,
          settlement: 'resume-replay',
          status: 'committed',
          resumeUnitId: resumed.unitId,
          resumeReceiptSha256: resumed.receiptSha256,
          evidenceRefs: resumed.evidenceRefs,
        }),
        replayed: true,
      };
    }

    const authorization = authority.authorize({
      actionId: input.actionId,
      tool: input.tool,
      purpose: input.purpose,
      effects: input.effects,
      input: input.input,
      risk: input.risk,
      protectedPath: input.protectedPath,
      surfaceConstraint: input.surfaceConstraint,
    });

    const action = buildCodingToolAction({
      runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: input.tool,
      purpose: input.purpose,
      effects: input.effects,
      input: input.input,
      authority: authorization.receipt,
    });
    const toolOutcome = await executor.execute(action, {
      execute: settledAction => executeExternalHost(input.nature, settledAction, host),
    }, authority);
    const receipt = externalReceipt(input, identity, toolOutcome.receipt);
    settleResumeEffect(resume, input.resumeUnitId, input.purpose, operationSha256, receipt);
    return { receipt, replayed: toolOutcome.replayed };
  }
}

/** Stable logical identity used by checkpoints to bind an exact external operation. */
export function codingExternalEffectOperationSha256<TInput>(
  input: CodingExternalEffectOperationInput<TInput>,
): string {
  return codingSemanticDigest({
    protocol: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
    operation: snapshotExternalEffectOperation(input),
  });
}

async function executeExternalHost<TInput, TResult>(
  nature: CodingExternalEffectNature,
  action: CodingToolAction<TInput>,
  host: ExternalEffectHostPort<TInput, TResult>,
) {
  if (nature === 'mutating') {
    if (!host.reconcile) {
      return {
        status: 'indeterminate' as const,
        errorCode: 'external-effect-reconciliation-unavailable',
        evidenceRefs: [`external-effect:${action.actionId}:reconciliation-unavailable`],
      };
    }
    let reconciliation: CodingExternalEffectReconciliation<TResult>;
    try {
      reconciliation = await host.reconcile(action);
    } catch {
      return {
        status: 'indeterminate' as const,
        errorCode: 'external-effect-reconciliation-failed',
        evidenceRefs: [`external-effect:${action.actionId}:reconciliation-failed`],
      };
    }
    if (reconciliation.status === 'committed') {
      return {
        status: 'completed' as const,
        ...(reconciliation.result === undefined ? {} : { result: reconciliation.result }),
        evidenceRefs: reconciliation.evidenceRefs,
      };
    }
    if (reconciliation.status === 'indeterminate') {
      return {
        status: 'indeterminate' as const,
        errorCode: 'external-effect-state-indeterminate',
        evidenceRefs: reconciliation.evidenceRefs,
      };
    }
    if (reconciliation.status !== 'not-started') {
      return {
        status: 'indeterminate' as const,
        errorCode: 'external-effect-invalid-reconciliation',
        evidenceRefs: [`external-effect:${action.actionId}:invalid-reconciliation`],
      };
    }
  }

  const result = await host.execute(action);
  return {
    status: result.status === 'committed'
      ? 'completed' as const
      : result.status === 'failed-no-effect'
        ? 'failed' as const
        : 'indeterminate' as const,
    ...(result.result === undefined ? {} : { result: result.result }),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    evidenceRefs: result.evidenceRefs,
  };
}

function externalReceipt<TResult>(
  input: CodingExternalEffectExecutionInput<unknown>,
  idempotencyKey: string,
  toolReceipt: CodingToolExecutionReceipt<TResult>,
): CodingExternalEffectAttemptReceipt<TResult> {
  const status: CodingExternalEffectStatus = toolReceipt.status === 'completed'
    ? 'committed'
    : toolReceipt.status === 'failed'
      ? 'failed-no-effect'
      : toolReceipt.status === 'denied'
        ? 'denied'
        : 'indeterminate';
  return snapshotReceipt({
    version: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
    runId: toolReceipt.runId,
    sequence: toolReceipt.sequence,
    actionId: toolReceipt.actionId,
    idempotencyKey,
    tool: toolReceipt.tool,
    purpose: input.purpose,
    nature: input.nature,
    effects: toolReceipt.effects,
    settlement: 'attempt',
    status,
    permission: toolReceipt.permission,
    toolReceipt,
    ...(toolReceipt.result === undefined ? {} : { result: toolReceipt.result }),
    ...(toolReceipt.errorCode ? { errorCode: toolReceipt.errorCode } : {}),
    evidenceRefs: toolReceipt.evidenceRefs,
  });
}

function settleResumeEffect(
  resume: CodingResumeIdempotencySessionPort | undefined,
  unitId: string | undefined,
  purpose: CodingExternalEffectExecutionInput<unknown>['purpose'],
  operationSha256: string,
  receipt: CodingExternalEffectReceipt<unknown>,
): void {
  if (!resume || !unitId) return;
  assertResumeOperation(resume, unitId, purpose, operationSha256);
  const status: CodingResumeReceiptStatus = receipt.status === 'committed'
    ? 'completed'
    : receipt.status === 'indeterminate'
      ? 'indeterminate'
      : 'failed-no-effect';
  resume.settle({ unitId, status, evidenceRefs: receipt.evidenceRefs });
}

function resumeDisposition(
  resume: CodingResumeIdempotencySessionPort | undefined,
  unitId: string | undefined,
  purpose: CodingExternalEffectExecutionInput<unknown>['purpose'],
  operationSha256: string,
) {
  if (!resume || !unitId) return undefined;
  const unit = assertResumeOperation(resume, unitId, purpose, operationSha256);
  const prior = resume.receipts().find(receipt => receipt.idempotencyKey === unit.idempotencyKey);
  if (unit.disposition === 'skip-completed' && prior?.status !== 'completed') {
    throw new Error('coding-external-effect:resume-completion-receipt-missing');
  }
  return {
    unitId: unit.id,
    idempotencyKey: unit.idempotencyKey,
    disposition: unit.disposition,
    ...(prior ? { receiptSha256: prior.receiptSha256 } : {}),
    evidenceRefs: uniqueCodingRefs([
      ...(prior?.evidenceRefs ?? []),
      `resume-effect:${unit.id}:${unit.disposition}`,
    ]),
  };
}

function assertResumeOperation(
  resume: CodingResumeIdempotencySessionPort,
  unitId: string,
  purpose: CodingExternalEffectExecutionInput<unknown>['purpose'],
  operationSha256: string,
) {
  const unit = resume.plan.units.find(candidate => candidate.id === unitId);
  if (!unit || unit.effectClass !== resumeEffectClass(purpose)) {
    throw new Error('coding-external-effect:resume-unit-mismatch');
  }
  if (!unit.operationSha256) {
    throw new Error('coding-external-effect:resume-operation-binding-missing');
  }
  if (unit.operationSha256 !== operationSha256) {
    throw new Error('coding-external-effect:resume-operation-mismatch');
  }
  return unit;
}

function resumeEffectClass(
  purpose: CodingExternalEffectExecutionInput<unknown>['purpose'],
): CodingResumeEffectClass {
  return purpose === 'verify' ? 'verification' : purpose === 'observe' ? 'read' : 'external-effect';
}

function snapshotExecutionInput<TInput>(
  input: CodingExternalEffectExecutionInput<TInput>,
): CodingExternalEffectExecutionInput<TInput> {
  if (!input || typeof input !== 'object') throw new Error('coding-external-effect:invalid-input');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error('coding-external-effect:invalid-sequence');
  }
  const operation = snapshotExternalEffectOperation(input);
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'action-id'),
    ...operation,
    ...(input.risk ? { risk: input.risk } : {}),
    ...(input.protectedPath ? { protectedPath: true } : {}),
    ...(input.surfaceConstraint ? { surfaceConstraint: input.surfaceConstraint } : {}),
    ...(input.resumeUnitId?.trim() ? { resumeUnitId: input.resumeUnitId.trim() } : {}),
  });
}

function snapshotExternalEffectOperation<TInput>(
  input: CodingExternalEffectOperationInput<TInput>,
): CodingExternalEffectOperationInput<TInput> {
  if (!input || typeof input !== 'object') throw new Error('coding-external-effect:invalid-operation');
  if (!['observe', 'verify', 'external-effect'].includes(input.purpose)) {
    throw new Error('coding-external-effect:invalid-purpose');
  }
  if (input.nature !== 'observational' && input.nature !== 'mutating') {
    throw new Error('coding-external-effect:invalid-nature');
  }
  if ((input.purpose === 'external-effect') !== (input.nature === 'mutating')) {
    throw new Error('coding-external-effect:purpose-nature-mismatch');
  }
  return Object.freeze({
    tool: normalizedCodingId(input.tool, 'tool'),
    purpose: input.purpose,
    nature: input.nature,
    effects: uniqueExternalEffects(input.effects),
    input: snapshotCodingValue(input.input, 'external-effect-input') as TInput,
  });
}

function snapshotReceipt<TResult>(
  receipt: CodingExternalEffectAttemptReceipt<TResult>,
): CodingExternalEffectAttemptReceipt<TResult>;
function snapshotReceipt(
  receipt: CodingExternalEffectReplayReceipt,
): CodingExternalEffectReplayReceipt;
function snapshotReceipt<TResult>(
  receipt: CodingExternalEffectReceipt<TResult>,
): CodingExternalEffectReceipt<TResult> {
  const base = {
    version: CODING_EXTERNAL_EFFECT_RECEIPT_VERSION,
    runId: normalizedCodingId(receipt.runId, 'receipt-run-id'),
    sequence: receipt.sequence,
    actionId: normalizedCodingId(receipt.actionId, 'receipt-action-id'),
    idempotencyKey: normalizedCodingId(receipt.idempotencyKey, 'idempotency-key'),
    tool: normalizedCodingId(receipt.tool, 'receipt-tool'),
    purpose: receipt.purpose,
    nature: receipt.nature,
    effects: uniqueExternalEffects(receipt.effects),
    evidenceRefs: Object.freeze(uniqueCodingRefs(receipt.evidenceRefs)),
  };
  if (receipt.settlement === 'resume-replay') {
    if (receipt.status !== 'committed') {
      throw new Error('coding-external-effect:invalid-replay-status');
    }
    return Object.freeze({
      ...base,
      settlement: 'resume-replay',
      status: 'committed',
      resumeUnitId: normalizedCodingId(receipt.resumeUnitId, 'resume-unit-id'),
      resumeReceiptSha256: snapshotSha256(receipt.resumeReceiptSha256, 'resume-receipt'),
    });
  }
  const result = receipt.result === undefined
    ? undefined
    : snapshotCodingValue(receipt.result, 'external-effect-result') as TResult;
  return Object.freeze({
    ...base,
    settlement: 'attempt',
    status: receipt.status,
    permission: receipt.permission,
    toolReceipt: receipt.toolReceipt,
    ...(result === undefined ? {} : { result }),
    ...(receipt.errorCode ? { errorCode: normalizeCodingErrorCode(receipt.errorCode) } : {}),
  });
}

function snapshotSha256(value: string, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`coding-external-effect:invalid-${label}-sha256`);
  }
  return normalized;
}

function uniqueExternalEffects(effects: readonly CodingToolEffect[]): readonly CodingToolEffect[] {
  const valid = new Set<CodingToolEffect>(['read', 'process', 'network', 'git', 'release']);
  if (!Array.isArray(effects) || effects.length === 0 || effects.some(effect => !valid.has(effect))) {
    throw new Error('coding-external-effect:invalid-effects');
  }
  return Object.freeze([...new Set(effects)]);
}
