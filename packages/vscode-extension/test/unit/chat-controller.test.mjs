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

test('ChatRouteController: complex refactor starts in plan review with plan permissions', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块',
    prompt: '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块',
    files: [],
    agentEnabled: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.workflow.kind, 'plan-agent');
  assert.equal(decision.workflow.state, 'plan_review');
  assert.equal(decision.workflow.requiresPlanReview, true);
  assert.equal(decision.toolPolicy.mode, 'plan');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('terminal'), false);
});

test('ChatRouteController: explicit read-only file inspection uses inspect policy', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码',
    prompt: '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码',
    files: [],
    agentEnabled: true,
  });

  assert.equal(decision.intent.mode, 'inspect');
  assert.equal(decision.workflow.kind, 'inspect-agent');
  assert.equal(decision.workflow.state, 'inspect');
  assert.equal(decision.toolPolicy.mode, 'inspect');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('read'), true);
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('terminal'), false);
});

test('ChatRouteController: explicit file inspection ignores disabled agent toggle for controlled read tools', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码',
    prompt: '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码',
    files: [],
    agentEnabled: false,
  });

  assert.equal(decision.intent.mode, 'inspect');
  assert.equal(decision.workflow.kind, 'inspect-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'inspect');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('read'), true);
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
});

test('ChatRouteController: explicit no-change refactor plan uses plan workflow', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '制定一个重构 src/agent/tool-executor.ts 的计划，但不要改代码',
    prompt: '制定一个重构 src/agent/tool-executor.ts 的计划，但不要改代码',
    files: [],
    agentEnabled: false,
  });

  assert.equal(decision.intent.mode, 'plan');
  assert.equal(decision.workflow.kind, 'plan-agent');
  assert.equal(decision.workflow.state, 'planning');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'plan');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('terminal'), false);
});

test('ChatRouteController: explicit file fix ignores disabled agent toggle for controlled edit tools', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    prompt: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    files: [],
    agentEnabled: false,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: explicit file fix is not downgraded by webview no-agent payload', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    prompt: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    files: [],
    agentEnabled: false,
    forceNoAgent: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: exact unknown-extension write is not downgraded by webview no-agent payload', () => {
  const controller = new ChatRouteController();
  const decision = controller.decide({
    userDisplay: '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。',
    prompt: '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。',
    files: [],
    agentEnabled: false,
    forceNoAgent: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.ok(decision.intent.signals.includes('explicit-file-path'));
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: explicit directory edit is not downgraded by webview no-agent payload', () => {
  const controller = new ChatRouteController();
  const prompt = '/home/ff/work/devseek_netai/code/shape_manager 请基于这些要求规划方案，并通过代码实现，编译验证';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: [],
    agentEnabled: false,
    forceNoAgent: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.ok(decision.intent.signals.includes('explicit-file-path'));
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: capability feature follow-up with context stays in edit workflow', () => {
  const controller = new ChatRouteController();
  const prompt = '现在可以同时显示，但是，6个图形，不能单独通过鼠标或者键盘操作，能提供单独控制每个图形旋转';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: [
      '/tmp/code/shape_manager/main.cpp',
      '/tmp/code/shape_manager/CMakeLists.txt',
      '/tmp/code/shape_manager/Shape3D.h',
      '/tmp/code/shape_manager/Sphere.cpp',
      '/tmp/code/shape_manager/Box.cpp',
    ],
    agentEnabled: false,
    forceNoAgent: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.intent.reason, 'capability-feature-request');
  assert.ok(decision.intent.signals.includes('capability-feature-request'));
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.workflow.useAgent, true);
  assert.equal(decision.workflow.requiresPlanReview, false);
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
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
