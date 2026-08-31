import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-failure-checkpoint.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-failure-checkpoint.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { buildAgenticFailureCheckpointTask } = createRequire(import.meta.url)(bundlePath);

test('failed coding work becomes one durable continuation task with concrete validation evidence', () => {
  const task = buildAgenticFailureCheckpointTask({
    userPrompt: '修复现有 X11 程序，不要重建项目。',
    failureReason: 'XImage 初始化仍失败。',
    writtenFiles: [{
      path: 'src/x11_app.cpp',
      basename: 'x11_app.cpp',
      linesAdded: 4,
      linesRemoved: 2,
      action: 'modify',
    }],
    terminalEvidence: [{
      command: './build/math_visual_lab --smoke-frames 3',
      kind: 'test',
      ok: false,
      exitCode: 1,
      detail: 'Cannot create XImage: depth=24',
    }],
    todos: [{ id: 1, title: '修复 XImage', status: 'in-progress' }],
  });

  assert.equal(task.id, 'agentic-incomplete-delivery');
  assert.equal(task.action, 'modify');
  assert.equal(task.file, 'src/x11_app.cpp');
  assert.match(task.desc, /current workspace state/);
  assert.match(task.desc, /Cannot create XImage/);
  assert.match(task.desc, /run only affected verification/);
  assert.doesNotMatch(task.desc, /recreate completed work\.$/);
});
