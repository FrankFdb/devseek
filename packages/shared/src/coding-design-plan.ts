import type { CodingToolEffect } from './coding-conformance';
import type { CodingContextGraph } from './coding-context-graph';
import type { CodingRequirementDecision } from './coding-requirements';
import { codingSemanticDigest } from './coding-semantic-digest';
import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import {
  codingWorkspaceTargetMatchesScope,
  normalizeCodingWorkspacePath,
} from './coding-workspace-scope';

export const CODING_DESIGN_DECISION_VERSION = 'devseek.coding-design-decision/v1' as const;
export const CODING_CHANGE_PLAN_VERSION = 'devseek.coding-change-plan/v1' as const;

export type CodingImpactKind = 'primary' | 'caller' | 'generated' | 'schema' | 'release';

export interface CodingDesignImpact {
  readonly id: string;
  readonly kind: CodingImpactKind;
  readonly target: string;
  readonly owner: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingImpactAssessment {
  readonly status: 'assessed' | 'not-applicable' | 'unresolved';
  readonly rationale: string;
  readonly impacts: readonly CodingDesignImpact[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingDesignAlternative {
  readonly id: string;
  readonly summary: string;
  readonly selected: boolean;
  readonly tradeoffs: readonly string[];
  readonly semanticOwner: string;
  readonly failureModes: readonly string[];
  readonly ports: readonly string[];
  readonly nonGoals: readonly string[];
}

export interface CodingDesignPlanSection {
  readonly status: 'planned' | 'not-applicable' | 'unresolved';
  readonly rationale: string;
  readonly steps: readonly {
    readonly target: string;
    readonly action: string;
    readonly evidenceRefs: readonly string[];
  }[];
}

export interface CodingDesignAcceptanceMapping {
  readonly acceptanceId: string;
  readonly impactIds: readonly string[];
  readonly verifier: string;
  readonly evidenceKinds: readonly string[];
}

export interface CodingDependencyDirectionCheck {
  readonly from: string;
  readonly to: string;
  readonly status: 'allowed' | 'violation';
  readonly evidenceRef: string;
}

export interface CodingDesignEvidence {
  readonly impacts?: readonly CodingDesignImpact[];
  readonly dependencyChecks?: readonly CodingDependencyDirectionCheck[];
  readonly migration?: CodingDesignPlanSection;
  readonly deletion?: CodingDesignPlanSection;
  readonly rollback?: CodingDesignPlanSection;
  readonly evidenceRefs?: readonly string[];
}

export interface CodingDesignDecision {
  readonly version: typeof CODING_DESIGN_DECISION_VERSION;
  readonly status: 'ready' | 'clarification-required' | 'exploration-required';
  readonly requirementRevisionId: string;
  readonly alternatives: readonly CodingDesignAlternative[];
  readonly selectedAlternativeId: string;
  readonly impactSet: Readonly<Record<CodingImpactKind, CodingImpactAssessment>>;
  readonly migration: CodingDesignPlanSection;
  readonly deletion: CodingDesignPlanSection;
  readonly rollback: CodingDesignPlanSection;
  readonly acceptanceMapping: readonly CodingDesignAcceptanceMapping[];
  readonly dependencyChecks: readonly CodingDependencyDirectionCheck[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly decisionSha256: string;
}

export interface CodingChangePlanStep {
  readonly id: string;
  readonly action: 'respond' | 'modify' | 'verify' | 'release';
  readonly target: string;
  readonly dependsOn: readonly string[];
  readonly effects: readonly CodingToolEffect[];
  readonly acceptanceIds: readonly string[];
  readonly evidenceRequirements: readonly string[];
}

export interface CodingChangePlan {
  readonly version: typeof CODING_CHANGE_PLAN_VERSION;
  readonly status: 'ready' | 'blocked';
  readonly planId: string;
  readonly parentPlanId?: string;
  readonly revisionReason: string;
  readonly requirementRevisionId: string;
  readonly designDecisionSha256: string;
  readonly steps: readonly CodingChangePlanStep[];
  /** Exact deliverable paths that must be changed before the plan is complete. */
  readonly requiredTargets: readonly string[];
  /** Workspace paths the model may choose to change while implementing the task. */
  readonly authorizedTargets: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly planSha256: string;
}

export interface CodingPlanEffectDecision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface DesignDecisionPort {
  decide(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly requirements: CodingRequirementDecision;
    readonly evidence?: CodingDesignEvidence;
  }): CodingDesignDecision;
}

export interface ChangePlanPort {
  create(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly requirements: CodingRequirementDecision;
    readonly design: CodingDesignDecision;
  }): CodingChangePlan;
  revise(input: {
    readonly previousPlan: CodingChangePlan;
    readonly taskContract: CodingKernelTaskContract;
    readonly requirements: CodingRequirementDecision;
    readonly design: CodingDesignDecision;
    readonly revisionReason: string;
    readonly newEvidenceRefs: readonly string[];
  }): CodingChangePlan;
}

/** Produces a read-only architecture decision from requirements and grounded context. */
export class CanonicalDesignDecisionService implements DesignDecisionPort {
  decide(input: Parameters<DesignDecisionPort['decide']>[0]): CodingDesignDecision {
    if (!input || typeof input !== 'object') designFailure('invalid-input');
    const contract = snapshotCodingKernelTaskContract(input.taskContract);
    assertRequirementBinding(contract, input.contextGraph, input.requirements);
    const targets = resolveImplementationTargets(contract);
    const suppliedImpacts = snapshotImpacts(input.evidence?.impacts ?? []);
    const primaryImpacts = uniqueImpacts([
      ...targets.map((target, index) => impact(
        `primary:${index + 1}`,
        'primary',
        target,
        'task-declared-semantic-owner',
        ['task-contract:current'],
      )),
      ...suppliedImpacts.filter(item => item.kind === 'primary'),
    ]);
    const impactSet = buildImpactSet(contract, primaryImpacts, suppliedImpacts);
    const dependencyChecks = snapshotDependencyChecks(input.evidence?.dependencyChecks ?? []);
    const alternatives = buildAlternatives(contract);
    const migration = snapshotPlanSection(
      input.evidence?.migration ?? notApplicableSection('No migration deliverable was declared.'),
      'migration',
    );
    const deletion = snapshotPlanSection(
      input.evidence?.deletion ?? notApplicableSection('No deletion deliverable was declared.'),
      'deletion',
    );
    const rollback = snapshotPlanSection(
      input.evidence?.rollback ?? defaultRollback(contract, targets),
      'rollback',
    );
    const acceptanceMapping = input.requirements.acceptance.criteria.map(criterion => Object.freeze({
      acceptanceId: criterion.id,
      impactIds: Object.freeze(primaryImpacts.map(item => item.id)),
      verifier: criterion.oracle.verifier,
      evidenceKinds: Object.freeze([...criterion.oracle.evidenceKinds]),
    }));
    const reasonCodes = unique([
      ...(input.requirements.status === 'ready' ? [] : [`requirements-${input.requirements.status}`]),
      ...Object.entries(impactSet).flatMap(([kind, assessment]) => (
        assessment.status === 'unresolved' ? [`impact-unresolved:${kind}`] : []
      )),
      ...dependencyChecks
        .filter(check => check.status === 'violation')
        .map(check => `dependency-direction-violation:${check.from}->${check.to}`),
      ...(rollback.status === 'unresolved' ? ['rollback-unresolved'] : []),
      ...(acceptanceMapping.some(mapping => mapping.impactIds.length === 0 && contract.mode !== 'explain' && contract.mode !== 'review')
        ? ['acceptance-impact-mapping-missing']
        : []),
    ]);
    const status = input.requirements.status === 'clarification-required'
      || dependencyChecks.some(check => check.status === 'violation')
      ? 'clarification-required' as const
      : input.requirements.status !== 'ready'
        || reasonCodes.some(reason => reason.startsWith('impact-unresolved:')
          || reason === 'rollback-unresolved'
          || reason === 'acceptance-impact-mapping-missing')
        ? 'exploration-required' as const
        : 'ready' as const;
    const payload = {
      version: CODING_DESIGN_DECISION_VERSION,
      status,
      requirementRevisionId: input.requirements.revisionId,
      alternatives: Object.freeze(alternatives),
      selectedAlternativeId: alternatives.find(alternative => alternative.selected)!.id,
      impactSet,
      migration,
      deletion,
      rollback,
      acceptanceMapping: Object.freeze(acceptanceMapping),
      dependencyChecks: Object.freeze(dependencyChecks),
      reasonCodes: Object.freeze(reasonCodes),
      evidenceRefs: Object.freeze(unique([
        input.requirements.decisionSha256,
        ...primaryImpacts.flatMap(item => item.evidenceRefs),
        ...dependencyChecks.map(check => check.evidenceRef),
        ...(input.evidence?.evidenceRefs ?? []),
      ])),
    };
    return Object.freeze({ ...payload, decisionSha256: codingSemanticDigest(payload) });
  }
}

/** Converts an accepted design into the only effect-authorizing change plan. */
export class CanonicalChangePlanService implements ChangePlanPort {
  create(input: Parameters<ChangePlanPort['create']>[0]): CodingChangePlan {
    return this.build(input, undefined, 'initial-plan', []);
  }

  revise(input: Parameters<ChangePlanPort['revise']>[0]): CodingChangePlan {
    assertChangePlan(input.previousPlan);
    const revisionReason = String(input.revisionReason ?? '').trim();
    const newEvidenceRefs = unique(input.newEvidenceRefs ?? []);
    if (!revisionReason) designFailure('missing-plan-revision-reason');
    if (newEvidenceRefs.length === 0) designFailure('missing-plan-revision-evidence');
    const designEvidence = new Set(input.design.evidenceRefs);
    if (newEvidenceRefs.some(ref => !designEvidence.has(ref))) {
      designFailure('unbound-plan-revision-evidence');
    }
    return this.build(input, input.previousPlan, revisionReason, newEvidenceRefs);
  }

  private build(
    input: {
      readonly taskContract: CodingKernelTaskContract;
      readonly requirements: CodingRequirementDecision;
      readonly design: CodingDesignDecision;
    },
    previousPlan: CodingChangePlan | undefined,
    revisionReason: string,
    newEvidenceRefs: readonly string[],
  ): CodingChangePlan {
    const contract = snapshotCodingKernelTaskContract(input.taskContract);
    assertRequirementBinding(contract, undefined, input.requirements);
    if (input.design.requirementRevisionId !== input.requirements.revisionId) {
      designFailure('design-requirement-revision-mismatch');
    }
    const authorizedTargets = unique([
      ...resolveImplementationTargets(contract),
      ...input.design.impactSet.primary.impacts.map(item => item.target),
    ].map(normalizeCodingWorkspacePath));
    const requiredTargets = resolveRequiredImplementationTargets(contract);
    const mutationSteps = authorizedTargets.map((target, index) => Object.freeze({
      id: `change:${index + 1}`,
      action: 'modify' as const,
      target,
      dependsOn: Object.freeze([]),
      effects: Object.freeze(['workspace-mutation' as const]),
      acceptanceIds: Object.freeze(contract.acceptance.map(criterion => criterion.id)),
      evidenceRequirements: Object.freeze(['workspace-mutation-receipt', 'workspace-readback']),
    }));
    const mutationIds = mutationSteps.map(step => step.id);
    const steps: CodingChangePlanStep[] = contract.mode === 'explain' || contract.mode === 'review'
      ? [Object.freeze({
          id: 'response:1',
          action: 'respond' as const,
          target: 'response',
          dependsOn: Object.freeze([]),
          effects: Object.freeze(['read' as const]),
          acceptanceIds: Object.freeze(contract.acceptance.map(criterion => criterion.id)),
          evidenceRequirements: Object.freeze(['response-evidence']),
        })]
      : [
          ...mutationSteps,
          ...(contract.acceptance.some(criterion => criterion.oracle.kind === 'verification')
            ? [Object.freeze({
                id: 'verify:1',
                action: 'verify' as const,
                target: 'workspace',
                dependsOn: Object.freeze(mutationIds),
                effects: Object.freeze(['process' as const]),
                acceptanceIds: Object.freeze(contract.acceptance
                  .filter(criterion => criterion.oracle.kind === 'verification')
                  .map(criterion => criterion.id)),
                evidenceRequirements: Object.freeze(['verification-receipt']),
              })]
            : []),
          ...(contract.mode === 'release'
            ? [Object.freeze({
                id: 'release:1',
                action: 'release' as const,
                target: 'release',
                dependsOn: Object.freeze([...mutationIds, ...(contract.acceptance.some(criterion => criterion.oracle.kind === 'verification') ? ['verify:1'] : [])]),
                effects: Object.freeze(['git' as const, 'release' as const]),
                acceptanceIds: Object.freeze(contract.acceptance.map(criterion => criterion.id)),
                evidenceRequirements: Object.freeze(['authority-receipt', 'verification-receipt']),
              })]
            : []),
        ];
    const reasonCodes = unique([
      ...(input.design.status === 'ready' ? [] : [`design-${input.design.status}`]),
      ...(contract.mode !== 'explain' && contract.mode !== 'review' && authorizedTargets.length === 0
        ? ['missing-change-target']
        : []),
    ]);
    const status = reasonCodes.length === 0 ? 'ready' as const : 'blocked' as const;
    const semanticPayload = {
      version: CODING_CHANGE_PLAN_VERSION,
      status,
      requirementRevisionId: input.requirements.revisionId,
      designDecisionSha256: input.design.decisionSha256,
      steps: Object.freeze(steps),
      requiredTargets: Object.freeze(requiredTargets),
      authorizedTargets: Object.freeze(authorizedTargets),
      reasonCodes: Object.freeze(reasonCodes),
      evidenceRefs: Object.freeze(unique([
        input.requirements.decisionSha256,
        input.design.decisionSha256,
        ...newEvidenceRefs,
      ])),
    };
    const planSha256 = codingSemanticDigest(semanticPayload);
    if (previousPlan?.planSha256 === planSha256) return previousPlan;
    return Object.freeze({
      ...semanticPayload,
      planId: `change-plan-${planSha256.slice(0, 24)}`,
      ...(previousPlan ? { parentPlanId: previousPlan.planId } : {}),
      revisionReason,
      planSha256,
    });
  }
}

export function evaluateCodingChangePlanEffect(
  plan: CodingChangePlan,
  input: {
    readonly effects: readonly CodingToolEffect[];
    readonly targetPaths: readonly string[];
  },
): CodingPlanEffectDecision {
  assertChangePlan(plan);
  const guarded = input.effects.some(effect => (
    effect === 'workspace-mutation' || effect === 'git' || effect === 'release'
  ));
  if (!guarded) return effectDecision('allow', 'change-plan-does-not-guard-read-only-effect', [plan.planId]);
  if (plan.status !== 'ready') {
    return effectDecision('deny', `change-plan-${plan.status}`, [plan.planId, ...plan.reasonCodes]);
  }
  const authorizedEffects = new Set(plan.steps.flatMap(step => step.effects));
  const unauthorizedEffect = input.effects.find(effect => (
    (effect === 'workspace-mutation' || effect === 'git' || effect === 'release')
    && !authorizedEffects.has(effect)
  ));
  if (unauthorizedEffect) {
    return effectDecision(
      'deny',
      `change-plan-effect-not-authorized:${unauthorizedEffect}`,
      [plan.planId],
    );
  }
  if (input.effects.includes('workspace-mutation')) {
    const targets = unique(input.targetPaths.map(normalizeCodingWorkspacePath));
    if (targets.length === 0) return effectDecision('deny', 'change-plan-target-required', [plan.planId]);
    const authorized = plan.authorizedTargets.map(normalizeCodingWorkspacePath);
    const outside = targets.find(target => !authorized.some(scope => (
      codingWorkspaceTargetMatchesScope(target, scope)
    )));
    if (outside) return effectDecision('deny', `change-plan-target-outside-scope:${outside}`, [plan.planId]);
  }
  return effectDecision('allow', 'change-plan-authorizes-effect', [plan.planId, plan.planSha256]);
}

export function renderCodingChangePlanSummary(plan: CodingChangePlan): string {
  assertChangePlan(plan);
  return [
    '[DevSeek Change Plan]',
    `status: ${plan.status}`,
    `plan: ${plan.planId}`,
    `targets: ${plan.authorizedTargets.join(', ') || 'none'}`,
    `steps: ${plan.steps.map(step => `${step.id}:${step.action}:${step.target}`).join(' | ') || 'none'}`,
    `blocking reasons: ${plan.reasonCodes.join(', ') || 'none'}`,
  ].join('\n');
}

function buildImpactSet(
  contract: CodingKernelTaskContract,
  primary: readonly CodingDesignImpact[],
  supplied: readonly CodingDesignImpact[],
): Readonly<Record<CodingImpactKind, CodingImpactAssessment>> {
  const readOnly = contract.mode === 'explain' || contract.mode === 'review';
  const assessment = (kind: CodingImpactKind, fallbackRationale: string): CodingImpactAssessment => {
    const impacts = kind === 'primary'
      ? primary
      : supplied.filter(item => item.kind === kind);
    if (impacts.length > 0) {
      return Object.freeze({
        status: 'assessed',
        rationale: impacts === primary ? 'Task-declared implementation scope.' : 'Evidence-supplied impact scope.',
        impacts: Object.freeze([...impacts]),
        evidenceRefs: Object.freeze(unique(impacts.flatMap(item => item.evidenceRefs))),
      });
    }
    if (readOnly || kind !== 'primary') {
      return Object.freeze({
        status: 'not-applicable',
        rationale: fallbackRationale,
        impacts: Object.freeze([]),
        evidenceRefs: Object.freeze(['task-contract:current']),
      });
    }
    return Object.freeze({
      status: 'unresolved',
      rationale: 'A mutating task requires an exact implementation target before execution.',
      impacts: Object.freeze([]),
      evidenceRefs: Object.freeze([]),
    });
  };
  return Object.freeze({
    primary: assessment('primary', 'Read-only tasks have no implementation impact.'),
    caller: assessment('caller', 'No caller change was declared by the task or supplied evidence.'),
    generated: assessment('generated', 'No generated artifact change was declared.'),
    schema: assessment('schema', 'No schema migration was declared.'),
    release: contract.mode === 'release'
      ? Object.freeze({
          status: 'assessed' as const,
          rationale: 'Release mode makes delivery impact applicable.',
          impacts: Object.freeze([impact('release:1', 'release', 'release', 'release-owner', ['task-contract:current'])]),
          evidenceRefs: Object.freeze(['task-contract:current']),
        })
      : assessment('release', 'The task is not a release operation.'),
  });
}

function buildAlternatives(contract: CodingKernelTaskContract): CodingDesignAlternative[] {
  return [
    Object.freeze({
      id: 'semantic-owner-change',
      summary: 'Change the smallest coherent semantic owner and reuse shared ports.',
      selected: true,
      tradeoffs: Object.freeze(['Requires evidence for every affected boundary before widening scope.']),
      semanticOwner: 'task-declared-semantic-owner',
      failureModes: Object.freeze(['unresolved-impact', 'verification-failure', 'rollback-failure']),
      ports: Object.freeze(['RequirementDecisionPort', 'DesignDecisionPort', 'ChangePlanPort']),
      nonGoals: Object.freeze([...contract.nonGoals]),
    }),
    Object.freeze({
      id: 'surface-local-patch',
      summary: 'Patch one Surface without changing the shared semantic owner.',
      selected: false,
      tradeoffs: Object.freeze(['Rejected because it creates divergent behavior and duplicate judgment.']),
      semanticOwner: 'surface-local',
      failureModes: Object.freeze(['cross-surface-divergence']),
      ports: Object.freeze([]),
      nonGoals: Object.freeze(['parallel-semantic-owner']),
    }),
  ];
}

function resolveImplementationTargets(contract: CodingKernelTaskContract): string[] {
  const deliverableTargets = resolveRequiredImplementationTargets(contract);
  const scopedTargets = contract.scope.include.filter(path => !path.includes('*') && !path.includes('?'));
  return unique([...deliverableTargets, ...scopedTargets].map(normalizeCodingWorkspacePath));
}

function resolveRequiredImplementationTargets(contract: CodingKernelTaskContract): string[] {
  return unique(contract.deliverables.flatMap(deliverable => (
    deliverable.kind === 'source-change' && deliverable.path ? [deliverable.path] : []
  )).map(normalizeCodingWorkspacePath));
}

function defaultRollback(
  contract: CodingKernelTaskContract,
  targets: readonly string[],
): CodingDesignPlanSection {
  if (contract.mode === 'explain' || contract.mode === 'review') {
    return notApplicableSection('Read-only tasks produce no workspace state to roll back.');
  }
  if (targets.length === 0) {
    return { status: 'unresolved', rationale: 'Rollback cannot bind before change targets are known.', steps: [] };
  }
  return {
    status: 'planned',
    rationale: 'Restore each mutation through its baseline-bound workspace receipt.',
    steps: targets.map(target => ({
      target,
      action: 'restore-baseline-receipt',
      evidenceRefs: ['workspace-mutation-transaction'],
    })),
  };
}

function notApplicableSection(rationale: string): CodingDesignPlanSection {
  return { status: 'not-applicable', rationale, steps: [] };
}

function snapshotPlanSection(section: CodingDesignPlanSection, label: string): CodingDesignPlanSection {
  if (!section || !['planned', 'not-applicable', 'unresolved'].includes(section.status)) {
    designFailure(`invalid-${label}-section`);
  }
  const rationale = String(section.rationale ?? '').trim();
  if (!rationale) designFailure(`missing-${label}-rationale`);
  const steps = (section.steps ?? []).map(step => Object.freeze({
    target: requiredText(step.target, `${label}-target`),
    action: requiredText(step.action, `${label}-action`),
    evidenceRefs: Object.freeze(unique(step.evidenceRefs ?? [])),
  }));
  if (section.status === 'planned'
    && (steps.length === 0 || steps.some(step => step.evidenceRefs.length === 0))) {
    designFailure(`invalid-${label}-evidence`);
  }
  return Object.freeze({ status: section.status, rationale, steps: Object.freeze(steps) });
}

function snapshotImpacts(impacts: readonly CodingDesignImpact[]): CodingDesignImpact[] {
  return impacts.map(item => impact(
    requiredText(item.id, 'impact-id'),
    requireImpactKind(item.kind),
    requiredText(item.target, 'impact-target'),
    requiredText(item.owner, 'impact-owner'),
    item.evidenceRefs,
  ));
}

function snapshotDependencyChecks(
  checks: readonly CodingDependencyDirectionCheck[],
): CodingDependencyDirectionCheck[] {
  return checks.map(check => Object.freeze({
    from: requiredText(check.from, 'dependency-from'),
    to: requiredText(check.to, 'dependency-to'),
    status: check.status === 'allowed' ? 'allowed' as const : check.status === 'violation'
      ? 'violation' as const : designFailure('invalid-dependency-status'),
    evidenceRef: requiredText(check.evidenceRef, 'dependency-evidence'),
  }));
}

function impact(
  id: string,
  kind: CodingImpactKind,
  target: string,
  owner: string,
  evidenceRefs: readonly string[],
): CodingDesignImpact {
  const refs = unique(evidenceRefs);
  if (refs.length === 0) designFailure('missing-impact-evidence');
  return Object.freeze({ id, kind, target, owner, evidenceRefs: Object.freeze(refs) });
}

function uniqueImpacts(impacts: readonly CodingDesignImpact[]): CodingDesignImpact[] {
  const byId = new Map<string, CodingDesignImpact>();
  for (const item of impacts) {
    const existing = byId.get(item.id);
    if (existing && codingSemanticDigest(existing) !== codingSemanticDigest(item)) {
      designFailure(`conflicting-impact-id:${item.id}`);
    }
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function assertRequirementBinding(
  contract: CodingKernelTaskContract,
  contextGraph: CodingContextGraph | undefined,
  requirements: CodingRequirementDecision,
): void {
  if (!requirements || requirements.taskContractSha256 !== codingSemanticDigest(contract)) {
    designFailure('requirement-task-contract-mismatch');
  }
  if (contextGraph && requirements.contextGraphSha256 !== codingSemanticDigest(contextGraph)) {
    designFailure('requirement-context-graph-mismatch');
  }
}

function assertChangePlan(plan: CodingChangePlan): void {
  if (!plan || plan.version !== CODING_CHANGE_PLAN_VERSION) designFailure('invalid-change-plan');
}

function effectDecision(
  decision: CodingPlanEffectDecision['decision'],
  reason: string,
  evidenceRefs: readonly string[],
): CodingPlanEffectDecision {
  return Object.freeze({ decision, reason, evidenceRefs: Object.freeze(unique(evidenceRefs)) });
}

function requireImpactKind(value: unknown): CodingImpactKind {
  const kinds: readonly CodingImpactKind[] = ['primary', 'caller', 'generated', 'schema', 'release'];
  if (!kinds.includes(value as CodingImpactKind)) designFailure('invalid-impact-kind');
  return value as CodingImpactKind;
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) designFailure(`missing-${label}`);
  return text;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

function designFailure(reason: string): never {
  throw new Error(`coding-design-plan:${reason}`);
}
