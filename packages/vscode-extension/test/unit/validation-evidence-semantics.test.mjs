import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/validation-evidence-semantics.bundle.cjs');

execSync(
  `npx esbuild src/agent/validation-evidence-semantics.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  renderCurrentCohortValidationFact,
  VALIDATION_EVIDENCE_REVIEW_RULES,
} = createRequire(import.meta.url)(bundlePath);

test('current cohort validation fact preserves every bounded host command result', () => {
  const fact = renderCurrentCohortValidationFact({
    qualityGate: { status: 'pass', summary: 'bash test.sh passed' },
    terminalEvidence: [
      { command: 'bash test.sh', kind: 'test', ok: true, exitCode: 0 },
      {
        command: './build/app --snapshot current.ppm',
        kind: 'run',
        ok: true,
        exitCode: 0,
      },
      {
        command: 'node tools/verify-ppm.mjs current.ppm',
        kind: 'run',
        ok: true,
        exitCode: 0,
      },
    ],
  });

  assert.match(fact, /QUALITY_GATE status=pass/u);
  assert.match(fact, /command="bash test\.sh"/u);
  assert.match(fact, /command="\.\/build\/app --snapshot current\.ppm"/u);
  assert.match(fact, /result=PASS kind=run exitCode=0 command="node tools\/verify-ppm\.mjs current\.ppm"/u);
});

test('review rules make an exact current-cohort pass authoritative over historical failure text', () => {
  assert.equal(
    VALIDATION_EVIDENCE_REVIEW_RULES.some(rule => (
      /exact current-cohort command/u.test(rule)
      && /supersedes an older failure/u.test(rule)
    )),
    true,
  );
});
