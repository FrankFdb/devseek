/**
 * Unit tests for the Codex-style model-led workflow boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workflow-service.bundle.cjs');
const intentBundlePath = path.join(rootDir, 'test/unit/workflow-service.intent-router.bundle.cjs');

execSync(
  `npx esbuild src/app/workflow-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/intent-router.ts --bundle ` +
  `--outfile=${intentBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideChatIntent } = req(intentBundlePath);
const { selectWorkflow, WorkflowStateMachine } = req(bundlePath);

function assertModelLed(prompt, files = []) {
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files, agentEnabled: true, prompt });

  assert.equal(selected.kind, 'model-agent');
  assert.equal(selected.state, 'acting');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.reason, 'model-led-turn');
  assert.equal(selected.toolPolicyMode, 'model-led');
  assert.equal(selected.requiresPlanReview, false);
  return { intent, selected };
}

test('WorkflowService: every ordinary natural-language family enters one model-led turn', () => {
  const cases = [
    ['smalltalk', 'hello', []],
    ['question', '解释一下这个错误是什么意思', []],
    ['inspect', '分析这段代码', ['/tmp/main.ts']],
    ['plan', '给出这个项目的重构方案，但不要改代码', ['/tmp/main.ts']],
    ['edit', '修复这个 bug', []],
    ['run-repair', 'Run npm test, and if it fails fix the issue.', []],
    ['destructive', '删除 code/main.cpp', ['/tmp/main.cpp']],
  ];

  for (const [name, prompt, files] of cases) {
    const { intent } = assertModelLed(prompt, files);
    assert.equal(intent.mode, 'model-led', `${name} must remain model-owned`);
    assert.deepEqual(intent.signals, ['model-led-unclassified-turn']);
    assert.equal(intent.semanticContract.intent.taskKind, 'ambiguous');
  }
});

test('WorkflowService: noisy and multilingual requests are not rejected by local routing', () => {
  const prompts = [
    '请吧登路页奔溃修好，测是也跑一下',
    'can u chek auth then fix watever is breaking login',
    '先看看 src/auth.ts，没问题的话直接修复并验证',
    'src/cache.ts no funciona, arreglalo y run tests',
    '这个先别改，我只是想知道为啥会报错',
  ];

  for (const prompt of prompts) assertModelLed(prompt);
});

test('WorkflowService: missing optional intent arrays degrade into the same model-led path', () => {
  const prompt = '分析 packages/vscode-extension/src/app/workflow-service.ts';
  const intent = {
    ...decideChatIntent(prompt),
    signals: undefined,
    blockers: undefined,
    allowedToolKinds: undefined,
  };
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(selected.kind, 'model-agent');
  assert.equal(selected.toolPolicyMode, 'model-led');
});

test('WorkflowService: forceNoAgent is an explicit product-level bypass', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, forceNoAgent: true });

  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'force-no-agent');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: disabled agent is an explicit product-level bypass', () => {
  const prompt = '创建 assets/manual-phase6.unknown，内容为 phase6。';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, prompt });

  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'agent-disabled');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: empty prompts do not start a model turn', () => {
  const intent = decideChatIntent('   ');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt: '   ' });

  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'empty-prompt');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: model-led lifecycle transitions preserve the authority strategy', () => {
  const intent = decideChatIntent('修复 src/cache.ts');
  const machine = new WorkflowStateMachine();
  const selected = machine.select({ intent, files: [], agentEnabled: true });
  const completed = machine.transition(selected, 'complete');

  assert.equal(completed.kind, 'model-agent');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.useAgent, false);
  assert.equal(completed.toolPolicyMode, 'model-led');
});

console.log('\nWorkflow service tests passed.\n');
