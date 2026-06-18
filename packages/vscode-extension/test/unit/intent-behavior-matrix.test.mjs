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
    id: 'READ-001',
    title: 'explicit no-change inspection stays non-agent',
    prompt: '不要修改，只分析这个文件',
    files: ['/tmp/main.ts'],
    expect: { kind: 'chat', mode: 'inspect', workflow: 'plain-chat', useAgent: false, tools: ['read', 'search', 'diagnostics'] },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'READ-002',
    title: 'file inspection uses read-only agent',
    prompt: '解释这段代码',
    files: ['/tmp/main.ts'],
    expect: { kind: 'chat', mode: 'inspect', workflow: 'inspect-agent', useAgent: true, tools: ['read', 'search', 'diagnostics'] },
    toolActions: { read: 'allow', search: 'allow', diagnostics: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'PLAN-001',
    title: 'project architecture plan uses plan agent when context exists',
    prompt: '给出这个项目的重构方案',
    files: ['/tmp/src/index.ts'],
    expect: { kind: 'chat', mode: 'plan', workflow: 'plan-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'plan'] },
    toolActions: { read: 'allow', plan: 'allow', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'PLAN-002',
    title: 'no-change planning request becomes read-only inspection',
    prompt: '给出这个项目的重构方案，先不要修改代码',
    files: ['/tmp/src/index.ts'],
    expect: { kind: 'chat', mode: 'inspect', workflow: 'plain-chat', useAgent: false, tools: ['read', 'search', 'diagnostics'] },
    blocker: 'explicit-no-change',
    toolActions: { read: 'allow', plan: 'deny', edit: 'deny', terminal: 'deny' },
  },
  {
    id: 'EDIT-001',
    title: 'create and run C++ hello world is edit workflow',
    prompt: '创建一个 hello world C++ 程序并运行',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'plan', 'edit', 'terminal'] },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-002',
    title: 'write C++ hello program is edit workflow',
    prompt: '编写一个 C++ 程序，打印 hello',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'plan', 'edit', 'terminal'] },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'EDIT-003',
    title: 'fix compile error prefers edit over run',
    prompt: '修复 main.cpp 编译错误',
    expect: { kind: 'code-change', mode: 'edit', workflow: 'edit-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'plan', 'edit', 'terminal'] },
    toolActions: { read: 'allow', edit: 'allow', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-001',
    title: 'run tests is terminal-confirmed run workflow',
    prompt: '运行测试',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'terminal'] },
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-002',
    title: 'compile explicit file is terminal-confirmed run workflow',
    prompt: '编译 code/hello.cpp',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'terminal'] },
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-003',
    title: 'execution-result follow-up is terminal-confirmed run workflow',
    prompt: '能执行，看到执行结果吗',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'terminal'] },
    signal: 'follow-up-run-request',
    toolActions: { read: 'allow', edit: 'deny', terminal: 'requireConfirm' },
  },
  {
    id: 'RUN-004',
    title: 'direct Chinese execute-result request is a follow-up run workflow',
    prompt: '请执行，给出执行结果',
    expect: { kind: 'code-change', mode: 'run', workflow: 'run-agent', useAgent: true, tools: ['read', 'search', 'diagnostics', 'terminal'] },
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
    title: 'forceNoAgent disables agent but keeps edit permissions',
    prompt: '修改 main.cpp',
    forceNoAgent: true,
    expect: { kind: 'code-change', mode: 'edit', workflow: 'plain-chat', useAgent: false, tools: ['read', 'search', 'diagnostics', 'plan', 'edit', 'terminal'] },
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

test('CTRL-001 regression: no-agent raw file tools are not parsed as pending edits after display sanitization', () => {
  const leaked = '[TOOL:create_file {"path":"code/hello.cpp","content":"#include <iostream>\\nint main(){return 0;}\\n"}]';
  const cleaned = stripToolCallBlocks(leaked);
  assert.equal(cleaned, '');
  assert.deepEqual(parseGeneratedArtifacts(cleaned), []);
});

console.log(`\nIntent behavior matrix passed: ${routingCases.length + 6} cases.\n`);
