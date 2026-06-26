/**
 * Unit tests for agent/no-tool-intent.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/no-tool-intent.bundle.cjs');

execSync(
  `npx esbuild src/agent/no-tool-intent.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildDanglingAgentActionFeedback,
  hasDanglingAgentActionIntent,
} = req(bundlePath);

test('NoToolIntent: detects dangling Chinese validation promises', () => {
  assert.equal(
    hasDanglingAgentActionIntent('我看到了！已有三维程序。让我检查一下这个程序是否已经成功编译并可以运行。'),
    true,
  );
  assert.equal(
    hasDanglingAgentActionIntent('接下来我会运行程序验证三维图形展示效果。'),
    true,
  );
});

test('NoToolIntent: detects dangling English tool promises', () => {
  assert.equal(
    hasDanglingAgentActionIntent('The project already has the files. Next I will compile and run it to verify.'),
    true,
  );
});

test('NoToolIntent: keeps completed summaries as final prose', () => {
  assert.equal(
    hasDanglingAgentActionIntent('验证结果：编译成功，程序运行正常，球体、长方体和三棱锥都可以切换显示。'),
    false,
  );
  assert.equal(
    hasDanglingAgentActionIntent('已完成：更新 main.cpp，并通过 cmake 构建验证。'),
    false,
  );
});

test('NoToolIntent: feedback names concrete required tools', () => {
  const feedback = buildDanglingAgentActionFeedback();
  assert.match(feedback, /list_dir\/read_file/);
  assert.match(feedback, /create_file\/write_file/);
  assert.match(feedback, /run_terminal/);
});

console.log('\nNo-tool intent tests passed.\n');
