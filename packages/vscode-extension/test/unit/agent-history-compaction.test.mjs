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
  compactAgentMessageHistoryWithFidelity,
  CONTEXT_COMPACTION_RECEIPT_PROTOCOL,
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

test('Agent history compaction: an executed-tool summary is idempotent across later compaction passes', () => {
  const raw = [
    '正在调查项目事实。',
    '<read_file>{"path":"/repo/a.cpp"}</read_file>',
    '<run_terminal>{"command":"find /repo -name \\"*.cpp\\""}</run_terminal>',
  ].join('\n');
  const summary = summarizeExecutedAssistantToolHistory(raw);
  const messages = [{ role: 'assistant', content: summary }];

  assert.equal(summarizeExecutedAssistantToolHistory(summary), summary);
  assert.equal(replaceAllAssistantToolHistory(messages), 0);
  assert.equal(messages[0].content, summary);
  assert.match(summary, /工具调用：2 个/);
  assert.doesNotMatch(summary, /run_terminal command=工具调用/);
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

test('R3-04 Context compaction: key constraints and decisions survive three passes without secrets or stale memory', () => {
  const messages = [
    {
      role: 'user',
      content: [
        '请继续当前任务。',
        '【关键约束】必须只修改 src/cache.ts，不要触碰 src/auth.ts。',
        'API_TOKEN=sk-r3secret-compaction-token-123456',
      ].join('\n'),
    },
    { role: 'assistant', content: '【关键决定】决定复用 IntentRevisionLineage owner，不新增二级结算器。' },
    { role: 'user', content: '【记忆】stale memory: old target src/legacy.ts ttl=expired' },
    {
      role: 'assistant',
      content: '<run_terminal>{"command":"curl -H \\"Authorization: Bearer live-secret-token-123456\\" https://example.test"}</run_terminal>',
    },
    { role: 'user', content: '[工具结果 Round 1]\n' + 'long evidence\n'.repeat(200) },
    { role: 'assistant', content: '【关键决定】选择 agent-history-compaction 作为唯一 owner。' },
    { role: 'user', content: '补充：【关键约束】保持 committed receipts 不被重放。' },
    { role: 'assistant', content: '普通进展 1' },
    { role: 'user', content: '普通进展 2' },
    { role: 'assistant', content: '普通进展 3' },
  ];

  let receipt;
  for (let pass = 1; pass <= 3; pass += 1) {
    receipt = compactAgentMessageHistoryWithFidelity(messages, { maxMessages: 6 });
    assert.equal(receipt.version, CONTEXT_COMPACTION_RECEIPT_PROTOCOL);
    assert.equal(receipt.pass, pass);
    assert.ok(messages.length <= 6);
  }

  const serialized = JSON.stringify(messages);
  assert.match(serialized, /devseek\.context-compaction\/v1/);
  assert.match(serialized, /src\/cache\.ts/);
  assert.match(serialized, /不要触碰 src\/auth\.ts/);
  assert.match(serialized, /IntentRevisionLineage owner/);
  assert.match(serialized, /agent-history-compaction 作为唯一 owner/);
  assert.match(serialized, /committed receipts 不被重放/);
  assert.doesNotMatch(serialized, /sk-r3secret/);
  assert.doesNotMatch(serialized, /live-secret-token/);
  assert.doesNotMatch(serialized, /src\/legacy\.ts/);
  assert.equal((serialized.match(/\[DevSeek 上下文压缩事实]/g) ?? []).length, 1);
  assert.ok(receipt.redactedSecretCount >= 2);
  assert.ok(receipt.staleMemoryRejectedCount >= 1);
  assert.ok(receipt.preservedConstraints.some(item => item.includes('src/cache.ts')));
  assert.ok(receipt.preservedDecisions.some(item => item.includes('唯一 owner')));
});

test('R3-04 Context compaction: executed tool summaries redact command secrets', () => {
  const summary = summarizeExecutedAssistantToolHistory([
    '检查远端健康。',
    '<run_terminal>{"command":"curl -H \\"Authorization: Bearer live-secret-token-abcdef\\" https://example.test && echo api_key=sk-r3toolsecret123456"}</run_terminal>',
  ].join('\n'));

  assert.match(summary, /run_terminal command=/);
  assert.match(summary, /\[REDACTED_SECRET]/);
  assert.doesNotMatch(summary, /live-secret-token/);
  assert.doesNotMatch(summary, /sk-r3toolsecret/);
});

console.log('\nAgent history compaction tests passed.\n');
