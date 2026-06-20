/**
 * Unit tests for agent evidence recovery.
 *
 * Claude Code/Codex-style contract: local validation evidence is authoritative.
 * If DevSeek stops on a validation conflict, user-visible verification todos
 * must not remain green just because the model marked them completed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/evidence-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/evidence-recovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { markValidationFailureTodos } = req(bundlePath);

test('Evidence recovery: failed local validation marks validation todos failed', () => {
  const todos = [
    { id: 1, title: '写入指定内容到文件', status: 'completed' },
    { id: 2, title: '验证 TypeScript 类型正确性', status: 'completed' },
  ];

  assert.deepEqual(markValidationFailureTodos(todos), [
    { id: 1, title: '写入指定内容到文件', status: 'completed' },
    { id: 2, title: '验证 TypeScript 类型正确性', status: 'failed' },
  ]);
});

test('Evidence recovery: generic validation todo is failed when stopping on QualityGate conflict', () => {
  const todos = [
    { id: 1, title: '创建/更新文件', status: 'completed' },
    { id: 2, title: '编译/运行并验证结果', status: 'completed' },
  ];

  assert.equal(markValidationFailureTodos(todos)[1].status, 'failed');
});
