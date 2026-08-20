import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL_INTENT_CORPUS,
  EXTERNAL_INTENT_SOURCES,
} from '../fixtures/external-intent-corpus.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-semantic-matrix-'));
const bundlePath = path.join(bundleDir, 'write-authority.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/write-authority.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const { createWriteAuthority } = createRequire(import.meta.url)(bundlePath);
after(() => rmSync(bundleDir, { recursive: true, force: true }));

const REQUIRED_TASK_KINDS = [
  'smalltalk',
  'question-answer',
  'read-only-analysis',
  'planning',
  'code-review',
  'standalone-program',
  'file-artifact',
  'existing-project-edit',
  'terminal-validation',
  'external-effect',
  'destructive',
  'ambiguous',
];

for (const item of EXTERNAL_INTENT_CORPUS) {
  test(`external workflow corpus preserves authority boundaries: ${item.id}`, () => {
    const authority = createWriteAuthority(item.prompt, {});

    assert.equal(authority.currentPrompt, item.prompt);
    assert.equal(authority.canonicalSemanticContract.intent.mode, 'model-led');
    assert.equal(authority.canonicalSemanticContract.mutation.requested, false);
    assert.equal(authority.canonicalSemanticContract.read.requested, false);
    assert.equal(authority.canonicalSemanticContract.validation.requested, false);

    if (!requiresConcreteAction(item.semanticIntent)) {
      assert.equal(authority.completionSemanticContract, authority.canonicalSemanticContract);
      return;
    }

    const binding = evidenceBindingFor(item.semanticIntent);
    const proposal = {
      ...item.semanticIntent,
      evidenceBindings: [binding],
    };
    assert.equal(authority.applyModelSemanticProposal(proposal), true);
    assert.equal(authority.completionSemanticContract, authority.canonicalSemanticContract);

    const wrongReceipt = receiptFor(binding, { inputSha256: 'f'.repeat(64) });
    assert.equal(authority.settleModelSemanticProposal([wrongReceipt]), undefined);
    assert.equal(authority.completionSemanticContract, authority.canonicalSemanticContract);

    const settled = authority.settleModelSemanticProposal([receiptFor(binding)]);
    assert.ok(settled);
    assert.equal(settled.semanticContract.intent.taskKind, item.semanticIntent.taskKind);
    assert.equal(settled.toolReceipts.length, 1);
    assert.notEqual(authority.completionSemanticContract, authority.canonicalSemanticContract);
    assertProjectedAction(settled.semanticContract, item.semanticIntent, item.id);
  });
}

test('external corpus covers every task family and keeps source provenance valid', () => {
  const counts = new Map(REQUIRED_TASK_KINDS.map(kind => [kind, 0]));
  for (const item of EXTERNAL_INTENT_CORPUS) {
    assert.ok(item.id.startsWith('EXT-'));
    assert.equal(item.taskKind, item.semanticIntent.taskKind);
    assert.ok(item.prompt.trim().length > 0, item.id);
    assert.ok(item.sourceRefs.length > 0, item.id);
    for (const sourceRef of item.sourceRefs) {
      assert.ok(EXTERNAL_INTENT_SOURCES[sourceRef], `${item.id}: unknown source ${sourceRef}`);
    }
    counts.set(item.taskKind, (counts.get(item.taskKind) || 0) + 1);
  }

  assert.deepEqual([...counts.entries()].filter(([, count]) => count < 4), []);
});

test('an exact operation binding rejects same-kind evidence from another action', () => {
  const authority = createWriteAuthority('创建 notes/ready.txt，只写 READY。', {});
  const binding = {
    tool: 'create_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    inputSha256: '1'.repeat(64),
  };
  authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'file-artifact',
    confidence: 0.98,
    mutation: 'create-file',
    targetPaths: ['notes/ready.txt'],
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized create_file action',
    evidenceBindings: [binding],
  });

  assert.equal(authority.settleModelSemanticProposal([
    receiptFor({ ...binding, inputSha256: '2'.repeat(64) }),
  ]), undefined);
  assert.equal(authority.completionSemanticContract.mutation.requested, false);

  const settled = authority.settleModelSemanticProposal([receiptFor(binding)]);
  assert.ok(settled);
  assert.deepEqual(authority.completionSemanticContract.mutation.targets, ['notes/ready.txt']);
});

function requiresConcreteAction(intent) {
  return intent.mutation !== 'none'
    || intent.requiresWorkspace
    || intent.requiresTerminal
    || intent.requiresExternalEffect;
}

function evidenceBindingFor(intent) {
  if (intent.mutation === 'create-file' || intent.mutation === 'modify-source' || intent.mutation === 'delete') {
    return {
      tool: intent.mutation === 'create-file'
        ? 'create_file'
        : intent.mutation === 'delete'
          ? 'delete_file'
          : 'replace_in_file',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      inputSha256: hashFor(intent),
    };
  }
  if (intent.mutation === 'external-effect' || intent.requiresExternalEffect) {
    return {
      tool: 'run_terminal',
      purpose: 'external-effect',
      effects: ['process', 'network'],
      inputSha256: hashFor(intent),
    };
  }
  if (intent.mutation === 'run-only' || intent.requiresTerminal) {
    return {
      tool: 'run_terminal',
      purpose: 'verify',
      effects: ['process'],
      inputSha256: hashFor(intent),
    };
  }
  return {
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: hashFor(intent),
  };
}

function receiptFor(binding, overrides = {}) {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'semantic-matrix-run',
    sequence: 1,
    actionId: 'semantic-matrix-action-1',
    tool: binding.tool,
    purpose: binding.purpose,
    effects: binding.effects,
    inputSha256: binding.inputSha256,
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'test-operation-authorized',
      evidenceRefs: ['authority:semantic-matrix-action-1'],
    },
    status: 'completed',
    evidenceRefs: ['tool:semantic-matrix-action-1:completed'],
    ...overrides,
  };
}

function hashFor(intent) {
  const seed = [...String(intent.taskKind)].reduce((total, character) => total + character.codePointAt(0), 0);
  return (seed.toString(16) || '0').padStart(64, '0').slice(-64);
}

function assertProjectedAction(contract, intent, id) {
  if (intent.mutation === 'create-file' || intent.mutation === 'modify-source') {
    assert.equal(contract.mutation.requested, true, id);
    for (const target of intent.targetPaths) assert.ok(contract.mutation.targets.includes(target), id);
  }
  if (intent.mutation === 'delete' || intent.taskKind === 'destructive') {
    assert.equal(contract.kind, 'destructive', id);
    assert.equal(contract.intent.requiresConfirmation, true, id);
  }
  if (intent.mutation === 'external-effect' || intent.requiresExternalEffect) {
    assert.equal(contract.intent.context.externalEffect, 'requested', id);
    assert.equal(contract.intent.requiresConfirmation, true, id);
  }
  if (intent.mutation === 'run-only' || intent.requiresTerminal) {
    assert.equal(contract.validation.requested, true, id);
  }
  if (intent.mutation === 'none' && intent.requiresWorkspace && !intent.requiresTerminal) {
    assert.equal(contract.read.requested, true, id);
  }
}
