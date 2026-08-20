import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const routerBundle = path.join(rootDir, 'test/unit/task-intent-router.bundle.cjs');
const initialBundle = path.join(rootDir, 'test/unit/task-intent-router-initial.bundle.cjs');
const actionBundle = path.join(rootDir, 'test/unit/task-intent-router-action.bundle.cjs');

for (const [entry, outfile] of [
  ['src/task-intent-router.ts', routerBundle],
  ['src/intent/model-led-semantic-contract.ts', initialBundle],
  ['src/intent/model-action-semantic-contract.ts', actionBundle],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const { routeTaskIntent, routeTaskSemanticContract } = req(routerBundle);
const { createModelLedTurnSemanticContract } = req(initialBundle);
const { projectModelActionSemanticContract } = req(actionBundle);

test('ordinary raw text stays ambiguous until the model proposes an action', () => {
  for (const prompt of [
    'hello',
    '创建 result.txt，内容为 READY',
    '只分析 src/cache.ts，不要修改',
    'MODEL_LATEST_OK',
  ]) {
    const route = routeTaskIntent(prompt);
    assert.equal(route.family, 'ambiguous');
    assert.equal(route.mode, 'model-led');
    assert.equal(route.chatKind, 'chat');
    assert.equal(route.mutation.requested, false);
    assert.equal(route.validation.commandEvidenceRequired, false);
  }
});

test('empty raw input is rejected as an empty turn, not semantically guessed', () => {
  const route = routeTaskIntent('   ');

  assert.equal(route.family, 'smalltalk');
  assert.equal(route.semanticContract.intent.context.empty, true);
});

test('normalized read action becomes a read-only route', () => {
  const route = routeAfterAction('Inspect the file.', {
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['src/cache.ts'],
    requiresWorkspace: true,
  });

  assert.equal(route.family, 'read-only-advisory');
  assert.equal(route.chatKind, 'chat');
  assert.equal(route.agentTaskShape, 'read-only-analysis');
  assert.deepEqual(route.semanticContract.read.targets, ['src/cache.ts']);
  assert.equal(route.allowedToolKinds.includes('edit'), false);
});

test('normalized source mutation becomes code-change work with validation evidence', () => {
  const route = routeAfterAction('Fix the source.', {
    taskKind: 'existing-project-edit',
    mutation: 'modify-source',
    targetPaths: ['src/cache.ts'],
    requiresWorkspace: true,
  });

  assert.equal(route.family, 'existing-project-edit');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'edit');
  assert.equal(route.mutation.sourceChange, true);
  assert.equal(route.validation.commandEvidenceRequired, true);
});

test('normalized non-code artifact requires scoped file readback', () => {
  const route = routeAfterAction('Create the report.', {
    taskKind: 'file-artifact',
    mutation: 'create-file',
    targetPaths: ['docs/report.md'],
    requiresWorkspace: true,
  });

  assert.equal(route.family, 'file-artifact');
  assert.equal(route.mutation.fileArtifact, true);
  assert.equal(route.validation.fileCheckRequired, true);
  assert.equal(route.validation.commandEvidenceRequired, false);
});

test('terminal, external, and destructive actions retain distinct typed routes', () => {
  const terminal = routeAfterAction('Validate.', {
    mode: 'run',
    taskKind: 'terminal-validation',
    mutation: 'run-only',
    requiresWorkspace: true,
    requiresTerminal: true,
  });
  const external = routeAfterAction('Publish.', {
    mode: 'run',
    taskKind: 'external-effect',
    mutation: 'external-effect',
    requiresTerminal: true,
    requiresExternalEffect: true,
  });
  const destructive = routeAfterAction('Delete.', {
    mode: 'destructive',
    taskKind: 'destructive',
    mutation: 'delete',
    targetPaths: ['build/cache.json'],
    requiresWorkspace: true,
  });

  assert.equal(terminal.family, 'terminal-validation');
  assert.equal(terminal.validation.commandEvidenceRequired, true);
  assert.equal(external.family, 'release-external-effect');
  assert.equal(external.requiresConfirmation, true);
  assert.equal(destructive.family, 'destructive');
  assert.equal(destructive.requiresConfirmation, true);
});

function routeAfterAction(prompt, overrides) {
  const initial = createModelLedTurnSemanticContract(prompt);
  const contract = projectModelActionSemanticContract(initial, action(overrides));
  return routeTaskSemanticContract(contract);
}

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
