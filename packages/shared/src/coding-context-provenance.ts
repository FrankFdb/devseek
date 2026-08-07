import { createHash } from 'node:crypto';

export const CODING_CONTEXT_PROVENANCE_VERSION = 'devseek.coding-context-provenance/v1' as const;

export type CodingContextProvenanceKind =
  | 'runtime-policy'
  | 'user-request'
  | 'task-contract'
  | 'workspace-root'
  | 'workspace-file'
  | 'project-instruction'
  | 'derived-environment'
  | 'external-source';
export type CodingContextAuthority = 'runtime' | 'user' | 'kernel' | 'workspace' | 'external';
export type CodingContextTrust = 'authoritative' | 'workspace-controlled' | 'observed' | 'derived';

export interface CodingContextProvenanceInput {
  readonly sourceId: string;
  readonly kind: CodingContextProvenanceKind;
  readonly locator: string;
  readonly content?: string;
  readonly contentSha256?: string;
  readonly parentSourceIds?: readonly string[];
}

export interface CodingContextProvenanceRecord {
  readonly version: typeof CODING_CONTEXT_PROVENANCE_VERSION;
  readonly sourceId: string;
  readonly kind: CodingContextProvenanceKind;
  readonly locator: string;
  readonly authority: CodingContextAuthority;
  readonly trust: CodingContextTrust;
  readonly contentSha256?: string;
  readonly parentSourceIds: readonly string[];
  readonly recordSha256: string;
}

export interface ContextProvenancePort {
  capture(input: CodingContextProvenanceInput): CodingContextProvenanceRecord;
  captureMany(inputs: readonly CodingContextProvenanceInput[]): readonly CodingContextProvenanceRecord[];
}

/** Seals source identity and trust metadata without retaining source content. */
export class CanonicalContextProvenanceService implements ContextProvenancePort {
  capture(input: CodingContextProvenanceInput): CodingContextProvenanceRecord {
    if (!input || typeof input !== 'object') provenanceFailure('invalid-input');
    const sourceId = requireText(input.sourceId, 'invalid-source-id');
    const kind = requireKind(input.kind);
    const locator = requireText(input.locator, 'invalid-locator');
    const parentSourceIds = Object.freeze(uniqueText(input.parentSourceIds ?? [], 'invalid-parent-source-id'));
    if (parentSourceIds.includes(sourceId)) provenanceFailure('self-parent');
    const suppliedHash = input.contentSha256 === undefined
      ? undefined
      : requireSha256(input.contentSha256, 'invalid-content-sha256');
    const calculatedHash = input.content === undefined ? undefined : sha256(String(input.content));
    if (suppliedHash && calculatedHash && suppliedHash !== calculatedHash) {
      provenanceFailure('content-sha256-mismatch');
    }
    const contentSha256 = calculatedHash ?? suppliedHash;
    const { authority, trust } = classifySource(kind);
    const recordBase = {
      version: CODING_CONTEXT_PROVENANCE_VERSION,
      sourceId,
      kind,
      locator,
      authority,
      trust,
      ...(contentSha256 ? { contentSha256 } : {}),
      parentSourceIds,
    };
    return Object.freeze({ ...recordBase, recordSha256: sha256(JSON.stringify(recordBase)) });
  }

  captureMany(inputs: readonly CodingContextProvenanceInput[]): readonly CodingContextProvenanceRecord[] {
    if (!Array.isArray(inputs)) provenanceFailure('invalid-inputs');
    const records = inputs.map(input => this.capture(input));
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.sourceId)) provenanceFailure(`duplicate-source-id:${record.sourceId}`);
      ids.add(record.sourceId);
    }
    for (const record of records) {
      for (const parent of record.parentSourceIds) {
        if (!ids.has(parent)) provenanceFailure(`missing-parent-source:${parent}`);
      }
    }
    return Object.freeze(records);
  }
}

function classifySource(kind: CodingContextProvenanceKind): { authority: CodingContextAuthority; trust: CodingContextTrust } {
  if (kind === 'runtime-policy') return { authority: 'runtime', trust: 'authoritative' };
  if (kind === 'user-request') return { authority: 'user', trust: 'authoritative' };
  if (kind === 'task-contract') return { authority: 'kernel', trust: 'authoritative' };
  if (kind === 'project-instruction') return { authority: 'workspace', trust: 'workspace-controlled' };
  if (kind === 'derived-environment') return { authority: 'kernel', trust: 'derived' };
  if (kind === 'external-source') return { authority: 'external', trust: 'observed' };
  return { authority: 'workspace', trust: 'observed' };
}

function requireKind(value: unknown): CodingContextProvenanceKind {
  const kinds: readonly CodingContextProvenanceKind[] = [
    'runtime-policy', 'user-request', 'task-contract', 'workspace-root',
    'workspace-file', 'project-instruction', 'derived-environment', 'external-source',
  ];
  if (!kinds.includes(value as CodingContextProvenanceKind)) provenanceFailure('invalid-kind');
  return value as CodingContextProvenanceKind;
}

function uniqueText(values: readonly string[], reason: string): string[] {
  if (!Array.isArray(values)) provenanceFailure(reason);
  return [...new Set(values.map(value => requireText(value, reason)))];
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) provenanceFailure(reason);
  return value.trim();
}

function requireSha256(value: unknown, reason: string): string {
  const text = requireText(value, reason).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) provenanceFailure(reason);
  return text;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function provenanceFailure(reason: string): never {
  throw new Error(`coding-context-provenance:${reason}`);
}
