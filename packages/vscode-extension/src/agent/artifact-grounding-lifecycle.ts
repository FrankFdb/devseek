import type { AgentLoopCallbacks, AgentLoopResult } from './loop-types';
import type { TaskExecutionResult } from './task-execution-result';
import type { ArtifactClaim, EvidenceRef, VerificationResult } from './evidence-grounding';
import { appendArtifactGroundingTrace } from './artifact-verification-trace';

export interface ArtifactGroundingResultFields {
  evidenceRefs?: EvidenceRef[];
  artifactClaims?: ArtifactClaim[];
  verificationResults?: VerificationResult[];
}

export interface ArtifactGroundingSettlementFields extends ArtifactGroundingResultFields {
  promptText: string;
}

/** Owns cross-task grounding aggregation and trace delivery for one agent run. */
export class ArtifactGroundingCollector {
  private readonly evidenceRefs: EvidenceRef[] = [];
  private readonly artifactClaims: ArtifactClaim[] = [];
  private readonly verificationResults: VerificationResult[] = [];

  constructor(
    private readonly callbacks: AgentLoopCallbacks,
    private readonly workspaceRoot: string,
  ) {}

  captureTask(promptText: string, result: TaskExecutionResult): ArtifactGroundingSettlementFields {
    if (result.evidenceRefs?.length) this.evidenceRefs.push(...result.evidenceRefs);
    if (result.artifactClaims?.length) this.artifactClaims.push(...result.artifactClaims);
    if (result.verificationResults?.length) this.verificationResults.push(...result.verificationResults);
    appendArtifactGroundingTrace(
      this.callbacks,
      this.workspaceRoot,
      result.evidenceRefs,
      result.verificationResults,
    );
    return {
      promptText,
      evidenceRefs: result.evidenceRefs,
      artifactClaims: result.artifactClaims,
      verificationResults: result.verificationResults,
    };
  }

  resultFields(): ArtifactGroundingResultFields {
    return selectArtifactGroundingResultFields({
      evidenceRefs: this.evidenceRefs,
      artifactClaims: this.artifactClaims,
      verificationResults: this.verificationResults,
    });
  }
}

export function selectArtifactGroundingResultFields(
  input: ArtifactGroundingResultFields,
): ArtifactGroundingResultFields {
  return {
    ...(input.evidenceRefs?.length ? { evidenceRefs: input.evidenceRefs } : {}),
    ...(input.artifactClaims?.length ? { artifactClaims: input.artifactClaims } : {}),
    ...(input.verificationResults?.length ? { verificationResults: input.verificationResults } : {}),
  };
}

/** Produces the replay-bound completion fields shared by both top-level routes. */
export function buildArtifactVerificationCompletionMetadata(
  result: Pick<AgentLoopResult, 'verificationResults'> | undefined,
): { verificationIds: string[]; artifactVerificationOk?: boolean } {
  const verificationResults = result?.verificationResults;
  const verificationIds = verificationResults?.map(item => item.verificationId) ?? [];
  if (!verificationResults?.length) return { verificationIds };
  return { verificationIds, artifactVerificationOk: verificationResults.at(-1)?.ok === true };
}
