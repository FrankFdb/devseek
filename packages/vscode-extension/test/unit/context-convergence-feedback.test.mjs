import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-context-convergence-'));
const bundlePath = path.join(tempRoot, 'context-convergence-feedback.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/context-convergence-feedback.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { PreMutationConvergenceLedger } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const unresolvedMutation = Object.freeze({
  mutationRequired: true,
  successfulMutationCount: 0,
  unresolvedExecution: true,
  gatheredEvidenceCount: 8,
  investigationActivity: true,
});

test('pre-mutation convergence corrects twice and then stops investigation without a write', () => {
  const ledger = new PreMutationConvergenceLedger();

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  const firstCorrection = ledger.observe(unresolvedMutation);
  assert.equal(firstCorrection.kind, 'correct');
  assert.match(firstCorrection.feedback, /replace_in_file/u);

  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
  const stopped = ledger.observe(unresolvedMutation);
  assert.equal(stopped.kind, 'stop');
  assert.match(stopped.reason, /避免自主模式继续无界调查/u);
});

test('pre-mutation convergence ignores non-investigation turns and resets after a real write', () => {
  const ledger = new PreMutationConvergenceLedger();
  const idle = { ...unresolvedMutation, investigationActivity: false };
  assert.equal(ledger.observe(idle).kind, 'continue');
  assert.equal(ledger.observe(idle).kind, 'continue');

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
  assert.equal(ledger.observe(unresolvedMutation).kind, 'correct');
  assert.equal(ledger.observe({
    ...unresolvedMutation,
    successfulMutationCount: 1,
  }).kind, 'continue');

  assert.equal(ledger.observe(unresolvedMutation).kind, 'continue');
});

test('read-only work and insufficient evidence never acquire mutation convergence pressure', () => {
  const ledger = new PreMutationConvergenceLedger();
  for (let round = 0; round < 6; round++) {
    assert.equal(ledger.observe({
      ...unresolvedMutation,
      mutationRequired: false,
    }).kind, 'continue');
    assert.equal(ledger.observe({
      ...unresolvedMutation,
      gatheredEvidenceCount: 2,
    }).kind, 'continue');
  }
});
