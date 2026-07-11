/**
 * End-to-end routing matrix for DevSeek intent behavior.
 *
 * These tests exercise the implementation-level decision path:
 * user-visible prompt -> intent -> workflow -> tool permissions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, outfile) {
  const bundlePath = path.join(rootDir, outfile);
  execSync(
    `npx esbuild ${entry} --bundle ` +
    `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return bundlePath;
}

const req = createRequire(import.meta.url);
const { ChatRouteController } = req(bundle(
  'src/app/chat-controller.ts',
  'test/unit/intent-behavior-matrix.chat-controller.bundle.cjs',
));
const { decideToolPermission } = req(bundle(
  'src/app/permission-service.ts',
  'test/unit/intent-behavior-matrix.permission-service.bundle.cjs',
));
const { shouldAutoApplyFromResponse } = req(bundle(
  'src/intent-router.ts',
  'test/unit/intent-behavior-matrix.intent-router.bundle.cjs',
));
const { stripToolCallBlocks } = req(bundle(
  'src/agent/fake-tool-parser.ts',
  'test/unit/intent-behavior-matrix.fake-tool-parser.bundle.cjs',
));
const { parseGeneratedArtifacts } = req(bundle(
  'src/generated-file-parser.ts',
  'test/unit/intent-behavior-matrix.generated-file-parser.bundle.cjs',
));

const controller = new ChatRouteController();

const READ_TOOLS = ['read', 'search', 'diagnostics', 'network'];
const PLAN_TOOLS = [...READ_TOOLS, 'plan', 'memory'];
const EDIT_TOOLS = [...PLAN_TOOLS, 'edit', 'terminal'];
const RUN_TOOLS = [...READ_TOOLS, 'plan', 'memory', 'terminal'];

function decide(input) {
  return controller.decide({
    userDisplay: input.userDisplay ?? input.prompt,
    prompt: input.prompt,
    files: input.files ?? [],
    agentEnabled: input.agentEnabled ?? true,
    forceNoAgent: input.forceNoAgent ?? false,
    lookupLearnedIntent: input.learnedKind ? () => input.learnedKind : undefined,
  });
}

function assertToolActions(decision, actions) {
  for (const [kind, expectedAction] of Object.entries(actions)) {
    assert.equal(
      decideToolPermission(decision.toolPolicy, kind).action,
      expectedAction,
      `${kind} permission`,
    );
  }
}

const routingCases = [
  {
    id: 'INT-001',
    title: 'hello is pure smalltalk',
    prompt: 'hello',
    expect: { routingText: 'hello', kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'INT-002',
    title: 'truncated ello is still smalltalk',
    prompt: 'ello',
    expect: { kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'INT-003',
    title: 'Chinese greeting is smalltalk',
    prompt: '你好',
    expect: { kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'ATT-001',
    title: 'attachment badge does not pollute hello routing',
    userDisplay: '📎 `main.cpp`\n\nhello',
    prompt: '**附件：`main.cpp`**\nint main() { std::cout << "Hello"; }\n\n---\nhello',
    files: ['/tmp/main.cpp'],
    expect: { routingText: 'hello', kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'HIST-001',
    title: 'learned code-change habit cannot upgrade hello',
    prompt: 'hello',
    learnedKind: 'code-change',
    expect: { kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    signal: 'learned-habit-ignored',
    blocker: 'learned-habit-conflict',
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'HIST-002',
    title: 'learned code-change habit cannot upgrade hello with files',
    prompt: 'hello',
    files: ['/tmp/hello.cpp'],
    learnedKind: 'code-change',
    expect: { kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    signal: 'learned-habit-ignored',
    blocker: 'learned-habit-conflict',
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'HIST-003',
    title: 'visible hello wins over polluted prompt transcript',
    userDisplay: 'hello',
    prompt: [
      '[TOOL:manage_todo_list {"todoList":[{"id":"1","title":"创建 Hello World","status":"completed"}]}]',
      '[TOOL:run_terminal {"command":"g++ hello.cpp -o hello"}]',
      'hello',
    ].join('\n'),
    files: ['/tmp/hello.cpp'],
    learnedKind: 'code-change',
    expect: { routingText: 'hello', kind: 'chat', mode: 'smalltalk', workflow: 'plain-chat', useAgent: false, tools: [] },
    signal: 'learned-habit-ignored',
    blocker: 'learned-habit-conflict',
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'QA-001',
    title: 'concept question stays plain QA',
    prompt: '什么是单例模式？',
    expect: { kind: 'chat', mode: 'qa', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'QA-002',
    title: 'technology introduction stays plain QA',
    prompt: '介绍一下 React',
    expect: { kind: 'chat', mode: 'qa', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'QA-003',
    title: 'technical capability introduction stays plain QA',
    prompt: '你好，能介绍一下 OpenGL 的旋转矩阵吗',
    expect: { kind: 'chat', mode: 'qa', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'QA-004',
    title: 'why-style graphics question stays plain QA',
    prompt: '为什么图形不能显示？',
    expect: { kind: 'chat', mode: 'qa', workflow: 'plain-chat', useAgent: false, tools: [] },
    toolActions: { read: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'READ-001',
    title: 'explicit no-change inspection uses read-only agent',
    prompt: '不要修改，只分析这个文件',
    files: ['/tmp/main.ts'],
    expect: { kind: 'chat', mode: 'inspect', workflow: 'inspect-agent', useAgent: true, tools: READ_TOOLS },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'READ-002',
    title: 'file inspection uses read-only agent',
    prompt: '解释这段代码',
    files: ['/tmp/main.ts'],
    expect: { kind: 'chat', mode: 'inspect', workflow: 'inspect-agent', useAgent: true, tools: READ_TOOLS },
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'READ-003',
    title: 'explicit file inspection stays controlled when agent toggle is off',
    prompt: '帮我查看 packages/vscode-extension/src/app/workflow-service.ts 的工作流状态机是否清晰，不要修改代码',
    agentEnabled: false,
    expect: { kind: 'chat', mode: 'inspect', workflow: 'inspect-agent', useAgent: true, tools: READ_TOOLS },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'READ-004',
    title: 'a negated artifact action remains read-only',
    prompt: '确认 /tmp/report.md 是否存在，不要创建 /tmp/report.md，也不要修改文件。',
    expect: { kind: 'chat', mode: 'inspect', workflow: 'inspect-agent', useAgent: true, tools: READ_TOOLS },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'PLAN-001',
    title: 'project architecture plan uses plan agent when context exists',
    prompt: '给出这个项目的重构方案',
    files: ['/tmp/src/index.ts'],
    expect: { kind: 'chat', mode: 'plan', workflow: 'plan-agent', useAgent: true, tools: PLAN_TOOLS },
    toolActions: { read: 'allow', plan: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'PLAN-002',
    title: 'no-change planning request stays read-only plan agent',
    prompt: '给出这个项目的重构方案，不要修改代码',
    files: ['/tmp/src/index.ts'],
    expect: { kind: 'chat', mode: 'plan', workflow: 'plan-agent', useAgent: true, tools: PLAN_TOOLS },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', plan: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'PLAN-003',
    title: 'advisory implementation countermeasure request stays read-only',
    prompt: '原来实现的吊运维保功能：设计文档+代码等/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance 下面是最新的维保提醒的需求： /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议',
    expect: { kind: 'chat', mode: 'plan', workflow: 'plan-agent', useAgent: true, tools: PLAN_TOOLS },
    signal: 'advisory-planning-request',
    toolActions: { read: 'allow', plan: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'EDIT-000',
    title: 'formal project markdown design plus code implementation is edit workflow',
    prompt: [
      '参考 /home/ff/uav/tars/huida_uav/src/oam/src/license 模块的通讯方式',
      '基于 /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 需求和平台接口文档进行遥控器和主控交互接口设计，主控逻辑实现设计，并通过 md 文档提供',
      '另外添加：代码实现，创建于：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance 目录下',
      '所有新增文件必须避免覆盖已有正式文件。',
      '请按照软件工程流程：分析既有项目原来代码逻辑，根据需求进行设计，最后实现代码，完成自闭环测试。',
    ].join('\n'),
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'edit-request',
    toolActions: { read: 'allow', plan: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-000B',
    title: 'isolated formal-project docs and src delivery is not downgraded by scoped no-change',
    prompt: [
      '添加：代码实现，创建于：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance目录下',
      '让DevSeek完成整体编程任务：先调查原项目，再设计，再实现，再验证。',
      '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637',
      '设计/实施 Markdown 文档放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/docs',
      '新增代码、测试代码和验证脚本放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/src',
      '不要修改正式源码目录里的既有文件；如果正式集成需要改原代码，必须在文档中提供原有代码修改清单。',
    ].join('\n'),
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'deliverable-write-request',
    toolActions: { read: 'allow', plan: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-000C',
    title: 'formal project delivery with uncovered-risk reporting stays in edit workflow',
    prompt: [
      '请在既有主控项目中调查通讯链路、实现新增代码和验证脚本，并修复到通过。',
      '所有新增文档和代码放入 /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607110603/docs 和 src 目录。',
      '不要修改正式源码目录里的既有文件；正式集成改动写入修改清单。',
      '最终返回生成文件路径、修改摘要、验证证据和未覆盖风险，并说明测试覆盖率。',
    ].join('\n'),
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'deliverable-write-request',
    toolActions: { read: 'allow', plan: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-000D',
    title: 'read source and write a scoped report is a mixed edit task, not read-only inspection',
    prompt: [
      '读取 /home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp 并提取协议常量。',
      '创建 /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607111215/docs/license-transport-facts.md，写盘后读回验证。',
      '不要修改任何源码，不要创建其他文件。',
    ].join('\n'),
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'deliverable-write-request',
    toolActions: { read: 'allow', plan: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-001',
    title: 'create and run C++ hello world is edit workflow',
    prompt: '创建一个 hello world C++ 程序并运行',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-002',
    title: 'write C++ hello program is edit workflow',
    prompt: '编写一个 C++ 程序，打印 hello',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-003',
    title: 'fix compile error prefers edit over run',
    prompt: '修复 main.cpp 编译错误',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-004',
    title: 'explicit file fix stays controlled when webview sends no-agent payload',
    prompt: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    agentEnabled: false,
    forceNoAgent: true,
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-005',
    title: 'auto-discovered project files keep optimization requests in controlled workflow',
    prompt: '现在的 shape_manager 图形绘画需要继续优化',
    files: ['/tmp/code/shape_manager/Renderer.cpp', '/tmp/code/shape_manager/Renderer.h'],
    agentEnabled: false,
    forceNoAgent: true,
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-006',
    title: 'capability phrased graphics follow-up stays in controlled edit workflow',
    prompt: '现在可以同时显示，但是，6个图形，不能单独通过鼠标或者键盘操作，能提供单独控制每个图形旋转',
    files: [
      '/tmp/code/shape_manager/main.cpp',
      '/tmp/code/shape_manager/CMakeLists.txt',
      '/tmp/code/shape_manager/Shape3D.h',
      '/tmp/code/shape_manager/Sphere.cpp',
      '/tmp/code/shape_manager/Box.cpp',
    ],
    agentEnabled: false,
    forceNoAgent: true,
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'capability-feature-request',
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-007',
    title: 'change-to interaction follow-up is not plain QA',
    prompt: '通过数字能选择描画的三维图形，能够改为通过鼠标点击选择对应图形吗',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: EDIT_TOOLS },
    signal: 'capability-feature-request',
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-001',
    title: 'run tests is terminal-confirmed run workflow',
    prompt: '运行测试',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: RUN_TOOLS },
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-002',
    title: 'compile explicit file is terminal-confirmed run workflow',
    prompt: '编译 code/hello.cpp',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: RUN_TOOLS },
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-003',
    title: 'execution-result follow-up is terminal-confirmed run workflow',
    prompt: '能执行，看到执行结果吗',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: RUN_TOOLS },
    signal: 'follow-up-run-request',
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-004',
    title: 'direct Chinese execute-result request is a follow-up run workflow',
    prompt: '请执行，给出执行结果',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: RUN_TOOLS },
    signal: 'follow-up-run-request',
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'DANGER-001',
    title: 'delete request requires confirmation and does not run agent',
    prompt: '删除 code/main.cpp',
    expect: { kind: 'code-change', mode: 'destructive', workflow: 'confirmation-required', useAgent: false, requireConfirmation: true },
    toolActions: { read: 'requireConfirm', edit: 'requireConfirm', terminal: 'requireConfirm', 'vscode-command': 'requireConfirm' },
  },
  {
    id: 'CTRL-001',
    title: 'forceNoAgent disables ambiguous edit agent but keeps edit permissions',
    prompt: '修复这个 bug',
    forceNoAgent: true,
    expect: { kind: 'code-change', mode: 'edit', workflow: 'plain-chat', useAgent: false, tools: EDIT_TOOLS },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
];

for (const item of routingCases) {
  test(`${item.id}: ${item.title}`, () => {
    const decision = decide(item);
    assert.equal(decision.intent.kind, item.expect.kind, 'intent kind');
    assert.equal(decision.intent.mode, item.expect.mode, 'intent mode');
    assert.equal(decision.workflow.kind, item.expect.workflow, 'workflow kind');
    assert.equal(decision.workflow.useAgent, item.expect.useAgent, 'workflow useAgent');
    if (item.expect.routingText !== undefined) {
      assert.equal(decision.intentRoutingText, item.expect.routingText, 'routing text');
    }
    if (item.expect.tools !== undefined) {
      assert.deepEqual(decision.toolPolicy.allowedToolKinds, item.expect.tools, 'allowed tools');
    }
    if (item.expect.requireConfirmation !== undefined) {
      assert.equal(decision.intent.requiresConfirmation, item.expect.requireConfirmation, 'requires confirmation');
      assert.equal(decision.toolPolicy.requireUserConfirmation, item.expect.requireConfirmation, 'tool policy confirmation');
    }
    if (item.signal) assert.ok(decision.intent.signals.includes(item.signal), `signal ${item.signal}`);
    if (item.blocker) assert.ok(decision.intent.blockers.includes(item.blocker), `blocker ${item.blocker}`);
    assertToolActions(decision, item.toolActions);
  });
}

const artifactResponse = [
  '文件 1: code/hello.cpp',
  '```cpp',
  '#include <iostream>',
  'int main() { std::cout << "Hello"; return 0; }',
  '```',
].join('\n');

test('ART-001: QA response with code fence is never auto-applied', () => {
  const decision = decide({ prompt: '什么是 Hello World 程序？' });
  assert.equal(shouldAutoApplyFromResponse(decision.intent, artifactResponse, 'aggressive'), false);
});

test('ART-002: polluted hello response with artifact is never auto-applied', () => {
  const decision = decide({ prompt: 'hello', learnedKind: 'code-change' });
  assert.equal(decision.intent.kind, 'chat');
  assert.equal(decision.intent.mode, 'smalltalk');
  assert.equal(shouldAutoApplyFromResponse(decision.intent, artifactResponse, 'aggressive'), false);
});

test('ART-003: edit response with structured artifact can be auto-applied under balanced policy', () => {
  const decision = decide({ prompt: '创建 code/hello.cpp' });
  assert.equal(decision.intent.kind, 'code-change');
  assert.equal(shouldAutoApplyFromResponse(decision.intent, artifactResponse, 'balanced'), true);
});

test('TOOL-001: bracket tool transcripts are stripped before user-facing display', () => {
  const leaked = [
    '[TOOL:manage_todo_list {"todoList":[{"id":"1","title":"创建 Hello World","status":"in-progress"}]}]',
    '[TOOL:create_file {"path":"code/hello.cpp","content":"#include <iostream>\\nint main() { return 0; }\\n"}]',
    '[TOOL:run_terminal {"command":"g++ code/hello.cpp -o code/hello && ./code/hello"}]',
  ].join('\n');
  assert.equal(stripToolCallBlocks(leaked), '');
});

test('TOOL-002: tool transcript removal preserves surrounding prose', () => {
  const leaked = [
    '准备验证。',
    '[TOOL:run_terminal {"command":"npm test"}]',
    '验证完成。',
  ].join('\n');
  assert.equal(stripToolCallBlocks(leaked), '准备验证。\n验证完成。');
});

test('TOOL-003: DSML tool transcripts are stripped before user-facing display', () => {
  const leaked = [
    '准备查看文件。',
    '< | DSML | tool_calls< | DSML | invoke name="read_file"< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
    '继续处理。',
  ].join('\n');
  assert.equal(stripToolCallBlocks(leaked), '准备查看文件。\n继续处理。');
});

test('TOOL-004: fullwidth double-bar DSML tool transcripts are stripped before user-facing display', () => {
  const leaked = [
    '准备查看文件。',
    '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"><｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="list_dir"><｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
    '继续处理。',
  ].join('\n');
  assert.equal(stripToolCallBlocks(leaked), '准备查看文件。\n继续处理。');
});

test('CTRL-001 regression: no-agent raw file tools are not parsed as pending edits after display sanitization', () => {
  const leaked = '[TOOL:create_file {"path":"code/hello.cpp","content":"#include <iostream>\\nint main(){return 0;}\\n"}]';
  const cleaned = stripToolCallBlocks(leaked);
  assert.equal(cleaned, '');
  assert.deepEqual(parseGeneratedArtifacts(cleaned), []);
});

console.log(`\nIntent behavior matrix passed: ${routingCases.length + 8} cases.\n`);
