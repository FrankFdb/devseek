export type MemoryScope = 'session' | 'workspace' | 'repository' | 'user';

export type MemoryStatus = 'pending' | 'active' | 'disabled' | 'expired';

export type MemoryType =
  | 'project-rule'
  | 'user-preference'
  | 'verified-experience'
  | 'command-success'
  | 'session-summary';

export interface MemorySource {
  kind: 'user' | 'agent' | 'project-rule' | 'task-history' | 'legacy-import';
  ref?: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  ttl?: number;
  lastUsedAt?: number;
  status: MemoryStatus;
  tags: string[];
}

export interface MemoryQuery {
  scopes?: MemoryScope[];
  types?: MemoryType[];
  tags?: string[];
  limit?: number;
  includeDisabled?: boolean;
}

export interface MemoryWriteProposal {
  type: MemoryType;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  reason: string;
  tags?: string[];
  requiresUserApproval: boolean;
}
