import {
  canonicalCodingJson,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';
import type { CodingVerificationReceipt } from './coding-verification';
import type {
  CodingVerifierSelectionDecision,
  CodingVerifierSelectionStep,
} from './coding-verifier-selection';

export const CODING_REGRESSION_SELECTION_VERSION = 'devseek.coding-regression-selection/v1' as const;

export type CodingRegressionStrategy = 'targeted' | 'dependent' | 'full-risk';

export interface SelectCodingRegressionInput {
  readonly sequence: number;
  readonly actionId: string;
  readonly changedPaths: readonly string[];
  readonly verifierSelection: CodingVerifierSelectionDecision;
  readonly previousVerifications: readonly CodingVerificationReceipt[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingRegressionSelectionDecision {
  readonly version: typeof CODING_REGRESSION_SELECTION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly status: 'selected' | 'unavailable';
  readonly strategy: CodingRegressionStrategy;
  readonly selectedStepIds: readonly string[];
  readonly omittedStepIds: readonly string[];
  readonly verificationSelection: CodingVerifierSelectionDecision;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface RegressionSelectionPort {
  readonly runId: string;
  select(input: SelectCodingRegressionInput): CodingRegressionSelectionDecision;
  decisions(): readonly CodingRegressionSelectionDecision[];
}

export interface RegressionSelectionServicePort {
  bind(input: { readonly runId: string }): RegressionSelectionPort;
}

/** Selects the smallest dependency-closed verifier set that preserves acceptance coverage. */
export class CanonicalRegressionSelectionService implements RegressionSelectionServicePort {
  bind(input: { readonly runId: string }): RegressionSelectionPort {
    return new CanonicalRegressionSelectionSession(
      normalizedCodingId(input.runId, 'regression-selection-run-id'),
    );
  }
}

class CanonicalRegressionSelectionSession implements RegressionSelectionPort {
  private readonly settled = new Map<string, { input: string; decision: CodingRegressionSelectionDecision }>();

  constructor(readonly runId: string) {}

  select(input: SelectCodingRegressionInput): CodingRegressionSelectionDecision {
    const snapshot = snapshotRegressionInput(input, this.runId);
    const canonicalInput = canonicalCodingJson(snapshot);
    const existing = this.settled.get(snapshot.actionId);
    if (existing) {
      if (existing.input !== canonicalInput) regressionFailure('conflicting-action-identity');
      return existing.decision;
    }
    const decision = selectRegression(snapshot, this.runId);
    this.settled.set(snapshot.actionId, { input: canonicalInput, decision });
    return decision;
  }

  decisions(): readonly CodingRegressionSelectionDecision[] {
    return Object.freeze([...this.settled.values()].map(value => value.decision));
  }
}

function selectRegression(
  input: SelectCodingRegressionInput,
  runId: string,
): CodingRegressionSelectionDecision {
  const selection = input.verifierSelection;
  const fullRisk = requiresFullRegression(input.changedPaths);
  const latestFailed = [...input.previousVerifications]
    .reverse()
    .find(receipt => receipt.status === 'failed');
  const failedCheckIds = new Set(
    latestFailed?.checks.filter(check => check.status === 'failed').map(check => check.checkId) ?? [],
  );
  const strategy: CodingRegressionStrategy = fullRisk
    ? 'full-risk'
    : failedCheckIds.size > 0
      ? 'dependent'
      : 'targeted';
  const selectedSteps = selection.status === 'selected'
    ? chooseSteps(selection.steps, input.changedPaths, failedCheckIds, strategy)
    : [];
  const coveredAcceptance = new Set(selectedSteps.flatMap(step => step.acceptanceIds));
  const requiredAcceptance = selection.acceptance
    .filter(item => item.status === 'selected')
    .map(item => item.criterionId);
  const coverageComplete = requiredAcceptance.every(id => coveredAcceptance.has(id));
  const effectiveSteps = coverageComplete ? selectedSteps : [...selection.steps];
  const status = selection.status === 'selected' && effectiveSteps.length > 0
    ? 'selected' as const
    : 'unavailable' as const;
  const selectedStepIds = effectiveSteps.map(step => step.id);
  const omittedStepIds = selection.steps
    .filter(step => !selectedStepIds.includes(step.id))
    .map(step => step.id);
  const verificationSelection = snapshotCodingValue({
    ...selection,
    status,
    steps: Object.freeze(status === 'selected' ? effectiveSteps : []),
    reasonCodes: Object.freeze(uniqueCodingRefs([
      ...selection.reasonCodes,
      `regression-selection:${strategy}`,
      ...(!coverageComplete ? ['regression-acceptance-coverage-expanded'] : []),
    ])),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...selection.evidenceRefs,
      ...input.evidenceRefs,
      ...(latestFailed ? latestFailed.evidenceRefs : []),
    ])),
  }, 'regression-verification-selection') as CodingVerifierSelectionDecision;
  return snapshotCodingValue({
    version: CODING_REGRESSION_SELECTION_VERSION,
    runId,
    sequence: input.sequence,
    actionId: input.actionId,
    status,
    strategy,
    selectedStepIds: Object.freeze(selectedStepIds),
    omittedStepIds: Object.freeze(omittedStepIds),
    verificationSelection,
    reasonCodes: Object.freeze(status === 'selected'
      ? [`regression-${strategy}-selected`]
      : ['regression-verifier-unavailable']),
    evidenceRefs: Object.freeze(uniqueCodingRefs([
      ...input.evidenceRefs,
      ...verificationSelection.evidenceRefs,
      ...selectedStepIds.map(id => `regression-step:${id}`),
    ])),
  }, 'regression-selection-decision') as CodingRegressionSelectionDecision;
}

function chooseSteps(
  steps: readonly CodingVerifierSelectionStep[],
  changedPaths: readonly string[],
  failedCheckIds: ReadonlySet<string>,
  strategy: CodingRegressionStrategy,
): CodingVerifierSelectionStep[] {
  if (strategy === 'full-risk') return [...steps];
  if (steps.every(step => step.triggerPaths === undefined && step.dependsOnStepIds === undefined)) {
    return chooseLegacyStepPrefix(steps, failedCheckIds, strategy);
  }

  const selectedIds = new Set<string>();
  for (const step of steps) {
    if (failedCheckIds.has(step.id) || stepTriggeredByChanges(step, changedPaths)) {
      selectedIds.add(step.id);
    }
  }
  if (selectedIds.size === 0) return [...steps];

  const byId = new Map(steps.map(step => [step.id, step]));
  const includeDependencies = (stepId: string): void => {
    for (const dependencyId of byId.get(stepId)?.dependsOnStepIds ?? []) {
      if (selectedIds.has(dependencyId)) continue;
      selectedIds.add(dependencyId);
      includeDependencies(dependencyId);
    }
  };
  for (const stepId of [...selectedIds]) includeDependencies(stepId);
  return steps.filter(step => selectedIds.has(step.id));
}

function chooseLegacyStepPrefix(
  steps: readonly CodingVerifierSelectionStep[],
  failedCheckIds: ReadonlySet<string>,
  strategy: CodingRegressionStrategy,
): CodingVerifierSelectionStep[] {
  if (strategy !== 'dependent' || failedCheckIds.size === 0) return [...steps];
  const lastFailedIndex = steps.reduce(
    (latest, step, index) => failedCheckIds.has(step.id) ? Math.max(latest, index) : latest,
    -1,
  );
  if (lastFailedIndex < 0) return [...steps];
  return steps.filter((step, index) => index <= lastFailedIndex || step.role === 'file-readback');
}

function stepTriggeredByChanges(
  step: CodingVerifierSelectionStep,
  changedPaths: readonly string[],
): boolean {
  if (step.triggerPaths === undefined) return true;
  return step.triggerPaths.some(trigger => (
    trigger === 'workspace'
      || changedPaths.some(changed => pathScopesOverlap(trigger, changed))
  ));
}

function pathScopesOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  const normalizedRight = right.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function requiresFullRegression(paths: readonly string[]): boolean {
  return paths.length > 8 || paths.some(path => (
    /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|Cargo\.toml|go\.mod)$/i.test(path)
    || /(?:^|\/)(?:schema|migrations?|release|ci|\.github)(?:\/|$)/i.test(path)
  ));
}

function snapshotRegressionInput(
  input: SelectCodingRegressionInput,
  runId: string,
): SelectCodingRegressionInput {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) regressionFailure('invalid-sequence');
  if (input.verifierSelection.runId !== runId) regressionFailure('verifier-selection-run-mismatch');
  if (input.previousVerifications.some(receipt => receipt.runId !== runId)) {
    regressionFailure('verification-history-run-mismatch');
  }
  return Object.freeze({
    sequence: input.sequence,
    actionId: normalizedCodingId(input.actionId, 'regression-action-id'),
    changedPaths: Object.freeze(uniqueCodingRefs(input.changedPaths)),
    verifierSelection: snapshotCodingValue(
      input.verifierSelection,
      'regression-verifier-selection',
    ) as CodingVerifierSelectionDecision,
    previousVerifications: Object.freeze(input.previousVerifications.map(receipt => (
      snapshotCodingValue(receipt, 'regression-verification-receipt') as CodingVerificationReceipt
    ))),
    evidenceRefs: Object.freeze(uniqueCodingRefs(input.evidenceRefs)),
  });
}

function regressionFailure(reason: string): never {
  throw new Error(`coding-regression-selection:${reason}`);
}
