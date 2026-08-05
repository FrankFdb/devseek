import * as crypto from 'crypto';
import type { CodingWorkspaceMutationReceipt, RunEvidenceJson } from '@devseek-netai/shared';
import type {
  WorkspaceCommittedEdit,
  WorkspaceDeleteResult,
  WorkspaceTextFileBaseline,
  WorkspaceTextFileCommitToken,
  WorkspaceTextFileDeleteCommitToken,
} from '../workspace/edit-service';
import type {
  PendingEditFinalHunkResolution,
  PendingEditHunkResolutionSummary,
} from './pending-edit-service';

export type PendingEditUndoOperation = 'restore-text-file' | 'delete-created-file';
export type PendingEditUndoPostcondition = 'content-readback' | 'absent';
export type PendingEditResolutionAction = 'keep' | 'undo';
export type PendingEditResolutionScope = 'file' | 'hunk' | 'all';

export type PendingEditUndoTransaction =
  | {
    operation: 'restore-text-file';
    targetPath: string;
    result: WorkspaceCommittedEdit;
    canonicalReceipt: CodingWorkspaceMutationReceipt<WorkspaceCommittedEdit>;
  }
  | {
    operation: 'delete-created-file';
    targetPath: string;
    result: WorkspaceDeleteResult;
    canonicalReceipt: CodingWorkspaceMutationReceipt<WorkspaceDeleteResult>;
  };

export interface PendingEditResolutionProofBase {
  recordId: string;
  recordPath: string;
  scope?: PendingEditResolutionScope;
  selectedHunk?: PendingEditHunkResolutionSummary;
  resolvedHunks?: PendingEditHunkResolutionSummary[];
  allRecordIds?: string[];
  expectedContentLength: number;
  sourceCommitToken?: WorkspaceTextFileCommitToken;
}

export interface PendingEditUndoProofInput extends PendingEditResolutionProofBase {
  action?: 'undo';
  postcondition: PendingEditUndoPostcondition;
  transaction: PendingEditUndoTransaction;
}

export interface PendingEditKeepProofInput extends PendingEditResolutionProofBase {
  action: 'keep';
  targetPath: string;
}

export type PendingEditResolutionProofInput = PendingEditUndoProofInput | PendingEditKeepProofInput;

export function buildPendingEditResolutionProof(input: PendingEditResolutionProofInput): RunEvidenceJson {
  const action = input.action ?? 'undo';
  const targetPath = 'transaction' in input ? input.transaction.targetPath : input.targetPath;
  const sourceCommitToken = input.sourceCommitToken;
  const mutationCommitToken = 'transaction' in input ? input.transaction.result.commitToken : undefined;
  const scope = normalizeScope(input);
  const selectedHunk = normalizeSelectedHunk(input.selectedHunk, scope);
  const resolvedHunks = normalizeResolvedHunks(input.resolvedHunks);
  const allRecordIds = normalizeAllRecordIds(input.allRecordIds);
  if (action === 'keep' && !sourceCommitToken) {
    throw new Error('Pending edit keep receipt requires a source commit token');
  }

  const proof: RunEvidenceJson = {
    kind: action === 'undo' ? 'workspace-pending-edit-undo-transaction' : 'workspace-pending-edit-keep-receipt',
    action,
    scope,
    record_id: input.recordId,
    record_path: input.recordPath,
    target_path: targetPath,
    expected_content_length: input.expectedContentLength,
    ...(action === 'undo' && 'transaction' in input ? {
      operation: input.transaction.operation,
      postcondition: input.postcondition,
      commit_token: summarizeTextFileCommitToken(mutationCommitToken),
      canonical_mutation_receipt: summarizeCanonicalMutationReceipt(input.transaction.canonicalReceipt),
    } : {}),
    ...(sourceCommitToken ? { source_commit_token: summarizeTextFileCommitToken(sourceCommitToken) } : {}),
    ...(selectedHunk ? { selected_hunk: selectedHunk } : {}),
    ...(resolvedHunks.length > 0 ? { resolved_hunks: resolvedHunks } : {}),
    ...(allRecordIds.length > 0 ? {
      all_record_ids: allRecordIds,
      all_record_count: allRecordIds.length,
    } : {}),
  };
  return {
    ...proof,
    resolution_fingerprint: fingerprintResolution(proof),
  };
}

function summarizeCanonicalMutationReceipt(
  receipt: CodingWorkspaceMutationReceipt<unknown>,
): RunEvidenceJson {
  if (receipt.status !== 'committed' || !receipt.baselineRef || !receipt.readbackRef) {
    throw new Error('Pending edit undo proof requires a committed canonical mutation receipt');
  }
  return {
    version: receipt.version,
    run_id: receipt.runId,
    sequence: receipt.sequence,
    action_id: receipt.actionId,
    idempotency_key: receipt.idempotencyKey,
    status: receipt.status,
    paths: [...receipt.paths],
    baseline_ref: receipt.baselineRef,
    readback_ref: receipt.readbackRef,
    evidence_refs: [...receipt.evidenceRefs],
  };
}

export function buildPendingEditUndoProof(input: PendingEditUndoProofInput): RunEvidenceJson {
  return buildPendingEditResolutionProof({ ...input, action: 'undo' });
}

function normalizeScope(input: PendingEditResolutionProofInput): PendingEditResolutionScope {
  const scope = input.scope ?? (input.selectedHunk ? 'hunk' : 'file');
  if (scope === 'hunk' && !input.selectedHunk) {
    throw new Error('Pending edit hunk resolution receipt requires a selected hunk');
  }
  if (scope === 'all' && (!input.allRecordIds || input.allRecordIds.length === 0)) {
    throw new Error('Pending edit all resolution receipt requires all record ids');
  }
  return scope;
}

function normalizeSelectedHunk(
  hunk: PendingEditHunkResolutionSummary | undefined,
  scope: PendingEditResolutionScope,
): RunEvidenceJson | undefined {
  if (!hunk) return undefined;
  const normalized = normalizeResolvedHunk(hunk);
  if (scope === 'hunk' && !normalized) {
    throw new Error('Pending edit hunk resolution receipt requires a final selected hunk resolution');
  }
  return normalized;
}

function normalizeResolvedHunks(hunks: PendingEditHunkResolutionSummary[] | undefined): RunEvidenceJson[] {
  return [...(hunks ?? [])]
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
    .map(normalizeResolvedHunk)
    .filter((hunk): hunk is RunEvidenceJson => Boolean(hunk));
}

function normalizeResolvedHunk(hunk: PendingEditHunkResolutionSummary): RunEvidenceJson | undefined {
  if (!isFinalHunkResolution(hunk.resolution)) return undefined;
  return {
    id: hunk.id,
    index: hunk.index,
    title: hunk.title,
    resolution: hunk.resolution,
    old_start: hunk.oldStart,
    old_end: hunk.oldEnd,
    new_start: hunk.newStart,
    new_end: hunk.newEnd,
    old_line_count: hunk.oldLineCount,
    new_line_count: hunk.newLineCount,
  };
}

function normalizeAllRecordIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map(id => id.trim()).filter(Boolean))).sort();
}

function isFinalHunkResolution(resolution: string): resolution is PendingEditFinalHunkResolution {
  return resolution === 'kept' || resolution === 'undone';
}

function summarizeTextFileCommitToken(
  token: WorkspaceTextFileCommitToken | WorkspaceTextFileDeleteCommitToken | undefined,
): RunEvidenceJson {
  if (!token) throw new Error('Pending edit undo receipt requires a mutation commit token');
  return {
    abs_path: token.absPath,
    workspace_root: token.workspaceRoot,
    before: summarizeTextFileBaseline(token.before),
    after: summarizeTextFileBaseline(token.after),
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

function fingerprintResolution(proof: RunEvidenceJson): string {
  return crypto.createHash('sha256').update(stableStringify(proof), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}
