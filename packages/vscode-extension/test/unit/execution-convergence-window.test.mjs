import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/execution-convergence-window.bundle.cjs');

execSync(
  `npx esbuild src/agent/execution-convergence-window.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { renewExecutionConvergenceRoundLimit } = createRequire(import.meta.url)(bundlePath);

test('execution convergence does not reward reads, prose, or already-settled work', () => {
  const base = {
    currentRoundLimit: 25,
    roundCount: 24,
    maxRoundLimit: 80,
  };
  assert.equal(renewExecutionConvergenceRoundLimit({
    ...base,
    concreteProgress: false,
    unresolvedExecution: true,
  }), 25);
  assert.equal(renewExecutionConvergenceRoundLimit({
    ...base,
    concreteProgress: true,
    unresolvedExecution: false,
  }), 25);
});

test('late mutation or validation progress renews a moving bounded repair window', () => {
  let limit = renewExecutionConvergenceRoundLimit({
    currentRoundLimit: 25,
    roundCount: 24,
    maxRoundLimit: 80,
    concreteProgress: true,
    unresolvedExecution: true,
  });
  assert.equal(limit, 32);

  limit = renewExecutionConvergenceRoundLimit({
    currentRoundLimit: limit,
    roundCount: 31,
    maxRoundLimit: 80,
    concreteProgress: true,
    unresolvedExecution: true,
  });
  assert.equal(limit, 39);
});

test('execution convergence renewal cannot exceed its absolute normal-mode cap', () => {
  assert.equal(renewExecutionConvergenceRoundLimit({
    currentRoundLimit: 78,
    roundCount: 77,
    maxRoundLimit: 80,
    concreteProgress: true,
    unresolvedExecution: true,
  }), 80);
});
