import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-planning.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-planning.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  extractPlanningTodoItems,
  shouldAdoptPlanningTodoItems,
} = req(bundlePath);

test('AgenticPlanning: adopts a model plan only before substantive work starts', () => {
  const initialPlan = [
    '任务计划：',
    '1. 读取现有代码',
    '2. 实现存储服务',
    '3. 运行测试',
  ].join('\n');

  assert.equal(shouldAdoptPlanningTodoItems({ sawWorkTool: false }), true);
  assert.deepEqual(
    extractPlanningTodoItems(initialPlan).map(item => item.title),
    ['读取现有代码', '实现存储服务', '运行测试'],
  );
});

test('AgenticPlanning: a final completion checklist cannot reopen an executed task', () => {
  const finalReport = [
    '任务清单：',
    '- 已创建 package.json',
    '- 已实现 src/task-service.js',
    '- 已通过 npm test',
  ].join('\n');

  assert.ok(extractPlanningTodoItems(finalReport).length > 0, 'fixture must resemble a parseable checklist');
  assert.equal(shouldAdoptPlanningTodoItems({ sawWorkTool: true }), false);
});
