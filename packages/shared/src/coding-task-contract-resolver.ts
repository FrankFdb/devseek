import type { CodingCompletionAcceptanceCriterion } from './coding-completion';
import {
  buildCodingKernelTaskContract,
  type CodingKernelSurface,
  type CodingKernelTaskContract,
} from './coding-kernel';
import type { CodingDeliverableKind, CodingTaskMode } from './coding-conformance';
import type {
  CodingTaskAcceptanceCriterion,
  CodingTaskExternalBoundary,
} from './coding-task-contract';
import { resolveCodingOrientationDecision } from './coding-orientation';
import {
  buildSecretHarvestingRefusalTaskContract,
  isUnsafeSecretHarvestingImplementationRequest,
} from './coding-safety-policy';

export interface ResolveCodingKernelTaskContractInput {
  /** Raw user goal. It is retained for the model and audit, not locally classified. */
  readonly prompt: string;
  readonly surface: CodingKernelSurface;
  readonly contextFiles?: readonly string[];
  readonly targetPaths?: readonly string[];
  readonly targetPathsAuthoritative?: boolean;
  readonly excludedTargetPaths?: readonly string[];
  readonly strictTargetScope?: boolean;
  readonly modeHint?: CodingTaskMode;
  readonly verificationRequired?: boolean;
  readonly verificationRequirementAuthoritative?: boolean;
  readonly deliverableKinds?: readonly CodingDeliverableKind[];
  readonly confirmedWorkspaceMutation?: boolean;
  readonly dependencyEffect?: boolean;
  readonly networkEffect?: boolean;
  readonly noDependencies?: boolean;
  readonly subjectiveAcceptance?: boolean;
  readonly externalBoundaries?: readonly CodingTaskExternalBoundary[];
  /** Typed semantic arbitration supplied by a model/Surface boundary. */
  readonly externalEffectIntent?: 'none' | 'question' | 'requested';
}

/**
 * Builds a Kernel contract exclusively from typed semantic fields. Prompt text
 * cannot create scope, effects, deliverables, or acceptance obligations. The
 * only local natural-language inspection is the fail-closed safety policy.
 */
export function resolveCodingKernelTaskContract(
  input: ResolveCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const prompt = normalizePrompt(input.prompt);
  const orientation = resolveCodingOrientationDecision({
    prompt,
    modeHint: input.modeHint,
    confirmedWorkspaceMutation: input.confirmedWorkspaceMutation,
  });
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) {
    return buildSecretHarvestingRefusalTaskContract(input.surface, orientation);
  }

  const dependencyEffect = input.dependencyEffect === true;
  const mode = orientation.mode;
  const mutating = dependencyEffect || (
    (mode === 'change' || mode === 'release')
      && input.confirmedWorkspaceMutation !== false
  );
  const networkEffect = dependencyEffect || input.networkEffect === true;
  const externalEffectRequested = orientation.externalEffectRequested
    || input.externalEffectIntent === 'requested'
    || dependencyEffect
    || networkEffect;
  const suppliedTargets = uniquePaths(input.targetPaths ?? []);
  const excludedScope = uniquePaths(input.excludedTargetPaths ?? []);
  const authoritativeTargets = input.targetPathsAuthoritative !== false
    ? suppliedTargets.filter(path => !workspacePathIsExcluded(path, excludedScope))
    : [];
  const include = mutating
    ? authoritativeTargets
    : uniquePaths([...suppliedTargets, ...(input.contextFiles ?? [])]);
  const scopedChange = mutating && input.strictTargetScope === true;
  const deliverableKinds = uniqueDeliverableKinds(input.deliverableKinds ?? []);
  const reportDeliverableRequested = deliverableKinds.includes('report');
  const sourceChangeDeliverableRequested = deliverableKinds.includes('source-change');
  const verificationRequired = input.verificationRequirementAuthoritative === true
    ? input.verificationRequired === true
    : input.verificationRequired ?? (mode === 'change');
  const deliverables = resolveDeliverables({
    mutating,
    dependencyEffect,
    verificationRequired,
    declaredTargets: authoritativeTargets,
    reportDeliverableRequested,
    sourceChangeDeliverableRequested,
  });
  const externalBoundaries = resolveExternalBoundaries({
    declared: input.externalBoundaries ?? [],
    dependencyEffect,
    networkEffect,
    externalEffectRequested,
  });
  const acceptance = resolveAcceptance({
    mutating,
    externalEffectRequested,
    scopedChange,
    verificationRequired,
    weakAcceptance: input.subjectiveAcceptance === true,
    deliverableIds: deliverables.map(deliverable => deliverable.id),
    externalBoundaryIds: externalBoundaries.map(boundary => boundary.id),
  });

  return buildCodingKernelTaskContract({
    goal: prompt,
    mode,
    orientation,
    include,
    exclude: mutating ? excludedScope : [],
    deliverables,
    constraints: resolveConstraints({
      mutating,
      dependencyEffect,
      networkEffect,
      externalEffectRequested,
      scopedChange,
      verificationRequired,
      noDependencies: input.noDependencies === true,
    }),
    nonGoals: resolveNonGoals({
      mutating,
      scopedChange,
      noDependencies: input.noDependencies === true,
    }),
    externalBoundaries,
    acceptance,
    provenanceRefs: ['user-goal', 'typed-semantic-contract', `surface:${input.surface}`],
  });
}

export function resolveCodingKernelAcceptance(
  input: Omit<ResolveCodingKernelTaskContractInput, 'surface'>,
): CodingCompletionAcceptanceCriterion[] {
  return [...resolveCodingKernelTaskContract({ ...input, surface: 'headless' }).acceptance];
}

function resolveDeliverables(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly verificationRequired: boolean;
  readonly declaredTargets: readonly string[];
  readonly reportDeliverableRequested: boolean;
  readonly sourceChangeDeliverableRequested: boolean;
}): Array<{ id: string; kind: 'source-change' | 'report' | 'verification-result'; path?: string }> {
  if (!input.mutating) {
    return [
      { id: 'response', kind: 'report' },
      ...(input.verificationRequired
        ? [{ id: 'verification-result', kind: 'verification-result' as const }]
        : []),
    ];
  }
  const targets = input.dependencyEffect
    ? ['package.json']
    : input.declaredTargets.filter(isConcreteWorkspacePath);
  const mutationDeliverables = input.dependencyEffect
    ? [{ id: 'dependency-change', kind: 'source-change' as const, path: 'package.json' }]
    : targets.length === 0
      ? [{
          id: input.reportDeliverableRequested && !input.sourceChangeDeliverableRequested
            ? 'report'
            : 'source-change',
          kind: input.reportDeliverableRequested && !input.sourceChangeDeliverableRequested
            ? 'report' as const
            : 'source-change' as const,
        }]
      : buildTargetDeliverables({
          targets,
          reportDeliverableRequested: input.reportDeliverableRequested,
          sourceChangeDeliverableRequested: input.sourceChangeDeliverableRequested,
        });
  return [
    ...mutationDeliverables,
    ...(input.verificationRequired
      ? [{ id: 'verification-result', kind: 'verification-result' as const }]
      : []),
  ];
}

function buildTargetDeliverables(input: {
  readonly targets: readonly string[];
  readonly reportDeliverableRequested: boolean;
  readonly sourceChangeDeliverableRequested: boolean;
}): Array<{ id: string; kind: 'source-change' | 'report'; path: string }> {
  let sourceCount = 0;
  let reportCount = 0;
  const reportOnlyTargets = input.reportDeliverableRequested
    && !input.sourceChangeDeliverableRequested
    && input.targets.every(isReportArtifactPath);
  return input.targets.map(path => {
    const report = reportOnlyTargets
      || (input.reportDeliverableRequested && isReportArtifactPath(path));
    if (report) {
      reportCount++;
      return {
        id: reportCount === 1 ? 'report' : `report:${reportCount}`,
        kind: 'report' as const,
        path,
      };
    }
    sourceCount++;
    return {
      id: sourceCount === 1 ? 'source-change' : `source-change:${sourceCount}`,
      kind: 'source-change' as const,
      path,
    };
  });
}

function workspacePathIsExcluded(path: string, excludedScope: readonly string[]): boolean {
  const normalized = path.replace(/^\.\//u, '').replace(/\/+$/u, '');
  return excludedScope.some(rawPattern => {
    const pattern = rawPattern.replace(/^\.\//u, '').replace(/\/+$/u, '');
    if (pattern.endsWith('/**')) {
      const directory = pattern.slice(0, -3).replace(/\/+$/u, '');
      return normalized === directory || normalized.startsWith(`${directory}/`);
    }
    return normalized === pattern;
  });
}

function resolveConstraints(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly networkEffect: boolean;
  readonly externalEffectRequested: boolean;
  readonly scopedChange: boolean;
  readonly verificationRequired: boolean;
  readonly noDependencies: boolean;
}): string[] {
  return uniqueStrings([
    input.mutating ? 'workspace-root-only' : 'no-workspace-mutation',
    ...(input.externalEffectRequested ? ['external-effect-requires-approval'] : []),
    ...(input.dependencyEffect ? ['dependency-change-requires-approval'] : []),
    ...(input.networkEffect ? ['network-requires-approval'] : []),
    ...(input.scopedChange ? ['no-other-files'] : []),
    ...(input.noDependencies ? ['no-dependencies'] : []),
    ...(input.verificationRequired ? ['verification-before-completion'] : []),
  ]);
}

function resolveAcceptance(input: {
  readonly mutating: boolean;
  readonly externalEffectRequested: boolean;
  readonly scopedChange: boolean;
  readonly verificationRequired: boolean;
  readonly weakAcceptance: boolean;
  readonly deliverableIds: readonly string[];
  readonly externalBoundaryIds: readonly string[];
}): CodingTaskAcceptanceCriterion[] {
  const externallyGroundedEvidenceKinds = (
    values: CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'],
  ): CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'] => [
    ...values,
    ...(input.externalBoundaryIds.length > 0 ? ['source-citation' as const] : []),
  ];
  const criteria: CodingTaskAcceptanceCriterion[] = input.mutating
    ? [{
        id: 'requested-outcome',
        statement: 'The requested workspace outcome is applied and read back.',
        deliverableIds: input.deliverableIds,
        oracle: acceptanceOracle('workspace-readback', 'workspace-mutation-readback', ['workspace'], externallyGroundedEvidenceKinds([
          'workspace-mutation-receipt',
          'workspace-readback',
        ])),
        externalBoundaryRefs: input.externalBoundaryIds,
      }]
    : [{
        id: 'grounded-response',
        statement: 'The response addresses the request without unauthorized effects.',
        deliverableIds: input.deliverableIds,
        oracle: acceptanceOracle('response-evidence', 'grounded-response-review', ['response'], externallyGroundedEvidenceKinds([
          'response-evidence',
        ])),
        externalBoundaryRefs: input.externalBoundaryIds,
      }];
  if (input.externalEffectRequested) {
    criteria.push({
      id: 'authority',
      statement: 'No external effect occurs without a concrete local authority receipt.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('authority', 'kernel-tool-authority', ['external-effect'], [
        'authority-receipt',
      ]),
      externalBoundaryRefs: [],
    });
  }
  if (input.scopedChange) {
    criteria.push({
      id: 'scoped-change',
      statement: 'Workspace changes remain inside the requested file scope.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('workspace-readback', 'change-set-scope', ['workspace'], [
        'workspace-mutation-receipt',
        'workspace-readback',
      ]),
      externalBoundaryRefs: [],
    });
  }
  if (input.verificationRequired) {
    criteria.push({
      id: 'verified',
      statement: 'Applicable verification passes before completion.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('verification', 'project-verification', ['workspace'], [
        'verification-receipt',
      ]),
      externalBoundaryRefs: [],
    });
  }
  if (input.weakAcceptance) {
    criteria.push({
      id: 'subjective-quality',
      statement: 'The requested subjective quality must be replaced by an executable acceptance oracle.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('subjective', 'user-impression', ['workspace'], []),
      externalBoundaryRefs: [],
    });
  }
  return criteria;
}

function resolveNonGoals(input: {
  readonly mutating: boolean;
  readonly scopedChange: boolean;
  readonly noDependencies: boolean;
}): string[] {
  if (!input.mutating) return ['workspace-mutation'];
  return [
    'unrequested-workspace-effects',
    ...(input.scopedChange ? ['modify-files-outside-requested-scope'] : []),
    ...(input.noDependencies ? ['introduce-new-dependencies'] : []),
  ];
}

function resolveExternalBoundaries(input: {
  readonly declared: readonly CodingTaskExternalBoundary[];
  readonly dependencyEffect: boolean;
  readonly networkEffect: boolean;
  readonly externalEffectRequested: boolean;
}): CodingTaskExternalBoundary[] {
  const boundaries = input.declared.map(boundary => ({ ...boundary }));
  if (input.dependencyEffect && !boundaries.some(boundary => boundary.id === 'external-data-source')) {
    boundaries.push({
      id: 'external-data-source',
      kind: 'data-source',
      subject: 'package registry metadata',
      sourceRef: 'typed-effect:dependency',
    });
  } else if (input.networkEffect && !boundaries.some(boundary => boundary.id === 'external-data-source')) {
    boundaries.push({
      id: 'external-data-source',
      kind: 'data-source',
      subject: 'model-proposed network source',
      sourceRef: 'typed-effect:network',
    });
  } else if (input.externalEffectRequested && boundaries.length === 0) {
    boundaries.push({
      id: 'external-effect',
      kind: 'deployment',
      subject: 'model-proposed external effect',
      sourceRef: 'typed-effect:external',
    });
  }
  const seen = new Set<string>();
  return boundaries.filter(boundary => {
    if (seen.has(boundary.id)) return false;
    seen.add(boundary.id);
    return true;
  });
}

function acceptanceOracle(
  kind: CodingTaskAcceptanceCriterion['oracle']['kind'],
  verifier: string,
  scope: readonly string[],
  evidenceKinds: CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'],
): CodingTaskAcceptanceCriterion['oracle'] {
  return { kind, verifier, scope, evidenceKinds };
}

function normalizePrompt(prompt: string): string {
  const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('coding-task-contract:missing-prompt');
  return normalized;
}

function normalizeWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/')) return '';
  return normalized;
}

function isConcreteWorkspacePath(path: string): boolean {
  return !path.includes('*') && !path.includes('?');
}

function isReportArtifactPath(path: string): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(path)
    || /(?:^|\/)(?:docs?|reports?)(?:\/|$)/iu.test(path);
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeWorkspacePath).filter(Boolean))];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueDeliverableKinds(values: readonly CodingDeliverableKind[]): CodingDeliverableKind[] {
  return [...new Set(values.filter(value => (
    value === 'source-change' || value === 'report' || value === 'verification-result'
  )))];
}
