/**
 * Unit tests for app/workflow-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workflow-service.bundle.cjs');
const intentBundlePath = path.join(rootDir, 'test/unit/workflow-service.intent-router.bundle.cjs');

execSync(
  `npx esbuild src/app/workflow-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);
execSync(
  `npx esbuild src/intent-router.ts --bundle ` +
  `--outfile=${intentBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { decideChatIntent } = req(intentBundlePath);
const { selectWorkflow, WorkflowStateMachine } = req(bundlePath);

test('WorkflowService: smalltalk stays plain chat', () => {
  const intent = decideChatIntent('hello');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.state, 'plain_chat');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: inspect requires context before agent', () => {
  const intent = decideChatIntent('分析这段代码');
  assert.equal(selectWorkflow({ intent, files: [], agentEnabled: true }).useAgent, false);
  const selected = selectWorkflow({ intent, files: ['/tmp/main.ts'], agentEnabled: true });
  assert.equal(selected.kind, 'inspect-agent');
  assert.equal(selected.toolPolicyMode, 'inspect');
});

test('WorkflowService: edit routes to edit agent when enabled', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
});

test('WorkflowService: run-to-repair routes to edit agent with edit policy', () => {
  const prompt = 'Run npm test, and if it fails fix the issue.';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'edit');
  assert.ok(intent.signals.includes('conditional-repair-on-failure'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: green-suite repair routes to edit agent with edit policy', () => {
  const prompt = 'Can you get the suite green again?';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'edit');
  assert.ok(intent.signals.includes('validation-health-repair-request'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: project health repair routes to edit agent with edit policy', () => {
  const prompt = 'The page crashes on load, get it stable again.';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'edit');
  assert.ok(intent.signals.includes('project-health-repair-request'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: negated repair keeps terminal validation in run agent', () => {
  const prompt = 'Run tests, but do not fix failures.';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'run');
  assert.equal(intent.signals.includes('conditional-repair-on-failure'), false);
  assert.equal(selected.kind, 'run-agent');
  assert.equal(selected.state, 'running');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'run');
});

test('WorkflowService: complex refactor enters plan review with plan policy', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(selected.kind, 'plan-agent');
  assert.equal(selected.state, 'plan_review');
  assert.equal(selected.useAgent, false);
  assert.equal(selected.requiresPlanReview, true);
  assert.equal(selected.toolPolicyMode, 'plan');
  assert.ok(selected.allowedTransitions.some(t => t.event === 'approve-plan' && t.to === 'editing'));
});

test('WorkflowService: plan review is enforced even when agent toggle is off', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, prompt });

  assert.equal(selected.kind, 'plan-agent');
  assert.equal(selected.state, 'plan_review');
  assert.equal(selected.requiresPlanReview, true);
  assert.equal(selected.reason, 'plan-review-required');
});

test('WorkflowService: explicit file inspection stays controlled when agent toggle is off', () => {
  const prompt = '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, prompt });

  assert.equal(selected.kind, 'inspect-agent');
  assert.equal(selected.state, 'inspect');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'inspect');
});

test('WorkflowService: read-only file existence/content check stays inspect-only', () => {
  const prompt = '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'inspect');
  assert.ok(intent.blockers.includes('explicit-no-change'));
  assert.equal(selected.kind, 'inspect-agent');
  assert.equal(selected.state, 'inspect');
  assert.equal(selected.toolPolicyMode, 'inspect');
});

test('WorkflowService: executable path question stays inspect-only', () => {
  const prompt = '可执行文件在哪儿呢？';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'inspect');
  assert.ok(intent.signals.includes('artifact-path-query'));
  assert.equal(selected.kind, 'inspect-agent');
  assert.equal(selected.state, 'inspect');
  assert.equal(selected.toolPolicyMode, 'inspect');
});

test('WorkflowService: explicit file edit stays controlled when agent toggle is off', () => {
  const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, prompt });

  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: capability feature follow-up with context stays controlled when agent toggle is off', () => {
  const prompt = '现在可以同时显示，但是，6个图形，不能单独通过鼠标或者键盘操作，能提供单独控制每个图形旋转';
  const files = [
    '/tmp/code/shape_manager/main.cpp',
    '/tmp/code/shape_manager/CMakeLists.txt',
    '/tmp/code/shape_manager/Shape3D.h',
    '/tmp/code/shape_manager/Sphere.cpp',
    '/tmp/code/shape_manager/Box.cpp',
  ];
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files, agentEnabled: false, forceNoAgent: true, prompt });

  assert.equal(intent.mode, 'edit');
  assert.ok(intent.signals.includes('capability-feature-request'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.requiresPlanReview, false);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: exact unknown-extension write stays controlled when agent toggle is off', () => {
  const prompt = '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, forceNoAgent: true, prompt });

  assert.ok(intent.signals.includes('explicit-file-path'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: explicit directory edit stays controlled when agent toggle is off', () => {
  const prompt = '/home/ff/work/devseek_netai/code/shape_manager 请规划一个整体更好的解决方案，并通过代码实现，编译验证';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: false, forceNoAgent: true, prompt });

  assert.ok(intent.signals.includes('explicit-file-path'));
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: explicit planning request stays in planning state', () => {
  const prompt = '给出这个项目的重构方案';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: ['/tmp/src/index.ts'], agentEnabled: true, prompt });

  assert.equal(selected.kind, 'plan-agent');
  assert.equal(selected.state, 'planning');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.requiresPlanReview, false);
  assert.equal(selected.toolPolicyMode, 'plan');
});

test('WorkflowService: missing intent signals degrades instead of throwing', () => {
  const prompt = '分析 packages/vscode-extension/src/app/workflow-service.ts';
  const intent = { ...decideChatIntent(prompt), signals: undefined };
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'mode-inspect-does-not-use-agent');
});

test('WorkflowService: no-change refactor plan stays planning with plan policy', () => {
  const prompt = '制定一个重构 src/agent/tool-executor.ts 的计划，但不要改代码';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(intent.mode, 'plan');
  assert.equal(selected.kind, 'plan-agent');
  assert.equal(selected.state, 'planning');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.requiresPlanReview, false);
  assert.equal(selected.toolPolicyMode, 'plan');
});

test('WorkflowService: approved plan review can transition to editing', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const intent = decideChatIntent(prompt);
  const machine = new WorkflowStateMachine();
  const selected = machine.select({ intent, files: [], agentEnabled: true, prompt });
  const next = machine.transition(selected, 'approve-plan');

  assert.equal(next.kind, 'edit-agent');
  assert.equal(next.state, 'editing');
  assert.equal(next.toolPolicyMode, 'edit');
  assert.equal(next.requiresPlanReview, false);
});

test('WorkflowService: forceNoAgent wins over edit intent', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, forceNoAgent: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'force-no-agent');
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: destructive requests require confirmation outside agent', () => {
  const intent = decideChatIntent('删除 code/main.cpp');
  const selected = selectWorkflow({ intent, files: ['/tmp/main.cpp'], agentEnabled: true });
  assert.equal(selected.kind, 'confirmation-required');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: confirmed destructive requests route to edit agent', () => {
  const intent = decideChatIntent('删除 code/main.cpp');
  const selected = selectWorkflow({ intent, files: ['/tmp/main.cpp'], agentEnabled: true, intentConfirmed: true });
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.reason, 'confirmed-destructive-workflow');
});

console.log('\nWorkflow service tests passed.\n');
