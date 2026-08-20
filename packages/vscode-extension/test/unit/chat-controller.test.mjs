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
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-chat-controller-'));
const bundlePath = path.join(bundleDir, 'chat-controller.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/chat-controller.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const { ChatRouteController, getIntentRoutingText } = createRequire(import.meta.url)(bundlePath);
const controller = new ChatRouteController();
after(() => rmSync(bundleDir, { recursive: true, force: true }));

const TURN_CASES = [
  'hello',
  '说明 GPU CPU',
  '再详细说明他们的差异',
  '请吧 src/login.ts 空密码问题秀一下',
  '只查看 src/router.ts，不要改代码。',
  '创建 docs/report.md 后运行检查。',
  'Delete build/cache.json and push the branch.',
  'MODEL_LATEST_OK',
  'このコードを説明してから、必要なら修正してください。',
];

for (const userText of TURN_CASES) {
  test(`enabled agent sends the complete ordinary turn to one model loop: ${userText}`, () => {
    const decision = controller.decide({
      userDisplay: userText,
      prompt: userText,
      files: [],
      agentEnabled: true,
    });

    assert.equal(decision.intentRoutingText, userText);
    assert.equal(decision.intent.semanticContract.prompt, userText);
    assert.equal(decision.intent.mode, 'model-led');
    assert.equal(decision.workflow.kind, 'model-agent');
    assert.equal(decision.workflow.state, 'acting');
    assert.equal(decision.workflow.useAgent, true);
    assert.equal(decision.workflow.reason, 'model-led-turn');
    assert.equal(decision.toolPolicy.mode, 'model-led');
    assert.equal(decision.intent.autoApplyEligible, false);
  });
}

test('visible user text wins over attachment transport content', () => {
  const decision = controller.decide({
    userDisplay: '📎 `main.cpp`\n\n说明这个函数为什么慢',
    prompt: '**附件：`main.cpp`**\nint main() { return 0; }\n\n---\n说明这个函数为什么慢',
    files: ['/workspace/main.cpp'],
    agentEnabled: true,
  });

  assert.equal(decision.intentRoutingText, '说明这个函数为什么慢');
  assert.equal(decision.intent.semanticContract.prompt, '说明这个函数为什么慢');
});

test('ordinary whitespace and multiline text remain byte-for-byte model input', () => {
  const userDisplay = '  line one\nline two with `code`  ';
  const decision = controller.decide({
    userDisplay,
    prompt: userDisplay,
    files: [],
    agentEnabled: true,
  });

  assert.equal(getIntentRoutingText(userDisplay, userDisplay), userDisplay);
  assert.equal(decision.intentRoutingText, userDisplay);
  assert.equal(decision.intent.semanticContract.prompt, userDisplay);
});

test('empty display falls back to the provider prompt without classifying attachments', () => {
  const prompt = 'actual provider prompt';
  const decision = controller.decide({
    userDisplay: '   ',
    prompt,
    files: ['/workspace/context.ts'],
    agentEnabled: true,
  });

  assert.equal(decision.intentRoutingText, prompt);
  assert.equal(decision.intent.semanticContract.prompt, prompt);
  assert.equal(decision.workflow.kind, 'model-agent');
});

test('empty input does not start an agent loop', () => {
  const decision = controller.decide({
    userDisplay: '',
    prompt: '',
    files: [],
    agentEnabled: true,
  });

  assert.equal(decision.workflow.kind, 'plain-chat');
  assert.equal(decision.workflow.useAgent, false);
  assert.equal(decision.workflow.reason, 'empty-prompt');
  assert.deepEqual(decision.toolPolicy.allowedToolKinds, []);
});

test('explicit product controls can bypass the agent without changing semantic meaning', () => {
  for (const control of [
    { agentEnabled: false, reason: 'agent-disabled' },
    { agentEnabled: true, forceNoAgent: true, reason: 'force-no-agent' },
  ]) {
    const decision = controller.decide({
      userDisplay: '修复 src/login.ts',
      prompt: '修复 src/login.ts',
      files: [],
      ...control,
    });

    assert.equal(decision.intent.mode, 'model-led');
    assert.equal(decision.intent.semanticContract.mutation.requested, false);
    assert.equal(decision.workflow.kind, 'plain-chat');
    assert.equal(decision.workflow.useAgent, false);
    assert.equal(decision.workflow.reason, control.reason);
  }
});

test('files and stale semanticIntent payloads cannot pre-route the current turn', () => {
  const decision = controller.decide({
    userDisplay: 'What does this phrase mean?',
    prompt: 'What does this phrase mean?',
    files: ['/workspace/src/mutable.ts'],
    agentEnabled: true,
    semanticIntent: {
      mode: 'destructive',
      taskKind: 'destructive',
      mutation: 'delete',
      targetPaths: ['/workspace/src/mutable.ts'],
    },
  });

  assert.equal(decision.intent.mode, 'model-led');
  assert.equal(decision.intent.kind, 'chat');
  assert.equal(decision.intent.semanticContract.kind, 'general');
  assert.equal(decision.intent.semanticContract.mutation.requested, false);
  assert.equal(decision.workflow.kind, 'model-agent');
});
