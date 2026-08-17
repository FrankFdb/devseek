import type {
  MemoryClassification,
  MemoryEpistemicStatus,
  MemoryFunctionalStage,
  MemoryOutcome,
  MemoryScope,
  MemoryType,
} from './types';

export const MEMORY_PIPELINE_VERSION = 'devseek.memory-pipeline/v2' as const;

export type MemoryStage1JobStatus =
  | 'pending'
  | 'leased'
  | 'succeeded'
  | 'no-output'
  | 'failed'
  | 'exhausted';

export type MemoryEvidenceKind =
  | 'rollout'
  | 'user-turn'
  | 'assistant-summary'
  | 'tool-execution'
  | 'verification'
  | 'run-evidence';

export interface MemoryEvidenceDescriptor {
  readonly ref: string;
  readonly kind: MemoryEvidenceKind;
  readonly sourceAuthority: 'user' | 'tool' | 'assistant' | 'external';
  readonly epistemicStatus: MemoryEpistemicStatus;
  readonly outcome: MemoryOutcome;
}

export interface MemoryRolloutEvidence {
  readonly rolloutId: string;
  readonly repositoryId: string;
  readonly workspaceRoot: string;
  readonly capturedAt: number;
  readonly userTurns: readonly string[];
  readonly assistantSummary?: string;
  readonly status: MemoryOutcome;
  readonly taskKind?: string;
  readonly changedPaths: readonly string[];
  readonly toolEvidence: readonly string[];
  readonly verificationEvidence: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly evidenceCatalog: readonly MemoryEvidenceDescriptor[];
}

export interface MemoryExtractionCandidate {
  readonly content: string;
  readonly type: MemoryType;
  readonly scope: MemoryScope;
  readonly classification: MemoryClassification;
  readonly epistemicStatus: MemoryEpistemicStatus;
  readonly outcome: MemoryOutcome;
  readonly functionalStage: MemoryFunctionalStage;
  readonly sourceAuthority: 'user' | 'tool' | 'assistant' | 'external';
  readonly evidenceRefs: readonly string[];
  readonly tags: readonly string[];
  readonly validFrom?: number;
  readonly validTo?: number;
}

export interface MemoryStage1Output {
  readonly rolloutSummary: string;
  readonly rawMemory: string;
  readonly candidates: readonly MemoryExtractionCandidate[];
}

export interface MemoryStage1Job {
  readonly id: string;
  readonly rolloutId: string;
  readonly status: MemoryStage1JobStatus;
  readonly attemptCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nextAttemptAt: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly consolidatedAt?: number;
  readonly lastError?: string;
  readonly evidence: MemoryRolloutEvidence;
  readonly output?: MemoryStage1Output;
}

export interface MemoryConsolidationState {
  readonly lastCompletedAt?: number;
  readonly lastSelectedJobIds: readonly string[];
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly lastError?: string;
}

export interface MemoryPipelineDocument {
  readonly version: typeof MEMORY_PIPELINE_VERSION;
  readonly revision: number;
  readonly jobs: readonly MemoryStage1Job[];
  readonly consolidation: MemoryConsolidationState;
}

export interface MemoryConsolidationProposal {
  readonly operation: 'upsert' | 'supersede';
  readonly candidate: MemoryExtractionCandidate;
  readonly supersedes: readonly string[];
  readonly reason: string;
}

export interface MemoryConsolidationOutput {
  readonly proposals: readonly MemoryConsolidationProposal[];
}
