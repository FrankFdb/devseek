/**
 * Unit tests for terminal execution guards in agent/tool-loop.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
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

console.log('\nAgent tool-loop terminal guard tests passed.\n');
