import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/manual-review-validation.bundle.cjs');

execSync(
  `npx esbuild src/agent/manual-review-validation.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { shouldRequestManualReviewForRun } = req(bundlePath);

test('manual review validation: X11 timeout becomes visual confirmation instead of hard failure', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-visual-'));
  try {
    const filePath = path.join(workspace, 'Circle.cpp');
    fs.writeFileSync(filePath, [
      '#include <X11/Xlib.h>',
      'void draw(Display* d, Window w, GC gc) { XDrawArc(d, w, gc, 10, 10, 20, 20, 0, 360 * 64); }',
      '',
    ].join('\n'));

    const decision = shouldRequestManualReviewForRun({
      userPrompt: '优化图形描画，需要通过图形库描画方式，做图，完成后，编译，执行看效果',
      command: `${workspace}/.devseek-build/shape_manager`,
      output: '[终端命令] ./shape_manager\n[退出码] -1\n[stdout]\n[超时 30000ms] 命令仍在运行',
      changedPaths: [filePath],
      terminalEvidence: {
        command: `${workspace}/.devseek-build/shape_manager`,
        kind: 'run',
        ok: false,
        exitCode: -1,
        detail: '终端命令超时或被终止',
      },
    });

    assert.equal(decision?.reason, 'manual-visual-confirmation-required');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('manual review validation: compiler and binary errors remain hard failures', () => {
  const decision = shouldRequestManualReviewForRun({
    userPrompt: '运行图形程序看效果',
    command: 'cmake --build build && ./missing',
    output: 'main.cpp:3:5: error: expected ;\nNo such file or directory',
    changedPaths: [],
    terminalEvidence: {
      command: 'cmake --build build && ./missing',
      kind: 'compile-run',
      ok: false,
      exitCode: 2,
      detail: 'build failed',
    },
  });

  assert.equal(decision, undefined);
});

test('manual review validation: standalone visual run task can request review without fresh changed files', () => {
  const decision = shouldRequestManualReviewForRun({
    userPrompt: '/home/ff/work/devseek_netai/code/shape_manager 优化图形描画，需要通过图形库描画方式，做图，完成后，编译，执行看效果',
    command: 'cmake -S /tmp/shape_manager -B /tmp/shape_manager/.devseek-build && /tmp/shape_manager/.devseek-build/shape_manager',
    output: '终端命令非正常结束或超时',
    changedPaths: [],
    terminalEvidence: {
      command: 'cmake -S /tmp/shape_manager -B /tmp/shape_manager/.devseek-build && /tmp/shape_manager/.devseek-build/shape_manager',
      kind: 'compile-run',
      ok: false,
      exitCode: -1,
      detail: '终端命令非正常结束或超时',
    },
  });

  assert.equal(decision?.reason, 'manual-visual-confirmation-required');
});
