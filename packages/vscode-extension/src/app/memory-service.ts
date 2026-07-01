import { MemoryStore } from '../memory/memory-store';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type { MemoryQuery, MemoryRecord, MemoryWriteProposal } from '../memory/types';
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
      .filter((record) => query.includeDisabled || record.status === 'active')
      .filter((record) => !scopes || scopes.has(record.scope))
      .filter((record) => !types || types.has(record.type))
      .filter((record) => !tags || record.tags.some((tag) => tags.has(tag)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  proposeWrite(input: Partial<MemoryWriteProposal> & { content: string; reason: string }): MemoryWriteProposal {
    return {
      type: input.type ?? 'verified-experience',
      scope: input.scope ?? 'repository',
      content: input.content.trim().slice(0, 1000),
      source: input.source ?? { kind: 'agent' },
      reason: input.reason,
      tags: input.tags ?? ['agent'],
      requiresUserApproval: input.requiresUserApproval ?? false,
    };
  }

  acceptWriteProposal(proposal: MemoryWriteProposal): MemoryRecord {
    const check = this.guard.check(proposal.content);
    if (!check.allowed) {
      throw new Error(check.reason ?? '记忆内容疑似包含敏感信息');
    }

    const now = Date.now();
    return this.store.append({
      id: this.createId(now),
      type: proposal.type,
      scope: proposal.scope,
      content: proposal.content.trim().slice(0, 1000),
      source: proposal.source,
      confidence: proposal.source.kind === 'user' ? 1 : 0.75,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      tags: proposal.tags ?? [],
    });
  }

  appendAgentMemory(content: string): MemoryRecord {
    return this.acceptWriteProposal(this.proposeWrite({
      content,
      reason: 'Agent requested memory_write',
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
      ? activeRecords.map((record) => `- [${record.type}/${record.scope}] ${record.content}`).join('\n')
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
