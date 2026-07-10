import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-history-compaction.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-history-compaction.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  applyProviderRecoveryHistory,
  replaceAllAssistantToolHistory,
  replaceLatestAssistantToolHistory,
  summarizeExecutedAssistantToolHistory,
} = req(bundlePath);

test('Agent history compaction: executed create_file payload is summarized', () => {
  const largeContent = '# Design\\n' + 'very detailed paragraph\\n'.repeat(500);
  const text = [
    '我将创建设计文档。',
    `<create_file>{"path":"/repo/docs/design.md","content":${JSON.stringify(largeContent)}}</create_file>`,
  ].join('\n\n');

  const summary = summarizeExecutedAssistantToolHistory(text);

  assert.match(summary, /已执行工具请求摘要/);
  assert.match(summary, /create_file path=\/repo\/docs\/design\.md/);
  assert.match(summary, new RegExp(`contentChars=${largeContent.length}`));
  assert.match(summary, /通过 read_file 读取已落盘文件/);
  assert.doesNotMatch(summary, /very detailed paragraph\\nvery detailed paragraph/);
  assert.ok(summary.length < 900);
});

test('Agent history compaction: replaces the latest assistant tool message only', () => {
  const messages = [
    { role: 'user', content: '任务' },
    { role: 'assistant', content: '普通回复' },
    { role: 'user', content: '[工具结果 Round 1]\\n已读取文件' },
    { role: 'assistant', content: '<read_file>{"path":"/repo/a.cpp","startLine":1,"endLine":20}</read_file>' },
  ];

  const changed = replaceLatestAssistantToolHistory(messages);

  assert.equal(changed, true);
  assert.equal(messages[1].content, '普通回复');
  assert.match(messages[3].content, /read_file path=\/repo\/a\.cpp lines=1-20/);
});

test('Agent history compaction: replaces every assistant tool message before provider send', () => {
  const messages = [
    { role: 'user', content: '任务' },
    { role: 'assistant', content: '<read_file>{"path":"/repo/a.cpp","startLine":1,"endLine":20}</read_file>' },
    { role: 'user', content: '[工具结果 Round 1]\n已读取文件' },
    { role: 'assistant', content: '<create_file>{"path":"/repo/docs/design.md","content":"# Design\\nbody"} </create_file>' },
  ];

  const changed = replaceAllAssistantToolHistory(messages);

  assert.equal(changed, 2);
  assert.match(messages[1].content, /read_file path=\/repo\/a\.cpp lines=1-20/);
  assert.match(messages[3].content, /create_file path=\/repo\/docs\/design\.md/);
  assert.doesNotMatch(messages[3].content, /# Design/);
});

test('Agent history compaction: provider recovery rebuilds from task prompt and ledger only', () => {
  const messages = [
    { role: 'user', content: '完整任务提示和工具协议' },
    { role: 'assistant', content: '<read_file>{"path":"/repo/a.cpp"}</read_file>' },
    { role: 'user', content: '[工具结果 Round 1]\n' + 'large evidence\n'.repeat(500) },
    { role: 'assistant', content: '现在写入文件，但没有工具调用' },
  ];
  const recoveryMessage = {
    role: 'user',
    content: '【系统恢复】上一轮 Provider 回复未通过完整性门禁，DevSeek 已阻止执行损坏内容。\n已读取证据：/repo/a.cpp',
  };

  applyProviderRecoveryHistory(messages, recoveryMessage);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, '完整任务提示和工具协议');
  assert.equal(messages[1].content, recoveryMessage.content);
  assert.doesNotMatch(JSON.stringify(messages), /large evidence/);
  assert.doesNotMatch(JSON.stringify(messages), /<read_file>/);
});

test('Agent history compaction: internal summaries are not nested into the next tool intent', () => {
  const text = [
    '正在修复验证脚本。',
    '[DevSeek 已执行工具请求摘要] 意图：上一轮内部摘要不应继续嵌套',
    '[工具结果 Round 9] old output',
    '<replace_in_file>{"path":"/repo/verify.sh","old_str":"old","new_str":"new"}</replace_in_file>',
  ].join('\n');

  const summary = summarizeExecutedAssistantToolHistory(text);

  assert.match(summary, /意图：正在修复验证脚本/);
  assert.doesNotMatch(summary, /上一轮内部摘要/);
  assert.doesNotMatch(summary, /old output/);
});

console.log('\nAgent history compaction tests passed.\n');
