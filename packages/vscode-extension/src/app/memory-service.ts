import { createHash } from 'crypto';
import {
  CanonicalMemoryPolicyService,
  classifyCodingMemoryWrite,
  codingMemorySourceIsExternal,
  codingMemorySourceIsTrusted,
  codingMemoryWriteRequiresApproval,
  renderCodingMemoryContext,
  type CodingMemoryCandidate,
  type CodingMemoryContextDecision,
  type MemoryPolicyPort,
} from '@devseek-netai/shared';
import { MemoryStore } from '../memory/memory-store';
import { MemoryReadService } from '../memory/memory-projection';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type { MemoryConsolidationProposal } from '../memory/pipeline-types';
import type { RepositoryMemoryLocation } from '../memory/repository-memory-location';
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
  hasContextAnchors,
} from './context-relevance';

const DEFAULT_MEMORY_LIMIT = 20;
const DEFAULT_MEMORY_MANAGEMENT_LIMIT = 100;
const DEFAULT_CONTEXT_CHARS = 3000;
const NO_CONTEXT_MATCH = Symbol('no-context-match');

export interface MemoryServiceDeps {
  workspaceRoot: string;
  memoryHome?: string;
  store?: MemoryStore;
  guard?: SensitiveMemoryGuard;
  policy?: MemoryPolicyPort;
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

type NormalizedMemoryWriteProposal = Omit<
  MemoryWriteProposal,
  'classification' | 'provenance' | 'tags'
> & {
  classification: MemoryClassification;
  provenance: MemoryProvenance;
  tags: string[];
};

export class MemoryService {
  private readonly store: MemoryStore;
  private readonly guard: SensitiveMemoryGuard;
  private readonly workspaceRoot: string;
  private readonly now: () => number;
  private readonly policy: MemoryPolicyPort;
  private readonly reader: MemoryReadService;

  constructor(deps: MemoryServiceDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    this.store = deps.store ?? new MemoryStore(deps.workspaceRoot, { memoryHome: deps.memoryHome });
    this.guard = deps.guard ?? new SensitiveMemoryGuard();
    this.now = deps.now ?? Date.now;
    this.policy = deps.policy ?? new CanonicalMemoryPolicyService();
    this.reader = new MemoryReadService(this.store.location);
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
      repositoryId: input.repositoryId,
      observedAt: input.observedAt,
      validFrom: input.validFrom,
      validTo: input.validTo,
      lastVerifiedAt: input.lastVerifiedAt,
      epistemicStatus: input.epistemicStatus,
      outcome: input.outcome,
      functionalStage: input.functionalStage,
      rolloutIds: input.rolloutIds,
      evidenceRefs: input.evidenceRefs,
      supersedes: input.supersedes,
      conflictsWith: input.conflictsWith,
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
    const now = this.now();
    const policyDecision = this.policy.assessWrite({
      candidate: proposalToCodingMemoryCandidate(normalized, this.workspaceRoot, now),
      workspaceRoot: this.workspaceRoot,
      now,
      sensitiveMatches: check.matches,
    });
    if (!policyDecision.allowed) {
      if (policyDecision.reasonCodes.includes('sensitive-content')) {
        throw new Error(check.reason ?? '记忆内容疑似包含敏感信息');
      }
      if (policyDecision.reasonCodes.includes('approval-required')) {
        throw new Error('持久记忆写入需要用户审批');
      }
      throw new Error(`记忆策略拒绝写入：${policyDecision.reasonCodes.join(', ')}`);
    }

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
      usageCount: 0,
      repositoryId: normalized.repositoryId ?? this.store.location.repositoryId,
      observedAt: normalized.observedAt ?? now,
      ...(normalized.validFrom === undefined ? {} : { validFrom: normalized.validFrom }),
      ...(normalized.validTo === undefined ? {} : { validTo: normalized.validTo }),
      ...(normalized.lastVerifiedAt === undefined ? {} : { lastVerifiedAt: normalized.lastVerifiedAt }),
      epistemicStatus: normalized.epistemicStatus ?? 'uncertain',
      outcome: normalized.outcome ?? 'uncertain',
      functionalStage: normalized.functionalStage ?? 'workflow',
      rolloutIds: normalized.rolloutIds ?? [],
      evidenceRefs: normalized.evidenceRefs ?? [],
      supersedes: normalized.supersedes ?? [],
      conflictsWith: normalized.conflictsWith ?? [],
      status: 'active',
      tags: normalized.tags ?? [],
    };
    const deduped = this.dedupeMemoryRecord(records, record, normalized.reason, now);
    if (deduped) return deduped;

    const superseded = this.supersedeConflictingMemoryRecords(records, record, normalized.reason, now);
    this.store.commit([...superseded.records, record], [
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

  acceptConsolidationProposal(
    proposal: MemoryConsolidationProposal,
    rolloutIds: readonly string[],
  ): MemoryRecord | undefined {
    const candidate = proposal.candidate;
    if (candidate.sourceAuthority === 'external') return undefined;
    if (candidate.sourceAuthority === 'assistant'
      && candidate.epistemicStatus !== 'tool-verified') return undefined;
    const source: MemorySource = candidate.sourceAuthority === 'user'
      ? { kind: 'user', ref: candidate.evidenceRefs[0] }
      : { kind: 'task-history', ref: candidate.evidenceRefs[0] };
    const write = this.proposeWrite({
      type: candidate.type,
      scope: candidate.scope,
      classification: candidate.classification,
      content: candidate.content,
      source,
      reason: proposal.reason,
      tags: [...candidate.tags, `stage:${candidate.functionalStage}`],
      requiresUserApproval: false,
      repositoryId: this.store.location.repositoryId,
      observedAt: this.now(),
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
      lastVerifiedAt: candidate.epistemicStatus === 'tool-verified' ? this.now() : undefined,
      epistemicStatus: candidate.epistemicStatus,
      outcome: candidate.outcome,
      functionalStage: candidate.functionalStage,
      rolloutIds: [...new Set(rolloutIds)],
      evidenceRefs: [...candidate.evidenceRefs],
      supersedes: [...proposal.supersedes],
    });
    const record = this.acceptWriteProposal(write);
    for (const previousId of proposal.supersedes) {
      if (previousId !== record.id) this.disable(previousId, `consolidated-by:${record.id}`);
    }
    return record;
  }

  getLocation(): RepositoryMemoryLocation {
    return this.store.location;
  }

  readSummary(): string {
    return this.reader.readSummary();
  }

  searchMemory(query: string, maxResults = 8): Array<{ path: string; line: number; text: string }> {
    return this.reader.search(query, maxResults);
  }

  readMemoryDetail(relativePath: string, startLine = 1, maxLines = 120): string {
    return this.reader.read(relativePath, startLine, maxLines);
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
    const receipt = this.createLifecycleReceipt({
      action: 'delete',
      recordId: target.id,
      statusBefore: target.status,
      reason,
      at: now,
      contentHash: hashText(target.content),
      recordSnapshotHash: hashMemoryRecordSnapshot(target),
    });
    this.store.commit(records.filter((record) => record.id !== id), [receipt]);
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

  recordContextUse(decision: CodingMemoryContextDecision, runId: string): MemoryLifecycleReceipt[] {
    renderCodingMemoryContext(decision);
    const selectedIds = new Set(decision.selected.map((entry) => entry.memoryId));
    if (selectedIds.size === 0) return [];
    const now = this.now();
    const receipts: MemoryLifecycleReceipt[] = [];
    const records = this.readNormalizedMemoryRecords();
    const next = records.map((record) => {
      if (!selectedIds.has(record.id) || record.status !== 'active') return record;
      const updated: MemoryRecord = {
        ...record,
        usageCount: (record.usageCount ?? 0) + 1,
        lastUsedAt: now,
      };
      receipts.push(this.createLifecycleReceipt({
        action: 'context-use',
        recordId: record.id,
        statusBefore: record.status,
        statusAfter: record.status,
        reason: `coding-run:${String(runId || 'unknown')}`,
        at: now,
        contentHash: hashText(record.content),
        recordSnapshotHash: hashMemoryRecordSnapshot(updated),
      }));
      return updated;
    });
    if (receipts.length > 0) this.store.commit(next, receipts);
    return receipts;
  }

  retrieveCodingMemoryCandidates(options: MemoryPromptContextOptions = {}): CodingMemoryCandidate[] {
    const records = this.retrieveRelevantRecords(options);
    const candidates = records === NO_CONTEXT_MATCH
      ? []
      : records.map(record => recordToCodingMemoryCandidate(record, this.workspaceRoot));
    const summary = this.readSummary().trim();
    if (!summary) return candidates;
    return [summaryToCodingMemoryCandidate(summary, this.store.location.repositoryId, this.workspaceRoot), ...candidates];
  }

  retrievePromptContext(options: MemoryPromptContextOptions | number = {}): string | null {
    const normalizedOptions = typeof options === 'number' ? { maxChars: options } : options;
    const maxChars = normalizedOptions.maxChars ?? DEFAULT_CONTEXT_CHARS;
    const relevantRecords = this.retrieveRelevantRecords(normalizedOptions);
    const summary = this.readSummary().trim();
    if (normalizedOptions.requireContextMatch && relevantRecords === NO_CONTEXT_MATCH) {
      return summary || null;
    }
    const records = relevantRecords === NO_CONTEXT_MATCH ? [] : relevantRecords;
    const policyDecision = this.policy.selectContext({
      candidates: records.map(record => recordToCodingMemoryCandidate(record, this.workspaceRoot)),
      workspaceRoot: this.workspaceRoot,
      now: this.now(),
      maxEntries: DEFAULT_MEMORY_LIMIT,
      maxChars,
    });
    const rendered = renderCodingMemoryContext(policyDecision);
    return [summary, rendered].filter(Boolean).join('\n\n') || null;
  }

  private retrieveRelevantRecords(options: MemoryPromptContextOptions): MemoryRecord[] | typeof NO_CONTEXT_MATCH {
    const anchorQuery = stripInjectedSessionContextForMemoryAnchors(options.query ?? '');
    const anchors = buildContextAnchors({
      workspaceRoot: this.workspaceRoot,
      prompt: anchorQuery,
      relatedPaths: options.relatedPaths ?? [],
    });
    const hasAnchors = hasContextAnchors(anchors);
    if (!hasAnchors) return NO_CONTEXT_MATCH;
    const matched = filterByContextAnchors(
      this.retrieve({ limit: DEFAULT_MEMORY_LIMIT }),
      anchors,
      (record) => `${record.content}\n${record.tags.join(' ')}`,
    );
    return matched.length > 0 ? matched : NO_CONTEXT_MATCH;
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
      usageCount: record.usageCount ?? 0,
      ...(record.lastUsedAt === undefined ? {} : { lastUsedAt: record.lastUsedAt }),
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
    this.store.commit(next, receipts);
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
    this.store.commit(next, receipts);
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
    this.store.commit(next, receipts);
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
      observedAt: Math.max(existing.observedAt ?? 0, incoming.observedAt ?? 0) || now,
      ...(incoming.validFrom === undefined ? {} : { validFrom: incoming.validFrom }),
      ...(incoming.validTo === undefined ? {} : { validTo: incoming.validTo }),
      ...(incoming.lastVerifiedAt === undefined ? {} : { lastVerifiedAt: incoming.lastVerifiedAt }),
      epistemicStatus: incoming.epistemicStatus ?? existing.epistemicStatus,
      outcome: incoming.outcome ?? existing.outcome,
      functionalStage: incoming.functionalStage ?? existing.functionalStage,
      rolloutIds: mergeMemoryTags(existing.rolloutIds ?? [], incoming.rolloutIds ?? []),
      evidenceRefs: mergeMemoryTags(existing.evidenceRefs ?? [], incoming.evidenceRefs ?? []),
      supersedes: mergeMemoryTags(existing.supersedes ?? [], incoming.supersedes ?? []),
      conflictsWith: mergeMemoryTags(existing.conflictsWith ?? [], incoming.conflictsWith ?? []),
    };
    const next = records.slice();
    next[index] = updated;
    this.store.commit(next, [this.createLifecycleReceipt({
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
    this.store.commit(next, [receipt]);
    return { changed: true, receipt };
  }
}

export function classifyMemoryWriteProposal(input: Partial<MemoryWriteProposal>): {
  type: MemoryType;
  scope: MemoryScope;
  classification: MemoryClassification;
} {
  const source = input.source ?? { kind: 'agent' };
  return classifyCodingMemoryWrite({
    type: input.type,
    scope: input.scope,
    sourceKind: source.kind,
  });
}

export function requiresPersistentMemoryApproval(input: {
  scope: MemoryScope;
  classification: MemoryClassification;
  source: MemorySource;
}): boolean {
  return codingMemoryWriteRequiresApproval({
    scope: input.scope,
    classification: input.classification,
    sourceKind: input.source.kind,
  });
}

function normalizeMemoryWriteProposal(
  input: Partial<MemoryWriteProposal> & { content?: string; reason?: string },
): NormalizedMemoryWriteProposal {
  const source = input.source ?? { kind: 'agent' };
  const classified = classifyMemoryWriteProposal({ ...input, source });
  const approvalRequired = input.requiresUserApproval === true
    || requiresPersistentMemoryApproval({ ...classified, source });
  const provenance = normalizeMemoryProvenance(
    input.provenance,
    source,
    approvalRequired,
  );
  return {
    type: classified.type,
    scope: classified.scope,
    classification: classified.classification,
    content: String(input.content ?? '').trim().slice(0, 2000),
    source,
    provenance,
    reason: input.reason ?? 'Memory write proposal',
    tags: input.tags ?? ['agent'],
    ttl: sanitizeMemoryTtl(input.ttl),
    requiresUserApproval: approvalRequired,
    repositoryId: typeof input.repositoryId === 'string' ? input.repositoryId.trim() : undefined,
    observedAt: sanitizeMemoryTimestamp(input.observedAt),
    validFrom: sanitizeMemoryTimestamp(input.validFrom),
    validTo: sanitizeMemoryTimestamp(input.validTo),
    lastVerifiedAt: sanitizeMemoryTimestamp(input.lastVerifiedAt),
    epistemicStatus: input.epistemicStatus,
    outcome: input.outcome,
    functionalStage: input.functionalStage,
    rolloutIds: sanitizeMemoryStrings(input.rolloutIds),
    evidenceRefs: sanitizeMemoryStrings(input.evidenceRefs),
    supersedes: sanitizeMemoryStrings(input.supersedes),
    conflictsWith: sanitizeMemoryStrings(input.conflictsWith),
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

function proposalToCodingMemoryCandidate(
  proposal: NormalizedMemoryWriteProposal,
  workspaceRoot: string,
  now: number,
): CodingMemoryCandidate {
  return {
    memoryId: `proposal:${hashText(proposal.content)}`,
    content: proposal.content,
    scope: proposal.scope,
    classification: proposal.classification,
    sourceKind: proposal.source.kind,
    ...(proposal.source.ref ? { sourceRef: proposal.source.ref } : {}),
    status: 'pending',
    approvalState: proposal.provenance.approvalState,
    externalContent: proposal.provenance.externalContent,
    trusted: proposal.provenance.trusted,
    workspaceRoot,
    createdAt: now,
    updatedAt: now,
    ...(proposal.ttl ? { expiresAt: now + proposal.ttl } : {}),
  };
}

function recordToCodingMemoryCandidate(
  record: MemoryRecord,
  workspaceRoot: string,
): CodingMemoryCandidate {
  return {
    memoryId: record.id,
    content: record.content,
    scope: record.scope,
    classification: record.classification,
    sourceKind: record.source.kind,
    ...(record.source.ref ? { sourceRef: record.source.ref } : {}),
    status: record.status,
    approvalState: record.provenance.approvalState,
    externalContent: record.provenance.externalContent,
    trusted: record.provenance.trusted,
    workspaceRoot,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    usageCount: record.usageCount ?? 0,
    ...(record.lastUsedAt === undefined ? {} : { lastUsedAt: record.lastUsedAt }),
    ...(record.ttl ? { expiresAt: record.createdAt + record.ttl } : {}),
  };
}

function summaryToCodingMemoryCandidate(
  content: string,
  repositoryId: string,
  workspaceRoot: string,
): CodingMemoryCandidate {
  return {
    memoryId: `memory-summary:${repositoryId.slice(0, 16)}`,
    content,
    scope: 'repository',
    classification: 'task',
    sourceKind: 'task-history',
    sourceRef: 'memory_summary.md',
    status: 'active',
    approvalState: 'not-required',
    externalContent: false,
    trusted: true,
    workspaceRoot,
    createdAt: 0,
    updatedAt: 0,
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
    usageCount: sanitizeMemoryUsageCount(record.usageCount),
    ...(Number.isSafeInteger(record.lastUsedAt) && Number(record.lastUsedAt) >= 0
      ? { lastUsedAt: Number(record.lastUsedAt) }
      : {}),
  };
  const ttl = sanitizeMemoryTtl(record.ttl);
  if (ttl === undefined) {
    delete (normalized as Partial<MemoryRecord>).ttl;
  } else {
    normalized.ttl = ttl;
  }
  if (!Number.isSafeInteger(record.lastUsedAt) || Number(record.lastUsedAt) < 0) {
    delete (normalized as Partial<MemoryRecord>).lastUsedAt;
  }
  return normalized;
}

function confidenceForMemorySource(source: MemorySource, provenance?: MemoryProvenance): number {
  if (source.kind === 'user') return 1;
  if (provenance?.externalContent) return 0.4;
  if (isTrustedMemorySource(source)) return 0.85;
  return 0.75;
}

function isTrustedMemorySource(source: MemorySource): boolean {
  return codingMemorySourceIsTrusted(source.kind);
}

function isExternalMemorySource(source: MemorySource): boolean {
  return codingMemorySourceIsExternal(source.kind);
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

function sanitizeMemoryUsageCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function sanitizeMemoryTimestamp(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function sanitizeMemoryStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim().slice(0, 500))
    .filter(Boolean))]
    .slice(0, 100);
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
