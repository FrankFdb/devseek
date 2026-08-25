import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-write-authority-${process.pid}.cjs`);

execSync(
  `npx esbuild src/agent/write-authority.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { createWriteAuthority } = createRequire(import.meta.url)(bundlePath);

test('raw user language is preserved but never predeclares effects', () => {
  for (const prompt of [
    '帮我见个 notes/ready.txt，里头只放 READY。',
    '只分析 src/cache.ts，不要修改也不要运行。',
    'MODEL_LATEST_OK',
    'src/main.cpp を直してテストしてください',
  ]) {
    const authority = createWriteAuthority(prompt, {});
    assert.equal(authority.currentPrompt, prompt);
    assert.equal(authority.canonicalSemanticContract.intent.mode, 'model-led');
    assert.equal(authority.canonicalSemanticContract.mutation.requested, false);
    assert.equal(authority.canonicalSemanticContract.read.requested, false);
    assert.equal(authority.canonicalSemanticContract.validation.requested, false);
  }
});

test('model proposal guides the loop but cannot become completion authority without a receipt', () => {
  const authority = createWriteAuthority('创建 notes/ready.txt。', {});
  const changed = authority.applyModelSemanticProposal(createProposal({
    taskKind: 'file-artifact',
    mutation: 'create-file',
    targetPaths: ['notes/ready.txt'],
    requiresWorkspace: true,
  }));

  assert.equal(changed, true);
  assert.deepEqual(authority.semanticContract.mutation.targets, ['notes/ready.txt']);
  assert.equal(authority.semanticContract.mutation.requested, true);
  assert.equal(authority.completionSemanticContract.mutation.requested, false);
  assert.equal(authority.canonicalSemanticContract.mutation.requested, false);
});

test('matching workspace receipt promotes the proposal into completion semantics', () => {
  const authority = createWriteAuthority('创建 notes/ready.txt。', {});
  authority.applyModelSemanticProposal(createProposal({
    taskKind: 'file-artifact',
    mutation: 'create-file',
    targetPaths: ['notes/ready.txt'],
    requiresWorkspace: true,
  }));

  const settled = authority.settleModelSemanticProposal([toolReceipt()]);
  assert.deepEqual(settled.semanticContract.mutation.targets, ['notes/ready.txt']);
  assert.deepEqual(settled.toolReceipts.map(receipt => receipt.actionId), ['semantic-action-3']);
  assert.equal(authority.completionSemanticContract.mutation.requested, true);
  assert.equal(authority.canonicalSemanticContract.mutation.requested, false);
});

test('read-only terminal observation settles from observe plus process evidence', () => {
  const authority = createWriteAuthority('看看目录状态。', {});
  authority.applyModelSemanticProposal(createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    requiresWorkspace: true,
  }));

  const settled = authority.settleModelSemanticProposal([toolReceipt({
    tool: 'run_terminal',
    purpose: 'observe',
    effects: ['process'],
    status: 'completed',
  })]);
  assert.ok(settled);
  assert.equal(settled.semanticContract.read.requested, true);
});

test('unrelated or effectful receipt cannot settle an observation proposal', () => {
  const authority = createWriteAuthority('读取 README。', {});
  authority.applyModelSemanticProposal(createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['README.md'],
    requiresWorkspace: true,
  }));

  assert.equal(authority.settleModelSemanticProposal([toolReceipt()]), undefined);
  assert.equal(authority.settleModelSemanticProposal([toolReceipt({
    tool: 'fetch_webpage',
    purpose: 'observe',
    effects: ['network'],
  })]), undefined);
  assert.equal(authority.completionSemanticContract.read.requested, false);
});

test('a failed observation cannot leak into the next settled contract', () => {
  const authority = createWriteAuthority('检查项目并修复问题。', {});
  authority.applyModelSemanticProposal(createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['build/missing.log'],
    requiresWorkspace: true,
    evidenceBindings: [observationBinding('a', ['build/missing.log'])],
  }));
  assert.equal(authority.settleModelSemanticProposal([toolReceipt({
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: 'a'.repeat(64),
    status: 'failed',
  })]), undefined);

  authority.applyModelSemanticProposal(createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['src/main.ts'],
    requiresWorkspace: true,
    evidenceBindings: [observationBinding('b', ['src/main.ts'])],
  }));
  const settled = authority.settleModelSemanticProposal([toolReceipt({
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: 'b'.repeat(64),
  })]);

  assert.deepEqual(settled.semanticContract.read.targets, ['src/main.ts']);
  assert.deepEqual(settled.observationPaths, ['src/main.ts']);
});

test('a partial observation batch settles only receipt-backed targets', () => {
  const authority = createWriteAuthority('检查两个路径。', {});
  authority.applyModelSemanticProposal(createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['src/', 'missing.txt'],
    requiresWorkspace: true,
    evidenceBindings: [
      observationBinding('a', ['src/']),
      observationBinding('b', ['missing.txt']),
    ],
  }));

  const settled = authority.settleModelSemanticProposal([toolReceipt({
    tool: 'list_dir',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: 'a'.repeat(64),
  })]);

  assert.deepEqual(settled.semanticContract.read.targets, ['src/']);
  assert.deepEqual(settled.observationPaths, ['src/']);
});

test('a mixed round promotes each successful semantic fragment from its own receipt', () => {
  const authority = createWriteAuthority('创建并读回 report.md。', {});
  const mutation = createProposal({
    taskKind: 'file-artifact',
    mutation: 'create-file',
    targetPaths: ['report.md'],
    requiresWorkspace: true,
  });
  const observation = createProposal({
    mode: 'inspect',
    taskKind: 'read-only-analysis',
    mutation: 'none',
    targetPaths: ['report.md'],
    requiresWorkspace: true,
    evidenceBindings: [observationBinding('b', ['report.md'])],
  });
  authority.applyModelSemanticProposal({
    ...mutation,
    evidenceBindings: [...observation.evidenceBindings, ...mutation.evidenceBindings],
    settlementFragments: [observation, mutation],
  });

  const settled = authority.settleModelSemanticProposal([
    toolReceipt({ inputSha256: 'a'.repeat(64) }),
    toolReceipt({
      actionId: 'semantic-action-4',
      sequence: 4,
      tool: 'read_file',
      purpose: 'observe',
      effects: ['read'],
      inputSha256: 'b'.repeat(64),
    }),
  ]);

  assert.equal(settled.semanticContract.mutation.requested, true);
  assert.deepEqual(settled.semanticContract.mutation.targets, ['report.md']);
  assert.equal(settled.semanticContract.read.requested, true);
  assert.deepEqual(settled.semanticContract.read.targets, ['report.md']);
  assert.deepEqual(settled.observationPaths, ['report.md']);
  assert.deepEqual(settled.toolReceipts.map(receipt => receipt.actionId), [
    'semantic-action-3',
    'semantic-action-4',
  ]);
});

test('pre-effect denial cannot poison later completed model semantics', () => {
  const authority = createWriteAuthority('安装依赖。', {});
  authority.applyModelSemanticProposal(createProposal({
    mode: 'run',
    taskKind: 'external-effect',
    mutation: 'external-effect',
    requiresTerminal: true,
    requiresExternalEffect: true,
  }));

  const settled = authority.settleModelSemanticProposal([toolReceipt({
    tool: 'run_terminal',
    purpose: 'external-effect',
    effects: ['process', 'network'],
    status: 'denied',
    permission: permission('deny', 'denied'),
    effectStarted: false,
  })]);
  assert.equal(settled, undefined);
  assert.equal(authority.semanticContract.intent.context.externalEffect, 'requested');
  assert.equal(authority.completionSemanticContract.intent.context.externalEffect, 'none');
  assert.equal(authority.canonicalSemanticContract.intent.context.externalEffect, 'none');
  assert.equal(authority.canonicalSemanticContract.mutation.requested, false);

  authority.applyModelSemanticProposal(createProposal({
    taskKind: 'existing-project-edit',
    mutation: 'modify-source',
    targetPaths: ['src/value.ts'],
    requiresWorkspace: true,
  }));
  const completed = authority.settleModelSemanticProposal([toolReceipt()]);
  assert.ok(completed);
  assert.equal(completed.semanticContract.intent.context.externalEffect, 'none');
  assert.deepEqual(completed.semanticContract.mutation.targets, ['src/value.ts']);
});

test('live steering is delivered verbatim and invalidates every stale proposal', () => {
  const steers = [
    '先别动 alpha.txt。',
    '更正：只创建 beta.txt，内容为 LATEST。',
  ];
  const authority = createWriteAuthority('创建 alpha.txt。', {
    onUserSteer: () => steers.splice(0),
  });
  authority.applyModelSemanticProposal(createProposal({
    taskKind: 'file-artifact',
    mutation: 'create-file',
    targetPaths: ['alpha.txt'],
    requiresWorkspace: true,
  }));

  const messages = authority.takePendingAndDrain();
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /先别动 alpha\.txt/u);
  assert.match(messages[1].content, /只创建 beta\.txt/u);
  assert.equal(authority.currentPrompt, steers.at(-1) ?? '更正：只创建 beta.txt，内容为 LATEST。');
  assert.equal(authority.semanticContract.mutation.requested, false);
  assert.equal(authority.completionSemanticContract.mutation.requested, false);
});

test('completion fence drains accepted correction and reopens through the lifecycle owner', () => {
  let reopened = 0;
  const authority = createWriteAuthority('创建 alpha.txt。', {
    onUserSteerCompletionFence: () => ['最后更正：改为 beta.txt。'],
    onReopenUserSteering: () => { reopened += 1; return true; },
  });

  const messages = authority.closeForCompletionAndDrain();
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /最后更正/u);
  assert.equal(authority.currentPrompt, '最后更正：改为 beta.txt。');
  assert.equal(authority.reopenAfterCompletionFence(), true);
  assert.equal(reopened, 1);
});

test('repository instructions survive model-led steering without becoming user text parsing', () => {
  const steers = ['继续，但使用项目既有验证命令。'];
  const authority = createWriteAuthority('检查项目。', {
    onUserSteer: () => steers.splice(0),
  }, {
    projectInstructions: {
      content: 'Always run npm test.',
      sources: [{ kind: 'agents', relPath: 'AGENTS.md' }],
    },
  });

  authority.takePendingAndDrain();
  assert.equal(authority.projectInstructionsText, 'Always run npm test.');
  assert.equal(authority.canonicalSemanticContract.context.projectInstructions.status, 'bound');
});

test('write authority preserves dynamic callback getters from the canonical Kernel', () => {
  let acceptance = [{ id: 'initial', statement: 'Initial contract' }];
  const callbacks = {
    get canonicalVerificationAcceptance() { return acceptance; },
  };
  const authority = createWriteAuthority('inspect the workspace', callbacks);

  assert.deepEqual(authority.callbacks.canonicalVerificationAcceptance, acceptance);
  acceptance = [{ id: 'verified', statement: 'Revised contract verification' }];
  assert.deepEqual(authority.callbacks.canonicalVerificationAcceptance, acceptance);
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(authority.callbacks, 'canonicalVerificationAcceptance')?.get,
    'function',
  );
});

function createProposal(overrides = {}) {
  const value = {
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
    reason: 'normalized model proposal',
    ...overrides,
  };
  return {
    ...value,
    evidenceBindings: overrides.evidenceBindings ?? [proposalBinding(value)],
  };
}

function proposalBinding(proposal) {
  if (proposal.mutation === 'create-file'
    || proposal.mutation === 'modify-source'
    || proposal.mutation === 'delete') {
    return {
      tool: 'create_file',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      inputSha256: 'a'.repeat(64),
      targetPaths: proposal.targetPaths,
    };
  }
  if (proposal.mutation === 'external-effect' || proposal.requiresExternalEffect) {
    return {
      tool: 'run_terminal',
      purpose: 'external-effect',
      effects: ['process', 'network'],
      inputSha256: 'a'.repeat(64),
      targetPaths: proposal.targetPaths,
    };
  }
  return {
    tool: 'run_terminal',
    purpose: 'observe',
    effects: ['process'],
    inputSha256: 'a'.repeat(64),
    targetPaths: proposal.targetPaths,
  };
}

function observationBinding(hashPrefix, targetPaths) {
  return {
    tool: targetPaths[0]?.endsWith('/') ? 'list_dir' : 'read_file',
    purpose: 'observe',
    effects: ['read'],
    inputSha256: hashPrefix.repeat(64),
    targetPaths,
  };
}

function toolReceipt(overrides = {}) {
  return {
    version: 'devseek.coding-tool-receipt/v1',
    runId: 'semantic-settlement-run',
    sequence: 3,
    actionId: 'semantic-action-3',
    tool: 'create_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    inputSha256: 'a'.repeat(64),
    permission: permission('allow', 'authorized'),
    status: 'completed',
    evidenceRefs: ['tool:semantic-action-3:completed'],
    ...overrides,
  };
}

function permission(decision, status) {
  return {
    decision,
    status,
    reason: `test-${status}`,
    evidenceRefs: [`authority:${status}`],
  };
}
