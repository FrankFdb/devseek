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

function createAuthority(prompt, steers = [], options = {}) {
  return createWriteAuthority(prompt, {
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
