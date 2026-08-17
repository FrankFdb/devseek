export type MemoryScope = 'session' | 'task' | 'workspace' | 'repository' | 'user';

export type MemoryStatus = 'pending' | 'active' | 'disabled' | 'expired' | 'revoked';

export type MemoryLifecycleAction =
  | 'write'
  | 'context-use'
  | 'dedupe-update'
  | 'conflict-supersede'
  | 'secret-redacted'
  | 'legacy-secret-redacted'
  | 'legacy-import-invalidated'
  | 'expire'
  | 'disable'
  | 'revoke'
  | 'delete';

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

export type MemoryEpistemicStatus = 'user-stated' | 'tool-verified' | 'inferred' | 'uncertain';

export type MemoryOutcome = 'success' | 'partial' | 'uncertain' | 'failure';

export type MemoryFunctionalStage =
  | 'analysis'
  | 'reproduction'
  | 'implementation'
  | 'verification'
  | 'recovery'
  | 'workflow';

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
  repositoryId?: string;
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
  usageCount?: number;
  lastUsedAt?: number;
  observedAt?: number;
  validFrom?: number;
  validTo?: number;
  lastVerifiedAt?: number;
  epistemicStatus?: MemoryEpistemicStatus;
  outcome?: MemoryOutcome;
  functionalStage?: MemoryFunctionalStage;
  rolloutIds?: string[];
  evidenceRefs?: string[];
  supersedes?: string[];
  conflictsWith?: string[];
  status: MemoryStatus;
  tags: string[];
}

export interface MemoryManagementEntry {
  id: string;
  label: string;
  description: string;
  detail: string;
  status: MemoryStatus;
  type: MemoryType;
  scope: MemoryScope;
  classification: MemoryClassification;
  sourceKind: MemorySourceKind;
  approvalState: MemoryApprovalState;
  trusted: boolean;
  contentPreview: string;
  usageCount: number;
  lastUsedAt?: number;
  lifecycleReceiptCount: number;
  accessibleLabel: string;
}

export interface MemoryLifecycleReceipt {
  id: string;
  action: MemoryLifecycleAction;
  recordId: string;
  previousRecordId?: string;
  statusBefore?: MemoryStatus;
  statusAfter?: MemoryStatus;
  reason: string;
  actor?: string;
  at: number;
  contentHash?: string;
  recordSnapshotHash?: string;
  sensitiveMatches?: string[];
  redactionCount?: number;
}

export interface MemoryLifecycleResult {
  changed: boolean;
  receipt?: MemoryLifecycleReceipt;
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
  ttl?: number;
  requiresUserApproval: boolean;
  repositoryId?: string;
  observedAt?: number;
  validFrom?: number;
  validTo?: number;
  lastVerifiedAt?: number;
  epistemicStatus?: MemoryEpistemicStatus;
  outcome?: MemoryOutcome;
  functionalStage?: MemoryFunctionalStage;
  rolloutIds?: string[];
  evidenceRefs?: string[];
  supersedes?: string[];
  conflictsWith?: string[];
}

export interface MemoryWriteResult {
  record?: MemoryRecord;
  blocked: boolean;
  reason?: string;
  sensitiveMatches: string[];
}
