import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/source-validation-ledger.bundle.cjs');

execSync(
  `npx esbuild src/agent/source-validation-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { SourceValidationLedger } = createRequire(import.meta.url)(bundlePath);
const passedGate = { status: 'pass', summary: 'project tests passed' };

test('successful validation remains attached across later read-only and completion rounds', () => {
  const ledger = new SourceValidationLedger();
  ledger.beginWriteCohort(1);
  ledger.settleWriteCohort(1, passedGate);

  assert.deepEqual(ledger.qualityGateForCurrentSource(), passedGate);
  assert.equal(ledger.currentSourceIsValidated(), true);

  // No new write cohort is announced during later read-only/model completion rounds.
  assert.deepEqual(ledger.qualityGateForCurrentSource(), passedGate);
  assert.equal(ledger.currentSourceIsValidated(), true);
});

test('a newer write invalidates the prior validation until that exact cohort settles', () => {
  const ledger = new SourceValidationLedger();
  ledger.beginWriteCohort(1);
  ledger.settleWriteCohort(1, passedGate);

  ledger.beginWriteCohort(2);
  assert.equal(ledger.qualityGateForCurrentSource(), undefined);
  assert.equal(ledger.currentSourceIsValidated(), false);

  ledger.settleWriteCohort(1, passedGate);
  assert.equal(ledger.qualityGateForCurrentSource(), undefined);

  const failedGate = { status: 'fail', summary: 'compile failed' };
  ledger.settleWriteCohort(2, failedGate);
  assert.deepEqual(ledger.qualityGateForCurrentSource(), failedGate);
  assert.equal(ledger.currentSourceIsValidated(), false);
});

test('manual-review validation cannot inherit a prior passing gate', () => {
  const ledger = new SourceValidationLedger();
  ledger.beginWriteCohort(1);
  ledger.settleWriteCohort(1, passedGate);

  ledger.beginWriteCohort(2);
  ledger.settleWriteCohort(2, undefined);

  assert.equal(ledger.qualityGateForCurrentSource(), undefined);
  assert.equal(ledger.currentSourceIsValidated(), false);
});
