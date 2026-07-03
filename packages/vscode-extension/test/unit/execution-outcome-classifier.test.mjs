/**
 * Unit tests for src/execution-outcome-classifier.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-execution-outcome-'));
const bundlePath = path.join(bundleDir, 'execution-outcome-classifier.bundle.cjs');
process.on('exit', () => {
  rmSync(bundleDir, { recursive: true, force: true });
});

execSync(
  `npx esbuild src/execution-outcome-classifier.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildValidationTimeoutFailureDetail,
  classifyFormattedTerminalExecutionEvidence,
  executionOutcomeClassifier,
  formatManualReviewTerminalDetail,
  hasHardExecutionFailureEvidence,
  hasInteractiveLaunchEvidence,
  isIndeterminateExecutionEvidence,
  makeExecutionTimeoutError,
  parseFormattedTerminalExitCode,
  parseManualReviewTerminalDetail,
  isVisualOrInteractiveContext,
} = req(bundlePath);

function timeoutError() {
  const error = new Error('Command failed: timeout');
  error.killed = true;
  return error;
}

test('ExecutionOutcomeClassifier: visual runtime timeout requires manual review', () => {
  const sourcePath = path.join(bundleDir, 'main.cpp');
  writeFileSync(sourcePath, '#include <GL/glut.h>\nint main(){ glutMainLoop(); }\n');

  const result = executionOutcomeClassifier.classifyExecResult({
    error: timeoutError(),
    stdout: 'program started',
    stderr: '',
    command: './shape_manager',
    timeoutMs: 30000,
    allowManualReview: true,
    visualSourcePaths: [sourcePath],
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, -1);
  assert.equal(result.reviewRequired, true);
  assert.match(result.output, /图形或交互式程序已启动/);
});

test('ExecutionOutcomeClassifier: validation timeout stays failed evidence', () => {
  const result = executionOutcomeClassifier.classifyExecResult({
    error: timeoutError(),
    stdout: '',
    stderr: '',
    command: 'npm test',
    timeoutMs: 15000,
    allowManualReview: false,
    timeoutFailureDetail: buildValidationTimeoutFailureDetail(15000),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 124);
  assert.equal(result.reviewRequired, undefined);
  assert.match(result.output, /自动验证按失败处理/);
});

test('ExecutionOutcomeClassifier: hard build failure suppresses manual review', () => {
  const result = executionOutcomeClassifier.classifyExecResult({
    error: timeoutError(),
    stdout: 'main.cpp:3:5: error: expected ;',
    stderr: '',
    command: 'g++ main.cpp -o app && ./app',
    timeoutMs: 30000,
    allowManualReview: true,
    manualReviewContext: 'OpenGL window',
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 124);
  assert.equal(result.reviewRequired, undefined);
});

test('ExecutionOutcomeClassifier: GUI launch output can require manual review after timeout', () => {
  const result = executionOutcomeClassifier.classifyExecResult({
    error: timeoutError(),
    stdout: [
      "-- Checking for module 'glut'",
      "--   No package 'glut' found",
      '============================================================',
      '      3D Shape Viewer - Mouse Selection Mode',
      '============================================================',
      'All shapes displayed simultaneously:',
      'Controls:',
      '  Left click      - Start dragging shape',
      '  ESC / Q         - Exit',
    ].join('\n'),
    stderr: '',
    command: './build/bin/shape_manager',
    timeoutMs: 30000,
    allowManualReview: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, -1);
  assert.equal(result.reviewRequired, true);
  assert.match(result.output, /图形或交互式程序已启动/);
  assert.equal(hasInteractiveLaunchEvidence(result.output), true);
});

test('ExecutionOutcomeClassifier: compile-only OpenGL output is not GUI launch evidence', () => {
  const output = [
    "-- Checking for module 'glut'",
    "--   No package 'glut' found",
    '-- Configuring done',
    '-- Generating done',
    '-- Build files have been written to: /tmp/build',
    '[100%] Built target shape_manager',
  ].join('\n');

  assert.equal(hasInteractiveLaunchEvidence(output), false);
  assert.equal(hasHardExecutionFailureEvidence(output), false);
});

test('ExecutionOutcomeClassifier: shared evidence helpers cover manual review inputs', () => {
  assert.equal(isVisualOrInteractiveContext('OpenGL 图形窗口'), true);
  assert.equal(isIndeterminateExecutionEvidence(-1, '[退出码] -1'), true);
  assert.equal(hasHardExecutionFailureEvidence('CMake Error: cannot open display'), true);
});

test('ExecutionOutcomeClassifier: terminal manual-review marker and timeout errors are centralized', () => {
  const error = makeExecutionTimeoutError(1234, './shape_manager');
  assert.equal(error.killed, true);
  assert.equal(error.code, 124);

  const formatted = formatManualReviewTerminalDetail('请确认窗口效果');
  assert.match(formatted, /\[MANUAL_REVIEW_REQUIRED\]/);
  assert.equal(parseManualReviewTerminalDetail(formatted), '请确认窗口效果');
});

test('ExecutionOutcomeClassifier: formatted terminal evidence is centralized', () => {
  assert.equal(parseFormattedTerminalExitCode('[退出码] -1'), -1);

  const review = classifyFormattedTerminalExecutionEvidence(
    `[终端命令] ./shape_manager\n[退出码] -1\n${formatManualReviewTerminalDetail('请确认窗口效果')}`,
  );
  assert.equal(review.ok, true);
  assert.equal(review.ran, true);
  assert.equal(review.reviewRequired, true);
  assert.equal(review.reviewReason, '请确认窗口效果');

  const notExecuted = classifyFormattedTerminalExecutionEvidence('（命令未执行：用户拒绝）');
  assert.equal(notExecuted.ok, false);
  assert.equal(notExecuted.ran, false);
  assert.equal(notExecuted.detail, '命令没有实际执行');
});
