/**
 * Unit tests for agent/simple-file-task.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/simple-file-task.bundle.cjs');

execSync(
  `npx esbuild src/agent/simple-file-task.ts --bundle ` +
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
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => {
        const rel = path.relative(folder.uri.fsPath, uri.fsPath);
        return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
      });
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  parseSimpleFileWriteRequest,
  tryRunSimpleFileTask,
} = req(bundlePath);

function makeCallbacks(events) {
  return {
    onDelta: (delta) => events.deltas.push(delta),
    onWorkflowStatus: (status) => events.workflowStatuses.push(status),
    onAgentStatus: (status) => events.statuses.push(status),
    onAppliedChange: (change) => events.applied.push(change),
    onResponseMeta: (text) => events.responseMeta.push(text),
    onTodoUpdate: (items) => events.todos.push(items),
    onToolActivity: (kind, label) => events.activities.push({ kind, label }),
    onBeforeFileWrite: async () => true,
    onValidationCommand: async ({ command, cwd, timeoutMs }) => {
      try {
        const stdout = execSync(command, {
          cwd,
          timeout: timeoutMs,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return {
          ran: true,
          ok: true,
          command,
          exitCode: 0,
          stdout,
          stderr: '',
          output: stdout,
          cwd,
        };
      } catch (error) {
        const stdout = String(error?.stdout ?? '');
        const stderr = String(error?.stderr ?? error?.message ?? error);
        return {
          ran: true,
          ok: false,
          command,
          exitCode: Number.isInteger(error?.status) ? error.status : null,
          stdout,
          stderr,
          output: [stdout, stderr].filter(Boolean).join('\n'),
          cwd,
        };
      }
    },
    onTaskCheckpoint: (completedUpToIndex, remainingTasks) => {
      events.checkpoints.push({ completedUpToIndex, remainingTasks });
    },
  };
}

function makeEvents() {
  return {
    deltas: [],
    workflowStatuses: [],
    statuses: [],
    applied: [],
    responseMeta: [],
    todos: [],
    activities: [],
    checkpoints: [],
  };
}

test('Simple file task: parses explicit markdown create and trims verification clause', () => {
  assert.deepEqual(
    parseSimpleFileWriteRequest('创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。'),
    {
      path: 'docs/manual-phase6-quality.md',
      content: 'phase6 quality gate smoke',
    },
  );
  assert.deepEqual(
    parseSimpleFileWriteRequest('创建 packages/vscode-extension/src/example.ts，内容为：export const x = 1;'),
    {
      path: 'packages/vscode-extension/src/example.ts',
      content: 'export const x = 1;',
    },
  );
  assert.deepEqual(
    parseSimpleFileWriteRequest('创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。'),
    {
      path: 'assets/manual-phase6.unknown',
      content: 'phase6 unknown validation target',
    },
  );
  assert.deepEqual(
    parseSimpleFileWriteRequest([
      'UI-R1A1B-CLEAN2-20260715-4a148c',
      '请在当前工作区创建 ui-r1a1b-clean2-4a148c.txt。',
      '文件内容必须精确包含一行 UI_R1A1B_CLEAN2_OK。',
      '完成写入和读回验证后结束任务，不要修改其他用户文件。',
    ].join(' ')),
    {
      path: 'ui-r1a1b-clean2-4a148c.txt',
      content: 'UI_R1A1B_CLEAN2_OK\n',
    },
  );
  assert.deepEqual(
    parseSimpleFileWriteRequest(
      'INTENT-SIM-SIMPLE-intent-simple-20260715-172137-35d024 请在当前工作区创建文件 intent-simple-20260715-172137-35d024.txt。文件内容必须精确为一行 INTENT_SIM_SIMPLE_OK_intent-simple-20260715-172137-35d024。完成写入后读取该文件验证内容精确匹配，然后结束任务。不要创建目录，不要修改其他用户文件，不要访问网络。',
    ),
    {
      path: 'intent-simple-20260715-172137-35d024.txt',
      content: 'INTENT_SIM_SIMPLE_OK_intent-simple-20260715-172137-35d024\n',
    },
  );
});

test('Simple file task: writes markdown and completes with file-check evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  let validationInput;
  const validationService = {
    validateWorkspaceChanges: async (input) => {
      validationInput = input;
      return {
        ran: true,
        ok: true,
        status: 'passed',
        command: "test -f 'docs/manual-phase6-quality.md' && wc -c 'docs/manual-phase6-quality.md' && sed -n '1,80p' 'docs/manual-phase6-quality.md'",
        exitCode: 0,
        output: '25 docs/manual-phase6-quality.md\nphase6 quality gate smoke',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      };
    },
  };

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。',
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
      options: { validationService },
    });

    const target = path.join(root, 'docs', 'manual-phase6-quality.md');
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, 'utf8'), 'phase6 quality gate smoke');
    assert.equal(result.tasksFailed, 0);
    assert.equal(result.tasksApplied, 1);
    assert.deepEqual(validationInput.changedPaths, ['docs/manual-phase6-quality.md']);
    assert.equal(events.statuses.at(-1).phase, 'done');
    assert.equal(events.statuses.at(-1).state, 'completed');
    assert.equal(events.todos.at(-1).every((todo) => todo.status === 'completed'), true);
    assert.equal(events.activities.some((activity) => activity.kind === 'write'), true);
    assert.equal(events.activities.some((activity) => activity.kind === 'terminal'), true);
    assert.match(events.deltas.at(-1), /^\x00ASUM\x00完成：已创建 `docs\/manual-phase6-quality\.md`。/);
    assert.match(events.deltas.at(-1), /验证：已读回确认文件存在、内容正确、大小正常。/);
    assert.match(events.deltas.at(-1), /结论：任务已完成。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: exact one-line text artifact uses deterministic fast path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-line-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  let validationInput;
  const validationService = {
    validateWorkspaceChanges: async (input) => {
      validationInput = input;
      return {
        ran: true,
        ok: true,
        status: 'passed',
        command: "test -f 'ui-r1a1b-clean2-4a148c.txt' && wc -c 'ui-r1a1b-clean2-4a148c.txt' && sed -n '1,80p' 'ui-r1a1b-clean2-4a148c.txt'",
        exitCode: 0,
        output: '19 ui-r1a1b-clean2-4a148c.txt\nUI_R1A1B_CLEAN2_OK',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      };
    },
  };

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: [
        'UI-R1A1B-CLEAN2-20260715-4a148c',
        '请在当前工作区创建 ui-r1a1b-clean2-4a148c.txt。',
        '文件内容必须精确包含一行 UI_R1A1B_CLEAN2_OK。',
        '完成写入和读回验证后结束任务，不要修改其他用户文件。',
      ].join(' '),
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
      options: { validationService },
    });

    const target = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, 'utf8'), 'UI_R1A1B_CLEAN2_OK\n');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.deepEqual(validationInput.changedPaths, ['ui-r1a1b-clean2-4a148c.txt']);
    assert.equal(events.statuses.at(-1).state, 'completed');
    assert.equal(events.todos.at(-1).length, 2);
    assert.equal(events.todos.at(-1).every((todo) => todo.status === 'completed'), true);
    assert.match(events.deltas.at(-1), /^\x00ASUM\x00完成：已创建 `ui-r1a1b-clean2-4a148c\.txt`。/);
    assert.match(events.deltas.at(-1), /验证：已读回确认文件存在、内容正确、大小正常。/);
    assert.match(events.deltas.at(-1), /结论：任务已完成。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: preserves a concurrent user edit made during the permission callback', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-race-'));
  const target = path.join(root, 'notes.txt');
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  const callbacks = makeCallbacks(events);
  try {
    writeFileSync(target, 'old-content');
    callbacks.onBeforeFileWrite = async () => {
      writeFileSync(target, 'newer-user-content');
      return true;
    };

    const result = await tryRunSimpleFileTask({
      userPrompt: '写 notes.txt，内容为：agent-content',
      workspaceRoot: root,
      callbacks,
      cppValidationPolicy: 'conservative',
    });

    assert.equal(readFileSync(target, 'utf8'), 'newer-user-content');
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.equal(events.applied.length, 0);
    assert.match(result.historyText, /target changed after write authority was captured/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: writes exact TypeScript content and fails QualityGate without repair', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-ts-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  let validationInput;
  const validationService = {
    validateWorkspaceChanges: async (input) => {
      validationInput = input;
      return {
        ran: true,
        ok: false,
        status: 'failed',
        command: 'npx tsc --noEmit --pretty false src/workspace/manual-phase6-quality-gate.ts && npm run compile',
        exitCode: 2,
        output: "src/workspace/manual-phase6-quality-gate.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.",
        cwd: path.join(root, 'packages', 'vscode-extension'),
        mode: 'compile-only',
        reason: 'extension-ts-semantic-check',
        risks: ['自动验证命令失败，不能把 QualityGate 标记为通过。'],
        alternativeChecks: [],
      };
    },
  };

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts，内容为：export const manualPhase6QualityGate: string = 1;',
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
      options: { validationService },
    });

    const target = path.join(root, 'packages', 'vscode-extension', 'src', 'workspace', 'manual-phase6-quality-gate.ts');
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, 'utf8'), 'export const manualPhase6QualityGate: string = 1;');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 1);
    assert.deepEqual(validationInput.changedPaths, ['packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts']);
    assert.equal(events.statuses.at(-1).phase, 'done');
    assert.equal(events.statuses.at(-1).state, 'failed');
    assert.equal(events.todos.at(-1)[0].status, 'completed');
    assert.equal(events.todos.at(-1)[1].status, 'completed');
    assert.equal(events.todos.at(-1)[2].title, '运行自动验证 / QualityGate');
    assert.equal(events.todos.at(-1)[2].status, 'failed');
    assert.equal(events.activities.some((activity) => activity.kind === 'write'), true);
    assert.equal(events.activities.some((activity) => activity.kind === 'terminal'), true);
    assert.match(events.deltas.at(-1), /用户指定了精确文件内容/);
    assert.match(events.deltas.at(-1), /extension-ts-semantic-check/);
    assert.match(result.historyText, /待处理事项/);
    assert.match(result.historyText, /修复自动验证失败后重新运行 QualityGate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: writes explicit unknown text target and completes file-check validation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-unknown-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。',
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
    });

    const target = path.join(root, 'assets', 'manual-phase6.unknown');
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, 'utf8'), 'phase6 unknown validation target');
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.equal(events.statuses.at(-1).phase, 'done');
    assert.equal(events.statuses.at(-1).state, 'completed');
    assert.equal(events.todos.at(-1)[0].status, 'completed');
    assert.equal(events.todos.at(-1)[1].status, 'completed');
    assert.equal(events.activities.some((activity) => activity.kind === 'write'), true);
    assert.equal(events.activities.some((activity) => activity.kind === 'terminal' && /test -f/.test(activity.label)), true);
    assert.equal(
      events.statuses.some((status) => status.phase === 'validate' && status.state === 'completed' && /自动验证通过/.test(status.title)),
      true,
    );
    assert.match(events.deltas.at(-1), /^\x00ASUM\x00完成：已创建 `assets\/manual-phase6\.unknown`。/);
    assert.match(events.deltas.at(-1), /验证：已读回确认文件存在、内容正确、大小正常。/);
    assert.match(events.deltas.at(-1), /结论：任务已完成。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: repairs transport-polluted C++ string newlines before writing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-cpp-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();
  let validationInput;
  const validationService = {
    validateWorkspaceChanges: async (input) => {
      validationInput = input;
      return {
        ran: true,
        ok: true,
        status: 'passed',
        command: 'g++ -fsyntax-only code/main.cpp',
        exitCode: 0,
        output: '',
        cwd: root,
        mode: 'compile-only',
        reason: 'cpp-syntax-check',
        risks: [],
        alternativeChecks: [],
      };
    },
  };

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: [
        '创建 code/main.cpp，内容为：',
        '#include <iostream>',
        'int main() {',
        '  std::cout << "',
        'broken";',
        '}',
      ].join('\n'),
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
      options: { validationService },
    });

    const target = path.join(root, 'code', 'main.cpp');
    assert.equal(existsSync(target), true);
    assert.match(readFileSync(target, 'utf8'), /std::cout << "\\nbroken";/);
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0);
    assert.equal(events.applied.length, 1);
    assert.equal(events.applied[0].normalization.kind, 'source-transport-escape-repair');
    assert.deepEqual(validationInput.changedPaths, ['code/main.cpp']);
    assert.equal(events.statuses.at(-1).phase, 'done');
    assert.equal(events.statuses.at(-1).state, 'completed');
    assert.equal(events.todos.at(-1)[0].status, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Simple file task: blocks unrecoverable C++ content before writing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-simple-file-task-cpp-block-'));
  fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  const events = makeEvents();

  try {
    const result = await tryRunSimpleFileTask({
      userPrompt: [
        '创建 code/main.cpp，内容为：',
        '#include <iostream>',
        'int main() {',
        '  std::cout << "unterminated;',
        '}',
      ].join('\n'),
      workspaceRoot: root,
      callbacks: makeCallbacks(events),
      cppValidationPolicy: 'conservative',
    });

    const target = path.join(root, 'code', 'main.cpp');
    assert.equal(existsSync(target), false);
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.equal(events.applied.length, 0);
    assert.equal(events.statuses.at(-1).phase, 'done');
    assert.equal(events.statuses.at(-1).state, 'failed');
    assert.match(events.statuses.at(-1).title, /源码语法护栏阻止写入/);
    assert.equal(events.todos.at(-1)[0].status, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nSimple file task tests passed.\n');
