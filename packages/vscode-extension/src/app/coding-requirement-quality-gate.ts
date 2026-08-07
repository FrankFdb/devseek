import {
  CanonicalContextGraphService,
  CanonicalRequirementDecisionService,
  resolveCodingKernelTaskContract,
} from '@devseek-netai/shared';
import type { QualityGateContractAcceptance } from './quality-gate-service';

export interface CodingRequirementQualityGateInput {
  readonly prompt: string;
  readonly workspaceRoot: string;
  readonly targetPaths?: readonly string[];
}

/** Projects the shared C4 decision into the VS Code quality-gate vocabulary. */
export function evaluateCodingRequirementQualityGate(
  input: CodingRequirementQualityGateInput,
): QualityGateContractAcceptance {
  try {
    const taskContract = resolveCodingKernelTaskContract({
      prompt: input.prompt,
      surface: 'vscode',
      targetPaths: input.targetPaths,
    });
    const contextGraph = new CanonicalContextGraphService().build({
      workspaceRoot: input.workspaceRoot,
      userPrompt: input.prompt,
      taskContract,
      seed: {
        files: (input.targetPaths ?? []).map(path => ({ path })),
      },
    });
    const decision = new CanonicalRequirementDecisionService().decide({
      taskContract,
      contextGraph,
    });
    if (decision.status === 'ready') {
      return {
        status: 'accepted',
        reason: 'canonical-requirement-decision-ready',
        evidenceRefs: [decision.revisionId, decision.decisionSha256],
      };
    }
    const status = decision.acceptance.status === 'clarification-required'
      ? 'weak-oracle' as const
      : decision.status === 'exploration-required'
        ? 'pending' as const
        : 'missing' as const;
    return {
      status,
      reason: status === 'weak-oracle'
        ? 'acceptance-not-bound-to-executable-oracle'
        : `canonical-requirement-${decision.status}`,
      evidenceRefs: [decision.revisionId, decision.decisionSha256, ...decision.evidenceRefs],
      risks: [...decision.reasonCodes],
      requiredActions: requirementActions(decision.reasonCodes),
    };
  } catch {
    return {
      status: 'missing',
      reason: 'canonical-requirement-decision-invalid',
      evidenceRefs: ['canonical-requirement:construction-failed'],
      risks: ['The canonical requirement decision could not be constructed.'],
      requiredActions: ['Resolve the task-contract error before applying workspace effects.'],
    };
  }
}

function requirementActions(reasonCodes: readonly string[]): string[] {
  if (reasonCodes.some(reason => reason.includes('external-source'))) {
    return ['Ground the external fact with exact source and effect-receipt evidence.'];
  }
  if (reasonCodes.some(reason => reason.includes('weak-oracle'))) {
    return ['Replace the subjective acceptance oracle with an executable verifier.'];
  }
  return ['Resolve canonical requirement conflicts before applying workspace effects.'];
}
