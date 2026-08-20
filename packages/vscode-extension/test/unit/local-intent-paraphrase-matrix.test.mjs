import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-paraphrase-matrix-'));

execFileSync('npx', [
  'esbuild',
  'src/intent-router.ts',
  'src/intent/model-action-semantic-contract.ts',
  '--bundle',
  `--outdir=${bundleDir}`,
  '--outbase=src',
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { decideChatIntent } = require(path.join(bundleDir, 'intent-router.js'));
const { projectModelActionSemanticContract } = require(path.join(
  bundleDir,
  'intent/model-action-semantic-contract.js',
));
after(() => rmSync(bundleDir, { recursive: true, force: true }));

const REPAIR_PARAPHRASES = [
  '请吧 src/login.ts 空密码崩溃的问题秀一下。',
  '登录表单没填密码就挂了，麻烦处理 src/login.ts。',
  'The login form crashes when the password is blank; take care of src/login.ts.',
  'src/login.ts は空のパスワードで落ちます。修正してください。',
  'src/login.ts blank password 时会 crash，帮忙 fix 一下。',
  '现象：密码为空时退出。目标文件 src/login.ts；完成后用现有检查确认。',
];

test('different users and typo styles converge only after the same typed model action', () => {
  const projectedViews = REPAIR_PARAPHRASES.map(prompt => {
    const initial = decideChatIntent(prompt).semanticContract;
    const projected = projectModelActionSemanticContract(initial, proposal({
      mode: 'edit',
      taskKind: 'existing-project-edit',
      mutation: 'modify-source',
      targetPaths: ['src/login.ts'],
      requiresWorkspace: true,
      requiresTerminal: true,
    }));
    assert.equal(projected.prompt, prompt);
    return semanticView(projected);
  });

  for (const view of projectedViews.slice(1)) {
    assert.deepEqual(view, projectedViews[0]);
  }
  assert.deepEqual(projectedViews[0], {
    mode: 'edit',
    taskKind: 'existing-project-edit',
    kind: 'existing-project-code',
    scope: 'existing-project',
    mutationRequested: true,
    sourceChange: true,
    fileArtifact: false,
    mutationTargets: ['src/login.ts'],
    readRequested: false,
    readTargets: [],
    validationRequested: true,
    runRequested: true,
    externalEffect: 'none',
  });
});

const ACTION_MATRIX = [
  {
    name: 'direct explanation',
    prompt: '说明 GPU CPU',
    action: proposal({ mode: 'qa', taskKind: 'question-answer' }),
    expected: { kind: 'general', mutation: false, read: false, validation: false },
  },
  {
    name: 'detailed follow-up explanation',
    prompt: '再详细说明他们的差异',
    action: proposal({ mode: 'qa', taskKind: 'question-answer' }),
    expected: { kind: 'general', mutation: false, read: false, validation: false },
  },
  {
    name: 'repository review',
    prompt: 'Review the current diff for regressions and missing tests.',
    action: proposal({
      mode: 'inspect',
      taskKind: 'code-review',
      requiresWorkspace: true,
      targetPaths: ['src/router.ts'],
    }),
    expected: { kind: 'read-only', mutation: false, read: true, validation: false },
  },
  {
    name: 'documentation artifact',
    prompt: '整理一份 docs/qa-summary.md，总结结果，不改源码。',
    action: proposal({
      mode: 'edit',
      taskKind: 'file-artifact',
      mutation: 'create-file',
      requiresWorkspace: true,
      targetPaths: ['docs/qa-summary.md'],
    }),
    expected: { kind: 'file-artifact', mutation: true, read: false, validation: false },
  },
  {
    name: 'run validation',
    prompt: 'Run the existing focused test and report the result.',
    action: proposal({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      requiresWorkspace: true,
      requiresTerminal: true,
    }),
    expected: { kind: 'validation', mutation: false, read: false, validation: true },
  },
  {
    name: 'external side effect',
    prompt: 'Push the current branch after the checks pass.',
    action: proposal({
      mode: 'run',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: true,
    }),
    expected: { kind: 'validation', mutation: false, read: false, validation: true },
  },
  {
    name: 'destructive workspace action',
    prompt: 'Delete build/cache.json only.',
    action: proposal({
      mode: 'destructive',
      taskKind: 'destructive',
      mutation: 'delete',
      requiresWorkspace: true,
      targetPaths: ['build/cache.json'],
    }),
    expected: { kind: 'destructive', mutation: false, read: false, validation: false },
  },
];

for (const item of ACTION_MATRIX) {
  test(`typed action matrix projects ${item.name} without re-reading prompt words`, () => {
    const initial = decideChatIntent(item.prompt).semanticContract;
    const projected = projectModelActionSemanticContract(initial, item.action);

    assert.equal(projected.intent.taskKind, item.action.taskKind);
    assert.equal(projected.kind, item.expected.kind);
    assert.equal(projected.mutation.requested, item.expected.mutation);
    assert.equal(projected.read.requested, item.expected.read);
    assert.equal(projected.validation.requested, item.expected.validation);
    assert.equal(projected.intent.requiresConfirmation, (
      item.action.taskKind === 'external-effect' || item.action.taskKind === 'destructive'
    ));
  });
}

test('prompt tokens cannot override a contradictory typed model proposal', () => {
  const prompt = 'DELETE src/all.ts and RUN TEST and PUSH immediately';
  const initial = decideChatIntent(prompt).semanticContract;
  const projected = projectModelActionSemanticContract(
    initial,
    proposal({ mode: 'qa', taskKind: 'question-answer', reason: 'the user is asking about quoted text' }),
  );

  assert.equal(projected.intent.taskKind, 'question-answer');
  assert.equal(projected.mutation.requested, false);
  assert.equal(projected.validation.requested, false);
  assert.equal(projected.intent.context.externalEffect, 'none');
});

test('low-confidence model output is ignored instead of becoming a local fallback guess', () => {
  const initial = decideChatIntent('这句话可能是任务，也可能只是例子。').semanticContract;
  const projected = projectModelActionSemanticContract(initial, proposal({
    confidence: 0.61,
    mode: 'edit',
    taskKind: 'existing-project-edit',
    mutation: 'modify-source',
    targetPaths: ['src/guess.ts'],
    requiresWorkspace: true,
  }));

  assert.equal(projected, initial);
  assert.equal(projected.mutation.requested, false);
});

function proposal(overrides = {}) {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'test',
    mode: 'qa',
    taskKind: 'question-answer',
    confidence: 0.98,
    mutation: 'none',
    targetPaths: [],
    requiresWorkspace: false,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'normalized model action for paraphrase simulation',
    ...overrides,
  };
}

function semanticView(contract) {
  return {
    mode: contract.intent.mode,
    taskKind: contract.intent.taskKind,
    kind: contract.kind,
    scope: contract.scope,
    mutationRequested: contract.mutation.requested,
    sourceChange: contract.mutation.sourceChange,
    fileArtifact: contract.mutation.fileArtifact,
    mutationTargets: contract.mutation.targets,
    readRequested: contract.read.requested,
    readTargets: contract.read.targets,
    validationRequested: contract.validation.requested,
    runRequested: contract.validation.runRequested,
    externalEffect: contract.intent.context.externalEffect,
  };
}
