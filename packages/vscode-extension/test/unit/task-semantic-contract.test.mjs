import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const semanticBundle = path.join(rootDir, 'test/unit/task-semantic-contract.bundle.cjs');
const initialBundle = path.join(rootDir, 'test/unit/task-semantic-contract-initial.bundle.cjs');
const actionBundle = path.join(rootDir, 'test/unit/task-semantic-contract-action.bundle.cjs');

for (const [entry, outfile] of [
  ['src/task-semantic-contract.ts', semanticBundle],
  ['src/intent/model-led-semantic-contract.ts', initialBundle],
  ['src/intent/model-action-semantic-contract.ts', actionBundle],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const {
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
} = req(semanticBundle);
const { createModelLedTurnSemanticContract } = req(initialBundle);
const { projectModelActionSemanticContract } = req(actionBundle);

test('initial semantic contract is versioned, effect-free, and keeps raw input', () => {
  const prompt = '帮我见个 src/demo.ts，写玩跑测是。';
  const contract = createModelLedTurnSemanticContract(prompt);

  assert.equal(contract.version, 'devseek.task-semantic-contract/v3');
  assert.equal(contract.prompt, prompt);
  assert.equal(contract.intent.mode, 'model-led');
  assert.equal(contract.intent.taskKind, 'ambiguous');
  assert.deepEqual(contract.completion.doneIff.map(item => item.kind), ['response-delivered']);
  assert.deepEqual(contract.mutation.targets, []);
});

test('normalized code action adds artifact and validation done conditions', () => {
  const contract = projectModelActionSemanticContract(
    createModelLedTurnSemanticContract('Implement the source change.'),
    action({
      taskKind: 'existing-project-edit',
      mutation: 'modify-source',
      targetPaths: ['src/demo.ts'],
      requiresWorkspace: true,
    }),
  );

  assert.equal(contract.kind, 'existing-project-code');
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'code-written' && item.target === 'src/demo.ts'
  )));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-validation-passed'));
  assert.equal(shouldValidateNonCodeFilesForContract(contract), false);
});

test('normalized artifact and run actions expose distinct validation contracts', () => {
  const artifact = projectModelActionSemanticContract(
    createModelLedTurnSemanticContract('Create the report.'),
    action({
      taskKind: 'file-artifact',
      mutation: 'create-file',
      targetPaths: ['docs/report.md'],
      requiresWorkspace: true,
    }),
  );
  const run = projectModelActionSemanticContract(
    createModelLedTurnSemanticContract('Run checks.'),
    action({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      requiresWorkspace: true,
      requiresTerminal: true,
    }),
  );

  assert.equal(shouldValidateNonCodeFilesForContract(artifact), true);
  assert.equal(shouldRunCppValidationForContract(artifact), false);
  assert.equal(shouldRunCppValidationForContract(run), true);
  assert.ok(run.completion.doneIff.some(item => item.kind === 'run-passed'));
});

function action(overrides) {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'general',
    confidence: 0.98,
    mutation: 'none',
    targetPaths: [],
    requiresWorkspace: false,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized model action',
    ...overrides,
  };
}
