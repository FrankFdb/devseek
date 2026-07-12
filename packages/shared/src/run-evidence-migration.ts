import * as crypto from 'crypto';

import {
  LEGACY_EVIDENCE_TRUST,
  type LegacyEvidenceImportInput,
} from './run-evidence-integration';
import { type RunEvidenceJson, sha256RunEvidence } from './run-evidence-ledger';

export interface LegacyTaskHistoryRecordLike {
  id?: unknown;
  status?: unknown;
  workflowMode?: unknown;
  provider?: { type?: unknown } | null;
  changedFiles?: unknown;
  operationRefs?: unknown;
  validationRefs?: unknown;
  evidenceRefs?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LegacyReviewLedgerLike {
  files?: unknown;
  validation?: unknown;
  qualityGate?: unknown;
  unfinishedItems?: unknown;
}

export interface LegacyDiagnosticJsonlProjection {
  trust: typeof LEGACY_EVIDENCE_TRUST;
  source_digest_scope: 'raw-utf8-bytes';
  line_count: number;
  valid_json_record_count: number;
  invalid_line_count: number;
  run_ids: string[];
  sources: string[];
  phases: string[];
}

/**
 * Converts the old mutable TaskHistory projection into an explicitly untrusted
 * import descriptor. Goals, prompts and file contents are intentionally not
 * copied into the immutable diagnostic ledger.
 */
export function projectLegacyTaskHistory(
  records: readonly LegacyTaskHistoryRecordLike[],
  sourceRef = 'vscode-workspace-state:devseek.taskHistory',
): LegacyEvidenceImportInput {
  const normalized = records.map(record => ({
    id: textOrUnknown(record.id),
    status: textOrUnknown(record.status),
    workflow_mode: textOrUnknown(record.workflowMode),
    provider_type: textOrUnknown(record.provider?.type),
    changed_file_count: arrayLength(record.changedFiles),
    operation_ref_count: arrayLength(record.operationRefs),
    validation_ref_count: arrayLength(record.validationRefs),
    evidence_ref_count: arrayLength(record.evidenceRefs),
    created_at_ms: finiteNumberOrNull(record.createdAt),
    updated_at_ms: finiteNumberOrNull(record.updatedAt),
  }));
  const statusCounts: Record<string, number> = {};
  for (const record of normalized) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
  }
  return {
    sourceKind: 'task-history',
    sourceRef,
    sourceSha256: sha256RunEvidence(normalizeJson(records)),
    recordCount: normalized.length,
    projection: {
      trust: LEGACY_EVIDENCE_TRUST,
      source_digest_scope: 'canonical-normalized-input',
      status_counts: statusCounts,
      records: normalized,
    },
  };
}

/**
 * ReviewLedger is a mutable UI review projection, not an append-only proof.
 * Preserve only its digest and summary counts under the legacy-unverified tag.
 */
export function projectLegacyReviewLedger(
  snapshot: LegacyReviewLedgerLike,
  sourceRef: string,
): LegacyEvidenceImportInput {
  const normalized = normalizeJson(snapshot);
  const validation = objectValue(snapshot.validation);
  const qualityGate = objectValue(snapshot.qualityGate);
  const files = objectValue(snapshot.files);
  const projection: RunEvidenceJson = {
    trust: LEGACY_EVIDENCE_TRUST,
    source_digest_scope: 'canonical-normalized-input',
    snapshot_sha256: sha256RunEvidence(normalized),
    changed_file_count: inferChangedFileCount(files),
    validation_ran: validation.ran === true,
    validation_ok: typeof validation.ok === 'boolean' ? validation.ok : null,
    quality_gate_status: textOrUnknown(qualityGate.status),
    unfinished_item_count: arrayLength(snapshot.unfinishedItems),
  };
  return {
    sourceKind: 'review-ledger',
    sourceRef,
    sourceSha256: sha256RunEvidence(normalized),
    recordCount: 1,
    projection,
  };
}

/**
 * Parses old diagnostic JSONL as a lossy index. The original bytes are hashed,
 * while arbitrary payloads remain outside the trusted product event taxonomy.
 */
export function projectLegacyDiagnosticJsonl(
  content: string,
  sourceRef: string,
): LegacyEvidenceImportInput {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  let valid = 0;
  let invalid = 0;
  const runIds = new Set<string>();
  const sources = new Set<string>();
  const phases = new Set<string>();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        invalid += 1;
        continue;
      }
      valid += 1;
      addBoundedText(runIds, parsed.runId);
      addBoundedText(sources, parsed.source);
      addBoundedText(phases, parsed.phase);
    } catch {
      invalid += 1;
    }
  }
  const projection: LegacyDiagnosticJsonlProjection = {
    trust: LEGACY_EVIDENCE_TRUST,
    source_digest_scope: 'raw-utf8-bytes',
    line_count: lines.length,
    valid_json_record_count: valid,
    invalid_line_count: invalid,
    run_ids: [...runIds].sort(),
    sources: [...sources].sort(),
    phases: [...phases].sort(),
  };
  return {
    sourceKind: 'diagnostic-jsonl',
    sourceRef,
    sourceSha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    recordCount: valid,
    projection: projection as unknown as RunEvidenceJson,
  };
}

function normalizeJson(value: unknown): RunEvidenceJson {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === 'object') {
    const normalized: { [key: string]: RunEvidenceJson } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      normalized[key] = normalizeJson(item);
    }
    return normalized;
  }
  return String(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOrUnknown(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || 'unknown';
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function inferChangedFileCount(files: Record<string, unknown>): number {
  for (const key of ['changedPaths', 'files', 'changes']) {
    if (Array.isArray(files[key])) return files[key].length;
  }
  for (const key of ['changedCount', 'fileCount', 'total']) {
    if (typeof files[key] === 'number' && Number.isSafeInteger(files[key]) && (files[key] as number) >= 0) {
      return files[key] as number;
    }
  }
  return 0;
}

function addBoundedText(target: Set<string>, value: unknown): void {
  if (target.size >= 64 || typeof value !== 'string') return;
  const normalized = value.trim();
  if (normalized) target.add(normalized.slice(0, 256));
}
