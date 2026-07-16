import * as crypto from 'crypto';
import type { RunEvidenceJson } from '@devseek-netai/shared';
import type {
  WorkspaceCommittedEdit,
  WorkspaceDeleteResult,
  WorkspaceTextFileBaseline,
} from '../workspace/edit-service';

export type PendingEditUndoOperation = 'restore-text-file' | 'delete-created-file';
export type PendingEditUndoPostcondition = 'content-readback' | 'absent';

export type PendingEditUndoTransaction =
  | {
    operation: 'restore-text-file';
    targetPath: string;
    result: WorkspaceCommittedEdit;
  }
  | {
    operation: 'delete-created-file';
    targetPath: string;
    result: WorkspaceDeleteResult;
  };

export interface PendingEditUndoProofInput {
  recordId: string;
  recordPath: string;
  expectedContentLength: number;
  postcondition: PendingEditUndoPostcondition;
  transaction: PendingEditUndoTransaction;
}

export function buildPendingEditUndoProof(input: PendingEditUndoProofInput): RunEvidenceJson {
  const token = input.transaction.result.commitToken;
  return {
    kind: 'workspace-pending-edit-undo-transaction',
    record_id: input.recordId,
    record_path: input.recordPath,
    operation: input.transaction.operation,
    target_path: input.transaction.targetPath,
    postcondition: input.postcondition,
    expected_content_length: input.expectedContentLength,
    commit_token: {
      abs_path: token.absPath,
      workspace_root: token.workspaceRoot,
      before: summarizeTextFileBaseline(token.before),
      after: summarizeTextFileBaseline(token.after),
    },
  };
}

function summarizeTextFileBaseline(baseline: WorkspaceTextFileBaseline): RunEvidenceJson {
  return {
    existed: baseline.snapshot.existed,
    content_length: baseline.snapshot.content.length,
    content_sha256: crypto.createHash('sha256').update(baseline.snapshot.content, 'utf8').digest('hex'),
    route_canonical_path: baseline.route.canonicalPath,
    parent_route_canonical_path: baseline.parentRoute.canonicalPath,
    parent_route_fingerprint: baseline.parentRoute.existingAncestorFingerprint,
    route_missing_segments: baseline.route.missingSegments,
    parent_route_missing_segments: baseline.parentRoute.missingSegments,
    leaf_device: baseline.leafDevice ?? null,
    leaf_inode: baseline.leafInode ?? null,
    leaf_mode: baseline.leafMode ?? null,
  };
}

