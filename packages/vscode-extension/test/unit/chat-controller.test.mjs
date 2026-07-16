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

test('ChatRouteController: isolated output directory keeps implementation workflow despite scoped no-change', () => {
  const controller = new ChatRouteController();
  const prompt = [
    '添加：代码实现，创建于：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance目录下',
    '请按照软件工程流程：分析既有项目原来代码逻辑，根据需求进行设计，最后实现代码，完成自闭环测试。',
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637',
    '设计/实施 Markdown 文档放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/docs',
    '新增代码、测试代码和验证脚本放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/src',
    '不要修改正式源码目录里的既有文件；如果正式集成需要改原代码，必须在文档中提供原有代码修改清单。',
  ].join('\n');
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: [],
    agentEnabled: true,
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.ok(decision.intent.signals.includes('deliverable-write-request'));
  assert.ok(decision.intent.signals.includes('scoped-existing-source-no-change'));
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.equal(decision.toolPolicy.mode, 'edit');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: a source read constraint does not cancel an explicit report path write', () => {
  const controller = new ChatRouteController();
  const prompt = [
    '读取 /workspace/src/license_types.hpp 并提取协议常量。',
    '创建 /workspace/out/license-facts.md，写盘后读回验证。',
    '不要修改任何源码，不要创建其他文件。',
  ].join('\n');
  const decision = controller.decide({ userDisplay: prompt, prompt, files: [], agentEnabled: true });

  assert.equal(decision.intent.mode, 'edit');
  assert.ok(decision.intent.signals.includes('deliverable-write-request'));
  assert.equal(decision.workflow.kind, 'edit-agent');
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

test('ChatRouteController: provider semantic intent can upgrade ambiguous local chat into edit workflow', () => {
  const controller = new ChatRouteController();
  const prompt = '做一个 hello everyday 小程序';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: [],
    agentEnabled: true,
    semanticIntent: {
      version: 'devseek.semantic-intent/v1',
      source: 'test',
      mode: 'edit',
      taskKind: 'standalone-program',
      confidence: 0.94,
      mutation: 'create-file',
      targetPaths: [],
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: false,
      requiresClarification: false,
      reason: '用户要求创建一个可运行程序',
    },
  });

  assert.equal(decision.intent.mode, 'edit');
  assert.equal(decision.workflow.kind, 'edit-agent');
  assert.ok(decision.intent.signals.includes('semantic-intent-provider'));
  assert.ok(decision.intent.signals.includes('semantic-intent-overrode-local'));
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), true);
});

test('ChatRouteController: explicit no-change boundary cannot be escalated by semantic edit intent', () => {
  const controller = new ChatRouteController();
  const prompt = '请分析 src/main.ts 的问题，直接回答，不要修改任何文件';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: ['/workspace/src/main.ts'],
    agentEnabled: true,
    semanticIntent: {
      version: 'devseek.semantic-intent/v1',
      source: 'test',
      mode: 'edit',
      taskKind: 'existing-project-edit',
      confidence: 0.96,
      mutation: 'modify-source',
      targetPaths: ['/workspace/src/main.ts'],
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      requiresClarification: false,
      reason: '模型误判成修改源码',
    },
  });

  assert.notEqual(decision.intent.mode, 'edit');
  assert.equal(decision.intent.blockers.includes('explicit-no-change'), true);
  assert.equal(decision.workflow.kind, 'inspect-agent');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
});

test('ChatRouteController: semantic external-effect intent requires confirmation', () => {
  const controller = new ChatRouteController();
  const prompt = '提交当前修改并推送到远端';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: ['/workspace/src/main.ts'],
    agentEnabled: true,
    semanticIntent: {
      version: 'devseek.semantic-intent/v1',
      source: 'test',
      mode: 'run',
      taskKind: 'external-effect',
      confidence: 0.93,
      mutation: 'external-effect',
      targetPaths: [],
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: true,
      requiresClarification: false,
      reason: '用户要求 git 提交推送',
    },
  });

  assert.equal(decision.intent.requiresConfirmation, true);
  assert.equal(decision.workflow.kind, 'confirmation-required');
});

test('ChatRouteController: contradictory semantic no-mutation edit is governed down to inspect', () => {
  const controller = new ChatRouteController();
  const prompt = '看看 src/main.ts 里有没有明显问题，不要改';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: ['/workspace/src/main.ts'],
    agentEnabled: true,
    semanticIntent: {
      version: 'devseek.semantic-intent/v1',
      source: 'test',
      mode: 'edit',
      taskKind: 'read-only-analysis',
      confidence: 0.91,
      mutation: 'none',
      targetPaths: ['/workspace/src/main.ts'],
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      requiresClarification: false,
      reason: '自然语言明确不允许修改',
    },
  });

  assert.equal(decision.intent.mode, 'inspect');
  assert.equal(decision.workflow.kind, 'inspect-agent');
  assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false);
});

test('getIntentRoutingText: strips only attachment badge lines', () => {
  assert.equal(getIntentRoutingText('📎 `a.ts`\n\nello', 'fallback'), 'ello');
  assert.equal(getIntentRoutingText('', 'fallback'), 'fallback');
});

console.log('\nChat controller tests passed.\n');
