import type { CodingContextGraph } from './coding-context-graph';
import { codingSemanticDigest } from './coding-semantic-digest';
import {
  snapshotCodingKernelTaskContract,
  type CodingKernelTaskContract,
  type CodingTaskAcceptanceCriterion,
  type CodingTaskExternalBoundary,
} from './coding-task-contract';

export const CODING_EXTERNAL_BOUNDARY_DECISION_VERSION = 'devseek.coding-external-boundary-decision/v1' as const;
export const CODING_SOURCE_GROUNDING_DECISION_VERSION = 'devseek.coding-source-grounding-decision/v1' as const;
export const CODING_ACCEPTANCE_CONTRACT_VERSION = 'devseek.coding-acceptance-contract/v1' as const;
export const CODING_REQUIREMENT_DECISION_VERSION = 'devseek.coding-requirement-decision/v1' as const;

export interface CodingExternalBoundaryDecisionItem extends CodingTaskExternalBoundary {
  readonly status: 'attributed' | 'source-required';
}

export interface CodingExternalBoundaryDecision {
  readonly version: typeof CODING_EXTERNAL_BOUNDARY_DECISION_VERSION;
  readonly status: 'ready' | 'source-required';
  readonly boundaries: readonly CodingExternalBoundaryDecisionItem[];
  readonly reasonCodes: readonly string[];
}

export interface CodingSourceGroundingItem {
  readonly boundaryId: string;
  readonly sourceRef?: string;
  readonly status: 'grounded' | 'unresolved';
  readonly locator?: string;
  readonly accessedAt?: string;
  readonly contentSha256?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingSourceGroundingDecision {
  readonly version: typeof CODING_SOURCE_GROUNDING_DECISION_VERSION;
  readonly status: 'grounded' | 'source-required';
  readonly sources: readonly CodingSourceGroundingItem[];
  readonly reasonCodes: readonly string[];
}

export interface CodingAcceptanceContractCriterion extends CodingTaskAcceptanceCriterion {
  readonly status: 'executable' | 'weak-oracle' | 'external-source-required';
  readonly reason?: string;
}

export interface CodingAcceptanceContract {
  readonly version: typeof CODING_ACCEPTANCE_CONTRACT_VERSION;
  readonly status: 'ready' | 'clarification-required' | 'source-required';
  readonly criteria: readonly CodingAcceptanceContractCriterion[];
  readonly reasonCodes: readonly string[];
  readonly contractSha256: string;
}

export type CodingRequirementKind = 'functional' | 'quality' | 'constraint' | 'non-goal';

export interface CodingRequirementItem {
  readonly id: string;
  readonly kind: CodingRequirementKind;
  readonly statement: string;
  readonly sourceRefs: readonly string[];
  readonly confidence: 'explicit' | 'derived';
}

export interface CodingRequirementDecision {
  readonly version: typeof CODING_REQUIREMENT_DECISION_VERSION;
  readonly status: 'ready' | 'clarification-required' | 'exploration-required';
  readonly revisionId: string;
  readonly parentRevisionId?: string;
  readonly revisionReason: string;
  readonly taskContractSha256: string;
  readonly contextGraphSha256: string;
  readonly requirements: readonly CodingRequirementItem[];
  readonly externalBoundaries: CodingExternalBoundaryDecision;
  readonly sourceGrounding: CodingSourceGroundingDecision;
  readonly acceptance: CodingAcceptanceContract;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly decisionSha256: string;
}

export interface ExternalBoundaryPort {
  evaluate(contract: CodingKernelTaskContract): CodingExternalBoundaryDecision;
}

export interface SourceGroundingPort {
  ground(
    boundaries: CodingExternalBoundaryDecision,
    contextGraph: CodingContextGraph,
  ): CodingSourceGroundingDecision;
}

export interface AcceptanceContractPort {
  build(
    contract: CodingKernelTaskContract,
    grounding: CodingSourceGroundingDecision,
  ): CodingAcceptanceContract;
}

export interface RequirementDecisionPort {
  decide(input: {
    readonly taskContract: CodingKernelTaskContract;
    readonly contextGraph: CodingContextGraph;
    readonly previousDecision?: CodingRequirementDecision;
    readonly revisionReason?: string;
    readonly newEvidenceRefs?: readonly string[];
  }): CodingRequirementDecision;
}

/** Validates the declared external boundary before any source is trusted. */
export class CanonicalExternalBoundaryService implements ExternalBoundaryPort {
  evaluate(candidate: CodingKernelTaskContract): CodingExternalBoundaryDecision {
    const contract = snapshotCodingKernelTaskContract(candidate);
    const boundaries = contract.externalBoundaries.map(boundary => Object.freeze({
      ...boundary,
      status: boundary.sourceRef ? 'attributed' as const : 'source-required' as const,
    }));
    const reasonCodes = boundaries
      .filter(boundary => boundary.status === 'source-required')
      .map(boundary => `external-source-attribution-required:${boundary.id}`);
    return Object.freeze({
      version: CODING_EXTERNAL_BOUNDARY_DECISION_VERSION,
      status: reasonCodes.length === 0 ? 'ready' : 'source-required',
      boundaries: Object.freeze(boundaries),
      reasonCodes: Object.freeze(reasonCodes),
    });
  }
}

/** Grounds external facts only in provenance linked to canonical tool/effect receipts. */
export class CanonicalSourceGroundingService implements SourceGroundingPort {
  ground(
    boundaries: CodingExternalBoundaryDecision,
    contextGraph: CodingContextGraph,
  ): CodingSourceGroundingDecision {
    assertBoundaryDecision(boundaries);
    const sourceById = new Map(contextGraph.externalSources.map(source => [source.sourceId, source]));
    const sources = boundaries.boundaries.map(boundary => {
      const source = boundary.sourceRef ? sourceById.get(boundary.sourceRef) : undefined;
      const grounded = Boolean(source?.boundaryIds.includes(boundary.id));
      return Object.freeze({
        boundaryId: boundary.id,
        ...(boundary.sourceRef ? { sourceRef: boundary.sourceRef } : {}),
        status: grounded ? 'grounded' as const : 'unresolved' as const,
        ...(source && grounded ? {
          locator: source.locator,
          accessedAt: source.accessedAt,
          contentSha256: source.contentSha256,
          evidenceRefs: Object.freeze([
            source.sourceId,
            source.toolExecutionRef,
            source.externalEffectRef,
          ]),
        } : { evidenceRefs: Object.freeze([]) }),
      });
    });
    const reasonCodes = sources
      .filter(source => source.status === 'unresolved')
      .map(source => `external-source-unresolved:${source.boundaryId}`);
    return Object.freeze({
      version: CODING_SOURCE_GROUNDING_DECISION_VERSION,
      status: reasonCodes.length === 0 ? 'grounded' : 'source-required',
      sources: Object.freeze(sources),
      reasonCodes: Object.freeze(reasonCodes),
    });
  }
}

/** Turns acceptance prose into an executable, deliverable-bound quality contract. */
export class CanonicalAcceptanceContractService implements AcceptanceContractPort {
  build(
    candidate: CodingKernelTaskContract,
    grounding: CodingSourceGroundingDecision,
  ): CodingAcceptanceContract {
    const contract = snapshotCodingKernelTaskContract(candidate);
    assertGroundingDecision(grounding);
    const groundedBoundaryIds = new Set(
      grounding.sources.filter(source => source.status === 'grounded').map(source => source.boundaryId),
    );
    const criteria = contract.acceptance.map(criterion => {
      const missingExternalSource = criterion.externalBoundaryRefs.some(id => !groundedBoundaryIds.has(id));
      const status = criterion.oracle.kind === 'subjective'
        ? 'weak-oracle' as const
        : missingExternalSource
          ? 'external-source-required' as const
          : 'executable' as const;
      return Object.freeze({
        ...criterion,
        status,
        ...(status === 'weak-oracle'
          ? { reason: 'acceptance-oracle-is-subjective' }
          : status === 'external-source-required'
            ? { reason: 'acceptance-depends-on-ungrounded-external-source' }
            : {}),
      });
    });
    const reasonCodes = criteria.flatMap(criterion => (
      criterion.status === 'executable'
        ? []
        : [`acceptance-${criterion.status}:${criterion.id}`]
    ));
    const status = criteria.some(criterion => criterion.status === 'weak-oracle')
      ? 'clarification-required' as const
      : criteria.some(criterion => criterion.status === 'external-source-required')
        ? 'source-required' as const
        : 'ready' as const;
    const payload = {
      version: CODING_ACCEPTANCE_CONTRACT_VERSION,
      status,
      criteria: Object.freeze(criteria),
      reasonCodes: Object.freeze(reasonCodes),
    };
    return Object.freeze({ ...payload, contractSha256: codingSemanticDigest(payload) });
  }
}

/** Owns requirement classification and evidence-bound revision semantics. */
export class CanonicalRequirementDecisionService implements RequirementDecisionPort {
  constructor(
    private readonly externalBoundaries: ExternalBoundaryPort = new CanonicalExternalBoundaryService(),
    private readonly sourceGrounding: SourceGroundingPort = new CanonicalSourceGroundingService(),
    private readonly acceptance: AcceptanceContractPort = new CanonicalAcceptanceContractService(),
  ) {}

  decide(input: Parameters<RequirementDecisionPort['decide']>[0]): CodingRequirementDecision {
    if (!input || typeof input !== 'object') requirementFailure('invalid-input');
    const taskContract = snapshotCodingKernelTaskContract(input.taskContract);
    const boundaries = this.externalBoundaries.evaluate(taskContract);
    const grounding = this.sourceGrounding.ground(boundaries, input.contextGraph);
    const acceptance = this.acceptance.build(taskContract, grounding);
    const requirements = buildRequirementItems(taskContract);
    const reasonCodes = unique([
      ...taskContract.conflicts.map(conflict => `requirement-conflict:${conflict.id}`),
      ...taskContract.assumptions
        .filter(assumption => assumption.status === 'unconfirmed')
        .map(assumption => `unconfirmed-assumption:${assumption.id}`),
      ...boundaries.reasonCodes,
      ...grounding.reasonCodes,
      ...acceptance.reasonCodes,
    ]);
    const hasClarificationBlocker = taskContract.conflicts.length > 0
      || taskContract.assumptions.some(assumption => assumption.status === 'unconfirmed')
      || acceptance.status === 'clarification-required';
    const status = hasClarificationBlocker
      ? 'clarification-required' as const
      : grounding.status === 'source-required' || acceptance.status === 'source-required'
        ? 'exploration-required' as const
        : 'ready' as const;
    const taskContractSha256 = codingSemanticDigest(taskContract);
    const contextGraphSha256 = codingSemanticDigest(input.contextGraph);
    const semanticPayload = {
      version: CODING_REQUIREMENT_DECISION_VERSION,
      status,
      taskContractSha256,
      contextGraphSha256,
      requirements,
      externalBoundaries: boundaries,
      sourceGrounding: grounding,
      acceptance,
      reasonCodes,
      evidenceRefs: unique([
        'task-contract:current',
        ...grounding.sources.flatMap(source => source.evidenceRefs),
        ...(input.newEvidenceRefs ?? []),
      ]),
    };
    const decisionSha256 = codingSemanticDigest(semanticPayload);
    if (input.previousDecision?.decisionSha256 === decisionSha256) return input.previousDecision;
    const revision = resolveRevision(input, input.contextGraph, decisionSha256);
    return Object.freeze({
      ...semanticPayload,
      revisionId: revision.revisionId,
      ...(revision.parentRevisionId ? { parentRevisionId: revision.parentRevisionId } : {}),
      revisionReason: revision.revisionReason,
      requirements: Object.freeze(requirements),
      reasonCodes: Object.freeze(reasonCodes),
      evidenceRefs: Object.freeze(semanticPayload.evidenceRefs),
      decisionSha256,
    });
  }
}

export function renderCodingRequirementDecisionSummary(decision: CodingRequirementDecision): string {
  assertRequirementDecision(decision);
  const nonGoals = decision.requirements
    .filter(requirement => requirement.kind === 'non-goal')
    .map(requirement => requirement.statement);
  return [
    '[DevSeek Requirement Contract]',
    `status: ${decision.status}`,
    `revision: ${decision.revisionId}`,
    `non-goals: ${nonGoals.join(' | ') || 'none declared'}`,
    `acceptance: ${decision.acceptance.criteria.map(item => `${item.id}:${item.status}`).join(', ')}`,
    `external boundaries: ${decision.sourceGrounding.sources.map(item => `${item.boundaryId}:${item.status}`).join(', ') || 'none'}`,
    `blocking reasons: ${decision.reasonCodes.join(', ') || 'none'}`,
  ].join('\n');
}

function buildRequirementItems(contract: CodingKernelTaskContract): CodingRequirementItem[] {
  return [
    requirementItem('goal', 'functional', contract.goal, ['task-contract:current'], 'explicit'),
    ...contract.deliverables.map(deliverable => requirementItem(
      `deliverable:${deliverable.id}`,
      'functional',
      `${deliverable.kind}:${deliverable.path ?? 'response'}`,
      ['task-contract:current'],
      'explicit',
    )),
    ...contract.constraints.map((statement, index) => requirementItem(
      `constraint:${index + 1}`,
      'constraint',
      statement,
      ['task-contract:current'],
      'explicit',
    )),
    ...contract.nonGoals.map((statement, index) => requirementItem(
      `non-goal:${index + 1}`,
      'non-goal',
      statement,
      ['task-contract:current'],
      'explicit',
    )),
    ...contract.acceptance.map(criterion => requirementItem(
      `quality:${criterion.id}`,
      'quality',
      criterion.statement,
      ['task-contract:current'],
      'derived',
    )),
  ];
}

function requirementItem(
  id: string,
  kind: CodingRequirementKind,
  statement: string,
  sourceRefs: readonly string[],
  confidence: CodingRequirementItem['confidence'],
): CodingRequirementItem {
  return Object.freeze({ id, kind, statement, sourceRefs: Object.freeze([...sourceRefs]), confidence });
}

function resolveRevision(
  input: Parameters<RequirementDecisionPort['decide']>[0],
  contextGraph: CodingContextGraph,
  decisionSha256: string,
): { revisionId: string; parentRevisionId?: string; revisionReason: string } {
  if (!input.previousDecision) {
    return { revisionId: `requirement-${decisionSha256.slice(0, 24)}`, revisionReason: 'initial-decision' };
  }
  assertRequirementDecision(input.previousDecision);
  const revisionReason = String(input.revisionReason ?? '').trim();
  const newEvidenceRefs = unique(input.newEvidenceRefs ?? []);
  if (!revisionReason) requirementFailure('missing-revision-reason');
  if (newEvidenceRefs.length === 0) requirementFailure('missing-revision-evidence');
  const knownEvidence = new Set(contextGraph.provenanceRefs);
  if (newEvidenceRefs.some(ref => !knownEvidence.has(ref))) {
    requirementFailure('unbound-revision-evidence');
  }
  return {
    revisionId: `requirement-${decisionSha256.slice(0, 24)}`,
    parentRevisionId: input.previousDecision.revisionId,
    revisionReason,
  };
}

function assertBoundaryDecision(decision: CodingExternalBoundaryDecision): void {
  if (!decision || decision.version !== CODING_EXTERNAL_BOUNDARY_DECISION_VERSION) {
    requirementFailure('invalid-external-boundary-decision');
  }
}

function assertGroundingDecision(decision: CodingSourceGroundingDecision): void {
  if (!decision || decision.version !== CODING_SOURCE_GROUNDING_DECISION_VERSION) {
    requirementFailure('invalid-source-grounding-decision');
  }
}

function assertRequirementDecision(decision: CodingRequirementDecision): void {
  if (!decision || decision.version !== CODING_REQUIREMENT_DECISION_VERSION) {
    requirementFailure('invalid-requirement-decision');
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

function requirementFailure(reason: string): never {
  throw new Error(`coding-requirements:${reason}`);
}
