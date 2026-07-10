import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-runtime-turn-policy.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-runtime-turn-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildMutatingNoToolRecoveryFeedback,
  buildReadOnlyNoToolRecoveryFeedback,
  decideAgentRuntimeTurn,
  decideReadOnlyNoToolRecovery,
  isReadOnlyRuntimeAction,
} = req(bundlePath);

test('agent runtime turn policy: tool rounds continue through tool-results', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'analyze',
    toolCallsMade: true,
    aggregateRaw: '我读取文件。',
    taskTitle: '分析需求',
    recoveryAttempts: 0,
  });

  assert.equal(decision.kind, 'tool-results');
});

test('agent runtime turn policy: read-only no-tool intent recovers before settlement', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'analyze',
    toolCallsMade: false,
    aggregateRaw: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    taskTitle: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
    recoveryAttempts: 0,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'recover');
});

test('agent runtime turn policy: enough-information transition recovers before settlement', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'analyze',
    toolCallsMade: false,
    aggregateRaw: '现在我已经收集了足够的信息，让我分析新需求与现有实现的差异，并给出实现对策建议。',
    roundRaw: '现在我已经收集了足够的信息，让我分析新需求与现有实现的差异，并给出实现对策建议。',
    taskTitle: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
    recoveryAttempts: 0,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'recover');
});


test('agent runtime turn policy: read-only recovery stops after bounded attempts', () => {
  const decision = decideReadOnlyNoToolRecovery({
    aggregateRaw: '现在让我再查看几个关键文件来完整了解原实现的设计。',
    taskTitle: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
    recoveryAttempts: 2,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'give-up');
  assert.match(decision.failedReason, /没有输出分析结论/);
  assert.match(decision.failedReason, /可执行工具调用/);
});

test('agent runtime turn policy: short report intent is not delivered after recovery budget', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'analyze',
    toolCallsMade: false,
    aggregateRaw: '现在我已经完整查看了新需求文档、旧实现代码和旧设计文档。接下来将生成分析报告。',
    roundRaw: '现在我已经完整查看了新需求文档、旧实现代码和旧设计文档。接下来将生成分析报告。',
    taskTitle: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
    recoveryAttempts: 2,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'give-up');
  assert.match(decision.failedReason, /没有输出分析结论/);
  assert.doesNotMatch(decision.failedReason, /空响应/);
});

test('agent runtime turn policy: read-only final answer can settle', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'analyze',
    toolCallsMade: false,
    aggregateRaw: '结论：现有维保实现缺少作业循环维度。依据：maintenance_threshold_engine.hpp 仍以旧阈值模型为核心。建议：拆分采集、状态机和阈值引擎任务。',
    taskTitle: '分析需求',
    recoveryAttempts: 0,
  });

  assert.equal(decision.kind, 'final-answer');
});

test('agent runtime turn policy: non-read-only no-tool output remains final-answer for editor parser', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'modify',
    toolCallsMade: false,
    aggregateRaw: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE',
    taskTitle: '修改文件',
    recoveryAttempts: 0,
  });

  assert.equal(decision.kind, 'final-answer');
});

test('agent runtime turn policy: mutating short no-tool intent recovers before editor parser', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'modify',
    toolCallsMade: false,
    aggregateRaw: '现在我来继续修复这些编译问题。',
    roundRaw: '现在我来继续修复这些编译问题。',
    taskTitle: '修复自动验证失败',
    recoveryAttempts: 0,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'recover');
  assert.match(decision.feedback, /可应用的代码修改/);
  assert.match(decision.feedback, /SEARCH\/REPLACE/);
});

test('agent runtime turn policy: mutating short no-tool intent stops after recovery budget', () => {
  const decision = decideAgentRuntimeTurn({
    taskAction: 'create',
    toolCallsMade: false,
    aggregateRaw: '接下来我会生成代码。',
    roundRaw: '接下来我会生成代码。',
    taskTitle: '创建实现代码',
    recoveryAttempts: 2,
    maxRecoveryAttempts: 2,
  });

  assert.equal(decision.kind, 'give-up');
  assert.match(decision.failedReason, /没有输出可应用补丁/);
});

test('agent runtime turn policy: read-only action classifier stays centralized', () => {
  assert.equal(isReadOnlyRuntimeAction('analyze'), true);
  assert.equal(isReadOnlyRuntimeAction('explain'), true);
  assert.equal(isReadOnlyRuntimeAction('explore'), true);
  assert.equal(isReadOnlyRuntimeAction('respond'), true);
  assert.equal(isReadOnlyRuntimeAction('modify'), false);
});

test('agent runtime turn policy: recovery feedback stays read-only and asks for concrete paths', () => {
  const feedback = buildReadOnlyNoToolRecoveryFeedback('分析 docs');

  assert.match(feedback, /path、pattern 或 command/);
  assert.match(feedback, /只读分析任务/);
  assert.match(feedback, /不要修改文件/);
});

test('agent runtime turn policy: mutating recovery feedback asks for tools or concrete patch', () => {
  const feedback = buildMutatingNoToolRecoveryFeedback('修改源码');

  assert.match(feedback, /create_file\/write_file/);
  assert.match(feedback, /完整 SEARCH\/REPLACE/);
  assert.match(feedback, /短意图/);
});

console.log('\nAgent runtime turn policy tests passed.\n');
