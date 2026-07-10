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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-tool-loop-terminal-guard.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-loop.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
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
  executeFakeToolsForLoop,
  isAgentWorkToolName,
} = req(bundlePath);

test('ToolLoop work-tool classifier keeps meta tools separate from real work', () => {
  assert.equal(isAgentWorkToolName('manage_todo_list'), false);
  assert.equal(isAgentWorkToolName('task_complete'), false);
  assert.equal(isAgentWorkToolName('memory_write'), false);
  assert.equal(isAgentWorkToolName('read_file'), true);
  assert.equal(isAgentWorkToolName('run_terminal'), true);
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
