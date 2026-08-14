import {
  CanonicalChangePlanService,
  CanonicalDesignDecisionService,
  evaluateCodingChangePlanEffect,
  type ChangePlanPort,
  type CodingChangePlan,
  type CodingDesignDecision,
  type CodingDesignImpact,
  type DesignDecisionPort,
} from './coding-design-plan';
import {
  CanonicalContextGraphService,
  type CodingContextGraph,
  type CodingContextSeed,
  type ContextGraphPort,
} from './coding-context-graph';
import {
  CanonicalRequirementDecisionService,
  type CodingRequirementDecision,
  type RequirementDecisionPort,
} from './coding-requirements';
import { codingSemanticDigest } from './coding-semantic-digest';
import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from './coding-task-contract';
import type { CodingTaskContractSourcePort } from './coding-task-contract-revision';
import {
  codingWorkspaceTargetMatchesScope,
  projectCodingWorkspaceTargets,
} from './coding-workspace-scope';

export const CODING_CHANGE_PLAN_REVISION_DECISION_VERSION = 'devseek.coding-change-plan-revision-decision/v1' as const;

export interface CodingChangePlanRevisionDecision {
  readonly version: typeof CODING_CHANGE_PLAN_REVISION_DECISION_VERSION;
  readonly status: 'unchanged' | 'revised' | 'denied';
  readonly actionId: string;
  readonly reason: string;
  readonly targetPaths: readonly string[];
  readonly planId: string;
  readonly evidenceRefs: readonly string[];
  readonly decisionSha256: string;
}

export interface CodingChangePlanSourcePort {
  currentPlan(): CodingChangePlan;
}

export interface CodingChangePlanRevisionSessionPort extends CodingChangePlanSourcePort {
  currentContextGraph(): CodingContextGraph;
  currentRequirements(): CodingRequirementDecision;
  currentDesign(): CodingDesignDecision;
  reconcile(input: { readonly actionId: string }): CodingChangePlanRevisionDecision;
  ensureTargets(input: {
    readonly actionId: string;
    readonly targetPaths: readonly string[];
  }): CodingChangePlanRevisionDecision;
  decisions(): readonly CodingChangePlanRevisionDecision[];
  designHistory(): readonly CodingDesignDecision[];
  planHistory(): readonly CodingChangePlan[];
}

export interface ChangePlanRevisionPort {
  bind(input: {
    readonly workspaceRoot: string;
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly requirements: CodingRequirementDecision;
    readonly design: CodingDesignDecision;
    readonly plan: CodingChangePlan;
    readonly contextSeed?: CodingContextSeed;
    readonly taskContractSource?: CodingTaskContractSourcePort;
  }): CodingChangePlanRevisionSessionPort;
}

/** Owns evidence-bound target discovery between provider output and tool authority. */
export class CanonicalChangePlanRevisionService implements ChangePlanRevisionPort {
  constructor(
    private readonly designs: DesignDecisionPort = new CanonicalDesignDecisionService(),
    private readonly plans: ChangePlanPort = new CanonicalChangePlanService(),
    private readonly contexts: ContextGraphPort = new CanonicalContextGraphService(),
    private readonly requirements: RequirementDecisionPort = new CanonicalRequirementDecisionService(),
  ) {}

  bind(input: Parameters<ChangePlanRevisionPort['bind']>[0]): CodingChangePlanRevisionSessionPort {
    const workspaceRoot = requireText(input.workspaceRoot, 'workspace-root');
    const taskContract = snapshotCodingKernelTaskContract(input.taskContract);
    const designHistory: CodingDesignDecision[] = [input.design];
    const planHistory: CodingChangePlan[] = [input.plan];
    const decisions: CodingChangePlanRevisionDecision[] = [];
    let currentContextGraph = input.contextGraph;
    let currentRequirements = input.requirements;
    let currentDesign = input.design;
    let currentPlan = input.plan;

    const reconcileTaskContract = (actionId: string): CodingChangePlanRevisionDecision | undefined => {
      const currentTaskContract = input.taskContractSource?.current() ?? taskContract;
      const contractSha256 = codingSemanticDigest(currentTaskContract);
      if (currentRequirements.taskContractSha256 === contractSha256) return undefined;
      const revisedContextGraph = this.contexts.build({
        workspaceRoot,
        userPrompt: currentTaskContract.goal,
        taskContract: currentTaskContract,
        seed: input.contextSeed,
      });
      const revisionEvidenceRef = revisedContextGraph.provenanceRefs.includes('task-contract:current')
        ? 'task-contract:current'
        : revisedContextGraph.provenanceRefs[0];
      if (!revisionEvidenceRef) {
        throw new Error('coding-change-plan-revision:missing-task-contract-provenance');
      }
      const revisedRequirements = this.requirements.decide({
        taskContract: currentTaskContract,
        contextGraph: revisedContextGraph,
        previousDecision: currentRequirements,
        revisionReason: 'task-contract-revision',
        newEvidenceRefs: [revisionEvidenceRef],
      });
      const revisedDesign = this.designs.decide({
        taskContract: currentTaskContract,
        contextGraph: revisedContextGraph,
        requirements: revisedRequirements,
        evidence: { evidenceRefs: [revisionEvidenceRef] },
      });
      const revisedPlan = this.plans.revise({
        previousPlan: currentPlan,
        taskContract: currentTaskContract,
        requirements: revisedRequirements,
        design: revisedDesign,
        revisionReason: 'task-contract-revision',
        newEvidenceRefs: [revisionEvidenceRef],
      });
      currentContextGraph = revisedContextGraph;
      currentRequirements = revisedRequirements;
      if (revisedDesign.decisionSha256 !== currentDesign.decisionSha256) {
        designHistory.push(revisedDesign);
        currentDesign = revisedDesign;
      }
      if (revisedPlan.planSha256 !== currentPlan.planSha256) {
        planHistory.push(revisedPlan);
        currentPlan = revisedPlan;
      }
      return recordDecision(decisions, {
        status: 'revised',
        actionId,
        reason: 'change-plan-revised-for-task-contract-revision',
        targetPaths: currentTaskContract.scope.include,
        planId: currentPlan.planId,
        evidenceRefs: [
          revisionEvidenceRef,
          currentRequirements.decisionSha256,
          currentDesign.decisionSha256,
          currentPlan.planSha256,
        ],
      });
    };

    return Object.freeze({
      currentContextGraph: () => currentContextGraph,
      currentRequirements: () => currentRequirements,
      currentDesign: () => currentDesign,
      currentPlan: () => currentPlan,
      reconcile: (candidate: Parameters<CodingChangePlanRevisionSessionPort['reconcile']>[0]) => {
        const actionId = requireText(candidate?.actionId, 'action-id');
        return reconcileTaskContract(actionId) ?? recordDecision(decisions, {
          status: 'unchanged',
          actionId,
          reason: 'task-contract-derived-state-current',
          targetPaths: (input.taskContractSource?.current() ?? taskContract).scope.include,
          planId: currentPlan.planId,
          evidenceRefs: [currentRequirements.decisionSha256, currentPlan.planSha256],
        });
      },
      ensureTargets: (candidate: Parameters<CodingChangePlanRevisionSessionPort['ensureTargets']>[0]) => {
        const actionId = requireText(candidate?.actionId, 'action-id');
        const projection = projectCodingWorkspaceTargets(candidate?.targetPaths ?? [], workspaceRoot);
        if (projection.decision === 'denied') {
          return recordDecision(decisions, {
            status: 'denied',
            actionId,
            reason: projection.reason ?? 'workspace-path-invalid',
            targetPaths: projection.targets,
            planId: currentPlan.planId,
            evidenceRefs: [currentPlan.planId],
          });
        }
        const taskContractReconciliation = reconcileTaskContract(actionId);
        const currentTaskContract = input.taskContractSource?.current() ?? taskContract;
        const targetPaths = projection.targets;
        const scopeFailure = validateTargetScopes(currentTaskContract, targetPaths);
        if (scopeFailure) {
          return recordDecision(decisions, {
            status: 'denied',
            actionId,
            reason: scopeFailure,
            targetPaths,
            planId: currentPlan.planId,
            evidenceRefs: [currentPlan.planId],
          });
        }

        const currentEffect = evaluateCodingChangePlanEffect(currentPlan, {
          effects: ['workspace-mutation'],
          targetPaths,
        });
        if (currentEffect.decision === 'allow') {
          return taskContractReconciliation ?? recordDecision(decisions, {
            status: 'unchanged',
            actionId,
            reason: 'change-plan-already-authorizes-targets',
            targetPaths,
            planId: currentPlan.planId,
            evidenceRefs: currentEffect.evidenceRefs,
          });
        }

        const proposalEvidenceRef = proposedTargetEvidenceRef(actionId, targetPaths);
        const proposedImpacts = buildProposedImpacts(
          currentDesign.impactSet.primary.impacts,
          targetPaths,
          proposalEvidenceRef,
        );
        const revisedDesign = this.designs.decide({
          taskContract: currentTaskContract,
          contextGraph: currentContextGraph,
          requirements: currentRequirements,
          evidence: {
            impacts: proposedImpacts,
            dependencyChecks: currentDesign.dependencyChecks,
            migration: currentDesign.migration,
            deletion: currentDesign.deletion,
            rollback: revisedRollback(currentDesign, targetPaths, proposalEvidenceRef),
            evidenceRefs: [...currentDesign.evidenceRefs, proposalEvidenceRef],
          },
        });
        const revisedPlan = this.plans.revise({
          previousPlan: currentPlan,
          taskContract: currentTaskContract,
          requirements: currentRequirements,
          design: revisedDesign,
          revisionReason: 'tool-proposed-targets',
          newEvidenceRefs: [proposalEvidenceRef],
        });
        if (revisedDesign.decisionSha256 !== currentDesign.decisionSha256) {
          designHistory.push(revisedDesign);
          currentDesign = revisedDesign;
        }
        if (revisedPlan.planSha256 !== currentPlan.planSha256) {
          planHistory.push(revisedPlan);
          currentPlan = revisedPlan;
        }
        return recordDecision(decisions, {
          status: 'revised',
          actionId,
          reason: currentPlan.status === 'ready'
            ? 'change-plan-revised-for-proposed-targets'
            : `change-plan-${currentPlan.status}`,
          targetPaths,
          planId: currentPlan.planId,
          evidenceRefs: [proposalEvidenceRef, revisedDesign.decisionSha256, currentPlan.planSha256],
        });
      },
      decisions: () => Object.freeze([...decisions]),
      designHistory: () => Object.freeze([...designHistory]),
      planHistory: () => Object.freeze([...planHistory]),
    });
  }
}

function validateTargetScopes(
  contract: CodingKernelTaskContract,
  targets: readonly string[],
): string | undefined {
  const excluded = targets.find(target => contract.scope.exclude.some(scope => (
    codingWorkspaceTargetMatchesScope(target, scope)
  )));
  if (excluded) return `change-plan-target-excluded:${excluded}`;
  if (!contract.constraints.includes('no-other-files')) return undefined;
  const outside = targets.find(target => !contract.scope.include.some(scope => (
    codingWorkspaceTargetMatchesScope(target, scope)
  )));
  return outside ? `change-plan-target-outside-scope:${outside}` : undefined;
}

function buildProposedImpacts(
  existing: readonly CodingDesignImpact[],
  targets: readonly string[],
  evidenceRef: string,
): CodingDesignImpact[] {
  const byTarget = new Map(existing.map(item => [item.target, item]));
  for (const target of targets) {
    if (byTarget.has(target)) continue;
    byTarget.set(target, Object.freeze({
      id: `primary:tool-proposal:${codingSemanticDigest(target).slice(0, 20)}`,
      kind: 'primary',
      target,
      owner: 'tool-proposed-semantic-owner',
      evidenceRefs: Object.freeze([evidenceRef]),
    }));
  }
  return [...byTarget.values()];
}

function revisedRollback(
  design: CodingDesignDecision,
  targets: readonly string[],
  evidenceRef: string,
): CodingDesignDecision['rollback'] {
  const steps = new Map(design.rollback.steps.map(step => [step.target, step]));
  for (const target of targets) {
    if (steps.has(target)) continue;
    steps.set(target, Object.freeze({
      target,
      action: 'restore-baseline-receipt',
      evidenceRefs: Object.freeze(['workspace-mutation-transaction', evidenceRef]),
    }));
  }
  return Object.freeze({
    status: 'planned',
    rationale: 'Restore each proposed mutation through its baseline-bound workspace receipt.',
    steps: Object.freeze([...steps.values()]),
  });
}

function proposedTargetEvidenceRef(actionId: string, targets: readonly string[]): string {
  return `tool-target-proposal:${actionId}:${codingSemanticDigest({ actionId, targets }).slice(0, 24)}`;
}

function recordDecision(
  decisions: CodingChangePlanRevisionDecision[],
  input: Omit<CodingChangePlanRevisionDecision, 'version' | 'decisionSha256'>,
): CodingChangePlanRevisionDecision {
  const payload = {
    version: CODING_CHANGE_PLAN_REVISION_DECISION_VERSION,
    ...input,
    targetPaths: Object.freeze([...input.targetPaths]),
    evidenceRefs: Object.freeze([...new Set(input.evidenceRefs)]),
  };
  const decision = Object.freeze({ ...payload, decisionSha256: codingSemanticDigest(payload) });
  decisions.push(decision);
  return decision;
}

function requireText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`coding-change-plan-revision:missing-${label}`);
  return text;
}
