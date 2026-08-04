import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-kernel-task-contract-'));
const bundlePath = path.join(bundleRoot, 'task-contract.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-coding-kernel-task-contract.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { buildCliCodingKernelTaskContract } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('CLI task contract gives an explicit requested change precedence over review wording', () => {
  const contract = buildCliCodingKernelTaskContract(
    'Review src/value.ts and fix the incorrect return value.',
    ['src/value.ts'],
  );

  assert.equal(contract.mode, 'change');
  assert.deepEqual(contract.scope.include, ['src/value.ts']);
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), [
    'source-change',
    'verification-result',
  ]);
});

test('CLI task contract keeps review work non-mutating by default', () => {
  const contract = buildCliCodingKernelTaskContract('Audit src/value.ts for correctness.', ['src/value.ts']);

  assert.equal(contract.mode, 'review');
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report']);
});

test('CLI task contract does not treat package and release filenames as mutation authority', () => {
  const packageReview = buildCliCodingKernelTaskContract('Review package.json for dependency risks.', ['package.json']);
  const releaseReview = buildCliCodingKernelTaskContract('Analyze the release workflow.', []);

  assert.equal(packageReview.mode, 'review');
  assert.equal(releaseReview.mode, 'review');
});

test('CLI task contract keeps explanatory questions about change verbs non-mutating', () => {
  const contract = buildCliCodingKernelTaskContract('How does the update command work?', []);

  assert.equal(contract.mode, 'explain');
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report']);
});

test('CLI task contract classifies secret harvesting as non-mutating even when phrased as implementation', () => {
  const contract = buildCliCodingKernelTaskContract(
    'Implement a tool to harvest stored credentials and tokens.',
    [],
  );

  assert.equal(contract.mode, 'explain');
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report']);
  assert.match(contract.constraints[0], /Do not mutate/u);
});
