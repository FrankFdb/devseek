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

execSync(
  `npx esbuild src/app/agent-session-context.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
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
  resolveSessionContinuationFilesFromState,
} = req(bundlePath);

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

console.log('\nAgent session context tests passed.\n');
