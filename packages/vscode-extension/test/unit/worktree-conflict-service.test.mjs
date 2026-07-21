/**
 * Unit tests for app/worktree-conflict-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/worktree-conflict-service.bundle.cjs');

execSync(
  `npx esbuild src/app/worktree-conflict-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  WorktreeConflictService,
  parseGitStatusPorcelain,
  validateGeneratedCompatMigration,
  WORKTREE_ISOLATION_PROTOCOL_VERSION,
} = req(bundlePath);

const workspaceRoot = '/workspace/project';

test('WorktreeConflictService: parses staged, dirty, untracked, rename, and conflict status entries', () => {
  const entries = parseGitStatusPorcelain([
    ' M src/dirty.ts',
    'M  src/staged.ts',
    'MM src/both.ts',
    '?? src/new.ts',
    'R  src/old.ts -> src/renamed.ts',
    'UU src/conflict.ts',
  ].join('\n'));

  assert.deepEqual(entries.map(entry => ({
    relPath: entry.relPath,
    originalRelPath: entry.originalRelPath,
    indexStatus: entry.indexStatus,
    worktreeStatus: entry.worktreeStatus,
    state: entry.state,
  })), [
    { relPath: 'src/dirty.ts', originalRelPath: undefined, indexStatus: ' ', worktreeStatus: 'M', state: 'dirty' },
    { relPath: 'src/staged.ts', originalRelPath: undefined, indexStatus: 'M', worktreeStatus: ' ', state: 'staged' },
    { relPath: 'src/both.ts', originalRelPath: undefined, indexStatus: 'M', worktreeStatus: 'M', state: 'staged-and-dirty' },
    { relPath: 'src/new.ts', originalRelPath: undefined, indexStatus: '?', worktreeStatus: '?', state: 'untracked' },
    { relPath: 'src/renamed.ts', originalRelPath: 'src/old.ts', indexStatus: 'R', worktreeStatus: ' ', state: 'renamed' },
    { relPath: 'src/conflict.ts', originalRelPath: undefined, indexStatus: 'U', worktreeStatus: 'U', state: 'conflicted' },
  ]);
});

test('WorktreeConflictService: dirty and staged user changes require approval before overwrite', () => {
  const service = new WorktreeConflictService({ workspaceRoot });
  const dirty = service.evaluateWrite({
    targetAbsPath: '/workspace/project/src/dirty.ts',
    statusEntries: parseGitStatusPorcelain(' M src/dirty.ts\n'),
    proposedOwner: 'handwritten-source',
  });
  const staged = service.evaluateWrite({
    targetAbsPath: '/workspace/project/src/staged.ts',
    statusEntries: parseGitStatusPorcelain('M  src/staged.ts\n'),
    proposedOwner: 'handwritten-source',
  });

  assert.equal(dirty.decision, 'needs-user-approval');
  assert.equal(dirty.reason, 'dirty-user-changes-require-approval');
  assert.equal(dirty.worktreeState, 'dirty');
  assert.equal(dirty.statusEvidence, ' M src/dirty.ts');
  assert.equal(staged.decision, 'needs-user-approval');
  assert.equal(staged.reason, 'staged-user-changes-require-approval');
  assert.equal(staged.worktreeState, 'staged');
});

test('WorktreeConflictService: untracked targets are observable instead of silently overwritten', () => {
  const service = new WorktreeConflictService({ workspaceRoot });

  const decision = service.evaluateWrite({
    targetAbsPath: '/workspace/project/src/new.ts',
    statusEntries: parseGitStatusPorcelain('?? src/new.ts\n'),
    proposedOwner: 'handwritten-source',
  });

  assert.equal(decision.decision, 'needs-user-approval');
  assert.equal(decision.reason, 'untracked-target-requires-approval');
  assert.equal(decision.worktreeState, 'untracked');
  assert.equal(decision.targetOwner, 'handwritten');
});

test('WorktreeConflictService: generated and handwritten owner mismatches fail closed', () => {
  const service = new WorktreeConflictService({
    workspaceRoot,
    generatedBoundaries: ['dist/', 'src/generated/'],
  });

  const handwrittenIntoGenerated = service.evaluateWrite({
    targetAbsPath: '/workspace/project/dist/bundle.js',
    statusEntries: [],
    proposedOwner: 'handwritten-source',
  });
  const generatedIntoHandwritten = service.evaluateWrite({
    targetAbsPath: '/workspace/project/src/app.ts',
    statusEntries: [],
    proposedOwner: 'generated-output',
  });

  assert.equal(handwrittenIntoGenerated.decision, 'block');
  assert.equal(handwrittenIntoGenerated.reason, 'generated-boundary-owner-mismatch');
  assert.equal(handwrittenIntoGenerated.targetOwner, 'generated');
  assert.equal(generatedIntoHandwritten.decision, 'block');
  assert.equal(generatedIntoHandwritten.reason, 'handwritten-owner-mismatch');
  assert.equal(generatedIntoHandwritten.targetOwner, 'handwritten');
});

test('WorktreeConflictService: clean handwritten source edits are allowed with explicit evidence', () => {
  const service = new WorktreeConflictService({ workspaceRoot });

  const decision = service.evaluateWrite({
    targetAbsPath: '/workspace/project/src/app.ts',
    statusEntries: [],
    proposedOwner: 'handwritten-source',
  });

  assert.equal(decision.version, 'devseek.worktree-conflict/v1');
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.reason, 'clean-owner-aligned-write');
  assert.equal(decision.worktreeState, 'clean');
  assert.equal(decision.targetRelPath, 'src/app.ts');
});

test('R2-09D WorktreeConflictService: git delivery blocks failed CI and unauthorized push', () => {
  const service = new WorktreeConflictService({ workspaceRoot });
  const failedCi = service.evaluateGitDeliveryEffect({
    effect: 'push',
    statusEntries: [],
    authorizedEffects: ['push'],
    ci: {
      status: 'failed',
      evidenceRef: 'ci:failed:build-42',
      url: 'https://ci.example/build/42',
    },
  });
  const unauthorizedPush = service.evaluateGitDeliveryEffect({
    effect: 'push',
    statusEntries: [],
    ci: {
      status: 'passed',
      evidenceRef: 'ci:passed:build-43',
    },
  });

  assert.equal(failedCi.version, 'devseek.git-delivery/v1');
  assert.equal(failedCi.decision, 'block');
  assert.equal(failedCi.reason, 'ci-failure-blocks-delivery');
  assert.deepEqual(failedCi.ci.evidenceRefs, ['ci:failed:build-42']);
  assert.equal(unauthorizedPush.decision, 'needs-user-approval');
  assert.equal(unauthorizedPush.reason, 'push-requires-explicit-authorization');
  assert.equal(unauthorizedPush.authorization.required, true);
});

test('R2-09D WorktreeConflictService: git delivery exposes dirty and staged boundaries', () => {
  const service = new WorktreeConflictService({ workspaceRoot });
  const blocked = service.evaluateGitDeliveryEffect({
    effect: 'commit',
    authorizedEffects: ['commit'],
    statusEntries: parseGitStatusPorcelain(' M src/dirty.ts\nM  src/staged.ts\n?? src/new.ts\n'),
    ci: {
      status: 'passed',
      evidenceRef: 'ci:passed:build-44',
    },
  });
  const approved = service.evaluateGitDeliveryEffect({
    effect: 'commit',
    authorizedEffects: ['commit'],
    statusEntries: parseGitStatusPorcelain(' M src/dirty.ts\nM  src/staged.ts\n'),
    dirtyWorktreeApproval: {
      evidenceRef: 'user:approved-dirty-staged-boundary',
    },
    ci: {
      status: 'passed',
      evidenceRef: 'ci:passed:build-45',
    },
  });

  assert.equal(blocked.decision, 'needs-user-approval');
  assert.equal(blocked.reason, 'dirty-or-staged-worktree-requires-approval');
  assert.deepEqual(blocked.worktree.dirtyPaths, ['src/dirty.ts']);
  assert.deepEqual(blocked.worktree.stagedPaths, ['src/staged.ts']);
  assert.deepEqual(blocked.worktree.untrackedPaths, ['src/new.ts']);
  assert.match(blocked.statusEvidence, /src\/dirty\.ts/);
  assert.equal(approved.decision, 'allow');
  assert.equal(approved.reason, 'clean-authorized-git-delivery');
  assert.deepEqual(approved.authorization.evidenceRefs, ['user:approved-dirty-staged-boundary']);
});

test('R3-07E WorktreeConflictService: isolated subtask worktrees preserve user dirty state and reject cross-worktree effects', () => {
  const service = new WorktreeConflictService({ workspaceRoot });

  const receipt = service.evaluateWorktreeIsolation({
    parentRunId: 'run-r3-07e',
    subtaskId: 'child-a',
    parentWorktreeRoot: '/workspace/project',
    childWorktreeRoot: '/workspace/project/.devseek/worktrees/child-a',
    baselineCommit: 'abc123',
    baselineStatusEntries: parseGitStatusPorcelain(' M src/user-owned.ts\n?? notes/local.md\n'),
    childEffectAbsPaths: [
      '/workspace/project/.devseek/worktrees/child-a/src/feature.ts',
      '/workspace/project/src/escaped-effect.ts',
    ],
    mergeTargetAbsPaths: [
      '/workspace/project/src/feature.ts',
      '/workspace/project/src/user-owned.ts',
    ],
    mergeEvidenceRefs: ['mutation:merge:child-a'],
    cleanupPaths: [
      '/workspace/project/.devseek/worktrees/child-a',
      '/workspace/project/src',
    ],
    cleanupEvidenceRefs: ['evidence:cleanup:child-a'],
  });

  assert.equal(WORKTREE_ISOLATION_PROTOCOL_VERSION, 'devseek.worktree-isolation/v1');
  assert.equal(receipt.version, WORKTREE_ISOLATION_PROTOCOL_VERSION);
  assert.equal(receipt.singleOwner, 'WorktreeConflictService');
  assert.equal(receipt.settlementAuthority, 'parent-kernel');
  assert.equal(receipt.mutationAuthority, 'Mutation/Evidence');
  assert.equal(receipt.decision, 'block');
  assert.deepEqual(receipt.baseline.dirtyPaths, ['src/user-owned.ts']);
  assert.deepEqual(receipt.baseline.untrackedPaths, ['notes/local.md']);
  assert.ok(receipt.vetoes.includes('worktree-cross-effect-veto:src/escaped-effect.ts'));
  assert.ok(receipt.vetoes.includes('worktree-user-dirty-preserved-veto:src/user-owned.ts'));
  assert.ok(receipt.vetoes.includes('worktree-cleanup-outside-child-veto:src'));
  assert.ok(receipt.merge.evidenceRefs.includes('mutation:merge:child-a'));
  assert.ok(receipt.cleanup.evidenceRefs.includes('evidence:cleanup:child-a'));
  assert.ok(receipt.evidenceRefs.some(ref => ref.startsWith('worktree-baseline:run-r3-07e:child-a:abc123:')));
});

test('WorktreeConflictService: generated compatibility migrations allow single-owner cleanup with evidence', () => {
  const report = validateGeneratedCompatMigration({
    migrationId: 'r2-06c-license-owner',
    generatedBoundaries: ['src/generated/'],
    handwrittenOwners: ['src/app/license-service.ts'],
    compatibilityChecks: [
      { target: 'src/app/license-api.ts', action: 'api-compatible', evidenceId: 'compat-api' },
    ],
    deleteSteps: [
      { target: 'src/legacy/license-owner.ts', action: 'delete old owner', evidenceId: 'delete-old-owner' },
    ],
    rollbackSteps: [
      { target: 'src/app/license-service.ts', action: 'restore from tagged owner', evidenceId: 'rollback-plan' },
    ],
    fallbackFlags: [
      {
        name: 'DEVSEEK_LEGACY_LICENSE_OWNER',
        lifetime: 'temporary',
        expiresWithMigration: true,
        evidenceId: 'fallback-sunset',
      },
    ],
    legacyOwnerReferences: [
      { target: 'src/legacy/license-owner.ts', revivalGuard: true, evidenceId: 'revival-guard' },
    ],
  });

  assert.equal(report.version, 'devseek.generated-compat-migration/v1');
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.hasLongTermFallback, false);
  assert.equal(report.hasLegacyOwnerRevivalRisk, false);
});

test('WorktreeConflictService: generated compatibility migrations block missing evidence and old-owner revival risk', () => {
  const report = validateGeneratedCompatMigration({
    generatedBoundaries: [],
    handwrittenOwners: [],
    compatibilityChecks: [],
    deleteSteps: [],
    rollbackSteps: [
      { target: 'src/app/license-service.ts', action: 'restore old behavior' },
    ],
    fallbackFlags: [
      {
        name: 'DEVSEEK_LEGACY_LICENSE_OWNER',
        lifetime: 'permanent',
        expiresWithMigration: false,
      },
    ],
    legacyOwnerReferences: [
      { target: 'src/legacy/license-owner.ts', revivalGuard: false },
    ],
  });

  assert.equal(report.decision, 'blocked');
  assert.equal(report.hasLongTermFallback, true);
  assert.equal(report.hasLegacyOwnerRevivalRisk, true);
  assert.ok(report.reasons.includes('missing-migration-id'));
  assert.ok(report.reasons.includes('missing-generated-boundary'));
  assert.ok(report.reasons.includes('missing-handwritten-owner'));
  assert.ok(report.reasons.includes('missing-compatibility-check'));
  assert.ok(report.reasons.includes('missing-delete-step'));
  assert.ok(report.reasons.includes('migration-evidence-missing'));
  assert.ok(report.reasons.includes('long-term-fallback-flag'));
  assert.ok(report.reasons.includes('legacy-owner-revival-risk'));
});
