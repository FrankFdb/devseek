import { MemoryStore } from '../memory/memory-store';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type {
  MemoryClassification,
  MemoryProvenance,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemorySource,
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
const DEFAULT_CONTEXT_CHARS = 3000;
const FILTERED_LEGACY_SCAN_CHARS = 12000;

export interface MemoryServiceDeps {
  workspaceRoot: string;
  store?: MemoryStore;
  guard?: SensitiveMemoryGuard;
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

  constructor(deps: MemoryServiceDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    this.store = deps.store ?? new MemoryStore(deps.workspaceRoot);
    this.guard = deps.guard ?? new SensitiveMemoryGuard();
  }

  retrieve(query: MemoryQuery = {}): MemoryRecord[] {
    const scopes = query.scopes ? new Set(query.scopes) : null;
    const types = query.types ? new Set(query.types) : null;
    const tags = query.tags ? new Set(query.tags) : null;
    const limit = query.limit ?? DEFAULT_MEMORY_LIMIT;

    return this.store.readAll()
      .map(record => normalizeStoredMemoryRecord(record))
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
      content: input.content,
      source: input.source,
      reason: input.reason,
      tags: input.tags,
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
        approvedAt: approval.approvedAt ?? Date.now(),
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

    const now = Date.now();
    return this.store.append({
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
      status: 'active',
      tags: normalized.tags ?? [],
    });
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

  disable(id: string): boolean {
    return this.store.disable(id);
  }

  delete(id: string): boolean {
    return this.store.delete(id);
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
    const legacy = legacyRaw ? filterLegacyMemoryMarkdownByContext(legacyRaw, anchors) : null;
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
  return {
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
