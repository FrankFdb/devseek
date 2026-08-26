import type {
  CodingContextGraph,
  CodingContextGraphSourcePort,
} from './coding-context-graph';
import type { CodingContextProvenanceRecord } from './coding-context-provenance';
import {
  type CodingCheckpoint,
  type CodingCheckpointPendingUnit,
  type CodingCheckpointPendingUnitInput,
  type CodingCheckpointSessionPort,
  CanonicalCheckpointService,
} from './coding-checkpoint';
import type { CodingMemoryContextDecision } from './coding-memory-policy';
import { codingSemanticDigest } from './coding-semantic-digest';
import { redactCodingSecretsInText, redactCodingSecretsInValue } from './coding-secret-redaction';
import {
  CanonicalTaskContractService,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import type { CodingTaskContractSourcePort } from './coding-task-contract-revision';

export const CODING_CONTEXT_COMPACTION_VERSION = 'devseek.coding-context-compaction/v1' as const;

export type CodingContextCompactionTrigger = 'budget-exceeded' | 'provider-recovery' | 'manual';

export interface CodingContextCompactionReceipt {
  readonly version: typeof CODING_CONTEXT_COMPACTION_VERSION;
  readonly pass: number;
  readonly trigger: CodingContextCompactionTrigger;
  readonly budget: {
    readonly observedChars: number;
    readonly maxChars: number;
    readonly omittedChars: number;
  };
  readonly taskContract: ReturnType<CanonicalTaskContractService['project']>;
  readonly taskContractSha256: string;
  readonly contextGraphSha256: string;
  readonly memoryPolicySha256: string;
  readonly provenance: readonly CodingContextProvenanceRecord[];
  readonly rejectedMemoryIds: readonly string[];
  readonly completedUnitCount: number;
  readonly pendingUnits: readonly CodingCheckpointPendingUnit[];
  readonly evidenceRefs: readonly string[];
  readonly redactedSecretCount: number;
  readonly requiresRevalidation: true;
  readonly checkpoint: CodingCheckpoint;
  readonly parentReceiptSha256?: string;
  readonly receiptSha256: string;
}

export interface CodingContextCompactionSessionPort {
  compact(input: {
    readonly trigger?: CodingContextCompactionTrigger;
    readonly observedChars: number;
    readonly maxChars: number;
    readonly omittedChars?: number;
    readonly completedUnitCount: number;
    readonly pendingUnits: readonly CodingCheckpointPendingUnitInput[];
    readonly evidenceRefs?: readonly string[];
    readonly redactedSecretCount?: number;
    readonly createdAt?: number;
    readonly priorReceipt?: CodingContextCompactionReceipt;
  }): CodingContextCompactionReceipt;
  receipts(): readonly CodingContextCompactionReceipt[];
}

export interface ContextCompactionPort {
  bind(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly taskContractSource?: CodingTaskContractSourcePort;
    readonly contextGraph: CodingContextGraph;
    readonly contextGraphSource?: CodingContextGraphSourcePort;
    readonly memoryPolicy: CodingMemoryContextDecision;
    readonly checkpoint: CodingCheckpointSessionPort;
    readonly resumeCheckpoint?: CodingCheckpoint;
  }): CodingContextCompactionSessionPort;
  snapshot(receipt: CodingContextCompactionReceipt): CodingContextCompactionReceipt;
}

interface CompactionBinding {
  readonly initialTaskContract: CodingKernelTaskContract;
  readonly taskContractSource?: CodingTaskContractSourcePort;
  readonly initialContextGraph: CodingContextGraph;
  readonly contextGraphSource?: CodingContextGraphSourcePort;
  readonly memoryPolicySha256: string;
  readonly rejectedMemoryIds: readonly string[];
  readonly checkpoint: CodingCheckpointSessionPort;
  readonly initialEpoch: number;
  readonly initialParentCheckpointId?: string;
}

interface CompactionSemanticSnapshot {
  readonly taskContract: ReturnType<CanonicalTaskContractService['project']>;
  readonly taskContractSha256: string;
  readonly contextGraphSha256: string;
  readonly provenance: readonly CodingContextProvenanceRecord[];
  readonly taskRedactionCount: number;
}

/** Owns the semantic envelope that must survive transport-level context pruning. */
export class CanonicalContextCompactionService implements ContextCompactionPort {
  private readonly checkpoints = new CanonicalCheckpointService();
  private readonly taskContracts = new CanonicalTaskContractService();

  bind(input: Parameters<ContextCompactionPort['bind']>[0]): CodingContextCompactionSessionPort {
    if (!input || typeof input !== 'object') compactionFailure('invalid-binding');
    const taskContract = this.taskContracts.snapshot(input.taskContract);
    const resumeCheckpoint = input.resumeCheckpoint
      ? this.checkpoints.snapshot(input.resumeCheckpoint)
      : undefined;
    const binding: CompactionBinding = Object.freeze({
      initialTaskContract: taskContract,
      ...(input.taskContractSource ? { taskContractSource: input.taskContractSource } : {}),
      initialContextGraph: input.contextGraph,
      ...(input.contextGraphSource ? { contextGraphSource: input.contextGraphSource } : {}),
      memoryPolicySha256: requireSha256(input.memoryPolicy?.decisionSha256, 'invalid-memory-policy'),
      rejectedMemoryIds: Object.freeze(uniqueText(
        input.memoryPolicy?.rejected?.map(item => item.memoryId) ?? [],
        'invalid-rejected-memory-id',
      )),
      checkpoint: input.checkpoint,
      initialEpoch: resumeCheckpoint?.epoch ?? 0,
      ...(resumeCheckpoint ? { initialParentCheckpointId: resumeCheckpoint.checkpointId } : {}),
    });
    let epoch = binding.initialEpoch;
    let parentCheckpointId = binding.initialParentCheckpointId;
    const receipts: CodingContextCompactionReceipt[] = [];

    return Object.freeze({
      compact: (compactInput: Parameters<CodingContextCompactionSessionPort['compact']>[0]) => {
        const suppliedPrior = compactInput?.priorReceipt
          ? this.snapshot(compactInput.priorReceipt)
          : undefined;
        const latest = receipts[receipts.length - 1];
        if (suppliedPrior && (!latest || suppliedPrior.receiptSha256 !== latest.receiptSha256)) {
          compactionFailure('prior-receipt-not-latest');
        }
        const prior = suppliedPrior ?? latest;
        const semantic = snapshotCompactionSemantics(this.taskContracts, binding);
        const receipt = createCompactionReceipt(binding, semantic, compactInput, {
          epoch: ++epoch,
          parentCheckpointId,
          prior,
        });
        parentCheckpointId = receipt.checkpoint.checkpointId;
        receipts.push(receipt);
        return receipt;
      },
      receipts: () => Object.freeze([...receipts]),
    });
  }

  snapshot(receipt: CodingContextCompactionReceipt): CodingContextCompactionReceipt {
    if (!receipt || typeof receipt !== 'object') compactionFailure('invalid-receipt');
    if (receipt.version !== CODING_CONTEXT_COMPACTION_VERSION) compactionFailure('unsupported-version');
    const checkpoint = this.checkpoints.snapshot(receipt.checkpoint);
    const payload = {
      version: CODING_CONTEXT_COMPACTION_VERSION,
      pass: positiveInteger(receipt.pass, 'invalid-pass'),
      trigger: requireTrigger(receipt.trigger),
      budget: snapshotBudget(receipt.budget),
      taskContract: deepFreeze(structuredClone(receipt.taskContract)),
      taskContractSha256: requireSha256(receipt.taskContractSha256, 'invalid-task-contract-sha256'),
      contextGraphSha256: requireSha256(receipt.contextGraphSha256, 'invalid-context-graph-sha256'),
      memoryPolicySha256: requireSha256(receipt.memoryPolicySha256, 'invalid-memory-policy-sha256'),
      provenance: deepFreeze(structuredClone(receipt.provenance ?? [])),
      rejectedMemoryIds: Object.freeze(uniqueText(receipt.rejectedMemoryIds ?? [], 'invalid-rejected-memory-id')),
      completedUnitCount: nonNegativeInteger(receipt.completedUnitCount, 'invalid-completed-unit-count'),
      pendingUnits: checkpoint.pendingUnits,
      evidenceRefs: Object.freeze(uniqueText(receipt.evidenceRefs ?? [], 'invalid-evidence-ref')),
      redactedSecretCount: nonNegativeInteger(receipt.redactedSecretCount, 'invalid-redacted-secret-count'),
      requiresRevalidation: true as const,
      checkpoint,
      ...(receipt.parentReceiptSha256
        ? { parentReceiptSha256: requireSha256(receipt.parentReceiptSha256, 'invalid-parent-receipt-sha256') }
        : {}),
    };
    if (receipt.requiresRevalidation !== true) compactionFailure('revalidation-required');
    if (payload.completedUnitCount !== checkpoint.completedUnitCount) {
      compactionFailure('checkpoint-progress-mismatch');
    }
    if (hasSecretMaterial(JSON.stringify(payload.taskContract))) compactionFailure('task-secret-not-redacted');
    const receiptSha256 = codingSemanticDigest(payload);
    if (receipt.receiptSha256 !== receiptSha256) compactionFailure('receipt-sha256-mismatch');
    return deepFreeze({ ...payload, receiptSha256 });
  }
}

const CONTEXT_COMPACTION = new CanonicalContextCompactionService();

export function renderCodingContextCompactionReceipt(receipt: CodingContextCompactionReceipt): string {
  const snapshot = CONTEXT_COMPACTION.snapshot(receipt);
  return [
    '[DevSeek Canonical Context Compaction]',
    `protocol: ${snapshot.version}`,
    `pass: ${snapshot.pass}`,
    `receipt: ${snapshot.receiptSha256}`,
    ...(snapshot.parentReceiptSha256 ? [`parentReceipt: ${snapshot.parentReceiptSha256}`] : []),
    `checkpoint: ${snapshot.checkpoint.checkpointId}`,
    `budget: ${JSON.stringify(snapshot.budget)}`,
    `taskContractSha256: ${snapshot.taskContractSha256}`,
    `contextGraphSha256: ${snapshot.contextGraphSha256}`,
    `memoryPolicySha256: ${snapshot.memoryPolicySha256}`,
    `task: ${JSON.stringify(snapshot.taskContract)}`,
    `provenance: ${JSON.stringify(snapshot.provenance)}`,
    `rejectedMemoryIds: ${JSON.stringify(snapshot.rejectedMemoryIds)}`,
    `completedUnitCount: ${snapshot.completedUnitCount}`,
    `pendingUnits: ${JSON.stringify(snapshot.pendingUnits)}`,
    `evidenceRefs: ${JSON.stringify(snapshot.evidenceRefs)}`,
    `redactedSecretCount: ${snapshot.redactedSecretCount}`,
    'requiresRevalidation: true',
  ].join('\n');
}

function createCompactionReceipt(
  binding: CompactionBinding,
  semantic: CompactionSemanticSnapshot,
  input: Parameters<CodingContextCompactionSessionPort['compact']>[0],
  state: {
    readonly epoch: number;
    readonly parentCheckpointId?: string;
    readonly prior?: CodingContextCompactionReceipt;
  },
): CodingContextCompactionReceipt {
  if (!input || typeof input !== 'object') compactionFailure('invalid-input');
  const budget = snapshotBudget({
    observedChars: input.observedChars,
    maxChars: input.maxChars,
    omittedChars: input.omittedChars ?? Math.max(0, input.observedChars - input.maxChars),
  });
  if (budget.observedChars <= budget.maxChars && budget.omittedChars === 0) {
    compactionFailure('budget-not-exceeded');
  }
  const redactedPending = redactValue(input.pendingUnits ?? []);
  if (!Array.isArray(redactedPending.value) || redactedPending.value.length === 0) {
    compactionFailure('missing-pending-units');
  }
  const completedUnitCount = nonNegativeInteger(input.completedUnitCount, 'invalid-completed-unit-count');
  assertProgressContinuity(state.prior, completedUnitCount, redactedPending.value);
  const redactedEvidence = redactValue(uniqueText(input.evidenceRefs ?? [], 'invalid-evidence-ref'));
  const evidenceRefs = redactedEvidence.value;
  const checkpoint = binding.checkpoint.create({
    epoch: state.epoch,
    completedUnitCount,
    pendingUnits: redactedPending.value,
    reason: 'compaction',
    evidenceRefs,
    createdAt: input.createdAt,
    ...(state.parentCheckpointId ? { parentCheckpointId: state.parentCheckpointId } : {}),
  });
  if (checkpoint.taskContractSha256 !== semantic.taskContractSha256) {
    compactionFailure('checkpoint-task-contract-drift');
  }
  if (checkpoint.contextGraphSha256 !== semantic.contextGraphSha256) {
    compactionFailure('checkpoint-context-graph-drift');
  }
  const payload = {
    version: CODING_CONTEXT_COMPACTION_VERSION,
    pass: (state.prior?.pass ?? 0) + 1,
    trigger: requireTrigger(input.trigger ?? 'budget-exceeded'),
    budget,
    taskContract: semantic.taskContract,
    taskContractSha256: semantic.taskContractSha256,
    contextGraphSha256: semantic.contextGraphSha256,
    memoryPolicySha256: binding.memoryPolicySha256,
    provenance: semantic.provenance,
    rejectedMemoryIds: binding.rejectedMemoryIds,
    completedUnitCount,
    pendingUnits: checkpoint.pendingUnits,
    evidenceRefs: Object.freeze(evidenceRefs),
    redactedSecretCount: Math.max(
      state.prior?.redactedSecretCount ?? 0,
      nonNegativeInteger(input.redactedSecretCount ?? 0, 'invalid-redacted-secret-count')
        + semantic.taskRedactionCount
        + redactedPending.count
        + redactedEvidence.count,
    ),
    requiresRevalidation: true as const,
    checkpoint,
    ...(state.prior ? { parentReceiptSha256: state.prior.receiptSha256 } : {}),
  };
  return deepFreeze({ ...payload, receiptSha256: codingSemanticDigest(payload) });
}

function snapshotCompactionSemantics(
  taskContracts: CanonicalTaskContractService,
  binding: CompactionBinding,
): CompactionSemanticSnapshot {
  const taskContract = taskContracts.snapshot(
    binding.taskContractSource?.current() ?? binding.initialTaskContract,
  );
  const contextGraph = binding.contextGraphSource?.currentContextGraph()
    ?? binding.initialContextGraph;
  const redactedTask = redactValue(taskContracts.project(taskContract));
  return Object.freeze({
    taskContract: deepFreeze(redactedTask.value),
    taskContractSha256: codingSemanticDigest(taskContract),
    contextGraphSha256: codingSemanticDigest(contextGraph),
    provenance: deepFreeze(structuredClone(contextGraph?.provenance ?? [])),
    taskRedactionCount: redactedTask.count,
  });
}

function assertProgressContinuity(
  prior: CodingContextCompactionReceipt | undefined,
  completedUnitCount: number,
  pendingUnits: readonly CodingCheckpointPendingUnitInput[],
): void {
  if (!prior) return;
  if (completedUnitCount < prior.completedUnitCount) compactionFailure('completed-prefix-regressed');
  const priorUnits = new Map(prior.pendingUnits.map(unit => [unit.id, unit]));
  for (const unit of pendingUnits) {
    const previous = priorUnits.get(unit.id);
    if (!previous) compactionFailure('pending-unit-drift');
    const comparable = {
      id: String(unit.id).trim(),
      description: String(unit.description).trim(),
      ...(unit.action?.trim() ? { action: unit.action.trim() } : {}),
      ...(unit.target?.trim() ? { target: unit.target.trim() } : {}),
      ...(unit.effectClass ? { effectClass: unit.effectClass } : {}),
    };
    if (codingSemanticDigest(comparable) !== previous.fingerprint) compactionFailure('pending-unit-drift');
  }
  const removed = prior.pendingUnits.length - pendingUnits.length;
  if (completedUnitCount < prior.completedUnitCount + removed) {
    compactionFailure('completed-prefix-does-not-cover-removed-units');
  }
}

function snapshotBudget(value: CodingContextCompactionReceipt['budget']): CodingContextCompactionReceipt['budget'] {
  if (!value || typeof value !== 'object') compactionFailure('invalid-budget');
  return Object.freeze({
    observedChars: positiveInteger(value.observedChars, 'invalid-observed-chars'),
    maxChars: positiveInteger(value.maxChars, 'invalid-max-chars'),
    omittedChars: nonNegativeInteger(value.omittedChars, 'invalid-omitted-chars'),
  });
}

function requireTrigger(value: unknown): CodingContextCompactionTrigger {
  if (value !== 'budget-exceeded' && value !== 'provider-recovery' && value !== 'manual') {
    compactionFailure('invalid-trigger');
  }
  return value;
}

function redactValue<T>(value: T): { value: T; count: number } {
  const receipt = redactCodingSecretsInValue(structuredClone(value), {
    replacement: '[REDACTED_SECRET]',
    sensitiveFieldReplacement: '[REDACTED_SECRET]',
  });
  return { value: receipt.value, count: receipt.redactionCount };
}

function hasSecretMaterial(value: string): boolean {
  return redactCodingSecretsInText(value).redacted;
}

function uniqueText(value: unknown, reason: string): string[] {
  if (!Array.isArray(value)) compactionFailure(reason);
  return [...new Set(value.map(item => {
    if (typeof item !== 'string' || !item.trim()) compactionFailure(reason);
    return item.trim();
  }))];
}

function positiveInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) compactionFailure(reason);
  return Number(value);
}

function nonNegativeInteger(value: unknown, reason: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) compactionFailure(reason);
  return Number(value);
}

function requireSha256(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) compactionFailure(reason);
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function compactionFailure(reason: string): never {
  throw new Error(`coding-context-compaction:${reason}`);
}
