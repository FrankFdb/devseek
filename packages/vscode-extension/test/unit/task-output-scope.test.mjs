/**
 * Unit tests for task-scoped output directory guards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-output-scope.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-output-scope.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildTaskOutputScopeRecoveryPrompt,
  detectTaskOutputScopeDrift,
} = req(bundlePath);

test('TaskOutputScope: rejects stale sibling timestamp artifact paths', () => {
  const requestPrompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101945',
    '- 设计/实施 Markdown 文档放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101945/docs',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101945/src',
  ].join('\n');

  const drift = detectTaskOutputScopeDrift({
    requestPrompt,
    workspaceRoot: '/workspace',
    text: '<TOOL name="create_file">{"path":"/workspace/src/oam/src/lifting/zc_maintenance/202607101942/docs/warranty.md"}</TOOL>',
  });

  assert.equal(drift.blocked, true);
  assert.deepEqual(drift.stalePaths, ['/workspace/src/oam/src/lifting/zc_maintenance/202607101942/docs/warranty.md']);
  assert.match(drift.reason, /同级旧运行目录/);
});

test('TaskOutputScope: allows reference project paths outside artifact root', () => {
  const requestPrompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101945',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101945/src',
  ].join('\n');

  const drift = detectTaskOutputScopeDrift({
    requestPrompt,
    workspaceRoot: '/workspace',
    text: '需要参考 /workspace/src/oam/src/license/proc_license_main.cpp 和 /workspace/src/oam/src/lifting/maintenance',
  });

  assert.equal(drift.blocked, false);
});

test('TaskOutputScope: recovery prompt names current roots and stale paths', () => {
  const drift = {
    blocked: true,
    allowedRoots: ['/workspace/out/202607101945'],
    stalePaths: ['/workspace/out/202607101942/docs/a.md'],
  };

  const prompt = buildTaskOutputScopeRecoveryPrompt(drift);

  assert.match(prompt, /当前允许的输出根目录/);
  assert.match(prompt, /202607101945/);
  assert.match(prompt, /202607101942/);
});

console.log('\nTask output scope tests passed.\n');
