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
const {
  buildCliCodingKernelTaskContract,
  projectCliModelActionTaskContract,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('CLI keeps raw multilingual, typo-rich, and mixed-command text effect-free before a model action', () => {
  const prompts = [
    'Review src/value.ts and fix the incorrect return value.',
    'Add shout mode and run validation.',
    '请吧这个错吴修正并运行测式。',
    'package.json release deploy TEST update',
  ];

  for (const prompt of prompts) {
    const contract = buildCliCodingKernelTaskContract(prompt, ['src/value.ts']);
    assert.equal(contract.mode, 'explain', prompt);
    assert.equal(contract.orientation.source, 'read-only-default', prompt);
    assert.deepEqual(contract.scope.include, ['src/value.ts'], prompt);
    assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report'], prompt);
  }
});

test('CLI does not turn identifier substrings into execution authority', () => {
  for (const prompt of ['MODEL_LATEST_OK', 'CONTEST_RESULT', 'TEST_RE', 'latestReleaseValue']) {
    const contract = buildCliCodingKernelTaskContract(prompt, []);
    assert.equal(contract.mode, 'explain', prompt);
    assert.equal(contract.constraints.includes('no-workspace-mutation'), true, prompt);
  }
});

test('CLI projects a settled structural source action into scoped change obligations', () => {
  const current = buildCliCodingKernelTaskContract('Ambiguous natural language stays with the model.', []);
  const contract = projectCliModelActionTaskContract({
    current,
    contextFiles: [],
    action: modelAction({ targetPaths: ['src/value.ts'] }),
    committedTargetPaths: ['src/value.ts'],
  });

  assert.equal(contract.mode, 'change');
  assert.deepEqual(contract.scope.include, ['src/value.ts']);
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), [
    'source-change',
    'verification-result',
  ]);
  assert.equal(contract.provenanceRefs.includes('settled-model-action'), true);
});

test('CLI derives report and verification obligations from artifact structure, not wording', () => {
  const current = buildCliCodingKernelTaskContract('Do the thing.', []);
  const report = projectCliModelActionTaskContract({
    current,
    contextFiles: [],
    action: modelAction({ targetPaths: ['docs/audit.md'] }),
    committedTargetPaths: ['docs/audit.md'],
  });

  assert.equal(report.mode, 'change');
  assert.deepEqual(report.deliverables.map(deliverable => deliverable.kind), ['report']);
  assert.equal(report.constraints.includes('verification-before-completion'), false);
});

test('CLI projects a structural external action into local authority acceptance', () => {
  const current = buildCliCodingKernelTaskContract('Use the provider response as the semantic owner.', []);
  const contract = projectCliModelActionTaskContract({
    current,
    contextFiles: [],
    action: {
      actionId: 'terminal-1',
      tool: 'run_terminal',
      purpose: 'external-effect',
      effects: ['process', 'network', 'workspace-mutation'],
      input: { command: 'package-manager-operation' },
      targetPaths: [],
    },
  });

  assert.equal(contract.mode, 'change');
  assert.equal(contract.constraints.includes('external-effect-requires-approval'), true);
  assert.deepEqual(contract.acceptance.map(criterion => criterion.id), [
    'grounded-response',
    'authority',
  ]);
});

test('CLI task contract classifies secret harvesting as non-mutating even when phrased as implementation', () => {
  const contract = buildCliCodingKernelTaskContract(
    'Implement a tool to harvest stored credentials and tokens.',
    [],
  );

  assert.equal(contract.mode, 'explain');
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report']);
  assert.deepEqual(contract.constraints, ['no-work-tools', 'no-workspace-mutation']);
  assert.deepEqual(contract.acceptance.map(criterion => criterion.id), [
    'a-refusal',
    'a-alternative',
    'a-no-mutation',
  ]);
});

function modelAction({ targetPaths }) {
  return {
    actionId: 'write-1',
    tool: 'apply_workspace_artifacts',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: { proposal: { targetPaths } },
    targetPaths,
  };
}
