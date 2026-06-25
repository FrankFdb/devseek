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
const bundlePath = path.join(rootDir, 'test/unit/terminal-launch-classifier.bundle.cjs');

execSync(
  `npx esbuild src/app/terminal-launch-classifier.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  containsRuntimeExecutableSegment,
  shouldUseManualReviewLaunchMode,
} = req(bundlePath);

test('terminal launch classifier: build-only commands do not require manual review', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-launch-'));
  try {
    fs.writeFileSync(path.join(workspace, 'main.cpp'), [
      '#include <X11/Xlib.h>',
      'int main() { return 0; }',
      '',
    ].join('\n'));

    assert.equal(
      shouldUseManualReviewLaunchMode({
        command: `cmake --build ${workspace}/.devseek-build`,
        workdir: workspace,
        workspaceRoot: workspace,
      }),
      false,
    );
    assert.equal(containsRuntimeExecutableSegment(`cmake --build ${workspace}/.devseek-build`), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('terminal launch classifier: compiled X11 executable launch requests manual review', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-launch-'));
  try {
    fs.writeFileSync(path.join(workspace, 'shape_manager.cpp'), [
      '#include <X11/Xlib.h>',
      'void draw(Display* d, Window w, GC gc) { XDrawArc(d, w, gc, 10, 10, 20, 20, 0, 360 * 64); }',
      '',
    ].join('\n'));

    const command = [
      `cmake -S '${workspace}' -B '${workspace}/.devseek-build'`,
      `cmake --build '${workspace}/.devseek-build'`,
      `if test -x '${workspace}/.devseek-build/shape_manager'; then '${workspace}/.devseek-build/shape_manager'; else ctest --test-dir '${workspace}/.devseek-build' --output-on-failure; fi`,
    ].join(' && ');

    assert.equal(containsRuntimeExecutableSegment(command), true);
    assert.equal(
      shouldUseManualReviewLaunchMode({
        command,
        workdir: workspace,
        workspaceRoot: workspace,
      }),
      true,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
