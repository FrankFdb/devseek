/**
 * Unit tests for DeepSeek Web bridge prompt session reuse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/bridge-prompt-session.bundle.cjs');

execSync(
  `npx esbuild src/llm/providers/bridge-prompt-session.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  flattenMessagesForBridge,
  prepareBridgePromptForSession,
  recordBridgePromptSessionResponse,
  resetBridgePromptSessionCacheForTests,
} = req(bundlePath);

test('BridgePromptSession: first turn sends full prompt, follow-up sends only incremental tool feedback', () => {
  resetBridgePromptSessionCacheForTests();
  const stableRules = [
    '你是 DevSeek 编程智能体。',
    '【工程原则】'.repeat(400),
    '【工具协议】'.repeat(400),
    '当前任务：分析并修改正式项目。',
  ].join('\n');
  const run = { traceRunId: 'run-1', traceWorkspaceRoot: '/repo' };
  const firstMessages = [{ role: 'user', content: stableRules }];

  const first = prepareBridgePromptForSession({
    ...run,
    newSession: true,
    messages: firstMessages,
  });
  assert.equal(first.mode, 'full');
  assert.match(first.prompt, /工程原则/);

  const assistantResponse = '[TOOL:read_file {"path":"src/main.cpp"}]';
  recordBridgePromptSessionResponse({
    ...run,
    newSession: true,
    messages: firstMessages,
  }, assistantResponse);

  const toolFeedback = '[工具结果 Round 1]\nread_file src/main.cpp\nclass App {};';
  const second = prepareBridgePromptForSession({
    ...run,
    newSession: false,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: assistantResponse },
      { role: 'user', content: toolFeedback },
    ],
  });

  assert.equal(second.mode, 'incremental');
  assert.match(second.prompt, /沿用本会话上一轮/);
  assert.match(second.prompt, /read_file src\/main\.cpp/);
  assert.doesNotMatch(second.prompt, /工程原则/);
  assert.ok(second.promptChars < second.fullChars / 2);
  assert.ok(second.promptBytes < second.fullBytes / 2);
});

test('BridgePromptSession: UTF-8 byte savings enable useful CJK incremental turns', () => {
  resetBridgePromptSessionCacheForTests();
  const run = { traceRunId: 'run-cjk-budget', traceWorkspaceRoot: '/repo' };
  const firstMessages = [{ role: 'user', content: `工程约束：${'必须保留当前行为。'.repeat(90)}` }];
  const first = prepareBridgePromptForSession({ ...run, newSession: true, messages: firstMessages });
  const assistantResponse = '[TOOL:read_file {"path":"main.cpp"}]';
  recordBridgePromptSessionResponse({ ...run, newSession: true, messages: firstMessages }, assistantResponse);

  const second = prepareBridgePromptForSession({
    ...run,
    newSession: false,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: assistantResponse },
      { role: 'user', content: '[工具结果 Round 1]\n读取成功，请继续。' },
    ],
  });

  assert.ok(first.fullChars - second.promptChars < 1024, 'fixture must stay below the old character threshold');
  assert.ok(first.fullBytes - second.promptBytes >= 1024, 'fixture must exceed the UTF-8 transport threshold');
  assert.equal(second.mode, 'incremental');
});

test('BridgePromptSession: missing trace key keeps ordinary chat self-contained', () => {
  resetBridgePromptSessionCacheForTests();
  const messages = [{ role: 'user', content: '短问题' }];
  const prepared = prepareBridgePromptForSession({ messages, newSession: false });
  assert.equal(prepared.mode, 'full');
  assert.equal(prepared.prompt, flattenMessagesForBridge(messages));
});
