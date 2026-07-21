import * as nodePath from 'path';

const WORKTREE_CONFLICT_PROTOCOL = {
  version: 'devseek.worktree-conflict/v1',
} as const;

const GENERATED_COMPAT_MIGRATION_PROTOCOL = {
  version: 'devseek.generated-compat-migration/v1',
} as const;

const GIT_DELIVERY_PROTOCOL = {
  version: 'devseek.git-delivery/v1',
} as const;

const WORKTREE_ISOLATION_PROTOCOL = {
  version: 'devseek.worktree-isolation/v1',
} as const;

export const WORKTREE_CONFLICT_PROTOCOL_VERSION = WORKTREE_CONFLICT_PROTOCOL.version;
export const GENERATED_COMPAT_MIGRATION_PROTOCOL_VERSION = GENERATED_COMPAT_MIGRATION_PROTOCOL.version;
export const GIT_DELIVERY_PROTOCOL_VERSION = GIT_DELIVERY_PROTOCOL.version;
export const WORKTREE_ISOLATION_PROTOCOL_VERSION = WORKTREE_ISOLATION_PROTOCOL.version;

export type WorktreeState =
  | 'clean'
  | 'dirty'
  | 'staged'
  | 'staged-and-dirty'
  | 'untracked'
  | 'deleted'
  | 'renamed'
  | 'conflicted';

export type WorktreeWriteDecisionKind = 'allow' | 'needs-user-approval' | 'block';
export type WorktreeTargetOwner = 'handwritten' | 'generated' | 'unknown';
export type WorktreeProposedOwner = 'handwritten-source' | 'generated-output' | 'unknown';
export type GeneratedCompatMigrationDecisionKind = 'allow' | 'blocked';
export type GitDeliveryEffectKind = 'commit' | 'push' | 'pull-request' | 'ci';
export type GitDeliveryDecisionKind = 'allow' | 'needs-user-approval' | 'block';
export type GitDeliveryCiStatus = 'passed' | 'failed' | 'not-run' | 'unknown';
export type WorktreeIsolationDecisionKind = 'allow' | 'block';

export type WorktreeWriteReason =
  | 'clean-owner-aligned-write'
  | 'dirty-user-changes-require-approval'
  | 'staged-user-changes-require-approval'
  | 'staged-and-dirty-user-changes-require-approval'
  | 'untracked-target-requires-approval'
  | 'deleted-target-requires-approval'
  | 'conflicted-worktree-state'
  | 'generated-boundary-owner-mismatch'
  | 'handwritten-owner-mismatch'
  | 'target-outside-workspace';

export type GeneratedCompatMigrationReason =
  | 'missing-migration-id'
  | 'missing-generated-boundary'
  | 'missing-handwritten-owner'
  | 'missing-compatibility-check'
  | 'missing-delete-step'
  | 'missing-rollback-step'
  | 'long-term-fallback-flag'
  | 'legacy-owner-revival-risk'
  | 'migration-evidence-missing';

export type GitDeliveryReason =
  | 'clean-authorized-git-delivery'
  | 'commit-requires-explicit-authorization'
  | 'push-requires-explicit-authorization'
  | 'pull-request-requires-explicit-authorization'
  | 'ci-requires-explicit-authorization'
  | 'dirty-or-staged-worktree-requires-approval'
  | 'conflicted-worktree-state'
  | 'ci-failure-blocks-delivery';

export interface WorktreeStatusEntry {
  relPath: string;
  originalRelPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  state: WorktreeState;
  raw: string;
}

export interface WorktreeConflictServiceOptions {
  workspaceRoot: string;
  generatedBoundaries?: readonly string[];
}

export interface WorktreeWriteInput {
  targetAbsPath: string;
  statusEntries: readonly WorktreeStatusEntry[];
  proposedOwner: WorktreeProposedOwner;
  generatedBoundaries?: readonly string[];
}

export interface WorktreeWriteDecision {
  version: typeof WORKTREE_CONFLICT_PROTOCOL.version;
  targetAbsPath: string;
  targetRelPath: string;
  targetOwner: WorktreeTargetOwner;
  proposedOwner: WorktreeProposedOwner;
  generatedBoundaryRelPath?: string;
  worktreeState: WorktreeState;
  statusEvidence: string;
  decision: WorktreeWriteDecisionKind;
  reason: WorktreeWriteReason;
}

export interface GeneratedCompatMigrationStep {
  target: string;
  action: string;
  evidenceId?: string;
}

export interface GeneratedCompatMigrationFallbackFlag {
  name: string;
  lifetime?: 'temporary' | 'permanent' | 'unknown' | string;
  expiresWithMigration?: boolean;
  evidenceId?: string;
}

export interface GeneratedCompatMigrationLegacyOwnerReference {
  target: string;
  revivalGuard?: boolean;
  evidenceId?: string;
}

export interface GeneratedCompatMigrationInput {
  migrationId?: string;
  generatedBoundaries?: readonly string[];
  handwrittenOwners?: readonly string[];
  compatibilityChecks?: readonly GeneratedCompatMigrationStep[];
  deleteSteps?: readonly GeneratedCompatMigrationStep[];
  rollbackSteps?: readonly GeneratedCompatMigrationStep[];
  fallbackFlags?: readonly GeneratedCompatMigrationFallbackFlag[];
  legacyOwnerReferences?: readonly GeneratedCompatMigrationLegacyOwnerReference[];
}

export interface GeneratedCompatMigrationReport {
  version: typeof GENERATED_COMPAT_MIGRATION_PROTOCOL.version;
  migrationId: string;
  generatedBoundaries: string[];
  handwrittenOwners: string[];
  compatibilityChecks: GeneratedCompatMigrationStep[];
  deleteSteps: GeneratedCompatMigrationStep[];
  rollbackSteps: GeneratedCompatMigrationStep[];
  fallbackFlags: GeneratedCompatMigrationFallbackFlag[];
  legacyOwnerReferences: GeneratedCompatMigrationLegacyOwnerReference[];
  hasLongTermFallback: boolean;
  hasLegacyOwnerRevivalRisk: boolean;
  decision: GeneratedCompatMigrationDecisionKind;
  reasons: GeneratedCompatMigrationReason[];
}

export interface GitDeliveryCiInput {
  status?: GitDeliveryCiStatus;
  evidenceRef?: string;
  url?: string;
}

export interface GitDeliveryDirtyWorktreeApproval {
  evidenceRef: string;
}

export interface GitDeliveryEffectInput {
  effect: GitDeliveryEffectKind;
  statusEntries: readonly WorktreeStatusEntry[];
  authorizedEffects?: readonly GitDeliveryEffectKind[];
  dirtyWorktreeApproval?: GitDeliveryDirtyWorktreeApproval;
  ci?: GitDeliveryCiInput;
}

export interface GitDeliveryWorktreeSummary {
  dirtyPaths: string[];
  stagedPaths: string[];
  untrackedPaths: string[];
  deletedPaths: string[];
  conflictedPaths: string[];
}

export interface GitDeliveryCiRecord {
  status: GitDeliveryCiStatus;
  evidenceRefs: string[];
  url: string;
}

export interface GitDeliveryAuthorizationRecord {
  required: boolean;
  granted: boolean;
  evidenceRefs: string[];
}

export interface GitDeliveryEffectDecision {
  version: typeof GIT_DELIVERY_PROTOCOL.version;
  effect: GitDeliveryEffectKind;
  decision: GitDeliveryDecisionKind;
  reason: GitDeliveryReason;
  statusEvidence: string;
  worktree: GitDeliveryWorktreeSummary;
  authorization: GitDeliveryAuthorizationRecord;
  ci: GitDeliveryCiRecord;
}

export interface WorktreeIsolationInput {
  parentRunId: string;
  subtaskId: string;
  parentWorktreeRoot?: string;
  childWorktreeRoot: string;
  baselineCommit?: string;
  baselineStatusEntries: readonly WorktreeStatusEntry[];
  childEffectAbsPaths?: readonly string[];
  mergeTargetAbsPaths?: readonly string[];
  mergeEvidenceRefs?: readonly string[];
  cleanupPaths?: readonly string[];
  cleanupEvidenceRefs?: readonly string[];
}

export interface WorktreeIsolationBaseline extends GitDeliveryWorktreeSummary {
  commit: string;
  statusEvidence: string;
}

export interface WorktreeIsolationChildEffects {
  relPaths: string[];
  crossWorktreePaths: string[];
}

export interface WorktreeIsolationMerge {
  targetRelPaths: string[];
  blockedTargetRelPaths: string[];
  evidenceRefs: string[];
}

export interface WorktreeIsolationCleanup {
  relPaths: string[];
  blockedRelPaths: string[];
  evidenceRefs: string[];
}

export interface WorktreeIsolationReceipt {
  version: typeof WORKTREE_ISOLATION_PROTOCOL.version;
  parentRunId: string;
  subtaskId: string;
  parentWorktreeRoot: string;
  childWorktreeRoot: string;
  singleOwner: 'WorktreeConflictService';
  settlementAuthority: 'parent-kernel';
  mutationAuthority: 'Mutation/Evidence';
  baseline: WorktreeIsolationBaseline;
  childEffects: WorktreeIsolationChildEffects;
  merge: WorktreeIsolationMerge;
  cleanup: WorktreeIsolationCleanup;
  decision: WorktreeIsolationDecisionKind;
  vetoes: string[];
  evidenceRefs: string[];
}

export class WorktreeConflictService {
  private readonly workspaceRoot: string;
  private readonly generatedBoundaries: readonly string[];

  constructor(options: WorktreeConflictServiceOptions) {
    this.workspaceRoot = nodePath.resolve(options.workspaceRoot);
    this.generatedBoundaries = options.generatedBoundaries ?? [];
  }

  evaluateWrite(input: WorktreeWriteInput): WorktreeWriteDecision {
    const targetAbsPath = nodePath.resolve(input.targetAbsPath);
    const targetRelPath = toRelPath(this.workspaceRoot, targetAbsPath);
    const statusEntry = input.statusEntries.find(entry =>
      entry.relPath === targetRelPath || entry.originalRelPath === targetRelPath);
    const owner = classifyTargetOwner(
      targetRelPath,
      input.generatedBoundaries ?? this.generatedBoundaries,
    );
    const base = {
      version: WORKTREE_CONFLICT_PROTOCOL.version,
      targetAbsPath,
      targetRelPath,
      targetOwner: owner.targetOwner,
      proposedOwner: input.proposedOwner,
      ...(owner.generatedBoundaryRelPath ? { generatedBoundaryRelPath: owner.generatedBoundaryRelPath } : {}),
      worktreeState: statusEntry?.state ?? 'clean',
      statusEvidence: statusEntry?.raw ?? 'clean',
    };

    if (isOutsideWorkspace(targetRelPath)) {
      return { ...base, targetOwner: 'unknown', decision: 'block', reason: 'target-outside-workspace' };
    }
    if (owner.targetOwner === 'generated' && input.proposedOwner === 'handwritten-source') {
      return { ...base, decision: 'block', reason: 'generated-boundary-owner-mismatch' };
    }
    if (owner.targetOwner === 'handwritten' && input.proposedOwner === 'generated-output') {
      return { ...base, decision: 'block', reason: 'handwritten-owner-mismatch' };
    }

    const worktreeState = statusEntry?.state ?? 'clean';
    if (worktreeState === 'conflicted') {
      return { ...base, decision: 'block', reason: 'conflicted-worktree-state' };
    }
    if (worktreeState === 'dirty') {
      return { ...base, decision: 'needs-user-approval', reason: 'dirty-user-changes-require-approval' };
    }
    if (worktreeState === 'staged' || worktreeState === 'renamed') {
      return { ...base, decision: 'needs-user-approval', reason: 'staged-user-changes-require-approval' };
    }
    if (worktreeState === 'staged-and-dirty') {
      return { ...base, decision: 'needs-user-approval', reason: 'staged-and-dirty-user-changes-require-approval' };
    }
    if (worktreeState === 'untracked') {
      return { ...base, decision: 'needs-user-approval', reason: 'untracked-target-requires-approval' };
    }
    if (worktreeState === 'deleted') {
      return { ...base, decision: 'needs-user-approval', reason: 'deleted-target-requires-approval' };
    }
    return { ...base, decision: 'allow', reason: 'clean-owner-aligned-write' };
  }

  evaluateGitDeliveryEffect(input: GitDeliveryEffectInput): GitDeliveryEffectDecision {
    const effect = normalizeGitDeliveryEffect(input.effect);
    const worktree = summarizeGitDeliveryWorktree(input.statusEntries);
    const ci = normalizeGitDeliveryCi(input.ci);
    const authorization = normalizeGitDeliveryAuthorization(
      effect,
      input.authorizedEffects,
      input.dirtyWorktreeApproval,
    );
    const statusEvidence = input.statusEntries.map(entry => entry.raw).filter(Boolean).join('\n') || 'clean';
    const decide = (
      decision: GitDeliveryDecisionKind,
      reason: GitDeliveryReason,
    ): GitDeliveryEffectDecision => ({
      version: GIT_DELIVERY_PROTOCOL.version,
      effect,
      decision,
      reason,
      statusEvidence,
      worktree,
      authorization,
      ci,
    });

    if (worktree.conflictedPaths.length > 0) {
      return decide('block', 'conflicted-worktree-state');
    }
    if (ci.status === 'failed') {
      return decide('block', 'ci-failure-blocks-delivery');
    }
    if (authorization.required && !authorization.granted) {
      return decide('needs-user-approval', `${effect}-requires-explicit-authorization` as GitDeliveryReason);
    }
    if (hasUnapprovedWorktreeBoundary(worktree) && !authorization.evidenceRefs.length) {
      return decide('needs-user-approval', 'dirty-or-staged-worktree-requires-approval');
    }
    return decide('allow', 'clean-authorized-git-delivery');
  }

  evaluateWorktreeIsolation(input: WorktreeIsolationInput): WorktreeIsolationReceipt {
    const parentRunId = normalizeText(input.parentRunId);
    const subtaskId = normalizeText(input.subtaskId);
    const parentWorktreeRoot = nodePath.resolve(input.parentWorktreeRoot ?? this.workspaceRoot);
    const childWorktreeRoot = nodePath.resolve(input.childWorktreeRoot);
    const baselineCommit = normalizeText(input.baselineCommit);
    const statusEvidence = input.baselineStatusEntries.map(entry => entry.raw).filter(Boolean).join('\n') || 'clean';
    const baseline = {
      commit: baselineCommit,
      statusEvidence,
      ...summarizeGitDeliveryWorktree(input.baselineStatusEntries),
    };
    const statusByRelPath = new Map(input.baselineStatusEntries.map(entry => [entry.relPath, entry]));
    const mergeEvidenceRefs = uniqueText(input.mergeEvidenceRefs ?? []);
    const cleanupEvidenceRefs = uniqueText(input.cleanupEvidenceRefs ?? []);
    const vetoes: string[] = [];

    if (!baselineCommit) vetoes.push('worktree-missing-baseline-veto');

    const childEffectAbsPaths = (input.childEffectAbsPaths ?? []).map(value => nodePath.resolve(value));
    const crossWorktreePaths = uniqueText(childEffectAbsPaths
      .filter(absPath => !isPathInsideRoot(childWorktreeRoot, absPath))
      .map(absPath => describeWorktreePath(absPath, parentWorktreeRoot, childWorktreeRoot)));
    for (const relPath of crossWorktreePaths) {
      vetoes.push(`worktree-cross-effect-veto:${relPath}`);
    }

    const mergeTargetAbsPaths = (input.mergeTargetAbsPaths ?? []).map(value => nodePath.resolve(value));
    const blockedMergeTargets: string[] = [];
    for (const absPath of mergeTargetAbsPaths) {
      const relPath = describeWorktreePath(absPath, parentWorktreeRoot, childWorktreeRoot);
      if (!isPathInsideRoot(parentWorktreeRoot, absPath) || isPathInsideRoot(childWorktreeRoot, absPath)) {
        blockedMergeTargets.push(relPath);
        vetoes.push(`worktree-cross-merge-target-veto:${relPath}`);
        continue;
      }
      const parentRelPath = toRelPath(parentWorktreeRoot, absPath);
      const entry = statusByRelPath.get(parentRelPath);
      if (entry && entry.state !== 'clean') {
        blockedMergeTargets.push(parentRelPath);
        vetoes.push(`worktree-user-dirty-preserved-veto:${parentRelPath}`);
      }
    }
    if (mergeTargetAbsPaths.length > 0 && mergeEvidenceRefs.length === 0) {
      vetoes.push('worktree-missing-merge-evidence-veto');
    }

    const cleanupAbsPaths = (input.cleanupPaths ?? []).map(value => nodePath.resolve(value));
    const blockedCleanupPaths = uniqueText(cleanupAbsPaths
      .filter(absPath => !isPathInsideRoot(childWorktreeRoot, absPath))
      .map(absPath => describeWorktreePath(absPath, parentWorktreeRoot, childWorktreeRoot)));
    for (const relPath of blockedCleanupPaths) {
      vetoes.push(`worktree-cleanup-outside-child-veto:${relPath}`);
    }
    if (cleanupAbsPaths.length > 0 && cleanupEvidenceRefs.length === 0) {
      vetoes.push('worktree-missing-cleanup-evidence-veto');
    }

    const evidenceRefs = uniqueText([
      `worktree-baseline:${parentRunId}:${subtaskId}:${baselineCommit || 'missing'}:${stableEvidenceToken(statusEvidence)}`,
      ...mergeEvidenceRefs,
      ...cleanupEvidenceRefs,
    ]);

    return {
      version: WORKTREE_ISOLATION_PROTOCOL.version,
      parentRunId,
      subtaskId,
      parentWorktreeRoot,
      childWorktreeRoot,
      singleOwner: 'WorktreeConflictService',
      settlementAuthority: 'parent-kernel',
      mutationAuthority: 'Mutation/Evidence',
      baseline,
      childEffects: {
        relPaths: uniqueText(childEffectAbsPaths.map(absPath => toRelPath(childWorktreeRoot, absPath))),
        crossWorktreePaths,
      },
      merge: {
        targetRelPaths: uniqueText(mergeTargetAbsPaths.map(absPath => describeWorktreePath(absPath, parentWorktreeRoot, childWorktreeRoot))),
        blockedTargetRelPaths: uniqueText(blockedMergeTargets),
        evidenceRefs: mergeEvidenceRefs,
      },
      cleanup: {
        relPaths: uniqueText(cleanupAbsPaths.map(absPath => toRelPath(childWorktreeRoot, absPath))),
        blockedRelPaths: blockedCleanupPaths,
        evidenceRefs: cleanupEvidenceRefs,
      },
      decision: vetoes.length === 0 ? 'allow' : 'block',
      vetoes: uniqueText(vetoes),
      evidenceRefs,
    };
  }
}

export function parseGitStatusPorcelain(raw: string): WorktreeStatusEntry[] {
  const text = String(raw || '');
  if (!text.trim()) return [];
  return text.includes('\0') ? parsePorcelainZ(text) : parsePorcelainLines(text);
}

function normalizeGitDeliveryEffect(value: GitDeliveryEffectKind): GitDeliveryEffectKind {
  return value === 'commit' || value === 'push' || value === 'pull-request' || value === 'ci'
    ? value
    : 'commit';
}

function normalizeGitDeliveryCi(input: GitDeliveryCiInput | undefined): GitDeliveryCiRecord {
  const status = normalizeGitDeliveryCiStatus(input?.status);
  const evidenceRef = normalizeText(input?.evidenceRef);
  return {
    status,
    evidenceRefs: evidenceRef ? [evidenceRef] : [],
    url: normalizeText(input?.url),
  };
}

function normalizeGitDeliveryCiStatus(value: GitDeliveryCiStatus | undefined): GitDeliveryCiStatus {
  return value === 'passed' || value === 'failed' || value === 'not-run' || value === 'unknown'
    ? value
    : 'unknown';
}

function normalizeGitDeliveryAuthorization(
  effect: GitDeliveryEffectKind,
  authorizedEffects: readonly GitDeliveryEffectKind[] | undefined,
  dirtyWorktreeApproval: GitDeliveryDirtyWorktreeApproval | undefined,
): GitDeliveryAuthorizationRecord {
  const authorized = new Set((authorizedEffects ?? []).map(normalizeGitDeliveryEffect));
  const evidenceRef = normalizeText(dirtyWorktreeApproval?.evidenceRef);
  return {
    required: true,
    granted: authorized.has(effect),
    evidenceRefs: evidenceRef ? [evidenceRef] : [],
  };
}

function summarizeGitDeliveryWorktree(
  entries: readonly WorktreeStatusEntry[],
): GitDeliveryWorktreeSummary {
  return {
    dirtyPaths: uniqueText(entries
      .filter(entry => entry.state === 'dirty' || entry.state === 'staged-and-dirty')
      .map(entry => entry.relPath)),
    stagedPaths: uniqueText(entries
      .filter(entry => entry.state === 'staged' || entry.state === 'staged-and-dirty' || entry.state === 'renamed')
      .map(entry => entry.relPath)),
    untrackedPaths: uniqueText(entries
      .filter(entry => entry.state === 'untracked')
      .map(entry => entry.relPath)),
    deletedPaths: uniqueText(entries
      .filter(entry => entry.state === 'deleted')
      .map(entry => entry.relPath)),
    conflictedPaths: uniqueText(entries
      .filter(entry => entry.state === 'conflicted')
      .map(entry => entry.relPath)),
  };
}

function hasUnapprovedWorktreeBoundary(worktree: GitDeliveryWorktreeSummary): boolean {
  return worktree.dirtyPaths.length > 0
    || worktree.stagedPaths.length > 0
    || worktree.untrackedPaths.length > 0
    || worktree.deletedPaths.length > 0;
}

export function validateGeneratedCompatMigration(
  input: GeneratedCompatMigrationInput,
): GeneratedCompatMigrationReport {
  const migrationId = normalizeText(input.migrationId);
  const generatedBoundaries = normalizePathList(input.generatedBoundaries, 'generated-boundary');
  const handwrittenOwners = normalizePathList(input.handwrittenOwners, 'path');
  const compatibilityChecks = normalizeMigrationSteps(input.compatibilityChecks);
  const deleteSteps = normalizeMigrationSteps(input.deleteSteps);
  const rollbackSteps = normalizeMigrationSteps(input.rollbackSteps);
  const fallbackFlags = normalizeFallbackFlags(input.fallbackFlags);
  const legacyOwnerReferences = normalizeLegacyOwnerReferences(input.legacyOwnerReferences);
  const reasons: GeneratedCompatMigrationReason[] = [];

  if (!migrationId) addReason(reasons, 'missing-migration-id');
  if (generatedBoundaries.length === 0) addReason(reasons, 'missing-generated-boundary');
  if (handwrittenOwners.length === 0) addReason(reasons, 'missing-handwritten-owner');
  if (compatibilityChecks.length === 0) addReason(reasons, 'missing-compatibility-check');
  if (deleteSteps.length === 0) addReason(reasons, 'missing-delete-step');
  if (rollbackSteps.length === 0) addReason(reasons, 'missing-rollback-step');

  const hasLongTermFallback = fallbackFlags.some(flag =>
    normalizeText(flag.lifetime) !== 'temporary' || flag.expiresWithMigration !== true);
  if (hasLongTermFallback) addReason(reasons, 'long-term-fallback-flag');

  const hasLegacyOwnerRevivalRisk = legacyOwnerReferences.some(reference => reference.revivalGuard !== true);
  if (hasLegacyOwnerRevivalRisk) addReason(reasons, 'legacy-owner-revival-risk');

  if (
    hasMissingMigrationStepEvidence(compatibilityChecks)
    || hasMissingMigrationStepEvidence(deleteSteps)
    || hasMissingMigrationStepEvidence(rollbackSteps)
    || fallbackFlags.some(flag => !normalizeText(flag.evidenceId))
    || legacyOwnerReferences.some(reference => !normalizeText(reference.evidenceId))
  ) {
    addReason(reasons, 'migration-evidence-missing');
  }

  return {
    version: GENERATED_COMPAT_MIGRATION_PROTOCOL.version,
    migrationId,
    generatedBoundaries,
    handwrittenOwners,
    compatibilityChecks,
    deleteSteps,
    rollbackSteps,
    fallbackFlags,
    legacyOwnerReferences,
    hasLongTermFallback,
    hasLegacyOwnerRevivalRisk,
    decision: reasons.length === 0 ? 'allow' : 'blocked',
    reasons,
  };
}

function normalizeMigrationSteps(
  steps: readonly GeneratedCompatMigrationStep[] | undefined,
): GeneratedCompatMigrationStep[] {
  return (steps ?? []).map(step => ({
    target: normalizeRelPath(step.target),
    action: normalizeText(step.action),
    ...(normalizeText(step.evidenceId) ? { evidenceId: normalizeText(step.evidenceId) } : {}),
  }));
}

function normalizeFallbackFlags(
  flags: readonly GeneratedCompatMigrationFallbackFlag[] | undefined,
): GeneratedCompatMigrationFallbackFlag[] {
  return (flags ?? []).map(flag => ({
    name: normalizeText(flag.name),
    ...(normalizeText(flag.lifetime) ? { lifetime: normalizeText(flag.lifetime) } : {}),
    expiresWithMigration: flag.expiresWithMigration === true,
    ...(normalizeText(flag.evidenceId) ? { evidenceId: normalizeText(flag.evidenceId) } : {}),
  }));
}

function normalizeLegacyOwnerReferences(
  references: readonly GeneratedCompatMigrationLegacyOwnerReference[] | undefined,
): GeneratedCompatMigrationLegacyOwnerReference[] {
  return (references ?? []).map(reference => ({
    target: normalizeRelPath(reference.target),
    revivalGuard: reference.revivalGuard === true,
    ...(normalizeText(reference.evidenceId) ? { evidenceId: normalizeText(reference.evidenceId) } : {}),
  }));
}

function normalizePathList(
  values: readonly string[] | undefined,
  kind: 'generated-boundary' | 'path',
): string[] {
  return [...new Set((values ?? [])
    .map(value => kind === 'generated-boundary'
      ? normalizeGeneratedBoundary(value).relPath
      : normalizeRelPath(value))
    .filter(Boolean))];
}

function hasMissingMigrationStepEvidence(steps: readonly GeneratedCompatMigrationStep[]): boolean {
  return steps.some(step =>
    !normalizeText(step.target) || !normalizeText(step.action) || !normalizeText(step.evidenceId));
}

function addReason(
  reasons: GeneratedCompatMigrationReason[],
  reason: GeneratedCompatMigrationReason,
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function parsePorcelainLines(raw: string): WorktreeStatusEntry[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.length >= 3)
    .map(parsePorcelainLine)
    .filter((entry): entry is WorktreeStatusEntry => Boolean(entry));
}

function parsePorcelainLine(line: string): WorktreeStatusEntry | null {
  const indexStatus = line[0] || ' ';
  const worktreeStatus = line[1] || ' ';
  const pathText = line.slice(3).trim();
  if (!pathText) return null;
  const renameParts = pathText.split(' -> ');
  const originalRelPath = renameParts.length === 2 ? normalizeRelPath(renameParts[0]) : undefined;
  const relPath = normalizeRelPath(renameParts.length === 2 ? renameParts[1] : pathText);
  return {
    relPath,
    ...(originalRelPath ? { originalRelPath } : {}),
    indexStatus,
    worktreeStatus,
    state: classifyWorktreeState(indexStatus, worktreeStatus),
    raw: line,
  };
}

function parsePorcelainZ(raw: string): WorktreeStatusEntry[] {
  const tokens = raw.split('\0').filter(Boolean);
  const entries: WorktreeStatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length < 4) continue;
    const indexStatus = token[0] || ' ';
    const worktreeStatus = token[1] || ' ';
    const relPath = normalizeRelPath(token.slice(3));
    let originalRelPath: string | undefined;
    if ((indexStatus === 'R' || indexStatus === 'C') && tokens[index + 1]) {
      originalRelPath = normalizeRelPath(tokens[index + 1]);
      index += 1;
    }
    entries.push({
      relPath,
      ...(originalRelPath ? { originalRelPath } : {}),
      indexStatus,
      worktreeStatus,
      state: classifyWorktreeState(indexStatus, worktreeStatus),
      raw: token,
    });
  }
  return entries;
}

function classifyWorktreeState(indexStatus: string, worktreeStatus: string): WorktreeState {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === 'U' || worktreeStatus === 'U' || (indexStatus === 'A' && worktreeStatus === 'A')) {
    return 'conflicted';
  }
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  const staged = indexStatus !== ' ' && indexStatus !== '?';
  const dirty = worktreeStatus !== ' ' && worktreeStatus !== '?';
  if (staged && dirty) return 'staged-and-dirty';
  if (staged) return 'staged';
  if (dirty) return 'dirty';
  return 'clean';
}

function classifyTargetOwner(
  targetRelPath: string,
  generatedBoundaries: readonly string[],
): { targetOwner: WorktreeTargetOwner; generatedBoundaryRelPath?: string } {
  const normalizedTarget = normalizeRelPath(targetRelPath);
  const boundary = generatedBoundaries
    .map(normalizeGeneratedBoundary)
    .find(candidate => candidate.isDirectory
      ? normalizedTarget.startsWith(candidate.relPath)
      : normalizedTarget === candidate.relPath);
  if (boundary) return { targetOwner: 'generated', generatedBoundaryRelPath: boundary.relPath };
  return { targetOwner: isOutsideWorkspace(normalizedTarget) ? 'unknown' : 'handwritten' };
}

function normalizeGeneratedBoundary(value: string): { relPath: string; isDirectory: boolean } {
  const isDirectory = /[\\/]$/.test(value);
  const relPath = normalizeRelPath(value);
  return { relPath: isDirectory && !relPath.endsWith('/') ? `${relPath}/` : relPath, isDirectory };
}

function toRelPath(root: string, absPath: string): string {
  return normalizeRelPath(nodePath.relative(root, absPath));
}

function normalizeRelPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map(value => normalizeText(value)).filter(Boolean))];
}

function isPathInsideRoot(root: string, absPath: string): boolean {
  const relPath = nodePath.relative(root, absPath);
  return relPath === '' || (!relPath.startsWith('..') && !nodePath.isAbsolute(relPath));
}

function describeWorktreePath(absPath: string, parentRoot: string, childRoot: string): string {
  if (isPathInsideRoot(parentRoot, absPath) && !isPathInsideRoot(childRoot, absPath)) {
    return toRelPath(parentRoot, absPath);
  }
  return toRelPath(childRoot, absPath);
}

function stableEvidenceToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isOutsideWorkspace(relPath: string): boolean {
  return relPath === '..' || relPath.startsWith('../') || nodePath.isAbsolute(relPath);
}
