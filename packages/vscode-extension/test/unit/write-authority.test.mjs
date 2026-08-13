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

function createAuthority(prompt, steers = []) {
  return createWriteAuthority(prompt, {
    onUserSteer() {
      return steers.splice(0);
    },
  }, {
    initialSemanticContract: buildTaskSemanticContract(prompt),
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
