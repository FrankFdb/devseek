import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-repair-'));
const bundlePath = path.join(tempRoot, 'terminal-failure-repair.cjs');

execSync(
  `npx esbuild src/agent/terminal-failure-repair.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { buildTerminalFailureRepairFeedback } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

const failure = {
  command: './test.sh',
  kind: 'test',
  ok: false,
  exitCode: 2,
  detail: 'src/math.cpp:42:7: error: unused variable value',
};

test('repair phase keeps the active failure scoped to one evidence-driven action', () => {
  const feedback = buildTerminalFailureRepairFeedback(
    failure,
    ['成功的测试/运行结果'],
    'repair',
  );

  assert.match(feedback, /公开失败命令: \.\/test\.sh/);
  assert.match(feedback, /math\.cpp:42:7: error/);
  assert.match(feedback, /活动失败是下一轮最高优先级/);
  assert.match(feedback, /只精确读取一个相关文件或行范围/);
  assert.match(feedback, /观测证据，不是新的产品需求/);
  assert.match(feedback, /不得为了单一阈值、快照统计或测试计数制造无语义/);
  assert.match(feedback, /不能用污染生产实现换取绿色结果/);
});

test('rerun phase returns a successful write to the unfiltered public command', () => {
  const feedback = buildTerminalFailureRepairFeedback(failure, [], 'rerun');

  assert.match(feedback, /当前轮已经产生文件修改/);
  assert.match(feedback, /原样重跑上面的失败命令/);
  assert.match(feedback, /过滤结果只能补充诊断，不能作为通过证据/);
  assert.doesNotMatch(feedback, /横向探索/);
});
