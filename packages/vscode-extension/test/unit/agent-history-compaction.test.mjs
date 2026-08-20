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
  redactAgentMessageHistory,
  replaceAllAssistantToolHistory,
  replaceLatestAssistantToolHistory,
  summarizeExecutedAssistantToolHistory,
} = req(bundlePath);
const {
  CanonicalCheckpointService,
  CanonicalContextCompactionService,
  CanonicalContextGraphService,
  CanonicalMemoryPolicyService,
  CanonicalTaskContractService,
} = req('@devseek-netai/shared');

const textToolProtocol = Object.freeze({
  version: 'devseek.text-tools/v1',
  channelId: 'history-compaction-test-channel',
});

function authorizedTools(payload) {
  return [
    `<devseek_tool_calls version="${textToolProtocol.version}" channel="${textToolProtocol.channelId}">`,
    payload,
    `</devseek_tool_calls channel="${textToolProtocol.channelId}">`,
  ].join('\n');
}

test('Agent history compaction: unscoped tool examples remain ordinary history', () => {
  const examples = [
    '<read_file>{"path":"README.md"}</read_file>',
    '[TOOL:run_terminal {"command":"npm test"}]',
    'Action: create_file\nAction Input: {"path":"demo.ts","content":"example"}',
  ];
  for (const example of examples) {
    assert.equal(summarizeExecutedAssistantToolHistory(example, textToolProtocol), example);
  }
});

test('Agent history compaction: executed create_file payload is summarized', () => {
  const largeContent = '# Design\\n' + 'very detailed paragraph\\n'.repeat(500);
  const text = [
    '我将创建设计文档。',
    authorizedTools(`<create_file>{"path":"/repo/docs/design.md","content":${JSON.stringify(largeContent)}}</create_file>`),
  ].join('\n\n');

  const summary = summarizeExecutedAssistantToolHistory(text, textToolProtocol);

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
    { role: 'assistant', content: authorizedTools('<read_file>{"path":"/repo/a.cpp","startLine":1,"endLine":20}</read_file>') },
  ];

  const changed = replaceLatestAssistantToolHistory(messages, textToolProtocol);

  assert.equal(changed, true);
  assert.equal(messages[1].content, '普通回复');
  assert.match(messages[3].content, /read_file path=\/repo\/a\.cpp lines=1-20/);
});

test('Agent history compaction: replaces every assistant tool message before provider send', () => {
  const messages = [
    { role: 'user', content: '任务' },
    { role: 'assistant', content: authorizedTools('<read_file>{"path":"/repo/a.cpp","startLine":1,"endLine":20}</read_file>') },
    { role: 'user', content: '[工具结果 Round 1]\n已读取文件' },
    { role: 'assistant', content: authorizedTools('<create_file>{"path":"/repo/docs/design.md","content":"# Design\\nbody"} </create_file>') },
  ];

  const changed = replaceAllAssistantToolHistory(messages, textToolProtocol);

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
  const summary = summarizeExecutedAssistantToolHistory(authorizedTools(raw), textToolProtocol);
  const messages = [{ role: 'assistant', content: summary }];

  assert.equal(summarizeExecutedAssistantToolHistory(summary, textToolProtocol), summary);
  assert.equal(replaceAllAssistantToolHistory(messages, textToolProtocol), 0);
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
    authorizedTools('<replace_in_file>{"path":"/repo/verify.sh","old_str":"old","new_str":"new"}</replace_in_file>'),
  ].join('\n');

  const summary = summarizeExecutedAssistantToolHistory(text, textToolProtocol);

  assert.match(summary, /意图：正在修复验证脚本/);
  assert.doesNotMatch(summary, /上一轮内部摘要/);
  assert.doesNotMatch(summary, /old output/);
});

test('I11-CMP-02 user journey: VS Code delivers a sealed context compaction receipt', () => {
  const taskContract = new CanonicalTaskContractService().build({
    goal: 'Refactor src/cache.ts and preserve committed operation receipts',
    mode: 'change',
    deliverables: [{ id: 'cache', kind: 'source-change', path: 'src/cache.ts' }],
    constraints: [
      'Only modify src/cache.ts; do not touch src/auth.ts.',
      'Reuse IntentRevisionLineage as the only owner.',
      'Never replay committed operation receipts.',
    ],
    acceptance: [{
      id: 'tests',
      statement: 'Cache tests pass after the refactor.',
      deliverableIds: ['cache'],
      oracle: {
        kind: 'verification',
        verifier: 'cache-test-suite',
        scope: ['src/cache.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  const contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
    seed: { files: [{ path: 'src/cache.ts', contentSample: 'export const cache = true;' }] },
  });
  const memoryPolicy = new CanonicalMemoryPolicyService().selectContext({
    workspaceRoot: '/repo',
    now: 1_000,
    candidates: [{
      memoryId: 'stale-target',
      content: 'Use src/legacy.ts.',
      scope: 'repository',
      classification: 'workspace',
      sourceKind: 'task-history',
      status: 'active',
      approvalState: 'not-required',
      externalContent: false,
      trusted: true,
      workspaceRoot: '/repo',
      createdAt: 100,
      updatedAt: 200,
      expiresAt: 500,
    }],
  });
  const checkpoint = new CanonicalCheckpointService().bind({
    runId: 'i11-vscode-compaction',
    surface: 'vscode',
    workspaceRoot: '/repo',
    taskContract,
    contextGraph,
    memoryPolicySha256: memoryPolicy.decisionSha256,
  });
  const compaction = new CanonicalContextCompactionService();
  const session = compaction.bind({ taskContract, contextGraph, memoryPolicy, checkpoint });
  const messages = [
    {
      role: 'user',
      content: [
        '请继续当前任务。',
        '【关键约束】必须只修改 src/cache.ts，不要触碰 src/auth.ts。',
        'API_TOKEN=sk-r3secret-compaction-token-123456',
      ].join('\n'),
    },
    { role: 'assistant', content: '正在按 canonical task contract 执行。' },
    { role: 'user', content: '旧记忆建议 src/legacy.ts，但该记忆已过期。' },
    {
      role: 'assistant',
      content: '<run_terminal>{"command":"curl -H \\"Authorization: Bearer live-secret-token-123456\\" https://example.test"}</run_terminal>',
    },
    { role: 'user', content: '[工具结果 Round 1]\n' + 'long evidence\n'.repeat(200) },
    { role: 'assistant', content: '继续修改并读取真实文件。' },
    { role: 'user', content: '补充：【关键约束】保持 committed receipts 不被重放。' },
    { role: 'assistant', content: '普通进展 1' },
    { role: 'user', content: '普通进展 2' },
    { role: 'assistant', content: '普通进展 3' },
  ];

  const plans = [
    [
      { id: 'todo:edit', description: 'Edit src/cache.ts', action: 'workspace-task', target: '/repo' },
      { id: 'todo:test', description: 'Run cache tests', action: 'verify', target: '/repo' },
      { id: 'todo:finalize', description: 'Revalidate acceptance', action: 'verify', target: '/repo' },
    ],
    [
      { id: 'todo:test', description: 'Run cache tests', action: 'verify', target: '/repo' },
      { id: 'todo:finalize', description: 'Revalidate acceptance', action: 'verify', target: '/repo' },
    ],
    [{ id: 'todo:finalize', description: 'Revalidate acceptance', action: 'verify', target: '/repo' }],
  ];
  let receipt;
  for (let pass = 1; pass <= 3; pass += 1) {
    const redactedSecretCount = redactAgentMessageHistory(messages);
    receipt = session.compact({
      observedChars: 80_000 + pass,
      maxChars: 52_000,
      completedUnitCount: pass - 1,
      pendingUnits: plans[pass - 1],
      evidenceRefs: [`i11:pass-${pass}`],
      redactedSecretCount,
      createdAt: 1_000 + pass,
    });
    compactAgentMessageHistoryWithFidelity(messages, { receipt, maxMessages: 6 });
    assert.equal(receipt.version, CONTEXT_COMPACTION_RECEIPT_PROTOCOL);
    assert.equal(receipt.pass, pass);
    assert.ok(messages.length <= 6);
  }

  const serialized = JSON.stringify(messages);
  assert.match(serialized, /devseek\.coding-context-compaction\/v1/);
  assert.match(serialized, /src\/cache\.ts/);
  assert.match(serialized, /do not touch src\/auth\.ts/i);
  assert.match(serialized, /IntentRevisionLineage as the only owner/);
  assert.match(serialized, /Never replay committed operation receipts/);
  assert.match(serialized, /stale-target/);
  assert.doesNotMatch(serialized, /sk-r3secret/);
  assert.doesNotMatch(serialized, /live-secret-token/);
  assert.doesNotMatch(serialized, /src\/legacy\.ts/);
  assert.equal((serialized.match(/\[DevSeek Canonical Context Compaction]/g) ?? []).length, 1);
  assert.ok(receipt.redactedSecretCount >= 2);
  assert.deepEqual(receipt.rejectedMemoryIds, ['stale-target']);
  assert.deepEqual(receipt.pendingUnits.map(unit => unit.id), ['todo:finalize']);
  assert.throws(
    () => compactAgentMessageHistoryWithFidelity(messages, {
      receipt: { ...receipt, completedUnitCount: 99 },
      maxMessages: 6,
    }),
    /coding-context-compaction:checkpoint-progress-mismatch/u,
  );
});

test('R3-04 Context compaction: executed tool summaries redact command secrets', () => {
  const summary = summarizeExecutedAssistantToolHistory([
    '检查远端健康。',
    authorizedTools('<run_terminal>{"command":"curl -H \\"Authorization: Bearer live-secret-token-abcdef\\" https://example.test && echo api_key=sk-r3toolsecret123456"}</run_terminal>'),
  ].join('\n'), textToolProtocol);

  assert.match(summary, /run_terminal command=/);
  assert.match(summary, /\[REDACTED_SECRET]/);
  assert.doesNotMatch(summary, /live-secret-token/);
  assert.doesNotMatch(summary, /sk-r3toolsecret/);
});

console.log('\nAgent history compaction tests passed.\n');
