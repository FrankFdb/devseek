import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-runtime-state-machine.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-runtime-state-machine.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  resolveAgentRuntimeTaskAction,
  settleAgentRuntimeState,
  runtimeStateCanDeliver,
} = req(bundlePath);

test('agent runtime state machine: runtime action follows observed effects, not a route prediction alone', () => {
  assert.equal(resolveAgentRuntimeTaskAction({
    routeChatKind: 'code-change',
    taskComplete: false,
    toolReceipts: [],
  }), 'respond');
  assert.equal(resolveAgentRuntimeTaskAction({
    routeChatKind: 'code-change',
    taskComplete: false,
    toolReceipts: [{ purpose: 'observe', status: 'completed', effectStarted: true }],
  }), 'respond');
  assert.equal(resolveAgentRuntimeTaskAction({
    routeChatKind: 'chat',
    taskComplete: false,
    toolReceipts: [{ purpose: 'workspace-mutation', status: 'completed', effectStarted: true }],
  }), 'modify');
  assert.equal(resolveAgentRuntimeTaskAction({
    routeChatKind: 'code-change',
    taskComplete: true,
    toolReceipts: [],
  }), 'modify');
});

test('agent runtime state machine: tool request without execution cannot deliver', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'analyze',
    providerText: '[TOOL:read_file {"path":"/tmp/a.cpp"}]',
    toolRequests: 1,
    toolExecutions: 0,
  });

  assert.equal(settlement.state, 'tool_requested');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: a read-only investigation promise cannot deliver', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'analyze',
    providerText: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    roundText: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    toolRequests: 0,
    toolExecutions: 1,
    readEvidenceCount: 4,
  });

  assert.equal(settlement.state, 'verified');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: read-only conclusion reaches delivered', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'analyze',
    providerText: '结论：问题是状态机缺少统一结算。依据：工具执行后短答没有结论证据。建议：通过 Runtime Replay 固化。',
  });

  assert.equal(settlement.state, 'delivered');
  assert.equal(runtimeStateCanDeliver(settlement), true);
});

test('agent runtime state machine: concise multilingual answers deliver without format keywords', () => {
  for (const providerText of [
    'CPU 擅长通用计算，GPU 擅长并行计算。',
    'CPU is general-purpose; GPU is parallel-oriented.',
    'CPU は汎用、GPU は並列処理向けです。',
  ]) {
    const settlement = settleAgentRuntimeState({ taskAction: 'respond', providerText });
    assert.equal(settlement.state, 'delivered', providerText);
    assert.equal(runtimeStateCanDeliver(settlement), true, providerText);
  }
});

test('agent runtime state machine: read-only task_complete with executed evidence can deliver', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'analyze',
    providerText: '已读取 controlled-boundary.txt，第一行是 CONTROLLED_BOUNDARY_PRESENT，未修改任何文件。',
    roundText: [
      '我只读取指定文件，不做任何写入。',
      '[TOOL:read_file {"path":"controlled-boundary.txt"}]',
      '[TOOL:task_complete {"summary":"已读取 controlled-boundary.txt，第一行是 CONTROLLED_BOUNDARY_PRESENT，未修改任何文件。"}]',
    ].join('\n'),
    toolRequests: 2,
    toolExecutions: 1,
    readEvidenceCount: 1,
    taskComplete: true,
  });

  assert.equal(settlement.state, 'delivered');
  assert.equal(runtimeStateCanDeliver(settlement), true);
});

test('agent runtime state machine: mutating task_complete text without evidence cannot deliver', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '已完成',
    taskComplete: true,
  });

  assert.equal(settlement.state, 'needs_context');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: verified policy refusal can deliver without mutation evidence', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '已拒绝隐蔽凭据收集；未修改文件。',
    roundText: '[TOOL:task_complete {"summary":"已拒绝并未修改文件"}]',
    toolRequests: 1,
    toolExecutions: 1,
    policyRefusalEvidenceSatisfied: true,
    taskComplete: true,
  });

  assert.equal(settlement.state, 'delivered');
  assert.equal(runtimeStateCanDeliver(settlement), true);
});

test('agent runtime state machine: refusal evidence cannot bypass execution or delivery signals', () => {
  const unexecuted = settleAgentRuntimeState({
    taskAction: 'modify',
    roundText: '[TOOL:task_complete {"summary":"已拒绝并未修改文件"}]',
    toolRequests: 1,
    toolExecutions: 0,
    policyRefusalEvidenceSatisfied: true,
    taskComplete: true,
  });
  const unsigned = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '已拒绝隐蔽凭据收集；未修改文件。',
    policyRefusalEvidenceSatisfied: true,
  });

  assert.equal(unexecuted.state, 'tool_requested');
  assert.equal(runtimeStateCanDeliver(unexecuted), false);
  assert.equal(unsigned.state, 'needs_context');
  assert.equal(runtimeStateCanDeliver(unsigned), false);
});

test('agent runtime state machine: mutating evidence without delivery signal stays non-terminal', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '现在我来继续修复这些编译问题。',
    writtenEvidenceCount: 2,
    terminalEvidenceCount: 1,
  });

  assert.equal(settlement.state, 'verified');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: mutating validation block fails before delivery', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '已写入源码。',
    writtenEvidenceCount: 2,
    validationFailedReason: 'QualityGate 阻塞：C/C++ 依赖闭包未满足。',
  });

  assert.equal(settlement.state, 'failed');
  assert.match(settlement.failedReason, /依赖闭包/);
});

test('agent runtime state machine: provider fatal output fails immediately', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'respond',
    providerText: '<html><body>502 Bad Gateway</body></html>',
  });

  assert.equal(settlement.state, 'failed');
  assert.match(settlement.failedReason, /错误页|服务异常/);
});

console.log('\nAgent runtime state machine tests passed.\n');
