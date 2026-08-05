import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-verification-adapter.bundle.cjs');

execSync(
  `npx esbuild src/app/coding-verification-adapter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { VsCodeVerificationAdapter } = req(bundlePath);

function input(overrides = {}) {
  return {
    runId: 'run-vscode-verification',
    sequence: 1,
    actionId: 'verify-1',
    scopePaths: ['src/main.ts'],
    acceptance: [{ id: 'validated', statement: 'Applicable validation passes.' }],
    evidenceRefs: ['mutation:commit-1'],
    verifier: 'vscode-quality-gate',
    observe: async () => ({
      status: 'passed',
      summary: 'Typecheck passed.',
      command: 'npm test',
      exitCode: 0,
      evidenceRefs: ['run-evidence:verify-1'],
    }),
    ...overrides,
  };
}

test('VS Code verification adapter returns evidence-backed shared acceptance', async () => {
  const outcome = await new VsCodeVerificationAdapter().verify(input());

  assert.equal(outcome.receipt.status, 'passed');
  assert.deepEqual(outcome.receipt.acceptance, [{
    criterionId: 'validated',
    status: 'passed',
    evidenceRefs: ['run-evidence:verify-1'],
  }]);
  assert.deepEqual(outcome.receipt.evidenceRefs, [
    'mutation:commit-1',
    'run-evidence:verify-1',
  ]);
});

test('VS Code verification adapter never promotes an unavailable verifier', async () => {
  const outcome = await new VsCodeVerificationAdapter().verify(input({
    observe: async () => ({
      status: 'unverified',
      summary: 'No applicable verifier was available.',
      evidenceRefs: ['run-evidence:verify-1:blocked'],
    }),
  }));

  assert.equal(outcome.receipt.status, 'unverified');
  assert.equal(outcome.receipt.acceptance[0].status, 'unverified');
});

test('VS Code verification adapter turns evidence-free pass into indeterminate', async () => {
  const outcome = await new VsCodeVerificationAdapter().verify(input({
    observe: async () => ({
      status: 'passed',
      summary: 'Claimed pass without evidence.',
      evidenceRefs: [],
    }),
  }));

  assert.equal(outcome.receipt.status, 'indeterminate');
  assert.equal(outcome.receipt.errorCode, 'verification-host-failed');
});

test('VS Code verification adapter replays one action identity without re-observing', async () => {
  let observations = 0;
  const adapter = new VsCodeVerificationAdapter();
  const request = input({
    observe: async () => {
      observations += 1;
      return {
        status: 'failed',
        summary: 'Tests failed.',
        command: 'npm test',
        exitCode: 1,
        evidenceRefs: ['run-evidence:verify-1'],
      };
    },
  });

  const first = await adapter.verify(request);
  const replay = await adapter.verify(request);

  assert.equal(first.receipt.status, 'failed');
  assert.equal(replay.replayed, true);
  assert.equal(observations, 1);
});
