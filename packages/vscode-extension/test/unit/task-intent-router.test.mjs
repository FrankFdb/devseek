/**
 * Unit tests for the canonical task intent router.
 *
 * R1-A2 contract: product routing starts from one semantic route matrix, then
 * display, task-shape guidance, validation and completion evidence consume that
 * route instead of re-deciding task families from raw prompt keywords.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-intent-router.bundle.cjs');

execSync(
  `npx esbuild src/task-intent-router.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { routeTaskIntent } = createRequire(import.meta.url)(bundlePath);

test('TaskIntentRouter: explicit path plus exact content is deterministic simple-file work', () => {
  const route = routeTaskIntent(
    '请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务，不要修改其他用户文件。',
  );

  assert.equal(route.version, 'devseek.task-intent-route/v1');
  assert.equal(route.family, 'simple-file');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'edit');
  assert.equal(route.agentTaskShape, 'simple-file');
  assert.equal(route.simpleFile.path, 'controlled-sim.txt');
  assert.equal(route.validation.fileCheckRequired, true);
  assert.equal(route.quality.formalProjectRequired, false);
  assert.ok(route.signals.includes('simple-file-route'));
  assert.ok(route.signals.includes('scoped-other-file-prohibition'));
});

test('TaskIntentRouter: marked natural create-file prompt stays simple-file work', () => {
  const route = routeTaskIntent(
    'INTENT-SIM-SIMPLE-intent-simple-20260715-172137-35d024 请在当前工作区创建文件 intent-simple-20260715-172137-35d024.txt。文件内容必须精确为一行 INTENT_SIM_SIMPLE_OK_intent-simple-20260715-172137-35d024。完成写入后读取该文件验证内容精确匹配，然后结束任务。不要创建目录，不要修改其他用户文件，不要访问网络。',
  );

  assert.equal(route.family, 'simple-file');
  assert.equal(route.agentTaskShape, 'simple-file');
  assert.equal(route.simpleFile.path, 'intent-simple-20260715-172137-35d024.txt');
  assert.equal(route.simpleFile.content, 'INTENT_SIM_SIMPLE_OK_intent-simple-20260715-172137-35d024\n');
  assert.equal(route.quality.formalProjectRequired, false);
  assert.equal(route.validation.fileCheckRequired, true);
});

test('TaskIntentRouter: latest requirement overrides old requirement without becoming read-only', () => {
  const route = routeTaskIntent(
    '这是一次多轮需求的最终轮：前面曾说写 INITIAL_REQUIREMENT，但现在改为 FINAL_REQUIREMENT_OK。请只按最新要求创建 journey-result.txt，文件内容必须精确包含一行 FINAL_REQUIREMENT_OK。完成写入和读回验证后结束任务，不要创建旧要求文件。',
  );

  assert.equal(route.family, 'simple-file');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'edit');
  assert.equal(route.agentTaskShape, 'simple-file');
  assert.equal(route.simpleFile.path, 'journey-result.txt');
  assert.equal(route.simpleFile.content, 'FINAL_REQUIREMENT_OK\n');
  assert.equal(route.mutation.requested, true);
  assert.equal(route.mutation.prohibited, false);
  assert.equal(route.validation.fileCheckRequired, true);
  assert.ok(route.signals.includes('scoped-historical-requirement-prohibition'));
  assert.ok(!route.blockers.includes('explicit-no-change'));
});

test('TaskIntentRouter: simple C++ stdout program is standalone, not formal project work', () => {
  const route = routeTaskIntent('编写一个 C++ 程序，打印下午好');

  assert.equal(route.family, 'standalone-program');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'edit');
  assert.equal(route.agentTaskShape, 'standalone-project');
  assert.equal(route.validation.runtimeRequired, true);
  assert.equal(route.validation.runProhibited, false);
  assert.equal(route.quality.formalProjectRequired, false);
  assert.ok(route.signals.includes('standalone-code'));
});

test('TaskIntentRouter: standalone stdout intent respects explicit no-run', () => {
  const route = routeTaskIntent('编写一个 C++ 程序，打印下午好，但不要运行。');

  assert.equal(route.family, 'standalone-program');
  assert.equal(route.agentTaskShape, 'standalone-project');
  assert.equal(route.validation.runtimeRequired, false);
  assert.equal(route.validation.runProhibited, true);
});

test('TaskIntentRouter: existing project implementation keeps formal project gate', () => {
  const route = routeTaskIntent([
    '参考 /repo/src/oam/src/license 模块的通讯方式',
    '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/需求.md',
    '进行遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现，创建于 /repo/src/oam/src/lifting/zc_maintenance 目录下',
  ].join('\n'));

  assert.equal(route.family, 'existing-project-edit');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'edit');
  assert.equal(route.agentTaskShape, 'existing-project');
  assert.equal(route.quality.formalProjectRequired, true);
  assert.ok(route.signals.includes('formal-project-quality-required'));
});

test('TaskIntentRouter: read-only advisory cannot request mutation', () => {
  const route = routeTaskIntent(
    '当前不准备修改代码，只读分析现有实现，给出对策检讨和 task 建议，通过 md 文档提供。',
  );

  assert.equal(route.family, 'read-only-advisory');
  assert.equal(route.chatKind, 'chat');
  assert.equal(route.agentTaskShape, 'read-only-analysis');
  assert.equal(route.mutation.requested, false);
  assert.equal(route.validation.runtimeRequired, false);
  assert.ok(route.blockers.includes('explicit-no-change') || route.signals.includes('read-only-route'));
});

test('TaskIntentRouter: terminal validation remains run-only and denies mutation', () => {
  const route = routeTaskIntent('运行测试');

  assert.equal(route.family, 'terminal-validation');
  assert.equal(route.chatKind, 'code-change');
  assert.equal(route.mode, 'run');
  assert.equal(route.agentTaskShape, 'general');
  assert.equal(route.mutation.requested, false);
  assert.equal(route.validation.commandEvidenceRequired, true);
  assert.deepEqual(route.allowedToolKinds, ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory', 'terminal']);
});

console.log('\nTask-intent-router tests passed.\n');
