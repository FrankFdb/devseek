import { createHash } from 'crypto';
import { MemoryStore } from '../memory/memory-store';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type {
  MemoryClassification,
  MemoryLifecycleAction,
  MemoryLifecycleReceipt,
  MemoryLifecycleResult,
  MemoryManagementEntry,
  MemoryProvenance,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemorySource,
  MemoryStatus,
  MemoryType,
  MemoryWriteProposal,
} from '../memory/types';
import {
  buildContextAnchors,
  filterByContextAnchors,
  filterLegacyMemoryMarkdownByContext,
  hasContextAnchors,
} from './context-relevance';

const DEFAULT_MEMORY_LIMIT = 20;
const DEFAULT_MEMORY_MANAGEMENT_LIMIT = 100;
const DEFAULT_CONTEXT_CHARS = 3000;
const FILTERED_LEGACY_SCAN_CHARS = 12000;

export interface MemoryServiceDeps {
  workspaceRoot: string;
  store?: MemoryStore;
  guard?: SensitiveMemoryGuard;
  now?: () => number;
}

export interface MemoryPromptContextOptions {
  query?: string;
  relatedPaths?: readonly string[];
  maxChars?: number;
  requireContextMatch?: boolean;
}

export interface MemoryApprovalInput {
  approvedBy: string;
  approvalRef: string;
  approvedAt?: number;
}

export class MemoryService {
  private readonly store: MemoryStore;
  private readonly guard: SensitiveMemoryGuard;
  private readonly workspaceRoot: string;
  private readonly now: () => number;

  constructor(deps: MemoryServiceDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    this.store = deps.store ?? new MemoryStore(deps.workspaceRoot);
    this.guard = deps.guard ?? new SensitiveMemoryGuard();
    this.now = deps.now ?? Date.now;
  }

  retrieve(query: MemoryQuery = {}): MemoryRecord[] {
    this.sanitizeSensitiveMemoryRecords();
    this.invalidateLegacyImportedMemoryRecords();
    this.refreshExpiredMemoryRecords();
    const scopes = query.scopes ? new Set(query.scopes) : null;
    const types = query.types ? new Set(query.types) : null;
    const tags = query.tags ? new Set(query.tags) : null;
    const limit = query.limit ?? DEFAULT_MEMORY_LIMIT;

    return this.readNormalizedMemoryRecords()
      .filter((record) => query.includeDisabled || record.status === 'active')
      .filter((record) => !scopes || scopes.has(record.scope))
      .filter((record) => !types || types.has(record.type))
      .filter((record) => !tags || record.tags.some((tag) => tags.has(tag)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  proposeWrite(input: Partial<MemoryWriteProposal> & { content: string; reason: string }): MemoryWriteProposal {
    return normalizeMemoryWriteProposal({
      type: input.type,
      scope: input.scope,
      classification: input.classification,
      content: input.content,
      source: input.source,
      provenance: input.provenance,
      reason: input.reason,
      tags: input.tags,
      ttl: input.ttl,
      requiresUserApproval: input.requiresUserApproval,
    });
  }

  approveWriteProposal(proposal: MemoryWriteProposal, approval: MemoryApprovalInput): MemoryWriteProposal {
    const normalized = normalizeMemoryWriteProposal(proposal);
    return {
      ...normalized,
      provenance: {
        ...normalized.provenance,
        approvalState: 'approved',
        approvalRef: approval.approvalRef,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt ?? this.now(),
      },
    };
  }

  acceptWriteProposal(proposal: MemoryWriteProposal): MemoryRecord {
    const normalized = normalizeMemoryWriteProposal(proposal);
    const check = this.guard.check(normalized.content);
    if (!check.allowed) {
      throw new Error(check.reason ?? '记忆内容疑似包含敏感信息');
    }
    if (
      normalized.requiresUserApproval
      && normalized.provenance?.approvalState !== 'approved'
    ) {
      throw new Error('持久记忆写入需要用户审批');
    }

    const now = this.now();
    this.refreshExpiredMemoryRecords(now);
    const records = this.readNormalizedMemoryRecords();
    const record: MemoryRecord = {
      id: this.createId(now),
      type: normalized.type,
      scope: normalized.scope,
      classification: normalized.classification ?? 'workspace',
      content: normalized.content,
      source: normalized.source,
      provenance: normalized.provenance ?? buildMemoryProvenance(normalized.source, normalized.requiresUserApproval),
      requiresUserApproval: normalized.requiresUserApproval,
      confidence: confidenceForMemorySource(normalized.source, normalized.provenance),
      createdAt: now,
      updatedAt: now,
      ...(normalized.ttl ? { ttl: normalized.ttl } : {}),
      status: 'active',
      tags: normalized.tags ?? [],
    };
    const deduped = this.dedupeMemoryRecord(records, record, normalized.reason, now);
    if (deduped) return deduped;

    const superseded = this.supersedeConflictingMemoryRecords(records, record, normalized.reason, now);
    this.store.writeAll([...superseded.records, record]);
    this.appendLifecycleReceipts([
      ...superseded.receipts,
      this.createLifecycleReceipt({
        action: 'write',
        recordId: record.id,
        statusAfter: 'active',
        reason: normalized.reason,
        at: now,
        contentHash: hashText(record.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(record),
      }),
    ]);
    return record;
  }

  appendAgentMemory(content: string): MemoryRecord {
    const proposal = this.proposeWrite({
      content,
      reason: 'Agent requested memory_write',
    });
    return this.acceptWriteProposal(this.approveWriteProposal(proposal, {
      approvedBy: 'devseek-internal-appendAgentMemory',
      approvalRef: 'memory-service.appendAgentMemory',
    }));
  }

  disable(id: string, reason = 'manual-disable'): MemoryLifecycleResult {
    return this.transitionMemoryRecordStatus(id, 'disabled', 'disable', reason);
  }

  revoke(id: string, reason = 'manual-revoke'): MemoryLifecycleResult {
    return this.transitionMemoryRecordStatus(id, 'revoked', 'revoke', reason);
  }

  delete(id: string, reason = 'manual-delete'): MemoryLifecycleResult {
    this.refreshExpiredMemoryRecords();
    const now = this.now();
    const records = this.readNormalizedMemoryRecords();
    const target = records.find((record) => record.id === id);
    if (!target) return { changed: false };
    this.store.writeAll(records.filter((record) => record.id !== id));
    const receipt = this.createLifecycleReceipt({
      action: 'delete',
      recordId: target.id,
      statusBefore: target.status,
      reason,
      at: now,
      contentHash: hashText(target.content),
      recordSnapshotHash: hashMemoryRecordSnapshot(target),
    });
    this.appendLifecycleReceipts([receipt]);
    return { changed: true, receipt };
  }

  listManagementEntries(query: MemoryQuery = {}): MemoryManagementEntry[] {
    const receiptsByRecord = this.countLifecycleReceiptsByRecord();
    return this.retrieve({
      ...query,
      includeDisabled: true,
      limit: query.limit ?? DEFAULT_MEMORY_MANAGEMENT_LIMIT,
    }).map((record) => this.projectMemoryManagementEntry(
      record,
      receiptsByRecord.get(record.id) ?? 0,
    ));
  }

  viewManagementEntry(id: string): MemoryManagementEntry | undefined {
    this.sanitizeSensitiveMemoryRecords();
    this.invalidateLegacyImportedMemoryRecords();
    this.refreshExpiredMemoryRecords();
    const record = this.readNormalizedMemoryRecords().find((candidate) => candidate.id === id);
    if (!record) return undefined;
    return this.projectMemoryManagementEntry(
      record,
      this.countLifecycleReceiptsByRecord().get(record.id) ?? 0,
    );
  }

  disableFromManagementSurface(id: string): MemoryLifecycleResult {
    return this.disable(id, 'memory-management-surface:disable');
  }

  deleteFromManagementSurface(id: string): MemoryLifecycleResult {
    return this.delete(id, 'memory-management-surface:delete');
  }

  getLifecycleReceipts(): MemoryLifecycleReceipt[] {
    return this.store.readLifecycleReceipts();
  }

  retrievePromptContext(options: MemoryPromptContextOptions | number = {}): string | null {
    const normalizedOptions = typeof options === 'number' ? { maxChars: options } : options;
    const maxChars = normalizedOptions.maxChars ?? DEFAULT_CONTEXT_CHARS;
    const anchorQuery = stripInjectedSessionContextForMemoryAnchors(normalizedOptions.query ?? '');
    const anchors = buildContextAnchors({
      workspaceRoot: this.workspaceRoot,
      prompt: anchorQuery,
      relatedPaths: normalizedOptions.relatedPaths ?? [],
    });
    const hasAnchors = hasContextAnchors(anchors);
    if (normalizedOptions.requireContextMatch && !hasAnchors) {
      return null;
    }

    const activeRecords = filterByContextAnchors(
      this.retrieve({ limit: DEFAULT_MEMORY_LIMIT }),
      anchors,
      (record) => `${record.content}\n${record.tags.join(' ')}`,
    );
    const structured = activeRecords.length > 0
      ? activeRecords.map((record) => renderStructuredMemoryPromptLine(record)).join('\n')
      : '';
    const legacyRaw = this.store.readLegacyMarkdown(hasAnchors ? Math.max(maxChars, FILTERED_LEGACY_SCAN_CHARS) : maxChars);
    const legacy = legacyRaw
      ? this.sanitizeLegacyMemoryMarkdownForPrompt(filterLegacyMemoryMarkdownByContext(legacyRaw, anchors))
      : null;
    const combined = [
      structured ? `[DevSeek structured memory]\n${structured}` : '',
      legacy ? `[DevSeek legacy memory]\n${legacy}` : '',
    ].filter(Boolean).join('\n\n').trim();

    return combined.slice(0, maxChars) || null;
  }

  ensureLegacyMemoryFile(): string {
    return this.store.ensureLegacyMarkdownFile();
  }

  getLegacyMemoryPath(): string {
    return this.store.getLegacyMemoryPath();
  }

  private createId(now: number): string {
    return `mem_${now}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private createLifecycleReceipt(input: Omit<MemoryLifecycleReceipt, 'id'>): MemoryLifecycleReceipt {
    const stableKey = [
      input.action,
      input.recordId,
      input.previousRecordId ?? '',
      input.statusBefore ?? '',
      input.statusAfter ?? '',
      input.reason,
      input.at,
    ].join('\n');
    return {
      id: `mem_life_${input.at}_${hashText(stableKey).slice(0, 10)}`,
      ...input,
    };
  }

  private appendLifecycleReceipts(receipts: MemoryLifecycleReceipt[]): void {
    for (const receipt of receipts) this.store.appendLifecycleReceipt(receipt);
  }

  private appendLifecycleReceiptOnce(receipt: MemoryLifecycleReceipt): void {
    const exists = this.store.readLifecycleReceipts().some((existing) => (
      existing.action === receipt.action
      && existing.recordId === receipt.recordId
      && existing.contentHash === receipt.contentHash
    ));
    if (!exists) this.store.appendLifecycleReceipt(receipt);
  }

  private readNormalizedMemoryRecords(): MemoryRecord[] {
    return this.store.readAll().map(record => normalizeStoredMemoryRecord(record));
  }

  private countLifecycleReceiptsByRecord(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const receipt of this.store.readLifecycleReceipts()) {
      counts.set(receipt.recordId, (counts.get(receipt.recordId) ?? 0) + 1);
    }
    return counts;
  }

  private projectMemoryManagementEntry(
    record: MemoryRecord,
    lifecycleReceiptCount: number,
  ): MemoryManagementEntry {
    const sourceKind = record.provenance?.sourceKind ?? record.source.kind;
    const approvalState = record.provenance?.approvalState ?? 'not-required';
    const trusted = record.provenance?.trusted ?? isTrustedMemorySource(record.source);
    const contentPreview = collapseMemoryPreview(record.content, 180);
    const label = `${record.type} (${record.status})`;
    const description = [
      record.scope,
      record.classification,
      `source=${sourceKind}`,
      `approval=${approvalState}`,
    ].join(' | ');
    const detail = [
      contentPreview,
      record.tags.length > 0 ? `tags=${record.tags.join(', ')}` : '',
      `receipts=${lifecycleReceiptCount}`,
    ].filter(Boolean).join(' | ');
    const accessibleLabel = [
      `Memory ${record.id}`,
      `status ${record.status}`,
      `type ${record.type}`,
      `scope ${record.scope}`,
      `classification ${record.classification}`,
      `source ${sourceKind}`,
      `approval ${approvalState}`,
      trusted ? 'trusted' : 'untrusted',
      contentPreview,
    ].join('; ');
    return {
      id: record.id,
      label,
      description,
      detail,
      status: record.status,
      type: record.type,
      scope: record.scope,
      classification: record.classification,
      sourceKind,
      approvalState,
      trusted,
      contentPreview,
      lifecycleReceiptCount,
      accessibleLabel,
    };
  }

  private sanitizeSensitiveMemoryRecords(now = this.now()): void {
    const records = this.readNormalizedMemoryRecords();
    const receipts: MemoryLifecycleReceipt[] = [];
    const next = records.map((record) => {
      const redaction = this.guard.redact(record.content);
      if (!redaction.redacted) return record;
      const sanitized: MemoryRecord = {
        ...record,
        content: redaction.text,
        updatedAt: now,
        tags: mergeMemoryTags(record.tags, ['sensitive-redacted']),
      };
      receipts.push(this.createLifecycleReceipt({
        action: 'secret-redacted',
        recordId: record.id,
        statusBefore: record.status,
        statusAfter: sanitized.status,
        reason: 'memory secret redacted before projection',
        at: now,
        contentHash: hashText(sanitized.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(record),
        sensitiveMatches: redaction.matches,
        redactionCount: redaction.redactionCount,
      }));
      return sanitized;
    });
    if (receipts.length === 0) return;
    this.store.writeAll(next);
    this.appendLifecycleReceipts(receipts);
  }

  private sanitizeLegacyMemoryMarkdownForPrompt(markdown: string): string | null {
    const content = String(markdown || '').trim();
    if (!content) return null;
    const redaction = this.guard.redact(content);
    if (redaction.redacted) {
      this.appendLifecycleReceiptOnce(this.createLifecycleReceipt({
        action: 'legacy-secret-redacted',
        recordId: 'legacy-memory.md',
        reason: 'legacy memory is untrusted; secrets redacted before prompt projection',
        at: this.now(),
        contentHash: hashText(content),
        recordSnapshotHash: hashText(redaction.text),
        sensitiveMatches: redaction.matches,
        redactionCount: redaction.redactionCount,
      }));
    }
    return redaction.text;
  }

  private invalidateLegacyImportedMemoryRecords(now = this.now()): void {
    const records = this.readNormalizedMemoryRecords();
    const receipts: MemoryLifecycleReceipt[] = [];
    const next = records.map((record) => {
      if (!isLegacyImportedMemoryRecord(record) || record.status === 'revoked') return record;
      const revoked: MemoryRecord = {
        ...record,
        status: 'revoked',
        updatedAt: now,
        tags: mergeMemoryTags(record.tags, ['legacy-import-invalidated']),
      };
      receipts.push(this.createLifecycleReceipt({
        action: 'legacy-import-invalidated',
        recordId: record.id,
        statusBefore: record.status,
        statusAfter: 'revoked',
        reason: 'legacy memory is untrusted; structured import invalidated',
        at: now,
        contentHash: hashText(record.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(record),
      }));
      return revoked;
    });
    if (receipts.length === 0) return;
    this.store.writeAll(next);
    this.appendLifecycleReceipts(receipts);
  }

  private refreshExpiredMemoryRecords(now = this.now()): void {
    const records = this.readNormalizedMemoryRecords();
    const receipts: MemoryLifecycleReceipt[] = [];
    const next = records.map((record) => {
      if (!isActiveMemoryRecord(record) || !isMemoryRecordExpired(record, now)) return record;
      const expired: MemoryRecord = { ...record, status: 'expired', updatedAt: now };
      receipts.push(this.createLifecycleReceipt({
        action: 'expire',
        recordId: record.id,
        statusBefore: record.status,
        statusAfter: 'expired',
        reason: 'memory ttl expired',
        at: now,
        contentHash: hashText(record.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(record),
      }));
      return expired;
    });
    if (receipts.length === 0) return;
    this.store.writeAll(next);
    this.appendLifecycleReceipts(receipts);
  }

  private dedupeMemoryRecord(
    records: MemoryRecord[],
    incoming: MemoryRecord,
    reason: string,
    now: number,
  ): MemoryRecord | null {
    const incomingContentKey = normalizeMemoryContentKey(incoming.content);
    const index = records.findIndex((record) => (
      isActiveMemoryRecord(record)
      && hasSameMemoryIdentity(record, incoming)
      && normalizeMemoryContentKey(record.content) === incomingContentKey
    ));
    if (index < 0) return null;

    const existing = records[index];
    const updated: MemoryRecord = {
      ...existing,
      source: incoming.source,
      provenance: incoming.provenance,
      requiresUserApproval: incoming.requiresUserApproval,
      confidence: Math.max(existing.confidence, incoming.confidence),
      updatedAt: now,
      ...(incoming.ttl ? { ttl: incoming.ttl } : {}),
      tags: mergeMemoryTags(existing.tags, incoming.tags),
    };
    const next = records.slice();
    next[index] = updated;
    this.store.writeAll(next);
    this.appendLifecycleReceipts([this.createLifecycleReceipt({
      action: 'dedupe-update',
      recordId: existing.id,
      statusBefore: existing.status,
      statusAfter: updated.status,
      reason,
      at: now,
      contentHash: hashText(updated.content),
      recordSnapshotHash: hashMemoryRecordSnapshot(updated),
    })]);
    return updated;
  }

  private supersedeConflictingMemoryRecords(
    records: MemoryRecord[],
    incoming: MemoryRecord,
    reason: string,
    now: number,
  ): { records: MemoryRecord[]; receipts: MemoryLifecycleReceipt[] } {
    const incomingKeys = memoryConflictKeys(incoming);
    if (incomingKeys.length === 0) return { records, receipts: [] };
    const incomingKeySet = new Set(incomingKeys);
    const receipts: MemoryLifecycleReceipt[] = [];
    const next = records.map((record) => {
      if (
        !isActiveMemoryRecord(record)
        || !hasSameMemoryIdentity(record, incoming)
        || normalizeMemoryContentKey(record.content) === normalizeMemoryContentKey(incoming.content)
        || !memoryConflictKeys(record).some((key) => incomingKeySet.has(key))
      ) {
        return record;
      }
      const disabled: MemoryRecord = { ...record, status: 'disabled', updatedAt: now };
      receipts.push(this.createLifecycleReceipt({
        action: 'conflict-supersede',
        recordId: incoming.id,
        previousRecordId: record.id,
        statusBefore: record.status,
        statusAfter: 'disabled',
        reason,
        at: now,
        contentHash: hashText(incoming.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(record),
      }));
      return disabled;
    });
    return { records: next, receipts };
  }

  private transitionMemoryRecordStatus(
    id: string,
    status: Extract<MemoryStatus, 'disabled' | 'revoked'>,
    action: Extract<MemoryLifecycleAction, 'disable' | 'revoke'>,
    reason: string,
  ): MemoryLifecycleResult {
    this.refreshExpiredMemoryRecords();
    const now = this.now();
    const records = this.readNormalizedMemoryRecords();
    const index = records.findIndex((record) => record.id === id);
    if (index < 0 || records[index].status === status) return { changed: false };
    const target = records[index];
    const updated: MemoryRecord = { ...target, status, updatedAt: now };
    const next = records.slice();
    next[index] = updated;
    this.store.writeAll(next);
    const receipt = this.createLifecycleReceipt({
      action,
      recordId: id,
      statusBefore: target.status,
      statusAfter: status,
      reason,
      at: now,
      contentHash: hashText(target.content),
      recordSnapshotHash: hashMemoryRecordSnapshot(target),
    });
    this.appendLifecycleReceipts([receipt]);
    return { changed: true, receipt };
  }
}

export function classifyMemoryWriteProposal(input: Partial<MemoryWriteProposal>): {
  type: MemoryType;
  scope: MemoryScope;
  classification: MemoryClassification;
} {
  const requestedType = input.type ?? 'verified-experience';
  const requestedScope = input.scope ?? 'repository';
  const source = input.source ?? { kind: 'agent' };
  const externalContent = isExternalMemorySource(source);
  let type = requestedType;
  let scope = requestedScope;
  let classification: MemoryClassification;

  if (scope === 'session' || type === 'session-summary') {
    classification = 'ephemeral';
    scope = 'session';
    type = 'session-summary';
  } else if (scope === 'user' || type === 'user-preference') {
    classification = 'preference';
    scope = 'user';
    type = 'user-preference';
  } else if (type === 'project-rule' || source.kind === 'project-rule') {
    classification = 'instruction';
    type = 'project-rule';
  } else if (scope === 'task' || source.kind === 'task-history') {
    classification = 'task';
    scope = 'task';
  } else {
    classification = 'workspace';
  }

  if (externalContent && (classification === 'instruction' || classification === 'preference')) {
    // R3-05A: external content cannot become privileged memory.
    classification = 'task';
    scope = 'task';
    type = 'verified-experience';
  }

  return { type, scope, classification };
}

export function requiresPersistentMemoryApproval(input: {
  scope: MemoryScope;
  classification: MemoryClassification;
  source: MemorySource;
}): boolean {
  if (input.scope === 'session' || input.classification === 'ephemeral') return false;
  if (input.source.kind === 'user') return false;
  return true;
}

function normalizeMemoryWriteProposal(input: Partial<MemoryWriteProposal> & { content?: string; reason?: string }): MemoryWriteProposal {
  const source = input.source ?? { kind: 'agent' };
  const classified = classifyMemoryWriteProposal({ ...input, source });
  const approvalRequired = input.requiresUserApproval === true
    || requiresPersistentMemoryApproval({ ...classified, source });
  const provenance = normalizeMemoryProvenance(
    input.provenance,
    source,
    approvalRequired,
    classified.classification,
  );
  return {
    type: classified.type,
    scope: classified.scope,
    classification: classified.classification,
    content: String(input.content ?? '').trim().slice(0, 1000),
    source,
    provenance,
    reason: input.reason ?? 'Memory write proposal',
    tags: input.tags ?? ['agent'],
    ttl: sanitizeMemoryTtl(input.ttl),
    requiresUserApproval: approvalRequired,
  };
}

function normalizeMemoryProvenance(
  provenance: MemoryProvenance | undefined,
  source: MemorySource,
  requiresApproval: boolean,
): MemoryProvenance {
  const approved = provenance?.approvalState === 'approved'
    && Boolean(provenance.approvalRef)
    && Boolean(provenance.approvedBy);
  const approvalState = approved
    ? 'approved'
    : requiresApproval ? 'required' : 'not-required';
  return {
    sourceKind: source.kind,
    ...(source.ref ? { sourceRef: source.ref } : {}),
    externalContent: isExternalMemorySource(source),
    trusted: isTrustedMemorySource(source) && !isExternalMemorySource(source),
    capturedAt: provenance?.capturedAt ?? Date.now(),
    approvalState,
    ...(provenance?.approvalRef ? { approvalRef: provenance.approvalRef } : {}),
    ...(provenance?.approvedBy ? { approvedBy: provenance.approvedBy } : {}),
    ...(provenance?.approvedAt ? { approvedAt: provenance.approvedAt } : {}),
  };
}

function buildMemoryProvenance(
  source: MemorySource,
  requiresApproval: boolean,
): MemoryProvenance {
  return normalizeMemoryProvenance(undefined, source, requiresApproval);
}

function normalizeStoredMemoryRecord(record: MemoryRecord): MemoryRecord {
  const source = record.source ?? { kind: 'legacy-import' as const };
  const classified = classifyMemoryWriteProposal({ ...record, source });
  const requiresApproval = record.requiresUserApproval
    ?? requiresPersistentMemoryApproval({ ...classified, source });
  const normalized: MemoryRecord = {
    ...record,
    type: classified.type,
    scope: classified.scope,
    source,
    classification: record.classification ?? classified.classification,
    provenance: normalizeMemoryProvenance(
      record.provenance,
      source,
      requiresApproval,
    ),
    requiresUserApproval: requiresApproval,
  };
  const ttl = sanitizeMemoryTtl(record.ttl);
  if (ttl === undefined) {
    delete (normalized as Partial<MemoryRecord>).ttl;
  } else {
    normalized.ttl = ttl;
  }
  return normalized;
}

function renderStructuredMemoryPromptLine(record: MemoryRecord): string {
  return [
    `- [${record.type}/${record.scope}/${record.classification}`,
    `source=${record.source.kind}`,
    `approval=${record.provenance.approvalState}]`,
    record.content,
  ].join(' ');
}

function confidenceForMemorySource(source: MemorySource, provenance?: MemoryProvenance): number {
  if (source.kind === 'user') return 1;
  if (provenance?.externalContent) return 0.4;
  if (isTrustedMemorySource(source)) return 0.85;
  return 0.75;
}

function isTrustedMemorySource(source: MemorySource): boolean {
  return source.kind === 'user' || source.kind === 'project-rule' || source.kind === 'task-history';
}

function isExternalMemorySource(source: MemorySource): boolean {
  return source.kind === 'external' || source.kind === 'legacy-import';
}

function isLegacyImportedMemoryRecord(record: MemoryRecord): boolean {
  return record.source?.kind === 'legacy-import' || record.provenance?.sourceKind === 'legacy-import';
}

function isActiveMemoryRecord(record: MemoryRecord): boolean {
  return record.status === 'active';
}

function isMemoryRecordExpired(record: MemoryRecord, now: number): boolean {
  return typeof record.ttl === 'number' && record.ttl > 0 && record.createdAt + record.ttl <= now;
}

function hasSameMemoryIdentity(left: MemoryRecord, right: MemoryRecord): boolean {
  return (
    left.type === right.type
    && left.scope === right.scope
    && left.classification === right.classification
  );
}

function normalizeMemoryContentKey(content: string): string {
  return String(content || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function collapseMemoryPreview(content: string, maxChars: number): string {
  const normalized = String(content || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}...`;
}

function memoryConflictKeys(record: Pick<MemoryRecord, 'tags'>): string[] {
  const keys = new Set<string>();
  for (const tag of record.tags ?? []) {
    const normalized = String(tag || '').trim().toLowerCase();
    if (/^(command|preference|subject|key|conflict):/.test(normalized)) {
      keys.add(normalized);
    }
  }
  return [...keys];
}

function mergeMemoryTags(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}

function sanitizeMemoryTtl(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return undefined;
  return Math.floor(ttl);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hashMemoryRecordSnapshot(record: MemoryRecord): string {
  return hashText(JSON.stringify(record));
}

function stripInjectedSessionContextForMemoryAnchors(query: string): string {
  const text = String(query || '');
  if (!text.trim()) return '';
  const markers = [
    '【同一会话续作上下文】',
    '【同一会话上下文】',
    '【当前用户消息】',
    '【上轮已创建/修改的文件',
    '【上轮分析已发现以下问题',
  ];
  let end = text.length;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index >= 0) end = Math.min(end, index);
  }
  return text.slice(0, end).trim();
}
