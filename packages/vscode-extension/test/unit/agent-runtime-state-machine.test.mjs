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
  settleAgentRuntimeState,
  runtimeStateCanDeliver,
} = req(bundlePath);

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

test('agent runtime state machine: read-only short intent after evidence still needs context', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'analyze',
    providerText: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    roundText: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    toolRequests: 0,
    toolExecutions: 1,
    readEvidenceCount: 4,
  });

  assert.equal(settlement.state, 'evidence_collected');
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

test('agent runtime state machine: mutating task_complete text without evidence cannot deliver', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'modify',
    providerText: '已完成',
    taskComplete: true,
  });

  assert.equal(settlement.state, 'needs_context');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: mutating evidence without delivery signal stays non-terminal', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'edit',
    providerText: '现在我来继续修复这些编译问题。',
    writtenEvidenceCount: 2,
    terminalEvidenceCount: 1,
  });

  assert.equal(settlement.state, 'verified');
  assert.equal(runtimeStateCanDeliver(settlement), false);
});

test('agent runtime state machine: mutating validation block fails before delivery', () => {
  const settlement = settleAgentRuntimeState({
    taskAction: 'edit',
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
