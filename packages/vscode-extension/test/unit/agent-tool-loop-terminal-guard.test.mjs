/**
 * Unit tests for terminal execution guards in agent/tool-loop.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-tool-loop-terminal-guard.bundle.cjs');
const readEvidenceBundlePath = path.join(rootDir, 'test/unit/tool-read-evidence.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-loop.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/tool-read-evidence.ts --bundle ` +
  `--outfile=${readEvidenceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeVscode = {
  Uri,
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder() { return undefined; },
  },
  window: {},
  Range: class Range {},
  Position: class Position {},
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  executeFakeToolsForLoop: executeFakeToolsWithoutFixturePolicy,
  isAgentWorkToolName,
} = req(bundlePath);
const {
  collectToolReadEvidence,
  ToolReadEvidenceRecorder,
  withToolReadEvidence,
} = req(readEvidenceBundlePath);

function executeFakeToolsForLoop(tools, callbacks, ...args) {
  return executeFakeToolsWithoutFixturePolicy(
    tools,
    { executionMode: 'edit', ...callbacks },
    ...args,
  );
}

test('ToolLoop work-tool classifier keeps meta tools separate from real work', () => {
  assert.equal(isAgentWorkToolName('manage_todo_list'), false);
  assert.equal(isAgentWorkToolName('task_complete'), false);
  assert.equal(isAgentWorkToolName('memory_write'), false);
  assert.equal(isAgentWorkToolName('read_file'), true);
  assert.equal(isAgentWorkToolName('run_terminal'), true);
});

test('ToolLoop fails closed when an execution policy is missing', async () => {
  let terminalCalled = false;
  const result = await executeFakeToolsWithoutFixturePolicy(
    [{ name: 'run_terminal', input: { command: 'echo must-not-run' } }],
    {
      onTerminalCommand: async () => {
        terminalCalled = true;
        return 'must-not-run';
      },
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );
  assert.equal(terminalCalled, false);
  assert.match(result.feedbackForAI, /tool-kind-denied:terminal/);
});

test('ToolLoop returns feedback for manage_todo_list even when UI todo callback is suppressed', async () => {
  const result = await executeFakeToolsForLoop(
    [
      {
        name: 'manage_todo_list',
        input: {
          todoList: [{ id: 1, title: '编译验证', status: 'in-progress' }],
        },
      },
    ],
    {
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(result.toolCallsMade, true);
  assert.equal(result.workToolCallsMade, false);
  assert.match(result.feedbackForAI, /任务清单已更新/);
});

test('ToolLoop validates required tool parameters before dispatch', async () => {
  let listDirCalled = false;
  let readFileCalled = false;
  const result = await executeFakeToolsForLoop(
    [
      { name: 'list_dir', input: {} },
      { name: 'read_file', input: {} },
    ],
    {
      onListDir: async () => {
        listDirCalled = true;
        return 'should-not-list';
      },
      onReadFile: async () => {
        readFileCalled = true;
        return 'should-not-read';
      },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(listDirCalled, false);
  assert.equal(readFileCalled, false);
  assert.equal(result.toolCallsMade, true);
  assert.equal(result.workToolCallsMade, true);
  assert.match(result.feedbackForAI, /list_dir.*缺少必填参数: path/s);
  assert.match(result.feedbackForAI, /read_file.*缺少必填参数: path/s);
  assert.equal(result.evidenceRefs, undefined);
});

test('ToolLoop records immutable evidence only after a successful read using the resolved path and payload hash', async () => {
  const resolvedPath = '/tmp/project/src/actual.hpp';
  const rawContent = 'constexpr int kValue = 42;\n';
  const success = await executeFakeToolsForLoop(
    [{ name: 'read_file', input: { path: 'actual.hpp' } }],
    {
      onReadFile: async () => [
        '[file_context]',
        'path=actual.hpp',
        `resolvedPath=${resolvedPath}`,
        'source=fs',
        'bytes=27',
        'lines=2',
        'returnedLines=1-2/2',
        'truncated=false',
        'reason=full-file',
        '[/file_context]',
        rawContent,
      ].join('\n'),
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project/src',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );
  assert.equal(success.evidenceRefs?.length, 1);
  assert.equal(success.evidenceRefs?.[0].sourcePath, resolvedPath);
  assert.equal(success.evidenceRefs?.[0].content, rawContent);
  assert.equal(success.evidenceRefs?.[0].contentHash, createHash('sha256').update(rawContent).digest('hex'));
  assert.equal(Object.isFrozen(success.evidenceRefs?.[0]), true);

  const failed = await executeFakeToolsForLoop(
    [{ name: 'read_file', input: { path: 'missing.hpp' } }],
    {
      onReadFile: async () => { throw new Error('missing'); },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project/src',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );
  assert.equal(failed.evidenceRefs, undefined);
});

test('ToolLoop shares one read recorder across rounds and task settlement retains both refs', async () => {
  const recorder = new ToolReadEvidenceRecorder('/tmp/project', 'run-shared');
  const collected = [];
  const callbacks = {
    onReadFile: async () => 'same payload\n',
    onToolActivity: () => {},
    onAgentStatus: async () => {},
  };
  for (let round = 0; round < 2; round++) {
    const result = await executeFakeToolsForLoop(
      [{ name: 'read_file', input: { path: 'same.hpp' } }],
      callbacks,
      '/tmp/project',
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project', readEvidenceRecorder: recorder },
    );
    collectToolReadEvidence(collected, result);
  }
  const taskResult = withToolReadEvidence({ applied: false }, collected);
  assert.deepEqual(taskResult.evidenceRefs?.map(ref => ref.operationId), ['read-1', 'read-2']);
  assert.deepEqual(taskResult.evidenceRefs?.map(ref => ref.captureSequence), [1, 2]);
  assert.notEqual(taskResult.evidenceRefs?.[0].evidenceId, taskResult.evidenceRefs?.[1].evidenceId);
});

test('ToolLoop terminal guard: raw TOOL_CALL protocol text never reaches shell', async () => {
  let terminalCalled = false;
  const activities = [];
  const result = await executeFakeToolsForLoop(
    [
      {
        name: 'run_terminal',
        input: {
          command: '<TOOL_CALL>run_terminal</TOOL_CALL><TOOL_CALL>{"command":"cat /tmp/main.cpp"}</TOOL_CALL>',
        },
      },
    ],
    {
      onTerminalCommand: async () => {
        terminalCalled = true;
        return 'should-not-run';
      },
      onToolActivity: (kind, label) => activities.push({ kind, label }),
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalled, false);
  assert.equal(result.toolCallsMade, true);
  assert.equal(result.workToolCallsMade, true);
  assert.deepEqual(result.terminalCommands ?? [], []);
  assert.match(result.feedbackForAI, /工具协议文本/);
  assert.deepEqual(activities, [{ kind: 'terminal', label: '阻止工具协议文本进入终端' }]);
});

test('ToolLoop terminal guard: raw ReAct Action protocol text never reaches shell', async () => {
  let terminalCalled = false;
  const result = await executeFakeToolsForLoop(
    [
      {
        name: 'run_terminal',
        input: {
          command: 'Action: read_file Action Input: {"path":"/tmp/main.cpp"}',
        },
      },
    ],
    {
      onTerminalCommand: async () => {
        terminalCalled = true;
        return 'should-not-run';
      },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalled, false);
  assert.equal(result.toolCallsMade, true);
  assert.equal(result.workToolCallsMade, true);
  assert.deepEqual(result.terminalCommands ?? [], []);
  assert.match(result.feedbackForAI, /工具协议文本/);
});

test('ToolLoop terminal guard: stale timestamp artifact directories never reach shell', async () => {
  let terminalCalled = false;
  const requestPrompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/tmp/project/out/202607101945',
    '- 代码和测试文件放入：/tmp/project/out/202607101945/src',
  ].join('\n');

  const result = await executeFakeToolsForLoop(
    [
      {
        name: 'run_terminal',
        input: {
          command: 'cd /tmp/project/out/202607101942/src && g++ -std=c++11 main.cpp -o test_app',
        },
      },
    ],
    {
      onTerminalCommand: async () => {
        terminalCalled = true;
        return 'should-not-run';
      },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project', userPrompt: requestPrompt },
  );

  assert.equal(terminalCalled, false);
  assert.equal(result.toolCallsMade, true);
  assert.equal(result.workToolCallsMade, true);
  assert.deepEqual(result.terminalCommands ?? [], []);
  assert.equal(result.toolFailures?.[0]?.tool, 'run_terminal');
  assert.match(result.feedbackForAI, /旧运行目录/);
});

test('ToolLoop terminal guard blocks shell writes to every file class, not only source extensions', async () => {
  let terminalCalls = 0;
  const commands = [
    "printf '%s' report > docs/result.markdown",
    'echo enabled > config/runtime.yaml',
    'echo started >> logs/agent.log',
    'echo terms > LICENSE',
  ];

  const result = await executeFakeToolsForLoop(
    commands.map(command => ({ name: 'run_terminal', input: { command } })),
    {
      onTerminalCommand: async () => {
        terminalCalls += 1;
        return 'should-not-run';
      },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalls, 0);
  assert.deepEqual(result.terminalCommands ?? [], []);
  assert.deepEqual(
    result.toolFailures?.map(failure => failure.path),
    ['docs/result.markdown', 'config/runtime.yaml', 'logs/agent.log', 'LICENSE'],
  );
  assert.ok(result.toolFailures?.every(failure => failure.kind === 'terminal-guard'));
  assert.match(result.feedbackForAI, /docs\/result\.markdown/);
  assert.match(result.feedbackForAI, /config\/runtime\.yaml/);
  assert.match(result.feedbackForAI, /logs\/agent\.log/);
  assert.match(result.feedbackForAI, /LICENSE/);
});

test('ToolLoop terminal guard fail-closes destructive, mutating, and unclassified write-capable commands', async () => {
  let terminalCalls = 0;
  const commands = [
    'dd if=input.bin of=output.bin bs=1',
    'patch -p0 < changes.diff',
    'git apply changes.patch',
  ];
  const result = await executeFakeToolsForLoop(
    commands.map(command => ({ name: 'run_terminal', input: { command } })),
    {
      onTerminalCommand: async () => { terminalCalls += 1; return 'should-not-run'; },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalls, 0);
  assert.deepEqual(result.terminalCommands ?? [], []);
  assert.equal(result.toolFailures?.length, 3);
  assert.match(result.toolFailures?.[0].reason || '', /destructive-command/);
  assert.match(result.toolFailures?.[1].reason || '', /unclassified-command/);
  assert.match(result.toolFailures?.[2].reason || '', /mutating-command/);
  assert.match(result.feedbackForAI, /仅允许只读查询和已分类验证命令/);
});

test('ToolLoop terminal guard allows workspace-local C++ compile-run validation', async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'devseek-tool-loop-cpp-run-'));
  try {
    writeFileSync(path.join(projectRoot, 'main.cpp'), '#include <iostream>\nint main(){std::cout<<"ok\\n";}\n');
    const executable = path.join(projectRoot, 'hello');
    writeFileSync(executable, '#!/bin/sh\necho ok\n', { mode: 0o755 });
    let terminalCalls = 0;
    const command = `cd ${projectRoot} && g++ main.cpp -o hello && ./hello`;

    const result = await executeFakeToolsForLoop(
      [{ name: 'run_terminal', input: { command } }],
      {
        onTerminalCommand: async () => {
          terminalCalls += 1;
          return '[终端命令] ' + command + '\n[退出码] 0\n[stdout]\nok\n';
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      projectRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: projectRoot },
    );

    assert.equal(terminalCalls, 1);
    assert.equal(result.toolFailures?.length ?? 0, 0);
    assert.deepEqual(result.terminalCommands, [command]);
    assert.equal(result.terminalEvidence?.[0]?.kind, 'compile-run');
    assert.equal(result.terminalEvidence?.[0]?.ok, true);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('ToolLoop records terminal raw output as immutable EvidenceRef before settlement', async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'devseek-tool-loop-terminal-evidence-'));
  try {
    const command = 'test -f marker.txt';
    const output = '[终端命令] test -f marker.txt\n[退出码] 1\n[stderr]\nmissing marker\n';

    const result = await executeFakeToolsForLoop(
      [{ name: 'run_terminal', input: { command } }],
      {
        onTerminalCommand: async () => output,
        onToolActivity: () => {},
        onAgentStatus: async () => {},
        traceRunId: 'terminal-evidence-run',
      },
      projectRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: projectRoot },
    );

    const terminalRef = result.evidenceRefs?.find(ref => ref.kind === 'terminal');
    assert.equal(result.terminalEvidence?.[0]?.ok, false);
    assert.equal(terminalRef?.command, command);
    assert.equal(terminalRef?.sourcePath, projectRoot);
    assert.equal(terminalRef?.workdir, projectRoot);
    assert.equal(terminalRef?.exitCode, 1);
    assert.equal(terminalRef?.content, output);
    assert.equal(terminalRef?.contentHash, createHash('sha256').update(output).digest('hex'));
    assert.equal(Object.isFrozen(terminalRef), true);
    assert.match(terminalRef?.evidenceId || '', /^ev-/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('ToolLoop terminal guard never dispatches read-only allowlist commands with hidden writes', async () => {
  let terminalCalls = 0;
  const commands = [
    'sed -n "w out.txt" input.txt',
    'git diff --output=out.patch',
    'find . -fprint out.txt',
    "find . -fprintf out.txt '%p\\n'",
    'find . -fls out.txt',
    String.raw`find . -execdir touch marker.txt \;`,
    'sort input.txt -o out.txt',
    'sort --output=out.txt input.txt',
    `awk '{print > "out.txt"}' input.txt`,
    `awk '{print>"out.txt"}' input.txt`,
    'echo x>out.txt',
  ];
  const result = await executeFakeToolsForLoop(
    commands.map(command => ({ name: 'run_terminal', input: { command } })),
    {
      onTerminalCommand: async () => { terminalCalls += 1; return 'should-not-run'; },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalls, 0, 'no hidden-write command may reach the host terminal callback');
  assert.equal(result.toolFailures?.length, commands.length);
  assert.ok(result.toolFailures?.every(failure => failure.kind === 'terminal-guard'));
  assert.deepEqual(result.terminalCommands ?? [], []);
});

test('ToolLoop terminal guard blocks branch mutations, awk command pipes, and writing validation flags', async () => {
  let terminalCalls = 0;
  const commands = [
    'git branch feature/new',
    'git branch -D feature/old',
    'git branch -m old new',
    'git branch --set-upstream-to=origin/main feature/current',
    `awk 'BEGIN { "touch marker.txt" | getline }'`,
    `awk 'BEGIN { "touch marker.txt"|getline }'`,
    'npx eslint . --fix',
    'npx jest -u',
    'npx jest --updateSnapshot',
    'npm run lint -- --fix',
    'npm test -- -u',
    'npx tsc',
    'tsc',
    'npx tsc --noEmit=false',
    'npx tsc --noEmit --incremental',
  ];
  const result = await executeFakeToolsForLoop(
    commands.map(command => ({ name: 'run_terminal', input: { command } })),
    {
      onTerminalCommand: async () => { terminalCalls += 1; return 'should-not-run'; },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.equal(terminalCalls, 0, 'write-capable branch/awk/validation commands must never reach the host');
  assert.equal(result.toolFailures?.length, commands.length);
  assert.ok(result.toolFailures?.every(failure => failure.kind === 'terminal-guard'));
  assert.deepEqual(result.terminalCommands ?? [], []);
});

test('ToolLoop terminal guard still allows classified inspection and validation commands', async () => {
  const terminalCommands = [];
  const result = await executeFakeToolsForLoop(
    [
      { name: 'run_terminal', input: { command: 'cat package.json' } },
      { name: 'run_terminal', input: { command: 'rg -n TODO src' } },
      { name: 'run_terminal', input: { command: 'git diff -- src/app.ts' } },
      { name: 'run_terminal', input: { command: 'git branch --show-current' } },
      { name: 'run_terminal', input: { command: 'npx eslint . --fix-dry-run' } },
      { name: 'run_terminal', input: { command: 'npx tsc --noEmit' } },
      { name: 'run_terminal', input: { command: 'npm test' } },
    ],
    {
      onTerminalCommand: async command => { terminalCommands.push(command); return 'ok'; },
      onToolActivity: () => {},
      onAgentStatus: async () => {},
    },
    '/tmp/project',
    { currentTaskIndex: 1, taskTotal: 1, workspaceRoot: '/tmp/project' },
  );

  assert.deepEqual(terminalCommands, [
    'cat package.json',
    'rg -n TODO src',
    'git diff -- src/app.ts',
    'git branch --show-current',
    'npx eslint . --fix-dry-run',
    'npx tsc --noEmit',
    'npm test',
  ]);
  assert.equal(result.toolFailures, undefined);
});

test('ToolLoop create_directory consults the file-write policy before invoking the host mkdir', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-create-directory-policy-'));
  try {
    const requestPrompt = '不要创建任何文件或目录。';
    let hostMkdirCalls = 0;
    const policyCalls = [];
    const result = await executeFakeToolsForLoop(
      [{ name: 'create_directory', input: { path: 'generated/docs' } }],
      {
        onBeforeFileWrite: async (absPath, context) => {
          policyCalls.push({ absPath, context });
          return false;
        },
        onCreateDirectory: async () => {
          hostMkdirCalls += 1;
          return 'should-not-create';
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot, userPrompt: requestPrompt },
    );

    assert.equal(hostMkdirCalls, 0);
    assert.deepEqual(policyCalls, [{
      absPath: path.join(workspaceRoot, 'generated/docs'),
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'create_directory',
        displayName: 'generated/docs',
        requestPrompt,
      },
    }]);
    assert.equal(result.writtenFiles, undefined);
    assert.equal(result.toolFailures?.[0]?.tool, 'create_directory');
    assert.equal(result.toolFailures?.[0]?.kind, 'write');
    assert.match(result.toolFailures?.[0]?.reason ?? '', /写入权限策略阻止/);
    assert.match(result.feedbackForAI, /create_directory: generated\/docs.*写入权限策略阻止/s);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop file-write policy denials are structured tool failures', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-file-write-policy-failure-'));
  try {
    const result = await executeFakeToolsForLoop(
      [{
        name: 'create_file',
        input: {
          path: 'probe.js',
          content: 'console.log("blocked");\n',
        },
      }],
      {
        onBeforeFileWrite: async () => false,
        onAppliedChange: async () => {},
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot, userPrompt: '请创建 probe.js。' },
    );

    assert.equal(result.writtenFiles, undefined);
    assert.equal(result.toolFailures?.[0]?.tool, 'create_file');
    assert.equal(result.toolFailures?.[0]?.kind, 'write');
    assert.equal(result.toolFailures?.[0]?.path, 'probe.js');
    assert.match(result.toolFailures?.[0]?.reason ?? '', /写入权限策略阻止/);
    assert.match(result.feedbackForAI, /create_file: probe\.js.*写入权限策略阻止/s);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop create_directory gives policy and host the same resolved absolute path', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-create-directory-resolution-'));
  const defaultWorkdir = path.join(workspaceRoot, 'task');
  mkdirSync(defaultWorkdir, { recursive: true });
  try {
    const policyPaths = [];
    const hostPaths = [];
    await executeFakeToolsForLoop(
      [{ name: 'create_directory', input: { path: 'generated/docs' } }],
      {
        onBeforeFileWrite: async absPath => { policyPaths.push(absPath); return true; },
        onCreateDirectory: async absPath => { hostPaths.push(absPath); return 'created'; },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      defaultWorkdir,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    const expected = path.join(defaultWorkdir, 'generated/docs');
    assert.deepEqual(policyPaths, [expected]);
    assert.deepEqual(hostPaths, [expected]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop delete_file leaves the file intact when the file-write policy rejects deletion', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-delete-file-policy-'));
  try {
    const filePath = path.join(workspaceRoot, 'notes.txt');
    const originalContent = 'keep this file\n';
    const requestPrompt = '不要删除 notes.txt。';
    writeFileSync(filePath, originalContent, 'utf8');
    let appliedChanges = 0;
    const policyCalls = [];
    const result = await executeFakeToolsForLoop(
      [{ name: 'delete_file', input: { path: 'notes.txt' } }],
      {
        onBeforeFileWrite: async (absPath, context) => {
          policyCalls.push({ absPath, context });
          return false;
        },
        onAppliedChange: async () => {
          appliedChanges += 1;
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot, userPrompt: requestPrompt },
    );

    assert.equal(appliedChanges, 0);
    assert.equal(readFileSync(filePath, 'utf8'), originalContent);
    assert.deepEqual(policyCalls, [{
      absPath: filePath,
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'delete_file',
        displayName: 'notes.txt',
        requestPrompt,
      },
    }]);
    assert.equal(result.writtenFiles, undefined);
    assert.match(result.feedbackForAI, /delete_file: notes\.txt.*写入权限策略阻止/s);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop replace_in_file edits existing workspace file with write evidence', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-replace-tool-'));
  try {
    const srcDir = path.join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'worker.cpp');
    writeFileSync(filePath, 'int threshold = 7000;\nint keep = 1;\n', 'utf8');
    const applied = [];
    const result = await executeFakeToolsForLoop(
      [
        {
          name: 'replace_in_file',
          input: {
            path: 'src/worker.cpp',
            old_str: 'int threshold = 7000;',
            new_str: 'int threshold = 6800;',
          },
        },
      ],
      {
        onAppliedChange: async (change) => {
          applied.push(change);
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    assert.equal(result.toolCallsMade, true);
    assert.equal(result.workToolCallsMade, true);
    assert.equal(readFileSync(filePath, 'utf8'), 'int threshold = 6800;\nint keep = 1;\n');
    assert.equal(applied.length, 1);
    assert.equal(result.writtenFiles?.[0].path, filePath);
    assert.equal(result.readFiles?.[0], filePath);
    assert.match(result.feedbackForAI, /replace_in_file: src\/worker\.cpp.*已写入/s);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop replace_in_file fails clearly when old_str is stale', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-replace-stale-'));
  try {
    const srcDir = path.join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'worker.cpp');
    writeFileSync(filePath, 'int threshold = 7000;\n', 'utf8');
    let applied = false;
    const result = await executeFakeToolsForLoop(
      [
        {
          name: 'replace_in_file',
          input: {
            path: 'src/worker.cpp',
            old_str: 'int threshold = 9000;',
            new_str: 'int threshold = 6800;',
          },
        },
      ],
      {
        onAppliedChange: async () => {
          applied = true;
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    assert.equal(applied, false);
    assert.equal(readFileSync(filePath, 'utf8'), 'int threshold = 7000;\n');
    assert.equal(result.writtenFiles, undefined);
    assert.equal(result.toolFailures?.[0]?.tool, 'replace_in_file');
    assert.equal(result.toolFailures?.[0]?.kind, 'replace');
    assert.match(result.feedbackForAI, /old_str 未在当前文件中找到/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop replace_in_file treats identical replacement as structured no-op failure', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-replace-noop-'));
  try {
    const srcDir = path.join(workspaceRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'worker.cpp');
    writeFileSync(filePath, 'int threshold = 7000;\n', 'utf8');
    let applied = false;
    const result = await executeFakeToolsForLoop(
      [
        {
          name: 'replace_in_file',
          input: {
            path: 'src/worker.cpp',
            old_str: 'int threshold = 7000;',
            new_str: 'int threshold = 7000;',
          },
        },
      ],
      {
        onAppliedChange: async () => {
          applied = true;
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    assert.equal(applied, false);
    assert.equal(result.writtenFiles, undefined);
    assert.equal(result.toolFailures?.[0]?.tool, 'replace_in_file');
    assert.equal(result.toolFailures?.[0]?.kind, 'replace');
    assert.match(result.feedbackForAI, /old_str 与 new_str 完全相同/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop records blocking source sanity failures as structured tool failures', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-source-sanity-failure-'));
  try {
    const result = await executeFakeToolsForLoop(
      [
        {
          name: 'create_file',
          input: {
            path: 'src/broken.cpp',
            content: 'int main() { const char* s = "unterminated; }\n',
          },
        },
      ],
      {
        onAppliedChange: async () => {},
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    assert.equal(result.writtenFiles, undefined);
    assert.equal(result.toolFailures?.[0]?.tool, 'create_file');
    assert.equal(result.toolFailures?.[0]?.kind, 'write');
    assert.match(result.toolFailures?.[0]?.reason ?? '', /源码语法护栏/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ToolLoop repairs C++ string newline transport pollution before writing source files', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-source-transport-repair-'));
  try {
    const filePath = path.join(workspaceRoot, 'src', 'main.cpp');
    const applied = [];
    const result = await executeFakeToolsForLoop(
      [
        {
          name: 'create_file',
          input: {
            path: 'src/main.cpp',
            content: [
              '#include <cstdio>',
              'int main() {',
              '  printf("ready',
              '");',
              '}',
            ].join('\n'),
          },
        },
      ],
      {
        onAppliedChange: async (change) => {
          applied.push(change);
        },
        onToolActivity: () => {},
        onAgentStatus: async () => {},
      },
      workspaceRoot,
      { currentTaskIndex: 1, taskTotal: 1, workspaceRoot },
    );

    assert.equal(result.toolCallsMade, true);
    assert.equal(result.workToolCallsMade, true);
    assert.equal(applied.length, 1);
    assert.equal(result.writtenFiles?.[0].path, filePath);
    assert.match(readFileSync(filePath, 'utf8'), /printf\("ready\\n"\);/);
    assert.match(result.feedbackForAI, /源码工具协议转义污染/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

console.log('\nAgent tool-loop terminal guard tests passed.\n');
