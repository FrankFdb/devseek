import { MemoryStore } from '../memory/memory-store';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type { MemoryQuery, MemoryRecord, MemoryWriteProposal } from '../memory/types';

const DEFAULT_MEMORY_LIMIT = 20;
const DEFAULT_CONTEXT_CHARS = 3000;

export interface MemoryServiceDeps {
  workspaceRoot: string;
  store?: MemoryStore;
  guard?: SensitiveMemoryGuard;
}

export class MemoryService {
  private readonly store: MemoryStore;
  private readonly guard: SensitiveMemoryGuard;

  constructor(deps: MemoryServiceDeps) {
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

  retrievePromptContext(maxChars = DEFAULT_CONTEXT_CHARS): string | null {
    const activeRecords = this.retrieve({ limit: DEFAULT_MEMORY_LIMIT });
    const structured = activeRecords.length > 0
      ? activeRecords.map((record) => `- [${record.type}/${record.scope}] ${record.content}`).join('\n')
      : '';
    const legacy = this.store.readLegacyMarkdown(maxChars);
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
