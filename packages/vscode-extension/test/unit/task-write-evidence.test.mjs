/**
 * Regression coverage for assigning tool-write evidence to the current agent task.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-write-evidence.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-write-evidence.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { selectTaskWriteEvidence } = req(bundlePath);

test('task write evidence: exact task file write completes the matching task', () => {
  const workspaceRoot = '/workspace';
  const task = {
    action: 'modify',
    file: 'code/shape_manager/Circle.cpp',
    absPath: '/workspace/code/shape_manager/Circle.cpp',
    desc: '将 draw() 改为使用 XDrawArc 绘制圆形边框',
  };
  const circleWrite = write('/workspace/code/shape_manager/Circle.cpp');
  const agentsWrite = write('/workspace/code/shape_manager/AGENTS.md');

  assert.equal(
    selectTaskWriteEvidence(task, [agentsWrite, circleWrite], workspaceRoot),
    circleWrite,
  );
});

test('task write evidence: unrelated instruction file cannot satisfy source edit task', () => {
  const task = {
    action: 'modify',
    file: 'Circle.cpp',
    absPath: '/workspace/code/shape_manager/Circle.cpp',
    desc: '将 draw() 改为使用 XDrawArc 绘制圆形边框',
  };

  assert.equal(
    selectTaskWriteEvidence(task, [write('/workspace/code/shape_manager/AGENTS.md')], '/workspace'),
    undefined,
  );
});

test('task write evidence: basename fallback supports planner tasks without abs path', () => {
  const task = {
    action: 'modify',
    file: 'Triangle.cpp',
    desc: '将 draw() 改为使用 XDrawLines 绘制三角形边框',
  };
  const triangleWrite = write('/workspace/code/shape_manager/Triangle.cpp');

  assert.equal(
    selectTaskWriteEvidence(task, [triangleWrite], '/workspace'),
    triangleWrite,
  );
});

function write(filePath) {
  return {
    path: filePath,
    basename: path.basename(filePath),
    linesAdded: 10,
    linesRemoved: 8,
    action: 'modify',
  };
}
