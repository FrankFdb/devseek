/**
 * Unit tests for R2-01B IntentRevisionLineage.
 *
 * Revision lineage owns cross-turn correction, negation, scope reduction and
 * permission-widening evidence. It never rewrites committed effects.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/intent-revision-lineage.bundle.cjs');

execSync(
  `npx esbuild src/intent/intent-revision-lineage.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildIntentRevisionLineage,
  rebindIntentRevisionLineageSemanticContract,
  replanUncommittedTasksForContractRevision,
} = createRequire(import.meta.url)(bundlePath);

test('IntentRevisionLineage: correction supersedes an uncommitted old target', () => {
  const first = buildIntentRevisionLineage({
    prompt: '请创建 old.txt，文件内容必须精确为 OLD。',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    prompt: '更正：不要创建 old.txt，改为创建 new.txt，文件内容必须精确为 NEW。',
  });

  assert.equal(second.version, 'devseek.intent-revision-lineage/v1');
  assert.equal(second.revisionCount, 2);
  assert.equal(second.revisions[0].status, 'superseded');
  assert.equal(second.effectiveRevisionId, second.revisions[1].id);
  assert.equal(second.effectiveRevision.prompt, second.revisions[1].prompt);
  assert.ok(second.effectiveRevision.changeKinds.includes('correction'));
  assert.ok(second.effectiveRevision.changeKinds.includes('negation'));
  assert.deepEqual(second.effectiveRevision.scope.targets, ['new.txt']);
  assert.deepEqual(second.effectiveRevision.scope.prohibitedTargets, ['old.txt']);
  assert.equal(second.allowedToExecute, true);
  assert.deepEqual(second.blockers, []);
});

test('IntentRevisionLineage: scope reduction narrows targets without permission widening', () => {
  const first = buildIntentRevisionLineage({
    prompt: '修复 src/cache.ts 和 src/auth.ts 里的问题。',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    prompt: '缩小范围：只改 src/cache.ts，不要碰 src/auth.ts。',
  });

  assert.equal(second.effectiveRevision.status, 'active');
  assert.ok(second.effectiveRevision.changeKinds.includes('scope-reduction'));
  assert.deepEqual(second.effectiveRevision.scope.targets, ['src/cache.ts']);
  assert.deepEqual(second.effectiveRevision.scope.prohibitedTargets, ['src/auth.ts']);
  assert.equal(second.effectiveRevision.permission.widening, false);
  assert.equal(second.allowedToExecute, true);
});

test('IntentRevisionLineage: model proposal keeps replacement target and excludes superseded target', () => {
  const first = buildIntentRevisionLineage({
    prompt: 'Plan the implementation for src/alpha.js before touching any files.',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    prompt: 'Actually change src/beta.js instead; do not touch src/alpha.js. Verify with node and finish.',
  });

  const rebound = rebindIntentRevisionLineageSemanticContract(
    second,
    second.semanticContractRevision.semanticContract,
    1,
  );

  assert.deepEqual(rebound.effectiveRevision.scope.targets, ['src/beta.js']);
  assert.deepEqual(rebound.effectiveRevision.scope.prohibitedTargets, ['src/alpha.js']);
  assert.deepEqual(rebound.semanticContractRevision.pendingTargets, ['src/beta.js']);
  assert.equal(rebound.semanticContractRevision.revisionId, `${second.effectiveRevisionId}:model-1`);
  assert.equal(rebound.allowedToExecute, true);
});

test('IntentRevisionLineage: correction replaces an obsolete uncommitted prohibition', () => {
  const first = buildIntentRevisionLineage({
    prompt: '只读分析 src/cache.ts，不要修改 src/cache.ts。',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    prompt: '更正：现在可以修改 src/cache.ts 并完成修复。',
  });

  assert.deepEqual(second.effectiveRevision.scope.targets, ['src/cache.ts']);
  assert.deepEqual(second.effectiveRevision.scope.prohibitedTargets, []);
  assert.equal(second.semanticContractRevision.semanticContract.mutation.requested, true);
  assert.equal(second.semanticContractRevision.semanticContract.mutation.prohibited, false);
});

test('IntentRevisionLineage: committed effects are preserved instead of rewritten', () => {
  const first = buildIntentRevisionLineage({
    prompt: '请创建 old.txt，文件内容必须精确为 OLD。',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    committedEffects: [{
      id: 'effect-old-write',
      revisionId: first.effectiveRevisionId,
      kind: 'file-write',
      target: 'old.txt',
      status: 'committed',
    }],
    prompt: '更正：不要创建 old.txt，改为创建 new.txt，文件内容必须精确为 NEW。',
  });

  assert.deepEqual(second.preservedCommittedEffectIds, ['effect-old-write']);
  assert.deepEqual(second.rewrittenCommittedEffectIds, []);
  assert.ok(second.evidence.some(item => item.kind === 'committed-effect-preserved' && item.value === 'effect-old-write:old.txt'));
  assert.deepEqual(second.effectiveRevision.scope.targets, ['new.txt']);
  assert.deepEqual(second.effectiveRevision.scope.prohibitedTargets, ['old.txt']);
});

test('R3-03 IntentRevisionLineage: steer creates semantic contract revision and replans only uncommitted work', () => {
  const first = buildIntentRevisionLineage({
    prompt: '请创建 old.txt 和 stale.txt，文件内容必须精确。',
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    committedEffects: [{
      id: 'effect-old-write',
      revisionId: first.effectiveRevisionId,
      kind: 'file-write',
      target: 'old.txt',
      status: 'committed',
    }],
    prompt: '继续，但不要再改 old.txt，改为只创建 new.txt。',
  });

  const revision = second.semanticContractRevision;
  assert.equal(revision.version, 'devseek.semantic-contract-revision/v1');
  assert.equal(revision.revisionId, second.effectiveRevisionId);
  assert.deepEqual(revision.preservedCommittedEffectIds, ['effect-old-write']);
  assert.deepEqual(revision.rewrittenCommittedEffectIds, []);
  assert.ok(revision.blockedReplayEffectIds.includes('effect-old-write'));
  assert.ok(revision.pendingTaskHints.some(item => item.includes('new.txt')));
  assert.ok(!revision.pendingTaskHints.some(item => item.includes('old.txt')));
  assert.deepEqual(revision.semanticContract.mutation.targets, ['new.txt']);

  const replanned = replanUncommittedTasksForContractRevision([
    { id: 1, title: 'Create old.txt', status: 'completed' },
    { id: 2, title: 'Rewrite old.txt again', status: 'not-started' },
    { id: 3, title: 'Create stale.txt', status: 'in-progress' },
  ], revision);

  assert.deepEqual(replanned.find(item => item.id === 1)?.status, 'completed');
  assert.equal(replanned.some(item => item.status !== 'completed' && item.title.includes('old.txt')), false);
  assert.equal(replanned.some(item => item.status !== 'completed' && item.title.includes('stale.txt')), false);
  assert.equal(replanned.some(item => item.title.includes('new.txt')), true);
});

test('IntentRevisionLineage: new revision cannot silently widen to external effects', () => {
  const first = buildIntentRevisionLineage({
    prompt: '只读分析 src/cache.ts，不要修改代码。',
    knownPaths: ['src/cache.ts'],
  });
  const second = buildIntentRevisionLineage({
    previous: first,
    prompt: '继续，并提交当前修改然后推送当前分支。',
  });

  assert.equal(second.allowedToExecute, false);
  assert.equal(second.effectiveRevision.status, 'needs-confirmation');
  assert.equal(second.effectiveRevision.permission.widening, true);
  assert.equal(second.effectiveRevision.permission.requiresConfirmation, true);
  assert.ok(second.blockers.includes('lineage-permission-widening-requires-confirmation'));
  assert.ok(second.blockers.includes('orientation-external-effect-authorization-required'));
  assert.ok(second.evidence.some(item => item.kind === 'permission-widening-detected'));
});

console.log('\nIntent revision lineage tests passed.\n');
