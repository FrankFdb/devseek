import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const proposalBundle = path.join(rootDir, 'test/unit/model-tool-semantic-proposal.bundle.cjs');
const initialBundle = path.join(rootDir, 'test/unit/model-led-semantic-contract.bundle.cjs');
const actionBundle = path.join(rootDir, 'test/unit/model-action-semantic-contract.bundle.cjs');

for (const [entry, outfile] of [
  ['src/agent/model-tool-semantic-proposal.ts', proposalBundle],
  ['src/intent/model-led-semantic-contract.ts', initialBundle],
  ['src/intent/model-action-semantic-contract.ts', actionBundle],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const { projectModelToolSemanticProposal } = req(proposalBundle);
const { createModelLedTurnSemanticContract } = req(initialBundle);
const { projectModelActionSemanticContract } = req(actionBundle);

test('raw multilingual or typo-prone input never grants local effects before a model action', () => {
  for (const prompt of [
    '帮我见个 notes/ready.txt，里头就一行 READY。',
    'MODEL_LATEST_OK',
    '先 inspect src/math.js，然后 give me a fix plan only。',
    'src/app.ts を直してテストしてください',
  ]) {
    const contract = createModelLedTurnSemanticContract(prompt);
    assert.equal(contract.intent.mode, 'model-led');
    assert.equal(contract.mutation.requested, false);
    assert.equal(contract.read.requested, false);
    assert.equal(contract.validation.requested, false);
    assert.deepEqual(contract.mutation.targets, []);
  }
});

test('normalized create action establishes an arbitrated file contract', () => {
  const initial = createModelLedTurnSemanticContract('帮我见个 notes/ready.txt，里头就一行 READY。');
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', ['notes/ready.txt']),
  ], initial);
  const contract = projectModelActionSemanticContract(initial, semanticIntent);

  assert.equal(semanticIntent.taskKind, 'file-artifact');
  assert.equal(semanticIntent.mutation, 'create-file');
  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.mutation.requested, true);
  assert.deepEqual(contract.mutation.targets, ['notes/ready.txt']);
  assert.deepEqual(contract.taskContract.deliverableTargets, ['notes/ready.txt']);
  assert.ok(contract.signals.includes('semantic-proposal-accepted'));
});

test('normalized paths with the same basename remain independent', () => {
  const initial = createModelLedTurnSemanticContract('创建两个 README。');
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', [
      'docs/README.md',
      'packages/demo/README.md',
    ]),
  ], initial);
  const contract = projectModelActionSemanticContract(initial, semanticIntent);

  assert.deepEqual(contract.mutation.targets, ['docs/README.md', 'packages/demo/README.md']);
  assert.equal(semanticIntent.evidenceBindings.length, 2);
  assert.equal(semanticIntent.evidenceBindings.every(binding => binding.tool === 'create_file'), true);
});

test('observation plus todo action remains planning-only and non-mutating', () => {
  const initial = createModelLedTurnSemanticContract('Inspect src/math.js and give me a plan.');
  const semanticIntent = projectModelToolSemanticProposal([
    tool('read_file', 'read', 'observe', ['src/math.js']),
    tool('manage_todo_list', 'control', 'observe'),
  ], initial);
  const contract = projectModelActionSemanticContract(initial, semanticIntent);

  assert.equal(semanticIntent.taskKind, 'planning');
  assert.equal(contract.intent.mode, 'plan');
  assert.equal(contract.read.requested, true);
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.validation.requested, false);
});

test('read-only terminal action is observation, not validation or mutation', () => {
  const initial = createModelLedTurnSemanticContract('看看当前目录。');
  const semanticIntent = projectModelToolSemanticProposal([
    tool('run_terminal', 'terminal', 'observe'),
  ], initial);
  const contract = projectModelActionSemanticContract(initial, semanticIntent);

  assert.equal(semanticIntent.taskKind, 'read-only-analysis');
  assert.equal(semanticIntent.requiresTerminal, false);
  assert.equal(contract.read.requested, true);
  assert.equal(contract.validation.requested, false);
  assert.equal(contract.mutation.requested, false);
});

test('validation terminal action requests command evidence without implying mutation', () => {
  const initial = createModelLedTurnSemanticContract('Run the project checks.');
  const semanticIntent = projectModelToolSemanticProposal([
    tool('run_terminal', 'terminal', 'verify'),
  ], initial);
  const contract = projectModelActionSemanticContract(initial, semanticIntent);

  assert.equal(semanticIntent.taskKind, 'terminal-validation');
  assert.equal(contract.kind, 'validation');
  assert.equal(contract.validation.requested, true);
  assert.equal(contract.mutation.requested, false);
});

test('external and destructive effects remain explicit local arbitration boundaries', () => {
  const initial = createModelLedTurnSemanticContract('Do the requested work.');
  const external = projectModelToolSemanticProposal([
    tool('memory_write', 'memory', 'external-effect'),
  ], initial);
  const destructive = projectModelToolSemanticProposal([
    tool('delete_file', 'edit', 'workspace-mutation', ['build/cache.json']),
  ], initial);

  const externalContract = projectModelActionSemanticContract(initial, external);
  const destructiveContract = projectModelActionSemanticContract(initial, destructive);
  assert.equal(externalContract.intent.context.externalEffect, 'requested');
  assert.equal(externalContract.intent.requiresConfirmation, true);
  assert.equal(destructiveContract.kind, 'destructive');
  assert.equal(destructiveContract.intent.requiresConfirmation, true);
});

function tool(name, kind, purpose, targetPaths = []) {
  const input = targetPaths.length > 1
    ? { files: targetPaths.map(path => ({ path, content: `content for ${path}` })) }
    : targetPaths.length === 1
      ? { path: targetPaths[0], content: `content for ${targetPaths[0]}` }
      : {};
  return {
    id: `tool-${name}`,
    name,
    input,
    source: 'native',
    registered: true,
    kind,
    risk: kind === 'terminal' ? 'medium' : 'low',
    purpose,
    effects: purpose === 'workspace-mutation'
      ? ['workspace-mutation']
      : purpose === 'external-effect'
        ? ['local-state']
        : purpose === 'observe'
          ? ['read']
          : ['process'],
    protectedPath: false,
    targetPaths,
    executable: true,
  };
}
