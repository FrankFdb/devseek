import { createDevSeekTraceLogger } from '@devseek-netai/shared';
import type { AgentLoopCallbacks } from './loop-types';
import type { EvidenceRef, VerificationResult } from './evidence-grounding';

export function appendArtifactGroundingTrace(
  callbacks: AgentLoopCallbacks,
  workspaceRoot: string,
  evidenceRefs: EvidenceRef[] = [],
  verificationResults: VerificationResult[] = [],
): void {
  if (!callbacks.traceRunId) return;
  const trace = createDevSeekTraceLogger({
    workspaceRoot: callbacks.traceWorkspaceRoot || workspaceRoot,
    source: 'vscode-extension.artifact-grounding',
    level: 'debug',
    runId: callbacks.traceRunId,
  });
  for (const evidence of evidenceRefs) {
    if (!evidence.evidenceId) continue;
    trace.info('evidence-store', 'evidence-collected', {
      evidenceId: evidence.evidenceId,
      operationId: evidence.operationId,
      kind: evidence.kind,
      sourcePath: evidence.sourcePath,
      lineStart: evidence.lineStart,
      lineEnd: evidence.lineEnd,
      contentHash: evidence.contentHash,
      capturedAt: evidence.capturedAt,
      captureSequence: evidence.captureSequence,
    });
  }
  for (const result of verificationResults) {
    trace.info('artifact-grounding', 'artifact-verification-completed', {
      verificationId: result.verificationId,
      artifactEvidenceId: result.artifactEvidenceId,
      artifactPath: result.artifactPath,
      artifactHash: result.artifactHash,
      checkedAt: result.checkedAt,
      ok: result.ok,
      claims: result.claims.map(claim => ({
        claimId: claim.claimId,
        symbol: claim.symbol,
        expectedValue: claim.expectedValue,
        normalizedExpectedValue: claim.normalizedExpectedValue,
        actualValue: claim.actualValue,
        normalizedActualValue: claim.normalizedActualValue,
        validator: claim.validator,
        evidenceId: claim.evidenceId,
        sourcePath: claim.sourcePath,
        sourceLine: claim.sourceLine,
        sourceHash: claim.sourceHash,
        artifactPath: claim.artifactPath,
        artifactLine: claim.artifactLine,
        status: claim.status,
        difference: claim.difference,
      })),
      differences: result.differences,
      contractDifferences: result.contractDifferences,
      sourceReadbackEvidenceIds: result.sourceReadbackEvidenceIds,
    });
  }
}
