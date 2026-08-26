import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-observed-contract-'));

execFileSync('npx', [
  'esbuild',
  'src/app/observed-task-contract-reconciler.ts',
  'src/app/coding-kernel-task-contract.ts',
  'src/agent/write-authority.ts',
  '--bundle',
  `--outdir=${bundleRoot}`,
  '--outbase=src',
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { reconcileObservedTaskContract } = require(path.join(
  bundleRoot,
  'app/observed-task-contract-reconciler.js',
));
const { projectVsCodeCodingKernelTaskContract } = require(path.join(
  bundleRoot,
  'app/coding-kernel-task-contract.js',
));
const { createWriteAuthority } = require(path.join(bundleRoot, 'agent/write-authority.js'));

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function toolReceipt(overrides = {}) {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'observed-contract-run',
    sequence: 5,
    actionId: 'observed-action-5',
    tool: 'create_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    inputSha256: 'b'.repeat(64),
    permission: {
      decision: 'allow',
      status: 'authorized',
      reason: 'user-authorized-target',
      evidenceRefs: ['authority:observed-action-5'],
    },
    status: 'completed',
    evidenceRefs: ['tool:observed-action-5:completed'],
    ...overrides,
  };
}

function changeReceipt(paths, overrides = {}) {
  return {
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'observed-contract-run',
    sequence: 5,
    actionId: 'observed-action-5',
    idempotencyKey: 'observed-contract-run:observed-action-5',
    status: 'committed',
    paths,
    baselineRef: 'baseline:observed-action-5',
    readbackRef: 'readback:observed-action-5',
    evidenceRefs: ['workspace-mutation:observed-action-5:committed'],
    ...overrides,
  };
}

function reconcile(prompt, proposal, receipts, changeReceipts = [], options = {}) {
  const authority = createWriteAuthority(prompt, {});
  const canonical = authority.canonicalSemanticContract;
  const contextFiles = options.contextFiles ?? [];
  const current = projectVsCodeCodingKernelTaskContract({
    userPrompt: canonical.prompt,
    executionMode: canonical.intent.mode,
    contextFiles,
    workspaceRoot: '/workspace',
    taskContract: canonical.taskContract,
    externalEffectIntent: canonical.intent.context.externalEffect,
    targetPaths: canonical.mutation.targets,
    prohibitedTargets: [],
  });
  const boundProposal = {
    ...proposal,
    evidenceBindings: proposal.evidenceBindings ?? receipts.map(receipt => ({
      tool: receipt.tool,
      purpose: receipt.purpose,
      effects: receipt.effects,
      inputSha256: receipt.inputSha256,
    })),
  };
  assert.equal(authority.applyModelSemanticProposal(boundProposal), true);
  const settled = authority.settleModelSemanticProposal(receipts);
  assert.ok(settled, 'the concrete receipt must settle the model interpretation');
  return {
    current,
    candidate: reconcileObservedTaskContract({
      current,
      semanticContract: settled.semanticContract,
      contextFiles,
      workspaceRoot: '/workspace',
      toolReceipts: settled.toolReceipts,
      changeReceipts,
    }),
  };
}

function mutationProposal(targetPaths, overrides = {}) {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'edit',
    taskKind: 'file-artifact',
    confidence: 0.98,
    mutation: 'create-file',
    targetPaths,
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'provider normalized colloquial or misspelled user input',
    ...overrides,
  };
}

test('a committed action refines typo-heavy create intent without rewriting user authority', () => {
  const prompt = '帮我见个 notes/ready.txt，里头就一行 READY，弄完再看眼写对没，别碰别的。';
  const receipt = toolReceipt();
  const { current, candidate } = reconcile(
    prompt,
    mutationProposal(['notes/ready.txt']),
    [receipt],
    [changeReceipt(['notes/ready.txt'])],
  );

  assert.notEqual(current.mode, 'change');
  assert.ok(candidate);
  assert.equal(candidate.taskContract.mode, 'change');
  assert.deepEqual(candidate.taskContract.scope.include, ['notes/ready.txt']);
  assert.equal(candidate.taskContract.constraints.includes('no-workspace-mutation'), false);
  assert.equal(candidate.taskContract.acceptance.some(item => item.id === 'requested-outcome'), true);
  assert.match(candidate.revisionId, /^settled-model-5-/);
  assert.equal(candidate.evidenceRefs.includes('workspace-mutation:observed-action-5:committed'), true);
});

test('model-proposed paths never enter the task contract without a matching committed mutation', () => {
  const { candidate } = reconcile(
    '建一个 notes/ready.txt，只写 READY。',
    mutationProposal(['notes/ready.txt', 'src/unrequested.ts']),
    [toolReceipt()],
    [changeReceipt(['notes/ready.txt'])],
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.taskContract.scope.include, ['notes/ready.txt']);
  assert.equal(candidate.taskContract.scope.include.includes('src/unrequested.ts'), false);
});

test('a committed path does not close a broader multi-file task to later model actions', () => {
  const { candidate } = reconcile(
    'Read USER_STORY.md and build the requested layered C++ application across include and src.',
    mutationProposal(['include/math_model.hpp'], { taskKind: 'existing-project-edit' }),
    [toolReceipt()],
    [changeReceipt(['include/math_model.hpp'])],
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.taskContract.scope.include, ['include/math_model.hpp']);
  assert.equal(candidate.taskContract.constraints.includes('no-other-files'), false);
});

test('read-only context scope never becomes a report deliverable after a committed write', () => {
  const contextFiles = [
    '/workspace/docs/input-matrix.md',
    '/workspace/src/input-contract.ts',
  ];
  const report = '/workspace/docs/audit-report.md';
  const { candidate } = reconcile(
    '读取两份输入并创建唯一审计报告。',
    mutationProposal([report]),
    [toolReceipt()],
    [changeReceipt([report])],
    { contextFiles },
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.taskContract.scope.include, ['docs/audit-report.md']);
  assert.deepEqual(
    candidate.taskContract.deliverables
      .filter(deliverable => deliverable.kind === 'report')
      .map(deliverable => deliverable.path),
    ['docs/audit-report.md'],
  );
});

test('symptom-style repair gains verification acceptance from settled edit evidence', () => {
  const receipt = toolReceipt({
    tool: 'replace_in_file',
    sequence: 8,
    actionId: 'observed-action-8',
    evidenceRefs: ['tool:observed-action-8:completed'],
  });
  const mutation = changeReceipt(['src/parser.ts'], {
    sequence: 8,
    actionId: 'observed-action-8',
    idempotencyKey: 'observed-contract-run:observed-action-8',
    evidenceRefs: ['workspace-mutation:observed-action-8:committed'],
  });
  const { candidate } = reconcile(
    '输入空白时它会直接崩，帮我弄好 src/parser.ts，跑一下现有测试确认。',
    mutationProposal(['src/parser.ts'], {
      taskKind: 'existing-project-edit',
      mutation: 'modify-source',
      requiresTerminal: true,
    }),
    [receipt],
    [mutation],
  );

  assert.ok(candidate);
  assert.equal(candidate.taskContract.mode, 'change');
  assert.deepEqual(candidate.taskContract.scope.include, ['src/parser.ts']);
  assert.equal(candidate.taskContract.acceptance.some(item => item.id === 'verified'), true);
  assert.equal(candidate.taskContract.constraints.includes('verification-before-completion'), true);
});

test('post-change observations cannot downgrade accumulated source work to review', () => {
  const prompt = 'Read USER_STORY.md and build the requested layered C++ application across include and src.';
  const authority = createWriteAuthority(prompt, {});
  const initial = projectVsCodeCodingKernelTaskContract({
    userPrompt: prompt,
    executionMode: authority.canonicalSemanticContract.intent.mode,
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: authority.canonicalSemanticContract.taskContract,
    externalEffectIntent: authority.canonicalSemanticContract.intent.context.externalEffect,
    targetPaths: [],
    prohibitedTargets: [],
  });
  const write = toolReceipt({
    actionId: 'write-math-model',
    inputSha256: 'c'.repeat(64),
  });
  assert.equal(authority.applyModelSemanticProposal(mutationProposal(['include/math_model.hpp'], {
    taskKind: 'existing-project-edit',
    evidenceBindings: [{
      tool: write.tool,
      purpose: write.purpose,
      effects: write.effects,
      inputSha256: write.inputSha256,
      targetPaths: ['include/math_model.hpp'],
    }],
  })), true);
  const settledWrite = authority.settleModelSemanticProposal([write]);
  assert.ok(settledWrite);
  const first = reconcileObservedTaskContract({
    current: initial,
    semanticContract: settledWrite.semanticContract,
    contextFiles: [],
    workspaceRoot: '/workspace',
    toolReceipts: settledWrite.toolReceipts,
    changeReceipts: [changeReceipt(['include/math_model.hpp'], {
      actionId: 'write-math-model',
    })],
  });
  assert.ok(first);
  assert.equal(first.taskContract.mode, 'change');

  const read = toolReceipt({
    sequence: 6,
    actionId: 'read-math-model',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: 'd'.repeat(64),
    evidenceRefs: ['tool:read-math-model:completed'],
  });
  assert.equal(authority.applyModelSemanticProposal({
    version: 'devseek.semantic-intent/v1',
    source: 'provider',
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    confidence: 0.98,
    mutation: 'none',
    targetPaths: ['include/math_model.hpp'],
    requiresWorkspace: true,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'provider reviews the committed source change',
    evidenceBindings: [{
      tool: read.tool,
      purpose: read.purpose,
      effects: read.effects,
      inputSha256: read.inputSha256,
      targetPaths: ['include/math_model.hpp'],
    }],
  }), true);
  const settledRead = authority.settleModelSemanticProposal([read]);
  assert.ok(settledRead);
  const second = reconcileObservedTaskContract({
    current: first.taskContract,
    semanticContract: settledRead.semanticContract,
    contextFiles: [],
    workspaceRoot: '/workspace',
    toolReceipts: settledRead.toolReceipts,
    changeReceipts: [],
  });
  const finalContract = second?.taskContract ?? first.taskContract;

  assert.equal(finalContract.mode, 'change');
  assert.equal(finalContract.deliverables.some(item => item.kind === 'source-change'), true);
  assert.equal(finalContract.constraints.includes('no-workspace-mutation'), false);
});

test('a settled memory effect replaces stale source and verification obligations', () => {
  const prompt = '记一下这个项目的习惯：处理 src/bridge.ts 后，用 npm run test:bridge 做聚焦验证；现在只记录，不改文件也不运行。';
  const memoryReceipt = toolReceipt({
    tool: 'memory_write',
    purpose: 'external-effect',
    effects: ['local-state'],
    actionId: 'memory-action-5',
    evidenceRefs: ['memory-write-record:memory-action-5'],
  });
  const { current, candidate } = reconcile(
    prompt,
    mutationProposal([], {
      mode: 'edit',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      requiresWorkspace: false,
      requiresTerminal: false,
      requiresExternalEffect: true,
    }),
    [memoryReceipt],
  );

  assert.equal(current.mode, 'explain');
  assert.ok(candidate);
  assert.equal(candidate.taskContract.mode, 'change');
  assert.equal(candidate.taskContract.deliverables.some(item => item.kind === 'source-change'), false);
  assert.equal(candidate.taskContract.deliverables.some(item => item.kind === 'verification-result'), false);
  assert.equal(candidate.taskContract.constraints.includes('verification-before-completion'), false);
  assert.equal(candidate.taskContract.constraints.includes('no-workspace-mutation'), true);
  assert.deepEqual(candidate.taskContract.acceptance.map(item => item.id), ['grounded-response', 'authority']);
});

test('a pre-effect denial cannot revise the canonical task contract', () => {
  const denied = toolReceipt({
    tool: 'run_terminal',
    purpose: 'external-effect',
    effects: ['process', 'network'],
    permission: {
      decision: 'deny',
      status: 'denied',
      reason: 'external-effect-requires-approval',
      evidenceRefs: ['authority:observed-action-5:denied'],
    },
    status: 'denied',
    effectStarted: false,
    evidenceRefs: ['tool:observed-action-5:denied'],
  });
  const prompt = '请安装缺少的依赖，然后告诉我是否成功。';
  const authority = createWriteAuthority(prompt, {});
  const current = projectVsCodeCodingKernelTaskContract({
    userPrompt: prompt,
    executionMode: authority.canonicalSemanticContract.intent.mode,
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: authority.canonicalSemanticContract.taskContract,
    externalEffectIntent: authority.canonicalSemanticContract.intent.context.externalEffect,
    targetPaths: [],
    prohibitedTargets: [],
  });
  const candidate = reconcileObservedTaskContract({
    current,
    semanticContract: authority.semanticContract,
    contextFiles: [],
    workspaceRoot: '/workspace',
    toolReceipts: [denied],
    changeReceipts: [],
  });

  assert.equal(candidate, undefined);
});
