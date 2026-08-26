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

export const CODING_KERNEL_TASK_CONTRACT_VERSION = 'devseek.coding-kernel-task-contract/v2' as const;

export type CodingAcceptanceOracleKind =
  | 'response-evidence'
  | 'workspace-readback'
  | 'verification'
  | 'authority'
  | 'subjective';

export type CodingAcceptanceEvidenceKind =
  | 'response-evidence'
  | 'workspace-mutation-receipt'
  | 'workspace-readback'
  | 'verification-receipt'
  | 'authority-receipt'
  | 'source-citation';

export interface CodingAcceptanceOracle {
  readonly kind: CodingAcceptanceOracleKind;
  readonly verifier: string;
  readonly scope: readonly string[];
  readonly evidenceKinds: readonly CodingAcceptanceEvidenceKind[];
}

export interface CodingTaskAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly deliverableIds: readonly string[];
  readonly oracle: CodingAcceptanceOracle;
  readonly externalBoundaryRefs: readonly string[];
}

export type CodingExternalBoundaryKind = 'api-version' | 'license' | 'deployment' | 'data-source';

export interface CodingTaskExternalBoundary {
  readonly id: string;
  readonly kind: CodingExternalBoundaryKind;
  readonly subject: string;
  readonly sourceRef?: string;
}

export interface CodingTaskAssumption {
  readonly id: string;
  readonly statement: string;
  readonly status: 'confirmed' | 'unconfirmed';
  readonly sourceRefs: readonly string[];
}

export interface CodingTaskConflict {
  readonly id: string;
  readonly statement: string;
  readonly sourceRefs: readonly string[];
}

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
  readonly nonGoals: readonly string[];
  readonly assumptions: readonly CodingTaskAssumption[];
  readonly conflicts: readonly CodingTaskConflict[];
  readonly externalBoundaries: readonly CodingTaskExternalBoundary[];
  readonly acceptance: readonly CodingTaskAcceptanceCriterion[];
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
  readonly nonGoals?: readonly string[];
  readonly assumptions?: readonly CodingTaskAssumption[];
  readonly conflicts?: readonly CodingTaskConflict[];
  readonly externalBoundaries?: readonly CodingTaskExternalBoundary[];
  readonly acceptance: readonly CodingTaskAcceptanceCriterion[];
  readonly provenanceRefs: readonly string[];
}

export interface TaskContractPort {
  build(input: BuildCodingKernelTaskContractInput): CodingKernelTaskContract;
  snapshot(contract: CodingKernelTaskContract): CodingKernelTaskContract;
  project(contract: CodingKernelTaskContract): CodingTaskContractProjection;
}

export function codingTaskContractRequiresVerification(
  contract: Pick<CodingKernelTaskContract, 'acceptance'>,
): boolean {
  return contract.acceptance.some(criterion => criterion.oracle.kind === 'verification');
}

export function codingTaskContractRequiresWorkspaceMutation(
  contract: Pick<CodingKernelTaskContract, 'mode' | 'constraints' | 'deliverables'>,
): boolean {
  return (contract.mode === 'change' || contract.mode === 'release')
    && !contract.constraints.includes('no-workspace-mutation')
    && contract.deliverables.some(deliverable => (
      deliverable.kind === 'source-change' || Boolean(deliverable.path)
    ));
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
      const oracle = requireAcceptanceOracle(criterion.oracle);
      return Object.freeze({
        id: requireText(criterion.id, 'invalid-acceptance-id'),
        statement: requireText(criterion.statement, 'empty-acceptance-statement'),
        deliverableIds: canonicalTextArray(criterion.deliverableIds, 'invalid-acceptance-deliverables'),
        oracle,
        externalBoundaryRefs: canonicalTextArray(
          criterion.externalBoundaryRefs,
          'invalid-acceptance-external-boundaries',
        ),
      });
    });
    const assumptions = requireArray<CodingTaskAssumption>(
      input.assumptions ?? [],
      'invalid-assumptions',
    ).map(assumption => Object.freeze({
      id: requireText(assumption.id, 'invalid-assumption-id'),
      statement: requireText(assumption.statement, 'invalid-assumption-statement'),
      status: requireAssumptionStatus(assumption.status),
      sourceRefs: canonicalTextArray(assumption.sourceRefs, 'invalid-assumption-source'),
    }));
    const conflicts = requireArray<CodingTaskConflict>(
      input.conflicts ?? [],
      'invalid-conflicts',
    ).map(conflict => Object.freeze({
      id: requireText(conflict.id, 'invalid-conflict-id'),
      statement: requireText(conflict.statement, 'invalid-conflict-statement'),
      sourceRefs: canonicalTextArray(conflict.sourceRefs, 'invalid-conflict-source'),
    }));
    const externalBoundaries = requireArray<CodingTaskExternalBoundary>(
      input.externalBoundaries ?? [],
      'invalid-external-boundaries',
    ).map(boundary => Object.freeze({
      id: requireText(boundary.id, 'invalid-external-boundary-id'),
      kind: requireExternalBoundaryKind(boundary.kind),
      subject: requireText(boundary.subject, 'invalid-external-boundary-subject'),
      ...(boundary.sourceRef === undefined
        ? {}
        : { sourceRef: requireText(boundary.sourceRef, 'invalid-external-boundary-source') }),
    }));
    const provenanceRefs = canonicalTextArray(input.provenanceRefs, 'invalid-provenance');

    if (!uniqueIds(deliverables)) contractFailure('invalid-deliverables');
    if (!uniqueIds(acceptance)) contractFailure('invalid-acceptance');
    if (!noDuplicateIds(assumptions)) contractFailure('invalid-assumptions');
    if (!noDuplicateIds(conflicts)) contractFailure('invalid-conflicts');
    if (!noDuplicateIds(externalBoundaries)) contractFailure('invalid-external-boundaries');
    if (provenanceRefs.length === 0) contractFailure('missing-provenance');
    assertAcceptanceBindings(deliverables, acceptance, externalBoundaries);

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
      nonGoals: canonicalTextArray(input.nonGoals ?? [], 'invalid-non-goals'),
      assumptions,
      conflicts,
      externalBoundaries,
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
      nonGoals: contract.nonGoals,
      assumptions: contract.assumptions,
      conflicts: contract.conflicts,
      externalBoundaries: contract.externalBoundaries,
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
      acceptance: Object.freeze(snapshot.acceptance.map(criterion => Object.freeze({
        id: criterion.id,
        statement: criterion.statement,
      }))),
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
    nonGoals: Object.freeze([...contract.nonGoals]),
    assumptions: Object.freeze([...contract.assumptions]),
    conflicts: Object.freeze([...contract.conflicts]),
    externalBoundaries: Object.freeze([...contract.externalBoundaries]),
    acceptance: Object.freeze([...contract.acceptance]),
    provenanceRefs: Object.freeze([...contract.provenanceRefs]),
  });
}

function requireAcceptanceOracle(value: unknown): CodingAcceptanceOracle {
  if (!value || typeof value !== 'object') contractFailure('missing-acceptance-oracle');
  const oracle = value as Partial<CodingAcceptanceOracle>;
  const kinds: readonly CodingAcceptanceOracleKind[] = [
    'response-evidence',
    'workspace-readback',
    'verification',
    'authority',
    'subjective',
  ];
  if (!kinds.includes(oracle.kind as CodingAcceptanceOracleKind)) {
    contractFailure('invalid-acceptance-oracle-kind');
  }
  const evidenceKinds = requireArray<CodingAcceptanceEvidenceKind>(
    oracle.evidenceKinds,
    'invalid-acceptance-evidence-kinds',
  );
  const validEvidenceKinds: readonly CodingAcceptanceEvidenceKind[] = [
    'response-evidence',
    'workspace-mutation-receipt',
    'workspace-readback',
    'verification-receipt',
    'authority-receipt',
    'source-citation',
  ];
  if (evidenceKinds.some(kind => !validEvidenceKinds.includes(kind))) {
    contractFailure('invalid-acceptance-evidence-kind');
  }
  if (oracle.kind !== 'subjective' && evidenceKinds.length === 0) {
    contractFailure('missing-acceptance-evidence-kind');
  }
  const scope = canonicalTextArray(oracle.scope, 'invalid-acceptance-scope');
  if (oracle.kind !== 'subjective' && scope.length === 0) {
    contractFailure('missing-acceptance-scope');
  }
  const requiredEvidenceKind = requiredOracleEvidenceKind(oracle.kind as CodingAcceptanceOracleKind);
  if (requiredEvidenceKind && !evidenceKinds.includes(requiredEvidenceKind)) {
    contractFailure(`acceptance-oracle-evidence-mismatch:${oracle.kind}`);
  }
  return Object.freeze({
    kind: oracle.kind as CodingAcceptanceOracleKind,
    verifier: requireText(oracle.verifier, 'invalid-acceptance-verifier'),
    scope,
    evidenceKinds: Object.freeze([...new Set(evidenceKinds)]),
  });
}

function assertAcceptanceBindings(
  deliverables: readonly { readonly id: string }[],
  acceptance: readonly CodingTaskAcceptanceCriterion[],
  externalBoundaries: readonly CodingTaskExternalBoundary[],
): void {
  const deliverableIds = new Set(deliverables.map(deliverable => deliverable.id));
  const boundaryIds = new Set(externalBoundaries.map(boundary => boundary.id));
  for (const criterion of acceptance) {
    if (criterion.deliverableIds.length === 0
      || criterion.deliverableIds.some(id => !deliverableIds.has(id))) {
      contractFailure(`invalid-acceptance-deliverable-ref:${criterion.id}`);
    }
    if (criterion.externalBoundaryRefs.some(id => !boundaryIds.has(id))) {
      contractFailure(`invalid-acceptance-boundary-ref:${criterion.id}`);
    }
    if (criterion.externalBoundaryRefs.length > 0
      && !criterion.oracle.evidenceKinds.includes('source-citation')) {
      contractFailure(`missing-acceptance-source-citation:${criterion.id}`);
    }
  }
  for (const deliverable of deliverables) {
    if (!acceptance.some(criterion => criterion.deliverableIds.includes(deliverable.id))) {
      contractFailure(`missing-deliverable-acceptance:${deliverable.id}`);
    }
  }
}

function requiredOracleEvidenceKind(
  kind: CodingAcceptanceOracleKind,
): CodingAcceptanceEvidenceKind | undefined {
  switch (kind) {
    case 'response-evidence': return 'response-evidence';
    case 'workspace-readback': return 'workspace-readback';
    case 'verification': return 'verification-receipt';
    case 'authority': return 'authority-receipt';
    case 'subjective': return undefined;
  }
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

function requireAssumptionStatus(value: unknown): CodingTaskAssumption['status'] {
  if (value !== 'confirmed' && value !== 'unconfirmed') contractFailure('invalid-assumption-status');
  return value;
}

function requireExternalBoundaryKind(value: unknown): CodingExternalBoundaryKind {
  const kinds: readonly CodingExternalBoundaryKind[] = ['api-version', 'license', 'deployment', 'data-source'];
  if (!kinds.includes(value as CodingExternalBoundaryKind)) {
    contractFailure('invalid-external-boundary-kind');
  }
  return value as CodingExternalBoundaryKind;
}

function uniqueIds(items: readonly { readonly id: string }[]): boolean {
  return items.length > 0 && new Set(items.map(item => item.id)).size === items.length;
}

function noDuplicateIds(items: readonly { readonly id: string }[]): boolean {
  return new Set(items.map(item => item.id)).size === items.length;
}

function contractFailure(reason: string): never {
  throw new Error(`coding-kernel-task-contract:${reason}`);
}
