import { memoryEvidenceDescriptor } from './memory-evidence';
import type { MemoryRolloutEvidence } from './pipeline-types';
import type { MemoryOutcome } from './types';

interface MemoryToolReceiptEvidence {
  readonly tool: string;
  readonly status: 'completed' | 'failed' | 'denied' | 'indeterminate';
  readonly effects: readonly string[];
  readonly evidenceRefs: readonly string[];
}

interface MemoryVerificationReceiptEvidence {
  readonly verifier: string;
  readonly status: 'passed' | 'failed' | 'unverified' | 'indeterminate';
  readonly scopePaths: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface MemoryRolloutCapture {
  readonly rolloutId: string;
  readonly repositoryId: string;
  readonly workspaceRoot: string;
  readonly capturedAt: number;
  readonly userTurns: readonly string[];
  readonly assistantSummary?: string;
  readonly status: MemoryOutcome;
  readonly taskKind?: string;
  readonly changedPaths: readonly string[];
  readonly toolReceipts: readonly MemoryToolReceiptEvidence[];
  readonly verificationReceipts: readonly MemoryVerificationReceiptEvidence[];
  readonly runEvidenceRefs: readonly string[];
}

export function createMemoryRolloutEvidence(capture: MemoryRolloutCapture): MemoryRolloutEvidence {
  const evidenceCatalog = [
    ...capture.toolReceipts.flatMap(receipt => receipt.evidenceRefs.map(ref => {
      const external = receipt.effects.includes('network');
      return memoryEvidenceDescriptor({
        ref,
        kind: 'tool-execution',
        sourceAuthority: external ? 'external' : 'tool',
        epistemicStatus: !external && (receipt.status === 'completed' || receipt.status === 'failed')
          ? 'tool-verified'
          : 'uncertain',
        outcome: receipt.status === 'completed'
          ? 'success'
          : receipt.status === 'failed' ? 'failure' : 'uncertain',
      });
    })),
    ...capture.verificationReceipts.flatMap(receipt => receipt.evidenceRefs.map(ref => (
      memoryEvidenceDescriptor({
        ref,
        kind: 'verification',
        sourceAuthority: 'tool',
        epistemicStatus: receipt.status === 'passed' || receipt.status === 'failed'
          ? 'tool-verified'
          : 'uncertain',
        outcome: receipt.status === 'passed'
          ? 'success'
          : receipt.status === 'failed' ? 'failure' : 'uncertain',
      })
    ))),
  ];
  return {
    rolloutId: capture.rolloutId,
    repositoryId: capture.repositoryId,
    workspaceRoot: capture.workspaceRoot,
    capturedAt: capture.capturedAt,
    userTurns: capture.userTurns,
    ...(capture.assistantSummary ? { assistantSummary: capture.assistantSummary } : {}),
    status: capture.status,
    ...(capture.taskKind ? { taskKind: capture.taskKind } : {}),
    changedPaths: capture.changedPaths,
    toolEvidence: capture.toolReceipts.map(receipt => [
      `tool=${receipt.tool}`,
      `status=${receipt.status}`,
      `effects=${receipt.effects.join(',')}`,
      `evidence=${receipt.evidenceRefs.join(',')}`,
    ].join(' ')),
    verificationEvidence: capture.verificationReceipts.map(receipt => [
      `verifier=${receipt.verifier}`,
      `status=${receipt.status}`,
      `scope=${receipt.scopePaths.join(',')}`,
      `evidence=${receipt.evidenceRefs.join(',')}`,
    ].join(' ')),
    evidenceRefs: [...new Set([
      `rollout:${capture.rolloutId}`,
      ...capture.runEvidenceRefs,
      ...capture.toolReceipts.flatMap(receipt => receipt.evidenceRefs),
      ...capture.verificationReceipts.flatMap(receipt => receipt.evidenceRefs),
    ])],
    evidenceCatalog,
  };
}
