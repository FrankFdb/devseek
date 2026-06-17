/**
 * Unit tests for app/chat-controller.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/chat-controller.bundle.cjs');

execSync(
  `npx esbuild src/app/chat-controller.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ChatRouteController, getIntentRoutingText } = req(bundlePath);

test('ChatRouteController: routes by visible user text, not attached prompt content', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '📎 `main.cpp`\n\nhello',
    prompt: '**附件：`main.cpp`**\nint main() { return 0; }\n\n---\nhello',
    files: ['/tmp/main.cpp'],
    agentEnabled: true,
  });

  assert.equal(decision.intentRoutingText, 'hello');
  assert.equal(decision.intent.mode, 'smalltalk');
  assert.equal(decision.workflow.useAgent, false);
  assert.deepEqual(decision.toolPolicy.allowedToolKinds, []);
});

test('ChatRouteController: preserves edit workflow for real edit requests', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '创建 hello world 程序并运行',
    prompt: '创建 hello world 程序并运行',
    files: [],
    agentEnabled: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.workflow.kind, 'edit-agent');
});

test('ChatRouteController: destructive workflow waits for visible confirmation', () => {
  const controller = new ChatRouteController();
  const pending = controller.decide({
    userDisplay: '删除 code/main.cpp',
    prompt: '删除 code/main.cpp',
    files: ['/tmp/main.cpp'],
    agentEnabled: true,
  });
  const confirmed = controller.decide({
    userDisplay: '删除 code/main.cpp',
    prompt: '删除 code/main.cpp',
    files: ['/tmp/main.cpp'],
    agentEnabled: true,
    intentConfirmed: true,
  });

  assert.equal(pending.workflow.kind, 'confirmation-required');
  assert.equal(confirmed.workflow.kind, 'edit-agent');
});

test('getIntentRoutingText: strips only attachment badge lines', () => {
  assert.equal(getIntentRoutingText('📎 `a.ts`\n\nello', 'fallback'), 'ello');
  assert.equal(getIntentRoutingText('', 'fallback'), 'fallback');
});

console.log('\nChat controller tests passed.\n');
