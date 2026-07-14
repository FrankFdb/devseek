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
  assert.match(guidance, /项目调查 → 设计\/接口与原代码修改清单 → 代码实现 → 编译\/测试\/QualityGate 验证/);
  assert.match(guidance, /源项目事实矩阵\/调查证据/);
  assert.match(guidance, /源项目事实矩阵/);
  assert.match(guidance, /协议数值/);
  assert.match(guidance, /面向对端的接口文档/);
  assert.match(guidance, /request JSON 示例/);
  assert.match(guidance, /response JSON 示例/);
  assert.match(guidance, /```json/);
  assert.match(guidance, /原有代码修改清单/);
  assert.match(guidance, /静态审计通过/);
  assert.match(guidance, /不要创建脱离主流程的孤岛模块/);
});

test('TaskShape: scoped no-change plus isolated docs/src delivery remains existing-project implementation', () => {
  const prompt = [
    '请作为优秀编程智能体，产物必须隔离创建在 /repo/src/oam/src/lifting/zc_maintenance/202607101701 下，',
    '其中 docs 放设计文档，src 放本次新增或修改代码副本；不要修改正式源码目录。',
    '参考 /repo/src/oam/src/license 模块通讯方式，进行遥控器和主控交互接口设计，并做代码实现。',
  ].join('\n');

  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'existing-project');
  assert.equal(result.readOnlyLikely, false);

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /uart\*_tx\/rx_main/);
  assert.match(guidance, /TunnelTransport\/分片传输/);
  assert.match(guidance, /不能只在用户给出的目录内自洽实现/);
});

test('TaskShape: standalone task remains allowed to create its own entrypoint', () => {
  const prompt = '请从零创建一个独立 demo，小工具可以自建 main 和运行方式。';
  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'standalone-project');

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /可以自建目录、入口和运行方式/);
});

test('TaskShape: simple programming prompt is standalone instead of formal project work', () => {
  const prompt = '编写C++程序，打印helloworld,编译执行';
  const result = classifyAgentTaskShape(prompt);
  assert.equal(result.shape, 'standalone-project');
  assert.equal(result.existingProjectLikely, false);
  assert.equal(result.standaloneLikely, true);

  const guidance = buildTaskShapeGuidancePrompt(prompt);
  assert.match(guidance, /独立新项目\/原型\/练习/);
  assert.match(guidance, /可以自建目录、入口和运行方式/);
  assert.match(guidance, /简单程序/);
  assert.doesNotMatch(guidance, /通信链路|原有代码修改清单|主入口\/调度链路/);
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
