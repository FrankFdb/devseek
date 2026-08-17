/**
 * Unit tests for agent session continuation context.
 *
 * Claude Code/Codex-style contract: same-session follow-up edits inherit the
 * previous real working set, and accidental root-level basename files must not
 * outrank deeper project files with the same basename.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-session-context.bundle.cjs');
const projectorBundlePath = path.join(rootDir, 'test/unit/session-continuation-projector.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-session-context.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/session-continuation-projector.ts --bundle ` +
  `--outfile=${projectorBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const fakeVscode = {};
const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  buildAgenticSessionContextFromState,
  projectSessionContinuationFromState,
  resolveSessionContinuationFilesFromState,
} = req(bundlePath);
const { SessionContinuationProjector } = req(projectorBundlePath);

test('Agent session context: edit follow-up restores deeper project file ahead of root basename drift', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-context-'));
  try {
    const projectDir = path.join(root, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    const rootMain = path.join(root, 'main.cpp');
    const projectMain = path.join(projectDir, 'main.cpp');
    writeFileSync(rootMain, 'int main() { return 99; }\n');
    writeFileSync(projectMain, 'int main() { return 0; }\n');

    const files = resolveSessionContinuationFilesFromState({
      workspaceRoot: root,
      prompt: '可以通过鼠标动作，天空背景也添加了，天空背景能用夜晚色吗，同时所有图形能同时显示吗',
      intent: { mode: 'edit', signals: [] },
      state: {
        lastUserPrompt: '上一轮错误地写到了根目录 main.cpp',
        lastSummary: '自动验证失败。',
        changedPaths: ['main.cpp'],
        completed: false,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['main.cpp'],
      recentFilePaths: [projectMain],
    });

    assert.equal(files[0], projectMain);
    assert.ok(files.includes(rootMain));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session context: independent new edit request does not restore stale files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-context-new-'));
  try {
    const projectDir = path.join(root, 'code', 'shape_manager');
    mkdirSync(projectDir, { recursive: true });
    const projectMain = path.join(projectDir, 'main.cpp');
    writeFileSync(projectMain, 'int main() { return 0; }\n');

    const files = resolveSessionContinuationFilesFromState({
      workspaceRoot: root,
      prompt: '创建一个新的 Python 程序，打印 hello',
      intent: { mode: 'edit', signals: [] },
      state: {
        lastUserPrompt: '上一轮编辑 3D 图形程序',
        lastSummary: '已完成。',
        changedPaths: ['code/shape_manager/main.cpp'],
        completed: true,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['code/shape_manager/main.cpp'],
      recentFilePaths: [projectMain],
    });

    assert.deepEqual(files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session context: build artifact paths are not restored as source working files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-context-build-'));
  try {
    const projectDir = path.join(root, 'code', 'shape_manager');
    const buildBinDir = path.join(projectDir, 'build', 'bin');
    mkdirSync(buildBinDir, { recursive: true });
    const projectMain = path.join(projectDir, 'main.cpp');
    const artifactHeader = path.join(buildBinDir, 'Cylinder.h');
    writeFileSync(projectMain, 'int main() { return 0; }\n');
    writeFileSync(artifactHeader, '#pragma once\n');

    const files = resolveSessionContinuationFilesFromState({
      workspaceRoot: root,
      prompt: '请编译，执行，如果有编译错误，请修正',
      intent: { mode: 'run', signals: ['run-request', 'conditional-repair-on-failure'] },
      state: {
        lastUserPrompt: '上一轮错误地把 Cylinder.h 写到了 build/bin',
        lastSummary: '已修改 code/shape_manager/build/bin/Cylinder.h 和 code/shape_manager/main.cpp。',
        changedPaths: ['code/shape_manager/build/bin/Cylinder.h', 'code/shape_manager/main.cpp'],
        completed: false,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['code/shape_manager/build/bin/Cylinder.h'],
      recentFilePaths: [artifactHeader, projectMain],
    });

    assert.equal(files.includes(artifactHeader), false);
    assert.equal(files[0], projectMain);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session context: filters restored history to the active project', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-context-filter-'));
  try {
    const shapeDir = path.join(root, 'code', 'shape_manager');
    const jokeDir = path.join(root, 'code', 'joke_program');
    mkdirSync(shapeDir, { recursive: true });
    mkdirSync(jokeDir, { recursive: true });
    const shapeMain = path.join(shapeDir, 'main.cpp');
    const jokeMain = path.join(jokeDir, 'main.cpp');
    writeFileSync(shapeMain, 'int main() { return 0; }\n');
    writeFileSync(jokeMain, 'int main() { return 1; }\n');

    const context = buildAgenticSessionContextFromState({
      workspaceRoot: root,
      currentPrompt: '通过鼠标点击选择三维图形',
      state: {
        lastUserPrompt: '通过数字选择 shape_manager 三维图形',
        lastSummary: '已修改 code/shape_manager/main.cpp。',
        changedPaths: ['code/shape_manager/main.cpp'],
        completed: false,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['code/shape_manager/main.cpp'],
      recentFilePaths: [shapeMain, jokeMain],
      history: [
        { role: 'user', content: '给 joke_program 添加一个笑话' },
        { role: 'assistant', content: '已修改 code/joke_program/main.cpp。' },
        { role: 'user', content: '通过数字选择 shape_manager 三维图形' },
        { role: 'assistant', content: '已修改 code/shape_manager/main.cpp。' },
      ],
    });

    assert.match(context, /shape_manager/);
    assert.doesNotMatch(context, /joke_program/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session projection: independent new work cannot inherit stale task context', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-projection-new-'));
  try {
    const legacyPath = path.join(root, 'src', 'legacy.ts');
    mkdirSync(path.dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, 'export const legacy = true;\n');

    const projection = projectSessionContinuationFromState({
      workspaceRoot: root,
      currentPrompt: '创建一个新的 Python 程序，打印 hello',
      newSession: false,
      intent: { mode: 'edit', signals: [] },
      state: {
        lastUserPrompt: '修复旧的 TypeScript 服务',
        lastSummary: '已修改 src/legacy.ts。',
        changedPaths: ['src/legacy.ts'],
        completed: true,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['src/legacy.ts'],
      recentFilePaths: [legacyPath],
      history: [
        { role: 'user', content: '修复旧的 TypeScript 服务' },
        { role: 'assistant', content: '已修改 src/legacy.ts。' },
      ],
    });

    assert.deepEqual(projection, { mode: 'none', restoreFiles: [], contextText: '' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session projection: explicit return preserves prior context when the new constraint uses different words', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-return-'));
  try {
    const storePath = path.join(root, 'src', 'task-store.js');
    const servicePath = path.join(root, 'src', 'task-service.js');
    mkdirSync(path.dirname(storePath), { recursive: true });
    writeFileSync(storePath, 'module.exports = { TaskStore: class TaskStore {} };\n');
    writeFileSync(servicePath, 'module.exports = { TaskService: class TaskService {} };\n');

    const projection = projectSessionContinuationFromState({
      workspaceRoot: root,
      currentPrompt: '回到刚才那个主任务，第二断补可注入输出和汇总，旧 API 保留。',
      newSession: false,
      intent: { mode: 'edit', signals: [] },
      state: {
        lastUserPrompt: '实现任务板核心，标记 SESSION_PRIMARY_TASK_BOARD_20260817。',
        lastSummary: '核心 store 和 service 已实现并通过测试。',
        changedPaths: ['src/task-store.js', 'src/task-service.js'],
        completed: true,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['src/task-store.js', 'src/task-service.js'],
      recentFilePaths: [storePath, servicePath],
      history: [
        { role: 'user', content: '实现任务板核心，标记 SESSION_PRIMARY_TASK_BOARD_20260817。' },
        { role: 'assistant', content: '核心 store 和 service 已实现并通过测试。' },
      ],
    });

    assert.equal(projection.mode, 'context-and-files');
    assert.deepEqual(projection.restoreFiles, [servicePath, storePath]);
    assert.match(projection.contextText, /SESSION_PRIMARY_TASK_BOARD_20260817/);
    assert.match(projection.contextText, /src\/task-service\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session projection: run follow-up restores files without stale task prose', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-projection-run-'));
  try {
    const servicePath = path.join(root, 'src', 'service.ts');
    mkdirSync(path.dirname(servicePath), { recursive: true });
    writeFileSync(servicePath, 'export const value = 1;\n');

    const projection = projectSessionContinuationFromState({
      workspaceRoot: root,
      currentPrompt: '请执行，给出执行结果',
      newSession: false,
      intent: { mode: 'run', signals: ['run-request', 'follow-up-run-request'] },
      state: {
        lastUserPrompt: '实现 src/service.ts',
        lastSummary: '文件已写入，尚未运行。',
        changedPaths: ['src/service.ts'],
        completed: false,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['src/service.ts'],
      recentFilePaths: [servicePath],
      history: [{ role: 'assistant', content: '文件已写入，尚未运行。' }],
    });

    assert.equal(projection.mode, 'files-only');
    assert.deepEqual(projection.restoreFiles, [servicePath]);
    assert.equal(projection.contextText, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session projection: explicit current files suppress restore and focus context', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agent-session-projection-focus-'));
  try {
    const shapeMain = path.join(root, 'code', 'shape_manager', 'main.cpp');
    const jokeMain = path.join(root, 'code', 'joke_program', 'main.cpp');
    mkdirSync(path.dirname(shapeMain), { recursive: true });
    mkdirSync(path.dirname(jokeMain), { recursive: true });
    writeFileSync(shapeMain, 'int main() { return 0; }\n');
    writeFileSync(jokeMain, 'int main() { return 1; }\n');

    const projection = projectSessionContinuationFromState({
      workspaceRoot: root,
      currentPrompt: '继续修改 code/joke_program/main.cpp',
      currentFilePaths: [jokeMain],
      newSession: false,
      intent: { mode: 'edit', signals: ['explicit-file-path'] },
      state: {
        lastUserPrompt: '修改 shape_manager',
        lastSummary: '已修改 code/shape_manager/main.cpp。',
        changedPaths: ['code/shape_manager/main.cpp'],
        completed: true,
        savedAt: Date.now(),
      },
      lastAgentChangedPaths: ['code/shape_manager/main.cpp'],
      recentFilePaths: [shapeMain, jokeMain],
      history: [
        { role: 'assistant', content: '已修改 code/shape_manager/main.cpp。' },
        { role: 'assistant', content: '之前也检查过 code/joke_program/main.cpp。' },
      ],
    });

    assert.equal(projection.mode, 'context-only');
    assert.deepEqual(projection.restoreFiles, []);
    assert.match(projection.contextText, /joke_program/);
    assert.doesNotMatch(projection.contextText, /shape_manager/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent session projection: a new session is an absolute isolation boundary', () => {
  const projection = projectSessionContinuationFromState({
    workspaceRoot: '/workspace',
    currentPrompt: '继续优化',
    newSession: true,
    intent: { mode: 'edit', signals: [] },
    state: {
      lastUserPrompt: '旧任务',
      lastSummary: '旧摘要',
      changedPaths: ['src/old.ts'],
      completed: false,
      savedAt: Date.now(),
    },
    lastAgentChangedPaths: ['src/old.ts'],
    recentFilePaths: ['/workspace/src/old.ts'],
    history: [{ role: 'assistant', content: '旧任务上下文' }],
  });

  assert.deepEqual(projection, { mode: 'none', restoreFiles: [], contextText: '' });
});

test('SessionContinuationProjector: removes restored summary primers before domain projection', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-session-projector-primer-'));
  try {
    const servicePath = path.join(root, 'src', 'service.ts');
    mkdirSync(path.dirname(servicePath), { recursive: true });
    writeFileSync(servicePath, 'export const value = 1;\n');
    const projector = new SessionContinuationProjector({
      getAgentState: () => ({
        lastUserPrompt: '实现 src/service.ts',
        lastSummary: '已修改 src/service.ts。',
        changedPaths: ['src/service.ts'],
        completed: true,
        savedAt: Date.now(),
      }),
      getLastAgentChangedPaths: () => ['src/service.ts'],
      getRecentFilePaths: () => [servicePath],
      getHistory: () => [
        { role: 'user', content: '[上次会话背景，请基于此继续工作]\n已修改 src/service.ts。' },
        { role: 'assistant', content: '好的，我已了解上次的工作进展，可以继续。' },
        { role: 'user', content: '实现 src/service.ts' },
        { role: 'assistant', content: '已修改 src/service.ts。' },
      ],
    });

    const projection = projector.project({
      workspaceRoot: root,
      currentPrompt: '继续优化',
      intent: { mode: 'edit', signals: [] },
      newSession: false,
    });

    assert.equal(projection.mode, 'context-and-files');
    assert.doesNotMatch(projection.contextText, /\[上次会话背景/);
    assert.doesNotMatch(projection.contextText, /好的，我已了解上次的工作进展/);
    assert.match(projection.contextText, /src\/service\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nAgent session context tests passed.\n');
