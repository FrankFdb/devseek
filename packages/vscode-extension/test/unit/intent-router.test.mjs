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
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-intent-router-'));
const bundlePath = path.join(bundleDir, 'intent-router.cjs');

execFileSync('npx', [
  'esbuild',
  'src/intent-router.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const { decideChatIntent } = createRequire(import.meta.url)(bundlePath);
after(() => rmSync(bundleDir, { recursive: true, force: true }));

const ORDINARY_USER_TURNS = [
  ['Chinese direct question', '说明 GPU 和 CPU'],
  ['Chinese detailed follow-up', '再详细说明它们在并行计算和延迟上的差异'],
  ['Chinese typo and homophone', '请吧 src/logn.ts 空密码崩溃的问题秀一下'],
  ['English indirect defect', 'The login form falls over on an empty password. Please take care of it.'],
  ['Japanese edit request', 'src/main.cpp を直して、既存のテストで確認してください。'],
  ['mixed-language plan', '先 inspect src/cache.ts, then give me a plan only; 不要改文件。'],
  ['negated mutation', '分析当前 diff，不要修改、不要运行，也不要 push。'],
  ['substring collision', 'MODEL_LATEST_OK'],
  ['tool syntax discussion', 'Explain why {"tool":"run_terminal","input":{"command":"npm test"}} is unsafe here.'],
  ['multiline exact input', '  第一行保留空格\n第二行：只是讨论，不是授权。  '],
];

for (const [name, prompt] of ORDINARY_USER_TURNS) {
  test(`model-led front door preserves ${name} without assigning local intent`, () => {
    const decision = decideChatIntent(prompt);

    assert.equal(decision.semanticContract.prompt, prompt);
    assert.deepEqual(decision.semanticContract.taskContract.objectives, [prompt]);
    assert.equal(decision.kind, 'chat');
    assert.equal(decision.mode, 'model-led');
    assert.equal(decision.autoApplyEligible, false);
    assert.equal(decision.addStructuredHint, false);
    assert.equal(decision.requiresConfirmation, false);
    assert.equal(decision.reason, 'model-led-unclassified-turn');
    assert.deepEqual(decision.blockers, []);
    assert.equal(decision.semanticContract.mutation.requested, false);
    assert.equal(decision.semanticContract.read.requested, false);
    assert.equal(decision.semanticContract.validation.requested, false);
    assert.deepEqual(decision.semanticContract.mutation.targets, []);
    assert.deepEqual(decision.semanticContract.read.targets, []);
  });
}

test('empty input is the only locally blocked ordinary turn', () => {
  const prompt = ' \n\t ';
  const decision = decideChatIntent(prompt);

  assert.equal(decision.semanticContract.prompt, prompt);
  assert.deepEqual(decision.blockers, ['empty-prompt']);
  assert.deepEqual(decision.allowedToolKinds, []);
  assert.equal(decision.reason, 'empty-prompt');
});

test('model-led tools are capabilities, not inferred permission or completion evidence', () => {
  const decision = decideChatIntent('删除 build/cache.json，然后 push。');

  assert.ok(decision.allowedToolKinds.includes('edit'));
  assert.ok(decision.allowedToolKinds.includes('terminal'));
  assert.ok(decision.allowedToolKinds.includes('mcp'));
  assert.equal(decision.semanticContract.intent.requiresConfirmation, false);
  assert.equal(decision.semanticContract.kind, 'general');
  assert.deepEqual(
    decision.semanticContract.completion.doneIff.map(condition => condition.kind),
    ['response-delivered'],
  );
});

test('an inherited effectful snapshot cannot restore prior turn authority', () => {
  const inherited = decideChatIntent('old turn').semanticContract;
  inherited.mutation = {
    requested: true,
    prohibited: false,
    sourceChange: true,
    fileArtifact: false,
    targets: ['src/old-authority.ts'],
  };
  inherited.validation = {
    ...inherited.validation,
    requested: true,
    runRequested: true,
  };
  inherited.context.projectInstructions = {
    status: 'bound',
    content: 'Use the repository test command.',
    fingerprint: 'test-project-instructions',
    sources: [{ kind: 'agents', relPath: 'AGENTS.md' }],
    diagnostics: [],
  };

  const decision = decideChatIntent('现在只回答一个概念问题。', inherited);

  assert.equal(decision.semanticContract.mutation.requested, false);
  assert.equal(decision.semanticContract.validation.requested, false);
  assert.deepEqual(decision.semanticContract.mutation.targets, []);
  assert.equal(
    decision.semanticContract.context.projectInstructions.content,
    'Use the repository test command.',
  );
});
