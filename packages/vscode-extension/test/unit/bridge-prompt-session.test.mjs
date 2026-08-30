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
  recordBridgePromptSessionRequest,
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

  recordBridgePromptSessionRequest({
    ...run,
    newSession: true,
    messages: firstMessages,
  });

  const compactedAssistant = '[DevSeek 已执行工具请求摘要]读取 src/main.cpp；真实结果见下一条工具反馈。';
  const toolFeedback = '[工具结果 Round 1]\nread_file src/main.cpp\nclass App {};';
  const second = prepareBridgePromptForSession({
    ...run,
    newSession: false,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: compactedAssistant },
      { role: 'user', content: toolFeedback },
    ],
  });

  assert.equal(second.mode, 'incremental');
  assert.match(second.prompt, /沿用本会话上一轮/);
  assert.match(second.prompt, /read_file src\/main\.cpp/);
  assert.doesNotMatch(second.prompt, /工程原则/);
  assert.doesNotMatch(second.prompt, /已执行工具请求摘要/);
  assert.ok(second.promptChars < second.fullChars / 2);
  assert.ok(second.promptBytes < second.fullBytes / 2);

  recordBridgePromptSessionRequest({
    ...run,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: compactedAssistant },
      { role: 'user', content: toolFeedback },
    ],
  });
  const third = prepareBridgePromptForSession({
    ...run,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: compactedAssistant },
      { role: 'user', content: toolFeedback },
      { role: 'assistant', content: '[DevSeek 已执行工具请求摘要]已写入 main.cpp。' },
      { role: 'user', content: '[工具结果 Round 2]\nwrite_file src/main.cpp 成功。' },
    ],
  });
  assert.equal(third.mode, 'incremental');
  assert.match(third.prompt, /Round 2/);
  assert.doesNotMatch(third.prompt, /Round 1|工程原则|已写入 main\.cpp/);
});

test('BridgePromptSession: small CJK follow-ups stay incremental once the logical cursor aligns', () => {
  resetBridgePromptSessionCacheForTests();
  const run = { traceRunId: 'run-cjk-budget', traceWorkspaceRoot: '/repo' };
  const firstMessages = [{ role: 'user', content: `工程约束：${'必须保留当前行为。'.repeat(90)}` }];
  const first = prepareBridgePromptForSession({ ...run, newSession: true, messages: firstMessages });
  recordBridgePromptSessionRequest({ ...run, newSession: true, messages: firstMessages });

  const second = prepareBridgePromptForSession({
    ...run,
    newSession: false,
    messages: [
      ...firstMessages,
      { role: 'assistant', content: '[DevSeek 已执行工具请求摘要]读取 main.cpp。' },
      { role: 'user', content: '[工具结果 Round 1]\n读取成功，请继续。' },
    ],
  });

  assert.equal(second.mode, 'incremental');
  assert.equal(second.resetBrowserSession, false);
  assert.ok(first.fullBytes > second.promptBytes);
});

test('BridgePromptSession: missing cursor or rewritten request prefix resets the browser conversation', () => {
  resetBridgePromptSessionCacheForTests();
  const run = { traceRunId: 'run-reset', traceWorkspaceRoot: '/repo' };
  const messages = [{ role: 'user', content: '实现 src/main.cpp 并验证。' }];

  const cacheMiss = prepareBridgePromptForSession({ ...run, messages });
  assert.equal(cacheMiss.mode, 'reset-full');
  assert.equal(cacheMiss.resetBrowserSession, true);
  assert.equal(cacheMiss.prompt, flattenMessagesForBridge(messages));

  const first = prepareBridgePromptForSession({ ...run, newSession: true, messages });
  assert.equal(first.mode, 'full');
  recordBridgePromptSessionRequest({ ...run, messages });

  const rewritten = prepareBridgePromptForSession({
    ...run,
    messages: [
      { role: 'user', content: '压缩后重建：实现 src/main.cpp 并验证。' },
      { role: 'assistant', content: '摘要' },
      { role: 'user', content: '继续' },
    ],
  });
  assert.equal(rewritten.mode, 'reset-full');
  assert.equal(rewritten.resetBrowserSession, true);
  assert.match(rewritten.prompt, /压缩后重建/);
});

test('BridgePromptSession: a compacted agent turn rebuilds from host facts without replaying tool transcripts', () => {
  resetBridgePromptSessionCacheForTests();
  const run = { traceRunId: 'run-compacted-reset', traceWorkspaceRoot: '/repo' };
  const initial = { role: 'user', content: '实现 src/main.cpp，并满足 nonDominantRatio >= 0.02。' };
  const firstMessages = [initial];
  prepareBridgePromptForSession({ ...run, newSession: true, messages: firstMessages });
  recordBridgePromptSessionRequest({ ...run, newSession: true, messages: firstMessages });
  const preCompactionMessages = [
    initial,
    { role: 'assistant', content: '[DevSeek 已执行工具请求摘要]\n- read_file path=src/main.cpp' },
    { role: 'user', content: '[工具结果 Round 18]\n已读取 main.cpp。' },
  ];
  prepareBridgePromptForSession({ ...run, messages: preCompactionMessages });
  recordBridgePromptSessionRequest({ ...run, messages: preCompactionMessages });

  const rebuilt = prepareBridgePromptForSession({
    ...run,
    messages: [
      initial,
      { role: 'user', content: '[DevSeek Canonical Context Compaction]\npendingUnits: verify pixels' },
      { role: 'assistant', content: '[DevSeek 已执行工具请求摘要]\n- read_file path=src/main.cpp' },
      { role: 'assistant', content: '[DevSeek 未来新增宿主摘要]\n不得回放。' },
      { role: 'user', content: '[工具结果 Round 19]\nstate.json missing fraction' },
    ],
  });

  assert.equal(rebuilt.mode, 'reset-full');
  assert.equal(rebuilt.resetBrowserSession, true);
  assert.match(rebuilt.prompt, /网页 Provider 会话重建/);
  assert.match(rebuilt.prompt, /宿主状态检查点/);
  assert.match(rebuilt.prompt, /宿主已验证事实批次 19/);
  assert.match(rebuilt.prompt, /nonDominantRatio >= 0\.02/);
  assert.doesNotMatch(rebuilt.prompt, /DevSeek 已执行工具请求摘要|DevSeek 未来新增宿主摘要|\[工具结果 Round/);
  assert.doesNotMatch(rebuilt.prompt, /read_file path=src\/main\.cpp/);
});

test('BridgePromptSession: an explicit agent-session replacement projects facts but preserves reviewer roles', () => {
  resetBridgePromptSessionCacheForTests();
  const run = { traceRunId: 'run-explicit-reset', traceWorkspaceRoot: '/repo' };
  const initial = { role: 'user', content: '修复现有项目。' };
  prepareBridgePromptForSession({ ...run, newSession: true, messages: [initial] });
  recordBridgePromptSessionRequest({ ...run, newSession: true, messages: [initial] });

  const recovery = prepareBridgePromptForSession({
    ...run,
    newSession: true,
    messages: [initial, { role: 'user', content: '[工具结果 Round 7]\n最新验证失败。' }],
  });
  assert.equal(recovery.mode, 'reset-full');
  assert.match(recovery.prompt, /宿主已验证事实批次 7/);

  recordBridgePromptSessionRequest({ ...run, messages: [initial] });
  const reviewerMessages = [
    { role: 'system', content: 'You are an independent reviewer.' },
    { role: 'user', content: 'Review this source snapshot.' },
  ];
  const reviewer = prepareBridgePromptForSession({
    ...run,
    newSession: true,
    messages: reviewerMessages,
  });
  assert.equal(reviewer.mode, 'full');
  assert.equal(reviewer.prompt, flattenMessagesForBridge(reviewerMessages));
});

test('BridgePromptSession: missing trace key keeps ordinary chat self-contained', () => {
  resetBridgePromptSessionCacheForTests();
  const messages = [{ role: 'user', content: '短问题' }];
  const prepared = prepareBridgePromptForSession({ messages, newSession: false });
  assert.equal(prepared.mode, 'full');
  assert.equal(prepared.resetBrowserSession, false);
  assert.equal(prepared.prompt, flattenMessagesForBridge(messages));
});
