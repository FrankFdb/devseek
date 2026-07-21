export type MemoryScope = 'session' | 'task' | 'workspace' | 'repository' | 'user';

export type MemoryStatus = 'pending' | 'active' | 'disabled' | 'expired';

export type MemoryClassification =
  | 'instruction'
  | 'workspace'
  | 'task'
  | 'preference'
  | 'ephemeral';

export type MemoryApprovalState = 'not-required' | 'required' | 'approved';

export type MemoryType =
  | 'project-rule'
  | 'user-preference'
  | 'verified-experience'
  | 'command-success'
  | 'session-summary';

export type MemorySourceKind =
  | 'user'
  | 'agent'
  | 'project-rule'
  | 'task-history'
  | 'legacy-import'
  | 'external';

export interface MemorySource {
  kind: MemorySourceKind;
  ref?: string;
}

export interface MemoryProvenance {
  sourceKind: MemorySourceKind;
  sourceRef?: string;
  externalContent: boolean;
  trusted: boolean;
  capturedAt: number;
  approvalState: MemoryApprovalState;
  approvalRef?: string;
  approvedBy?: string;
  approvedAt?: number;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  classification: MemoryClassification;
  content: string;
  source: MemorySource;
  provenance: MemoryProvenance;
  requiresUserApproval: boolean;
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
  classification?: MemoryClassification;
  content: string;
  source: MemorySource;
  provenance?: MemoryProvenance;
  reason: string;
  tags?: string[];
  requiresUserApproval: boolean;
}

export interface MemoryWriteResult {
  record?: MemoryRecord;
  blocked: boolean;
  reason?: string;
  sensitiveMatches: string[];
}
