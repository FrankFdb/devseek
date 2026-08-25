import type { CodingKernelTaskContract } from '@devseek-netai/shared';
import * as nodePath from 'path';
import type { TaskSemanticContract } from '../task-semantic-contract';
import {
  coalesceWrittenFileEvidence,
  isCodeArtifactPath,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { AgenticHistoryQualityGate } from './agentic-history';

export type RequirementReviewStrategy = 'independent-provider' | 'host-evidence';

export type RequirementReviewPolicyReason =
  | 'bounded-validated-source-creation'
  | 'missing-semantic-contract'
  | 'missing-kernel-contract'
  | 'validation-not-passed'
  | 'host-source-evidence-missing'
  | 'source-set-out-of-bounds'
  | 'semantic-risk-requires-review'
  | 'existing-source-change-requires-review'
  | 'kernel-risk-requires-review';

export interface RequirementReviewPolicyDecision {
  readonly strategy: RequirementReviewStrategy;
  readonly reason: RequirementReviewPolicyReason;
  readonly sourcePaths: readonly string[];
}

export interface RequirementReviewPolicyInput {
  readonly qualityGate?: AgenticHistoryQualityGate;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly hostFinalSourceEvidenceReady?: boolean;
  readonly workspaceRoot?: string;
  readonly semanticContract?: TaskSemanticContract;
  readonly canonicalTaskContract?: CodingKernelTaskContract;
}

const HOST_EVIDENCE_SOURCE_LIMIT = 2;
const HOST_EVIDENCE_CONSTRAINTS = new Set([
  'workspace-root-only',
  'no-other-files',
  'no-dependencies',
  'verification-before-completion',
]);
const HOST_EVIDENCE_ORACLES = new Set(['workspace-readback', 'verification']);

/**
 * Selects the evidence owner for final requirement coverage. Local evidence is
 * intentionally narrow; every uncertain or higher-risk shape remains with an
 * isolated provider reviewer.
 */
export class RequirementReviewPolicy {
  evaluate(input: RequirementReviewPolicyInput): RequirementReviewPolicyDecision {
    const sourceWrites = coalesceWrittenFileEvidence(input.writtenFiles, input.workspaceRoot)
      .filter(file => file.action !== 'delete' && isCodeArtifactPath(file.path));
    const sourcePaths = sourceWrites.map(file => normalizeWorkspacePath(file.path, input.workspaceRoot));
    const providerReview = (reason: RequirementReviewPolicyReason): RequirementReviewPolicyDecision => ({
      strategy: 'independent-provider',
      reason,
      sourcePaths,
    });

    if (input.qualityGate?.status !== 'pass') return providerReview('validation-not-passed');
    if (input.hostFinalSourceEvidenceReady !== true) return providerReview('host-source-evidence-missing');
    if (sourcePaths.length < 1 || sourcePaths.length > HOST_EVIDENCE_SOURCE_LIMIT) {
      return providerReview('source-set-out-of-bounds');
    }
    if (!input.semanticContract) return providerReview('missing-semantic-contract');
    if (!input.canonicalTaskContract) return providerReview('missing-kernel-contract');
    if (!semanticContractAllowsHostEvidence(
      input.semanticContract,
      sourceWrites,
      sourcePaths,
      input.workspaceRoot,
    )) {
      return providerReview(
        input.semanticContract.scope === 'existing-project'
          ? 'existing-source-change-requires-review'
          : 'semantic-risk-requires-review',
      );
    }
    if (!kernelContractAllowsHostEvidence(input.canonicalTaskContract, sourcePaths, input.workspaceRoot)) {
      return providerReview('kernel-risk-requires-review');
    }
    return {
      strategy: 'host-evidence',
      reason: 'bounded-validated-source-creation',
      sourcePaths,
    };
  }
}

function semanticContractAllowsHostEvidence(
  contract: TaskSemanticContract,
  sourceWrites: readonly WrittenFileEvidence[],
  sourcePaths: readonly string[],
  workspaceRoot?: string,
): boolean {
  if (contract.kind !== 'standalone-code' && contract.kind !== 'existing-project-code') return false;
  if (contract.scope !== 'standalone' && contract.scope !== 'existing-project') return false;
  if (!contract.mutation.requested || contract.mutation.prohibited || !contract.mutation.sourceChange) return false;
  if (!contract.validation.requested || contract.validation.runProhibited) return false;
  if (contract.quality.formalProjectRequired || contract.ambiguity.status !== 'clear') return false;
  if (contract.intent.context.externalEffect !== 'none'
    || contract.intent.context.broadScope
    || contract.intent.context.complexAction
    || contract.intent.context.planningOnly
    || contract.intent.context.unsafeSecretHarvesting) return false;

  if (contract.scope === 'standalone') return sourceWrites.every(file => file.action === 'create');
  if (contract.intent.context.failureContext || !sourceWrites.every(file => file.action === 'create')) return false;

  const explicitTargets = new Set(
    contract.mutation.targets.map(target => normalizeWorkspacePath(target, workspaceRoot)),
  );
  return explicitTargets.size > 0 && sourcePaths.every(sourcePath => explicitTargets.has(sourcePath));
}

function kernelContractAllowsHostEvidence(
  contract: CodingKernelTaskContract,
  sourcePaths: readonly string[],
  workspaceRoot?: string,
): boolean {
  if (contract.mode !== 'change') return false;
  if (contract.conflicts.length > 0 || contract.externalBoundaries.length > 0) return false;
  if (contract.assumptions.some(assumption => assumption.status === 'unconfirmed')) return false;
  if (contract.constraints.some(constraint => !HOST_EVIDENCE_CONSTRAINTS.has(constraint))) return false;

  const sourceDeliverables = contract.deliverables.filter(deliverable => deliverable.kind === 'source-change');
  if (sourceDeliverables.length < 1 || sourceDeliverables.length > HOST_EVIDENCE_SOURCE_LIMIT) return false;
  const declaredPaths = sourceDeliverables
    .map(deliverable => deliverable.path && normalizeWorkspacePath(deliverable.path, workspaceRoot))
    .filter((path): path is string => Boolean(path));
  if (declaredPaths.length > 0 && !sourcePaths.every(path => declaredPaths.includes(path))) return false;

  if (!contract.acceptance.some(criterion => criterion.oracle.kind === 'verification')) return false;
  return contract.acceptance.every(criterion => (
    criterion.externalBoundaryRefs.length === 0
      && HOST_EVIDENCE_ORACLES.has(criterion.oracle.kind)
  ));
}

function normalizeWorkspacePath(value: string, workspaceRoot?: string): string {
  const trimmed = value.trim();
  const root = workspaceRoot?.trim();
  if (root && nodePath.isAbsolute(trimmed)) {
    const relative = nodePath.relative(nodePath.resolve(root), nodePath.resolve(trimmed));
    if (relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative)) {
      return normalizePathSeparators(relative);
    }
  }
  return normalizePathSeparators(trimmed);
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}
