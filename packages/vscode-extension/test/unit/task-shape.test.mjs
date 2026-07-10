/**
 * Unit tests for agent/task-shape.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-shape.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-shape.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  classifyAgentTaskShape,
  buildTaskShapeGuidancePrompt,
} = req(bundlePath);

test('TaskShape: existing formal project implementation requires integration anchors', () => {
  const prompt = [
    '参考 /repo/src/oam/src/license 模块的通讯方式',
    '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/需求.md',
    '进行遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现，创建于 /repo/src/oam/src/lifting/zc_maintenance 目录下',
  ].join('\n');

  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'existing-project');
  assert.equal(result.existingProjectLikely, true);

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /既有大项目\/正式项目内实现/);
  assert.match(guidance, /主入口\/调度链路/);
  assert.match(guidance, /线程或事件模型/);
  assert.match(guidance, /源项目事实矩阵/);
  assert.match(guidance, /面向对端的接口文档/);
  assert.match(guidance, /原有代码修改清单/);
  assert.match(guidance, /不要创建脱离主流程的孤岛模块/);
});

test('TaskShape: standalone task remains allowed to create its own entrypoint', () => {
  const prompt = '请从零创建一个独立 demo，小工具可以自建 main 和运行方式。';
  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'standalone-project');

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /可以自建目录、入口和运行方式/);
});

test('TaskShape: read-only advice is not treated as implementation work', () => {
  const prompt = '当前不准备修改代码，只读分析现有实现，给出对策检讨和 task 建议，通过 md 文档提供。';
  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'read-only-analysis');

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /不要把建议清单当成要立即执行的修改任务/);
});

test('TaskShape: validation repair starts from logs and failure evidence', () => {
  const prompt = '最新测试失败，请结合日志和截图分析根因，修复后回归验证。';
  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'validation-repair');

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /读取日志、失败输出和最近变更/);
});

console.log('\nTask-shape tests passed.\n');
