import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-write-authority-${process.pid}.cjs`);

execSync(
  `npx esbuild src/agent/write-authority.ts src/task-semantic-contract.ts --bundle ` +
  `--outdir=${path.dirname(bundlePath)} --outbase=src --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createWriteAuthority } = req(path.join(path.dirname(bundlePath), 'agent/write-authority.js'));
const { buildTaskSemanticContract } = req(path.join(path.dirname(bundlePath), 'task-semantic-contract.js'));

function createAuthority(prompt, steers = [], options = {}, callbacks = {}) {
  return createWriteAuthority(prompt, {
    ...callbacks,
    onUserSteer() {
      return steers.splice(0);
    },
  }, {
    initialSemanticContract: buildTaskSemanticContract(prompt),
    ...options,
  });
}

test('report-only artifact prompts keep source-code no-write as a scoped constraint', () => {
  const prompt = [
    '请创建 docs/r3-iteration/r3-live-deepseek-login-ready-state.md 测试报告。',
    '报告需要记录输入、期望结果、实际结果和日志证据。',
    '不要修改任何源码。',
  ].join('\n');

  const authority = createAuthority(prompt);

  assert.equal(authority.semanticContract.kind, 'file-artifact');
  assert.equal(authority.semanticContract.mutation.fileArtifact, true);
  assert.equal(authority.semanticContract.mutation.sourceChange, false);
  assert.equal(authority.writeRevoked, false);
});

test('global file-write revocation still blocks report artifact creation', () => {
  const prompt = '请创建 docs/r3-iteration/r3-live-deepseek-login-ready-state.md 测试报告。不要创建任何文件。';

  const authority = createAuthority(prompt);

  assert.equal(authority.writeRevoked, true);
});

test('a no-dependency boundary preserves the user-authorized source target', () => {
  const prompt = '请实现 tools/log_summary.py 并用 python 自测；不要引入依赖，不要改其他文件。';
  const authority = createAuthority(prompt);

  assert.equal(authority.semanticContract.intent.context.externalEffect, 'none');
  assert.equal(authority.semanticContractRevision.allowedToExecute, true);
  assert.deepEqual(authority.semanticContractRevision.prohibitedTargets, []);
  assert.deepEqual(authority.semanticContractRevision.pendingTargets, ['tools/log_summary.py']);
});

test('in-flight global write revocation overrides a report-only artifact contract', () => {
  const steers = ['不要创建任何文件。'];
  const authority = createAuthority(
    '请创建 docs/r3-iteration/r3-live-deepseek-login-ready-state.md 测试报告。',
    steers,
  );

  assert.equal(authority.writeRevoked, false);
  assert.equal(authority.takePendingAndDrain().length, 1);
  assert.equal(authority.writeRevoked, true);
});

test('a later explicit correction can restore write authority for the current task', () => {
  const steers = [
    '先不要修改，只分析 src/cache.ts。',
    '更正，现在可以修改 src/cache.ts 并完成修复。',
  ];
  const authority = createAuthority('修复 src/cache.ts 的缓存问题。', steers);

  assert.equal(authority.takePendingAndDrain().length, 2);
  assert.equal(authority.writeRevoked, false);
  assert.equal(authority.semanticContract.mutation.requested, true);
  assert.equal(authority.semanticContract.mutation.prohibited, false);
  assert.ok(authority.semanticContractRevision.pendingTargets.includes('src/cache.ts'));
});

test('a read-only continuation does not silently restore revoked write authority', () => {
  const steers = [
    '先不要修改，只分析 src/cache.ts。',
    '继续分析 src/cache.ts，说明根因。',
  ];
  const authority = createAuthority('修复 src/cache.ts 的缓存问题。', steers);

  assert.equal(authority.takePendingAndDrain().length, 2);
  assert.equal(authority.writeRevoked, true);
});

test('in-flight source-only write constraint does not cancel a pending report artifact', () => {
  const steers = ['不要修改任何源码。'];
  const authority = createAuthority(
    '请创建 docs/r3-iteration/r3-live-deepseek-login-ready-state.md 测试报告。',
    steers,
  );

  assert.equal(authority.writeRevoked, false);
  assert.equal(authority.takePendingAndDrain().length, 1);
  assert.equal(authority.writeRevoked, false);
});

test('in-flight user steers revise the active contract without restarting the task', () => {
  const steers = [
    '缩小范围：只改 src/cache.ts，不要碰 src/auth.ts。',
    '继续，但不要运行命令。',
  ];
  const authority = createAuthority(
    '修复 src/cache.ts 和 src/auth.ts 的缓存登录问题，完成后运行测试。',
    steers,
  );

  const messages = authority.takePendingAndDrain();
  const revision = authority.semanticContractRevision;

  assert.equal(messages.length, 2);
  assert.equal(revision.revisionId, 'rev-3');
  assert.equal(revision.parentRevisionId, 'rev-2');
  assert.ok(revision.pendingTargets.includes('src/cache.ts'));
  assert.equal(revision.pendingTargets.includes('src/auth.ts'), false);
  assert.ok(revision.prohibitedTargets.includes('src/auth.ts'));
  assert.equal(revision.semanticContract.validation.runProhibited, true);
  assert.equal(revision.semanticContract.validation.runRequested, false);
  assert.equal(authority.currentPrompt, '继续，但不要运行命令。');
  assert.doesNotMatch(authority.currentPrompt, /修复 src\/cache\.ts 和 src\/auth\.ts/);
  assert.match(messages.at(-1).content, /TaskSemanticContract Revision/);
});

test('queued steers publish every ordered contract revision and preserve independent prohibitions', () => {
  const steers = [
    '再加一个约束：不要修改 tests/fixture.ts。',
    '更正，不再创建 alpha.txt，改为只创建 beta.txt。',
  ];
  const published = [];
  const authority = createAuthority(
    '只创建 alpha.txt。',
    steers,
    {},
    { onTaskSemanticContractRevision: revision => published.push(revision) },
  );

  const messages = authority.takePendingAndDrain();

  assert.equal(messages.length, 2);
  assert.deepEqual(published.map(revision => revision.revisionId), ['rev-2', 'rev-3']);
  assert.equal(published[0].prohibitedTargets.includes('tests/fixture.ts'), true);
  assert.equal(published[1].prohibitedTargets.includes('tests/fixture.ts'), true);
  assert.equal(published[1].prohibitedTargets.includes('alpha.txt'), true);
  assert.equal(published[1].pendingTargets.includes('beta.txt'), true);
  assert.match(messages[0].content, /不要修改 tests\/fixture\.ts/u);
  assert.match(messages[1].content, /只创建 beta\.txt/u);
});

test('in-flight correction preserves committed effects and replans only uncommitted work', () => {
  const steers = ['更正：不要再改 src/auth.ts，改为只改 src/cache.ts。'];
  const authority = createAuthority(
    '修复 src/cache.ts 和 src/auth.ts 的缓存登录问题。',
    steers,
    {
      committedEffects: () => [{
        id: 'effect-auth-write',
        revisionId: 'rev-1',
        kind: 'file-write',
        target: 'src/auth.ts',
        status: 'committed',
      }],
    },
  );

  const messages = authority.takePendingAndDrain();
  const revision = authority.semanticContractRevision;

  assert.equal(messages.length, 1);
  assert.deepEqual(revision.preservedCommittedEffectIds, ['effect-auth-write']);
  assert.ok(revision.blockedReplayEffectIds.includes('effect-auth-write'));
  assert.equal(revision.pendingTargets.includes('src/auth.ts'), false);
  assert.ok(revision.pendingTargets.includes('src/cache.ts'));
  assert.ok(revision.prohibitedTargets.includes('src/auth.ts'));
  assert.match(messages[0].content, /sealedCommittedEffects: effect-auth-write/);
});

test('provider tool proposals cannot rewrite the user-owned task contract', () => {
  const revisions = [];
  const authority = createAuthority(
    '帮我见个 notes/ready.txt，里头就一行 READY，弄完再看眼写对没，别碰别的。',
    [],
    {},
    { onTaskSemanticContractRevision: revision => revisions.push(revision) },
  );
  const initialRevision = authority.semanticContractRevision;

  const changed = authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'file-artifact',
    confidence: 0.98,
    mutation: 'create-file',
    targetPaths: ['notes/ready.txt'],
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized create_file proposal',
  });

  assert.equal(changed, true);
  assert.equal(revisions.length, 0);
  assert.equal(authority.semanticContractRevision, initialRevision);
  assert.equal(authority.semanticContractRevision.semanticContract.intent.mode, 'inspect');
  assert.equal(authority.canonicalSemanticContract.intent.mode, 'inspect');
  assert.equal(authority.semanticContract.intent.mode, 'edit');
  assert.equal(authority.semanticContract.mutation.requested, true);
  assert.deepEqual(authority.semanticContract.mutation.targets, ['notes/ready.txt']);
  assert.equal(authority.writeRevoked, false);
});

test('provider terminal proposals cannot add user-owned read completion obligations', () => {
  const authority = createAuthority(
    '只修改 src/value.cpp，不要改 test.sh，完成后运行 ./test.sh。',
    [],
  );
  const canonicalCompletion = authority.canonicalSemanticContract.completion.doneIff;

  const changed = authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'run',
    taskKind: 'terminal-validation',
    confidence: 0.98,
    mutation: 'run-only',
    targetPaths: [],
    requiresWorkspace: true,
    requiresTerminal: true,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized run_terminal proposal',
  });

  assert.equal(changed, true);
  assert.equal(authority.semanticContract.read.requested, true);
  assert.equal(authority.canonicalSemanticContract.read.requested, false);
  assert.deepEqual(authority.canonicalSemanticContract.completion.doneIff, canonicalCompletion);
  assert.equal(
    authority.canonicalSemanticContract.completion.doneIff.some(item => item.target === 'test.sh'),
    false,
  );
});

test('a provider proposal cannot override an explicit read-only user contract', () => {
  const revisions = [];
  const authority = createAuthority(
    '只分析 src/cache.ts 的职责，不要修改文件，也不要运行命令。',
    [],
    {},
    { onTaskSemanticContractRevision: revision => revisions.push(revision) },
  );

  const changed = authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'existing-project-edit',
    confidence: 0.99,
    mutation: 'modify-source',
    targetPaths: ['src/cache.ts'],
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'model proposed a prohibited write',
  });

  assert.equal(changed, false);
  assert.equal(revisions.length, 0);
  assert.equal(authority.semanticContract.mutation.prohibited, true);
  assert.deepEqual(authority.semanticContract.mutation.targets, []);
});

test('a user steer clears the provider semantic overlay and publishes user authority', () => {
  const steers = ['更正：改为创建 notes/final.txt，只写 FINAL。'];
  const revisions = [];
  const authority = createAuthority(
    '帮我见个 notes/ready.txt，里头就一行 READY。',
    steers,
    {},
    { onTaskSemanticContractRevision: revision => revisions.push(revision) },
  );
  authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'file-artifact',
    confidence: 0.98,
    mutation: 'create-file',
    targetPaths: ['notes/ready.txt'],
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized create_file proposal',
  });

  authority.takePendingAndDrain();

  assert.equal(revisions.length, 1);
  assert.equal(authority.semanticContract, authority.semanticContractRevision.semanticContract);
  assert.ok(authority.semanticContract.mutation.targets.includes('notes/final.txt'));
  assert.equal(authority.semanticContract.mutation.targets.includes('notes/ready.txt'), false);
});

test('write authority preserves dynamic callback getters from the canonical Kernel', () => {
  let acceptance = [{ id: 'initial', statement: 'Initial contract' }];
  const callbacks = {
    get canonicalVerificationAcceptance() { return acceptance; },
  };
  const authority = createWriteAuthority('inspect the workspace', callbacks);

  assert.deepEqual(authority.callbacks.canonicalVerificationAcceptance, acceptance);
  acceptance = [{ id: 'verified', statement: 'Revised contract verification' }];
  assert.deepEqual(authority.callbacks.canonicalVerificationAcceptance, acceptance);
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(authority.callbacks, 'canonicalVerificationAcceptance')?.get,
    'function',
  );
});
