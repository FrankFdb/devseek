import type {
  CodingDeliverableKind,
  CodingTaskContractProjection,
  CodingTaskMode,
} from './coding-conformance';
import {
  assertCodingOrientationDecision,
  resolveCodingOrientationDecision,
  type CodingOrientationDecision,
} from './coding-orientation';

export const CODING_KERNEL_TASK_CONTRACT_VERSION = 'devseek.coding-kernel-task-contract/v1' as const;

export interface CodingKernelTaskContract {
  readonly version: typeof CODING_KERNEL_TASK_CONTRACT_VERSION;
  readonly goal: string;
  readonly mode: CodingTaskMode;
  readonly orientation: CodingOrientationDecision;
  readonly scope: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  readonly deliverables: readonly {
    readonly id: string;
    readonly kind: CodingDeliverableKind;
    readonly path?: string;
  }[];
  readonly constraints: readonly string[];
  readonly acceptance: readonly {
    readonly id: string;
    readonly statement: string;
  }[];
  readonly provenanceRefs: readonly string[];
}

export interface BuildCodingKernelTaskContractInput {
  readonly goal: string;
  readonly mode: CodingTaskMode;
  readonly orientation?: CodingOrientationDecision;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly deliverables: readonly {
    readonly id: string;
    readonly kind: CodingDeliverableKind;
    readonly path?: string;
  }[];
  readonly constraints?: readonly string[];
  readonly acceptance: readonly {
    readonly id: string;
    readonly statement: string;
  }[];
  readonly provenanceRefs: readonly string[];
}

export interface TaskContractPort {
  build(input: BuildCodingKernelTaskContractInput): CodingKernelTaskContract;
  snapshot(contract: CodingKernelTaskContract): CodingKernelTaskContract;
  project(contract: CodingKernelTaskContract): CodingTaskContractProjection;
}

/** Owns canonical construction, validation, snapshots, and public projection. */
export class CanonicalTaskContractService implements TaskContractPort {
  build(input: BuildCodingKernelTaskContractInput): CodingKernelTaskContract {
    if (!input || typeof input !== 'object') contractFailure('invalid-input');
    const goal = requireText(input.goal, 'missing-goal');
    const mode = requireMode(input.mode);
    const orientation = input.orientation
      ? assertCodingOrientationDecision(input.orientation)
      : resolveCodingOrientationDecision({ prompt: goal, modeHint: mode });

    if (orientation.mode !== mode) contractFailure('orientation-mode-mismatch');

    const deliverables = requireArray<BuildCodingKernelTaskContractInput['deliverables'][number]>(
      input.deliverables,
      'invalid-deliverables',
    ).map(deliverable => {
      if (!deliverable || typeof deliverable !== 'object') contractFailure('invalid-deliverable');
      const path = deliverable.path === undefined
        ? undefined
        : requireText(deliverable.path, 'invalid-deliverable-path');
      return Object.freeze({
        id: requireText(deliverable.id, 'invalid-deliverable-id'),
        kind: requireDeliverableKind(deliverable.kind),
        ...(path ? { path } : {}),
      });
    });
    const acceptance = requireArray<BuildCodingKernelTaskContractInput['acceptance'][number]>(
      input.acceptance,
      'invalid-acceptance',
    ).map(criterion => {
      if (!criterion || typeof criterion !== 'object') contractFailure('invalid-acceptance-criterion');
      return Object.freeze({
        id: requireText(criterion.id, 'invalid-acceptance-id'),
        statement: requireText(criterion.statement, 'empty-acceptance-statement'),
      });
    });
    const provenanceRefs = canonicalTextArray(input.provenanceRefs, 'invalid-provenance');

    if (!uniqueIds(deliverables)) contractFailure('invalid-deliverables');
    if (!uniqueIds(acceptance)) contractFailure('invalid-acceptance');
    if (provenanceRefs.length === 0) contractFailure('missing-provenance');

    return freezeTaskContract({
      version: CODING_KERNEL_TASK_CONTRACT_VERSION,
      goal,
      mode,
      orientation,
      scope: {
        include: canonicalTextArray(input.include ?? [], 'invalid-include-scope'),
        exclude: canonicalTextArray(input.exclude ?? [], 'invalid-exclude-scope'),
      },
      deliverables,
      constraints: canonicalTextArray(input.constraints ?? [], 'invalid-constraints'),
      acceptance,
      provenanceRefs,
    });
  }

  snapshot(contract: CodingKernelTaskContract): CodingKernelTaskContract {
    if (!contract || typeof contract !== 'object') contractFailure('invalid-shape');
    if (contract.version !== CODING_KERNEL_TASK_CONTRACT_VERSION) contractFailure('unsupported-version');
    if (!contract.scope || typeof contract.scope !== 'object') contractFailure('invalid-shape');
    return this.build({
      goal: contract.goal,
      mode: contract.mode,
      orientation: contract.orientation,
      include: contract.scope.include,
      exclude: contract.scope.exclude,
      deliverables: contract.deliverables,
      constraints: contract.constraints,
      acceptance: contract.acceptance,
      provenanceRefs: contract.provenanceRefs,
    });
  }

  project(contract: CodingKernelTaskContract): CodingTaskContractProjection {
    const snapshot = this.snapshot(contract);
    return Object.freeze({
      goal: snapshot.goal,
      mode: snapshot.mode,
      scope: snapshot.scope,
      deliverables: snapshot.deliverables,
      constraints: snapshot.constraints,
      acceptance: snapshot.acceptance,
      provenanceRefs: snapshot.provenanceRefs,
    });
  }
}

const TASK_CONTRACT = new CanonicalTaskContractService();

export function buildCodingKernelTaskContract(
  input: BuildCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  return TASK_CONTRACT.build(input);
}

export function snapshotCodingKernelTaskContract(
  contract: CodingKernelTaskContract,
): CodingKernelTaskContract {
  return TASK_CONTRACT.snapshot(contract);
}

export function projectCodingKernelTaskContract(
  contract: CodingKernelTaskContract,
): CodingTaskContractProjection {
  return TASK_CONTRACT.project(contract);
}

function freezeTaskContract(contract: CodingKernelTaskContract): CodingKernelTaskContract {
  const scope = Object.freeze({
    include: Object.freeze([...contract.scope.include]),
    exclude: Object.freeze([...contract.scope.exclude]),
  });
  return Object.freeze({
    ...contract,
    scope,
    deliverables: Object.freeze([...contract.deliverables]),
    constraints: Object.freeze([...contract.constraints]),
    acceptance: Object.freeze([...contract.acceptance]),
    provenanceRefs: Object.freeze([...contract.provenanceRefs]),
  });
}

function canonicalTextArray(value: unknown, reason: string): readonly string[] {
  const values = requireArray(value, reason).map(item => requireText(item, reason));
  return Object.freeze([...new Set(values)]);
}

function requireArray<T>(value: unknown, reason: string): readonly T[] {
  if (!Array.isArray(value)) contractFailure(reason);
  return value as readonly T[];
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string') contractFailure(reason);
  const text = value.trim();
  if (!text) contractFailure(reason);
  return text;
}

function requireMode(value: unknown): CodingTaskMode {
  if (value !== 'explain' && value !== 'review' && value !== 'change' && value !== 'release') {
    contractFailure('invalid-mode');
  }
  return value;
}

function requireDeliverableKind(value: unknown): CodingDeliverableKind {
  if (value !== 'source-change' && value !== 'report' && value !== 'verification-result') {
    contractFailure('invalid-deliverable-kind');
  }
  return value;
}

function uniqueIds(items: readonly { readonly id: string }[]): boolean {
  return items.length > 0 && new Set(items.map(item => item.id)).size === items.length;
}

function contractFailure(reason: string): never {
  throw new Error(`coding-kernel-task-contract:${reason}`);
}
