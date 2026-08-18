import {
  codingWorkspaceTargetMatchesScope,
  normalizeCodingWorkspacePath,
} from './coding-workspace-scope';

export const CODING_CONFORMANCE_SCHEMA_VERSION = 'devseek.coding-conformance/v1';

export const CODING_CONFORMANCE_PREPARATION = Object.freeze({
  implementationState: 'cross-surface-product-projection-wired',
  productWiring: true,
  productAdapterCount: 3,
  qualificationEligible: false,
  claimsPermitted: false,
  requiredSurfaces: ['vscode', 'cli', 'headless'] as const,
});

export const CODING_CONFORMANCE_DIMENSIONS = Object.freeze([
  'taskContract',
  'toolExecutions',
  'changeReceipts',
  'verifications',
  'completion',
] as const);

export const CODING_CONFORMANCE_UNAVAILABLE_REASONS = Object.freeze([
  'route-output-not-exposed',
  'route-evidence-incomplete',
  'surface-not-implemented',
] as const);

export type CodingConformanceSurface = typeof CODING_CONFORMANCE_PREPARATION.requiredSurfaces[number];
export type CodingConformanceDimension = typeof CODING_CONFORMANCE_DIMENSIONS[number];
export type CodingTaskMode = 'explain' | 'review' | 'change' | 'release';
export type CodingTerminalStatus = 'completed' | 'failed' | 'blocked' | 'cancelled';
export type CodingReceiptStatus = 'completed' | 'failed' | 'denied';
export type CodingVerificationStatus = 'passed' | 'failed' | 'blocked' | 'not-run';
export type CodingAcceptanceStatus = 'passed' | 'failed' | 'blocked' | 'not-applicable';
export type CodingToolEffect =
  | 'read'
  | 'process'
  | 'network'
  | 'local-state'
  | 'workspace-mutation'
  | 'git'
  | 'release';
export type CodingDeliverableKind = 'source-change' | 'report' | 'verification-result';
export type CodingConformanceEvidenceClass =
  | 'fixture-self-test'
  | 'development-route-replay'
  | 'product-route';
export type CodingConformanceUnavailableReason = typeof CODING_CONFORMANCE_UNAVAILABLE_REASONS[number];
export type CodingBenchmarkBehavior =
  | 'context-scoped-contract'
  | 'structured-tool-feedback'
  | 'permission-before-effect'
  | 'workspace-receipt'
  | 'verification-before-completion'
  | 'bounded-repair'
  | 'safe-refusal-no-side-effect'
  | 'evidence-backed-settlement';

export interface CodingTaskContractProjection {
  readonly goal: string;
  readonly mode: CodingTaskMode;
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

export interface CodingToolExecutionProjection {
  readonly sequence: number;
  readonly actionId: string;
  readonly tool: string;
  readonly effects: readonly CodingToolEffect[];
  readonly status: CodingReceiptStatus;
  readonly effectStarted?: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface CodingChangeReceiptProjection {
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'committed' | 'rolled-back';
  readonly paths: readonly string[];
  readonly baselineRef: string;
  readonly readbackRef?: string;
  readonly rollbackRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingVerificationProjection {
  readonly sequence: number;
  readonly actionId: string;
  readonly verifier: string;
  readonly status: CodingVerificationStatus;
  readonly acceptanceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingCompletionProjection {
  readonly status: CodingTerminalStatus;
  readonly acceptance: readonly {
    readonly criterionId: string;
    readonly status: CodingAcceptanceStatus;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly residualRisks: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingConformanceProjection {
  readonly schemaVersion: typeof CODING_CONFORMANCE_SCHEMA_VERSION;
  readonly fixtureId: string;
  readonly taskContract: CodingTaskContractProjection;
  readonly toolExecutions: readonly CodingToolExecutionProjection[];
  readonly changeReceipts: readonly CodingChangeReceiptProjection[];
  readonly verifications: readonly CodingVerificationProjection[];
  readonly completion: CodingCompletionProjection;
}

export type CodingConformanceObservedProjection =
  Pick<CodingConformanceProjection, 'schemaVersion' | 'fixtureId'>
  & Partial<Pick<CodingConformanceProjection, CodingConformanceDimension>>;

export interface CodingConformanceFixture {
  readonly schemaVersion: typeof CODING_CONFORMANCE_SCHEMA_VERSION;
  readonly fixtureId: string;
  readonly title: string;
  readonly prompt: string;
  readonly taskContractInput?: {
    readonly modeHint?: CodingTaskMode;
    readonly verificationRequired?: boolean;
  };
  readonly requiredSurfaces: readonly CodingConformanceSurface[];
  readonly benchmark: {
    readonly competitors: readonly ['Codex', 'Claude Code'];
    readonly sourceRef: string;
    readonly observableBehaviors: readonly CodingBenchmarkBehavior[];
  };
  readonly expected: CodingConformanceProjection;
}

export interface CodingConformanceObservation {
  readonly surface: CodingConformanceSurface;
  readonly adapterId: string;
  readonly evidenceClass: CodingConformanceEvidenceClass;
  readonly sourceRefs: readonly string[];
  readonly projection: CodingConformanceObservedProjection;
  readonly unavailableDimensions: readonly {
    readonly dimension: CodingConformanceDimension;
    readonly reason: CodingConformanceUnavailableReason;
    readonly evidenceRefs: readonly string[];
  }[];
}

/**
 * A Surface adapter may only project facts already settled by the route it observes.
 * It must not infer missing receipts, execute effects, or construct a terminal decision.
 * Dimensions absent from settled route output stay absent and require an explicit
 * unavailability receipt on the returned observation.
 */
export interface CodingConformanceProjectionAdapter<TRouteOutput> {
  readonly surface: CodingConformanceSurface;
  readonly adapterId: string;
  project(input: {
    readonly fixture: CodingConformanceFixture;
    readonly routeOutput: TRouteOutput;
  }): CodingConformanceObservation;
}

export interface CodingConformanceViolation {
  readonly surface?: CodingConformanceSurface;
  readonly dimension: CodingConformanceDimension | 'fixture' | 'observation';
  readonly code: string;
}

export interface CodingConformanceSurfaceResult {
  readonly surface: CodingConformanceSurface;
  readonly contractConformant: boolean;
  readonly evidenceClass: CodingConformanceObservation['evidenceClass'] | 'missing';
  readonly observedDimensions: readonly CodingConformanceDimension[];
  readonly missingDimensions: readonly CodingConformanceDimension[];
  readonly violations: readonly CodingConformanceViolation[];
}

export interface CodingConformanceEvaluation {
  readonly schemaVersion: typeof CODING_CONFORMANCE_SCHEMA_VERSION;
  readonly fixtureId: string;
  readonly contractConformant: boolean;
  readonly productRouteEvidenceComplete: boolean;
  readonly qualificationEligible: false;
  readonly claimsPermitted: false;
  readonly surfaceResults: readonly CodingConformanceSurfaceResult[];
  readonly violations: readonly CodingConformanceViolation[];
}

export function validateCodingConformanceProjection(
  projection: CodingConformanceObservedProjection,
  surface?: CodingConformanceSurface,
): CodingConformanceViolation[] {
  if (!projection || typeof projection !== 'object') {
    return [{ surface, dimension: 'observation', code: 'invalid-projection' }];
  }

  const violations: CodingConformanceViolation[] = [];
  if (projection.schemaVersion !== CODING_CONFORMANCE_SCHEMA_VERSION) {
    violations.push({ surface, dimension: 'observation', code: 'unsupported-schema-version' });
  }
  if (!nonEmpty(projection.fixtureId)) {
    violations.push({ surface, dimension: 'observation', code: 'invalid-fixture-identity' });
  }
  for (const dimension of CODING_CONFORMANCE_DIMENSIONS) {
    if (projection[dimension] === undefined) {
      violations.push({ surface, dimension, code: 'missing-dimension' });
    }
  }

  if (isCompleteProjection(projection)) {
    try {
      violations.push(...validateProjection(projection, surface));
    } catch {
      violations.push({ surface, dimension: 'observation', code: 'invalid-projection-shape' });
    }
  }
  return uniqueViolations(violations);
}

export function compareCodingConformanceProjection(
  expected: CodingConformanceProjection,
  actual: CodingConformanceObservedProjection,
  surface?: CodingConformanceSurface,
): CodingConformanceViolation[] {
  const violations = validateCodingConformanceProjection(actual, surface);
  for (const dimension of CODING_CONFORMANCE_DIMENSIONS) {
    if (actual[dimension] === undefined) {
      continue;
    }
    const semanticallyConformant = dimension === 'taskContract'
      ? taskContractSemanticallyConforms(expected.taskContract, actual.taskContract)
      : dimension === 'completion'
        ? completionSemanticallyConforms(expected.completion, actual.completion)
        : canonicalJson(projectSemanticDimension(expected, dimension))
          === canonicalJson(projectSemanticDimension(actual, dimension));
    if (!semanticallyConformant) {
      violations.push({ surface, dimension, code: 'semantic-mismatch' });
    }
  }
  if (actual.schemaVersion !== expected.schemaVersion) {
    violations.push({ surface, dimension: 'observation', code: 'schema-version-mismatch' });
  }
  if (actual.fixtureId !== expected.fixtureId) {
    violations.push({ surface, dimension: 'observation', code: 'fixture-id-mismatch' });
  }
  return uniqueViolations(violations);
}

/**
 * A settled model proposal may narrow an abstract task contract with concrete
 * workspace evidence. It may not change the goal or widen an existing scope.
 */
function taskContractSemanticallyConforms(
  expected: CodingTaskContractProjection,
  actual: CodingTaskContractProjection | undefined,
): boolean {
  if (!actual) return false;
  if (expected.goal !== actual.goal || expected.mode !== actual.mode) return false;
  if (!stringSetIncludes(actual.constraints, expected.constraints)) return false;
  if (!identifiedSetIncludes(actual.acceptance, expected.acceptance)) return false;
  if ((expected.provenanceRefs.length > 0) !== (actual.provenanceRefs.length > 0)) return false;
  if (!scopeSemanticallyNarrows(expected.scope, actual.scope)) return false;
  return deliverablesSemanticallyNarrow(expected.deliverables, actual.deliverables, actual.scope.include);
}

function stringSetIncludes(actual: readonly string[], expected: readonly string[]): boolean {
  const actualValues = new Set(actual);
  return expected.every(value => actualValues.has(value));
}

function identifiedSetIncludes<T extends { readonly id: string }>(
  actual: readonly T[],
  expected: readonly T[],
): boolean {
  const actualById = new Map(actual.map(value => [value.id, value]));
  return expected.every(value => canonicalJson(actualById.get(value.id)) === canonicalJson(value));
}

function completionSemanticallyConforms(
  expected: CodingCompletionProjection,
  actual: CodingCompletionProjection | undefined,
): boolean {
  if (!actual || expected.status !== actual.status) return false;
  if (canonicalJson([...expected.residualRisks].sort()) !== canonicalJson([...actual.residualRisks].sort())) {
    return false;
  }
  if ((expected.evidenceRefs.length > 0) !== (actual.evidenceRefs.length > 0)) return false;
  const actualAcceptance = new Map(actual.acceptance.map(criterion => [criterion.criterionId, criterion]));
  return expected.acceptance.every(criterion => {
    const candidate = actualAcceptance.get(criterion.criterionId);
    return candidate?.status === criterion.status
      && (criterion.evidenceRefs.length > 0) === (candidate.evidenceRefs.length > 0);
  });
}

function scopeSemanticallyNarrows(
  expected: CodingTaskContractProjection['scope'],
  actual: CodingTaskContractProjection['scope'],
): boolean {
  if (expected.include.length > 0) {
    if (actual.include.length === 0) return false;
    const targetOutsideScope = actual.include.some(target => !expected.include.some(scope => (
      codingWorkspaceTargetMatchesScope(target, scope)
    )));
    if (targetOutsideScope) return false;
  }
  const actualExcludes = new Set(actual.exclude.map(normalizeCodingWorkspacePath));
  return expected.exclude.every(path => actualExcludes.has(normalizeCodingWorkspacePath(path)));
}

function deliverablesSemanticallyNarrow(
  expected: CodingTaskContractProjection['deliverables'],
  actual: CodingTaskContractProjection['deliverables'],
  actualScope: readonly string[],
): boolean {
  if (expected.length !== actual.length) return false;
  const actualById = new Map(actual.map(deliverable => [deliverable.id, deliverable]));
  return expected.every(deliverable => {
    const candidate = actualById.get(deliverable.id);
    if (!candidate || candidate.kind !== deliverable.kind) return false;
    if (deliverable.path) {
      return normalizeCodingWorkspacePath(candidate.path ?? '')
        === normalizeCodingWorkspacePath(deliverable.path);
    }
    if (!candidate.path) return true;
    return actualScope.some(scope => codingWorkspaceTargetMatchesScope(candidate.path ?? '', scope));
  });
}

function projectSemanticDimension(
  projection: CodingConformanceObservedProjection,
  dimension: CodingConformanceDimension,
): unknown {
  switch (dimension) {
    case 'taskContract': {
      const taskContract = projection.taskContract;
      return taskContract && {
        ...taskContract,
        provenanceRefs: taskContract.provenanceRefs.length > 0,
      };
    }
    case 'toolExecutions':
      return semanticToolExecutions(projection.toolExecutions ?? []);
    case 'changeReceipts': {
      const actionRoles = semanticActionRoles(projection.toolExecutions ?? []);
      return (projection.changeReceipts ?? []).map((receipt, index) => ({
        sequence: index + 1,
        actionRole: actionRoles.get(receipt.actionId) ?? 'unowned-action',
        status: receipt.status,
        paths: receipt.paths,
        baselineEvidence: Boolean(receipt.baselineRef),
        readbackEvidence: Boolean(receipt.readbackRef),
        ...(receipt.status === 'rolled-back' ? { rollbackEvidence: Boolean(receipt.rollbackRef) } : {}),
        settledEvidence: receipt.evidenceRefs.length > 0,
      }));
    }
    case 'verifications': {
      const actionRoles = semanticActionRoles(projection.toolExecutions ?? []);
      return coreVerifications(projection.verifications ?? []).map((verification, index) => ({
        sequence: index + 1,
        actionRole: actionRoles.get(verification.actionId) ?? 'unowned-action',
        status: verification.status,
        verifierEvidence: Boolean(verification.verifier),
        settledEvidence: verification.evidenceRefs.length > 0,
      }));
    }
    case 'completion': {
      const completion = projection.completion;
      return completion && {
        status: completion.status,
        acceptance: completion.acceptance.map(criterion => ({
          criterionId: criterion.criterionId,
          status: criterion.status,
          settledEvidence: criterion.evidenceRefs.length > 0,
        })),
        residualRisks: [...completion.residualRisks].sort(),
        settledEvidence: completion.evidenceRefs.length > 0,
      };
    }
  }
}

function semanticToolExecutions(
  receipts: readonly CodingToolExecutionProjection[],
): unknown[] {
  return coreToolExecutions(receipts).map((receipt, index) => ({
    sequence: index + 1,
    actionRole: `effect-${index + 1}`,
    effects: [...receipt.effects].sort(),
    status: receipt.status,
    settledEvidence: receipt.evidenceRefs.length > 0,
  }));
}

function semanticActionRoles(
  receipts: readonly CodingToolExecutionProjection[],
): Map<string, string> {
  return new Map(coreToolExecutions(receipts).map((receipt, index) => [
    receipt.actionId,
    `effect-${index + 1}`,
  ]));
}

function coreToolExecutions(
  receipts: readonly CodingToolExecutionProjection[],
): CodingToolExecutionProjection[] {
  return effectfulToolExecutions(receipts).filter(receipt => !isAuxiliaryHostValidationTool(receipt));
}

function coreVerifications(
  verifications: readonly CodingVerificationProjection[],
): CodingVerificationProjection[] {
  return verifications.filter(verification => !isAuxiliaryHostValidationVerification(verification));
}

function effectfulToolExecutions(
  receipts: readonly CodingToolExecutionProjection[],
): CodingToolExecutionProjection[] {
  return receipts.filter(receipt => receipt.effects.some(effect => effect !== 'read'));
}

function isAuxiliaryHostValidationTool(receipt: CodingToolExecutionProjection): boolean {
  return receipt.tool === 'run_terminal'
    && receipt.evidenceRefs.some(ref => ref.startsWith('vscode-host-validation:'));
}

function isAuxiliaryHostValidationVerification(verification: CodingVerificationProjection): boolean {
  return verification.evidenceRefs.some(ref => (
    ref.startsWith('build-orchestration:auto-validation-')
    || ref.startsWith('vscode-host-validation:')
  ));
}

export function evaluateCodingConformanceFixture(
  fixture: CodingConformanceFixture,
  observations: readonly CodingConformanceObservation[],
): CodingConformanceEvaluation {
  const violations = validateFixture(fixture);
  const observationsBySurface = new Map<CodingConformanceSurface, CodingConformanceObservation>();

  for (const observation of observations) {
    if (!fixture.requiredSurfaces.includes(observation.surface)) {
      violations.push({ surface: observation.surface, dimension: 'observation', code: 'unexpected-surface' });
      continue;
    }
    if (observationsBySurface.has(observation.surface)) {
      violations.push({ surface: observation.surface, dimension: 'observation', code: 'duplicate-surface' });
      continue;
    }
    observationsBySurface.set(observation.surface, observation);
  }

  const surfaceResults = fixture.requiredSurfaces.map(surface => {
    const observation = observationsBySurface.get(surface);
    if (!observation) {
      const missing: CodingConformanceViolation = { surface, dimension: 'observation', code: 'missing-surface' };
      violations.push(missing);
      return {
        surface,
        contractConformant: false,
        evidenceClass: 'missing' as const,
        observedDimensions: [],
        missingDimensions: CODING_CONFORMANCE_DIMENSIONS,
        violations: [missing],
      };
    }

    const surfaceViolations = compareCodingConformanceProjection(fixture.expected, observation.projection, surface);
    const observedDimensions = observedProjectionDimensions(observation.projection);
    const missingDimensions = CODING_CONFORMANCE_DIMENSIONS.filter(
      dimension => !observedDimensions.includes(dimension),
    );
    surfaceViolations.push(...validateUnavailableDimensions(observation, missingDimensions));
    if (!nonEmpty(observation.adapterId)) {
      surfaceViolations.push({ surface, dimension: 'observation', code: 'missing-adapter-id' });
    }
    if (!hasNonEmptyStrings(observation.sourceRefs)) {
      surfaceViolations.push({ surface, dimension: 'observation', code: 'missing-source-refs' });
    }
    violations.push(...surfaceViolations);
    return {
      surface,
      contractConformant: surfaceViolations.length === 0,
      evidenceClass: observation.evidenceClass,
      observedDimensions,
      missingDimensions,
      violations: surfaceViolations,
    };
  });

  const deduplicated = uniqueViolations(violations);
  const contractConformant = deduplicated.length === 0;
  const productRouteEvidenceComplete = contractConformant
    && Number(CODING_CONFORMANCE_PREPARATION.productAdapterCount) === fixture.requiredSurfaces.length
    && surfaceResults.every(result => result.evidenceClass === 'product-route');

  return {
    schemaVersion: CODING_CONFORMANCE_SCHEMA_VERSION,
    fixtureId: fixture.fixtureId,
    contractConformant,
    productRouteEvidenceComplete,
    qualificationEligible: false,
    claimsPermitted: false,
    surfaceResults,
    violations: deduplicated,
  };
}

function validateFixture(fixture: CodingConformanceFixture): CodingConformanceViolation[] {
  const violations: CodingConformanceViolation[] = [];
  if (fixture.schemaVersion !== CODING_CONFORMANCE_SCHEMA_VERSION) {
    violations.push({ dimension: 'fixture', code: 'unsupported-schema-version' });
  }
  if (!nonEmpty(fixture.fixtureId) || fixture.expected.fixtureId !== fixture.fixtureId) {
    violations.push({ dimension: 'fixture', code: 'invalid-fixture-identity' });
  }
  if (canonicalJson(fixture.requiredSurfaces) !== canonicalJson(CODING_CONFORMANCE_PREPARATION.requiredSurfaces)) {
    violations.push({ dimension: 'fixture', code: 'required-surface-set-mismatch' });
  }
  if (fixture.benchmark.competitors[0] !== 'Codex' || fixture.benchmark.competitors[1] !== 'Claude Code') {
    violations.push({ dimension: 'fixture', code: 'benchmark-competitors-mismatch' });
  }
  if (!nonEmpty(fixture.benchmark.sourceRef) || fixture.benchmark.observableBehaviors.length === 0) {
    violations.push({ dimension: 'fixture', code: 'missing-benchmark-basis' });
  }
  violations.push(...validateProjection(fixture.expected));
  return uniqueViolations(violations);
}

function validateUnavailableDimensions(
  observation: CodingConformanceObservation,
  missingDimensions: readonly CodingConformanceDimension[],
): CodingConformanceViolation[] {
  const violations: CodingConformanceViolation[] = [];
  const unavailableByDimension = new Map<CodingConformanceDimension, number>();

  for (const unavailable of observation.unavailableDimensions ?? []) {
    unavailableByDimension.set(
      unavailable.dimension,
      (unavailableByDimension.get(unavailable.dimension) ?? 0) + 1,
    );
    if (!missingDimensions.includes(unavailable.dimension)) {
      violations.push({
        surface: observation.surface,
        dimension: unavailable.dimension,
        code: 'unavailability-for-observed-dimension',
      });
    }
    if (!hasNonEmptyStrings(unavailable.evidenceRefs)) {
      violations.push({
        surface: observation.surface,
        dimension: unavailable.dimension,
        code: 'missing-unavailability-evidence',
      });
    }
    if (!CODING_CONFORMANCE_UNAVAILABLE_REASONS.includes(unavailable.reason)) {
      violations.push({
        surface: observation.surface,
        dimension: unavailable.dimension,
        code: 'invalid-unavailability-reason',
      });
    }
  }

  for (const dimension of missingDimensions) {
    const receiptCount = unavailableByDimension.get(dimension) ?? 0;
    if (receiptCount === 0) {
      violations.push({ surface: observation.surface, dimension, code: 'unexplained-missing-dimension' });
    } else if (receiptCount > 1) {
      violations.push({ surface: observation.surface, dimension, code: 'duplicate-unavailability-receipt' });
    }
  }
  return uniqueViolations(violations);
}

function validateProjection(
  projection: CodingConformanceProjection,
  surface?: CodingConformanceSurface,
): CodingConformanceViolation[] {
  const violations: CodingConformanceViolation[] = [];
  const criterionIds = projection.taskContract.acceptance.map(criterion => criterion.id);
  const toolActionIdList = projection.toolExecutions.map(receipt => receipt.actionId);
  const toolExecutionsByActionId = new Map(
    projection.toolExecutions.map(receipt => [receipt.actionId, receipt] as const),
  );

  if (!nonEmpty(projection.taskContract.goal) || !hasNonEmptyStrings(projection.taskContract.provenanceRefs)) {
    violations.push({ surface, dimension: 'taskContract', code: 'missing-goal-or-provenance' });
  }
  if (!uniqueNonEmpty(criterionIds) || criterionIds.length === 0) {
    violations.push({ surface, dimension: 'taskContract', code: 'invalid-acceptance-ids' });
  }
  if (!uniqueNonEmpty(projection.taskContract.deliverables.map(deliverable => deliverable.id))) {
    violations.push({ surface, dimension: 'taskContract', code: 'invalid-deliverable-ids' });
  }

  for (const receipt of projection.toolExecutions) {
    if (!nonEmpty(receipt.actionId) || !nonEmpty(receipt.tool) || receipt.effects.length === 0 || !hasNonEmptyStrings(receipt.evidenceRefs)) {
      violations.push({ surface, dimension: 'toolExecutions', code: 'incomplete-tool-receipt' });
    }
    if (receipt.effectStarted !== undefined
      && (receipt.status !== 'failed' || typeof receipt.effectStarted !== 'boolean')) {
      violations.push({ surface, dimension: 'toolExecutions', code: 'invalid-tool-effect-state' });
    }
  }
  if (new Set(toolActionIdList).size !== toolActionIdList.length) {
    violations.push({ surface, dimension: 'toolExecutions', code: 'duplicate-action-id' });
  }
  if (!strictlyIncreasing(projection.toolExecutions.map(receipt => receipt.sequence))) {
    violations.push({ surface, dimension: 'toolExecutions', code: 'invalid-sequence' });
  }

  for (const receipt of projection.changeReceipts) {
    const toolExecution = toolExecutionsByActionId.get(receipt.actionId);
    if (!toolExecution
      || !uniqueNonEmpty(receipt.paths)
      || !nonEmpty(receipt.baselineRef)
      || !hasNonEmptyStrings(receipt.evidenceRefs)
      || (receipt.status === 'committed' && !nonEmpty(receipt.readbackRef))
      || (receipt.status === 'rolled-back' && !nonEmpty(receipt.rollbackRef))) {
      violations.push({ surface, dimension: 'changeReceipts', code: 'incomplete-change-receipt' });
    }
    if (toolExecution && !toolExecution.effects.includes('workspace-mutation')) {
      violations.push({ surface, dimension: 'changeReceipts', code: 'change-action-not-mutation' });
    }
    if (receipt.status === 'committed' && toolExecution?.status !== 'completed') {
      violations.push({ surface, dimension: 'changeReceipts', code: 'committed-change-action-not-completed' });
    }
  }
  if (!strictlyIncreasing(projection.changeReceipts.map(receipt => receipt.sequence))) {
    violations.push({ surface, dimension: 'changeReceipts', code: 'invalid-sequence' });
  }

  for (const verification of projection.verifications) {
    if (!toolExecutionsByActionId.has(verification.actionId)
      || !nonEmpty(verification.verifier)
      || !hasNonEmptyStrings(verification.acceptanceIds)
      || !verification.acceptanceIds.every(id => criterionIds.includes(id))
      || !hasNonEmptyStrings(verification.evidenceRefs)) {
      violations.push({ surface, dimension: 'verifications', code: 'incomplete-verification-receipt' });
    }
  }
  if (!strictlyIncreasing(projection.verifications.map(verification => verification.sequence))) {
    violations.push({ surface, dimension: 'verifications', code: 'invalid-sequence' });
  }

  const completionCriteria = projection.completion.acceptance.map(criterion => criterion.criterionId);
  if (!sameStringSet(criterionIds, completionCriteria)
    || !projection.completion.acceptance.every(criterion => hasNonEmptyStrings(criterion.evidenceRefs))
    || !hasNonEmptyStrings(projection.completion.evidenceRefs)) {
    violations.push({ surface, dimension: 'completion', code: 'incomplete-acceptance-evidence' });
  }
  if (projection.completion.status === 'completed'
    && projection.completion.acceptance.some(criterion => !['passed', 'not-applicable'].includes(criterion.status))) {
    violations.push({ surface, dimension: 'completion', code: 'completed-with-unsettled-acceptance' });
  }
  return uniqueViolations(violations);
}

function strictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => Number.isInteger(value) && value > 0 && (index === 0 || value > values[index - 1]));
}

function isCompleteProjection(
  projection: CodingConformanceObservedProjection,
): projection is CodingConformanceProjection {
  return CODING_CONFORMANCE_DIMENSIONS.every(dimension => projection[dimension] !== undefined);
}

function observedProjectionDimensions(
  projection: CodingConformanceObservedProjection,
): CodingConformanceDimension[] {
  return CODING_CONFORMANCE_DIMENSIONS.filter(dimension => projection[dimension] !== undefined);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return uniqueNonEmpty(left)
    && uniqueNonEmpty(right)
    && canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function uniqueNonEmpty(values: readonly string[]): boolean {
  return hasNonEmptyStrings(values) && new Set(values).size === values.length;
}

function hasNonEmptyStrings(values: readonly string[]): boolean {
  return values.length > 0 && values.every(nonEmpty);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortObjectKeys(child)]),
  );
}

function uniqueViolations(violations: readonly CodingConformanceViolation[]): CodingConformanceViolation[] {
  const seen = new Set<string>();
  return violations.filter(violation => {
    const key = `${violation.surface ?? ''}:${violation.dimension}:${violation.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
