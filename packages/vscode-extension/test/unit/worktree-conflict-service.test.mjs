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
