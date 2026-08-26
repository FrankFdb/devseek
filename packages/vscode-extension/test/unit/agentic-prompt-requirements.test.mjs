import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agentic-prompt-requirements-'));
const bundlePath = path.join(tempRoot, 'agentic-prompt-requirements.cjs');
const semanticBundlePath = path.join(tempRoot, 'model-led-semantic-contract.cjs');

for (const [entry, output] of [
  ['src/agent/agentic-prompt-requirements.ts', bundlePath],
  ['src/intent/model-led-semantic-contract.ts', semanticBundlePath],
]) {
  execFileSync('npx', [
    'esbuild',
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${output}`,
  ], { cwd: rootDir, stdio: 'pipe' });
}

const { resolveAgenticPromptRequirements } = createRequire(import.meta.url)(bundlePath);
const {
  createModelLedTurnSemanticContract,
} = createRequire(import.meta.url)(semanticBundlePath);
const {
  resolveCodingKernelTaskContract,
} = createRequire(import.meta.url)(path.resolve(rootDir, '../shared/dist/index.js'));

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function canonicalContract(prompt, modeHint) {
  return resolveCodingKernelTaskContract({
    prompt,
    surface: 'vscode',
    modeHint,
    confirmedWorkspaceMutation: modeHint === 'change',
    deliverableKinds: modeHint === 'change' ? ['source-change'] : ['report'],
  });
}

test('canonical change obligation keeps model-led investigation mutation-bound', () => {
  const prompt = 'Continue modifying the existing C++ application.\nRun its tests.';
  const requirements = resolveAgenticPromptRequirements(
    createModelLedTurnSemanticContract(prompt),
    canonicalContract(prompt, 'change'),
  );

  assert.equal(requirements.promptRequiresFileChange, true);
  assert.equal(requirements.promptRequiresTools, true);
});

test('read-only contracts and stale steering goals do not inherit mutation debt', () => {
  const prompt = 'Review the current implementation.';
  const semanticContract = createModelLedTurnSemanticContract(prompt);

  assert.equal(resolveAgenticPromptRequirements(
    semanticContract,
    canonicalContract(prompt, 'review'),
  ).promptRequiresFileChange, false);
  assert.equal(resolveAgenticPromptRequirements(
    semanticContract,
    canonicalContract('Modify the implementation.', 'change'),
  ).promptRequiresFileChange, false);
});
