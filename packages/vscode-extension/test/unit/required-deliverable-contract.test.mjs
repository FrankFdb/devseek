import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/required-deliverable-contract.bundle.cjs');
execSync(`npx esbuild src/agent/required-deliverable-contract.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`, {
  cwd: rootDir,
  stdio: 'pipe',
});
const {
  extractRequiredDeliverables,
  getMissingRequiredDeliverables,
} = createRequire(import.meta.url)(bundlePath);

test('required deliverables: based-on source files are not required outputs', () => {
  const prompt = [
    '请基于 /tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md 和 /tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts 创建 Markdown 审计报告。',
    '请把报告保存到 /tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md。',
    '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
  ].join('\n');

  assert.deepEqual(
    extractRequiredDeliverables(prompt).map(item => item.path),
    ['/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md'],
  );
});

test('required deliverables: read source then create report binds only the report', () => {
  assert.deepEqual(
    extractRequiredDeliverables('读取 config.hpp，提取 kValue 的真实值并创建 report.md。').map(item => item.path),
    ['report.md'],
  );
});

test('required deliverables: explicit output file label remains required', () => {
  assert.deepEqual(
    extractRequiredDeliverables('请生成结果。必须创建输出文件：/tmp/result.txt').map(item => item.path),
    ['/tmp/result.txt'],
  );
});

test('required deliverables: numbered collision sibling satisfies requested markdown output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-required-deliverable-'));
  try {
    const docsDir = path.join(root, 'docs');
    mkdirSync(docsDir, { recursive: true });
    const requested = path.join(docsDir, 'warranty-maintenance-advice-simulation.md');
    const written = path.join(docsDir, 'warranty-maintenance-advice-simulation-1.md');
    writeFileSync(written, '# 仿真测试报告\n\n已生成。\n', 'utf8');
    const prompt = [
      '请生成仿真测试结果。',
      `请保存到 ${requested}，文件名需要保留 simulation 标识。`,
    ].join('\n');

    assert.deepEqual(
      getMissingRequiredDeliverables(prompt, [{ path: written }], root),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
