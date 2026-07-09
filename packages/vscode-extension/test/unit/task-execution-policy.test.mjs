import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-execution-policy.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-execution-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  enforceAgentTaskExecutionPolicy,
  isWorkspaceWriteAgentTaskAction,
  taskModeAllowsWorkspaceWrites,
} = req(bundlePath);

test.after(() => {
  if (existsSync(bundlePath)) unlinkSync(bundlePath);
});

test('task-execution-policy: plan mode collapses write-heavy plans into one read-only analysis task', () => {
  const result = enforceAgentTaskExecutionPolicy(
    [
      { id: 't1', file: 'src/oam/maintenance_types.hpp', action: 'modify', desc: '扩展SMaintenanceStat结构体', absPath: '/project/src/oam/maintenance_types.hpp' },
      { id: 't2', file: 'src/oam/calc.cpp', action: 'modify', desc: '重构阈值计算引擎', absPath: '/project/src/oam/calc.cpp' },
      { id: 't3', file: 'src/oam/event.hpp', action: 'create', desc: '扩展UAV_EVENT_1032协议', absPath: '/project/src/oam/event.hpp' },
    ],
    { mode: 'plan', userPrompt: '给出对策检讨和task，当前不修改代码' },
  );

  assert.equal(result.changed, true);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].action, 'analyze');
  assert.match(result.tasks[0].desc, /对策检讨与任务建议/);
  assert.equal(result.tasks[0].absPath, '/project/src/oam/maintenance_types.hpp');
  assert.equal(result.tasks.some(task => isWorkspaceWriteAgentTaskAction(task.action)), false);
});

test('task-execution-policy: plan mode allows only requested Markdown document deliverables', () => {
  const result = enforceAgentTaskExecutionPolicy(
    [
      { id: 't1', file: 'src/oam/maintenance_types.hpp', action: 'modify', desc: '扩展SMaintenanceStat结构体', absPath: '/project/src/oam/maintenance_types.hpp' },
      { id: 't2', file: 'docs/warranty-maintenance-advice.md', action: 'create', desc: '创建 Markdown 建议文档', absPath: '/project/docs/warranty-maintenance-advice.md' },
    ],
    { mode: 'plan', userPrompt: '请分析吊运维保新旧需求，给出建议，通过 md 文档提供' },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tasks.map(task => task.action), ['create']);
  assert.equal(result.tasks[0].id, 't1');
  assert.equal(result.tasks[0].file, 'docs/warranty-maintenance-advice.md');
  assert.match(result.tasks[0].desc, /Markdown 建议文档/);
});

test('task-execution-policy: plan mode adds missing Markdown deliverable task', () => {
  const result = enforceAgentTaskExecutionPolicy(
    [
      {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
        action: 'analyze',
        desc: '分析需求、现有实现和约束，输出对策检讨与任务建议',
        absPath: '/project/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
      },
    ],
    { mode: 'plan', userPrompt: '请分析吊运维保新旧需求，给出建议，通过 md 文档提供' },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tasks.map(task => task.action), ['create']);
  assert.equal(result.tasks[0].id, 't1');
  assert.equal(result.tasks[0].file, 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md');
  assert.equal(result.tasks[0].absPath, '/project/src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md');
  assert.match(result.reason, /单一 \.md 创建任务/);
});

test('task-execution-policy: plan mode preserves model-provided project-prefixed Markdown create', () => {
  const result = enforceAgentTaskExecutionPolicy(
    [
      { id: 't1', file: 'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md', action: 'analyze', desc: '分析新需求文档' },
      { id: 't2', file: 'huida_uav/docs/maintenance_refactor_analysis.md', action: 'create', desc: '创建分析报告:新需求与旧实现对比及重构建议' },
    ],
    { mode: 'plan', userPrompt: '请分析新旧需求，给出建议，通过md文档提供' },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tasks.map(task => task.action), ['create']);
  assert.equal(result.tasks[0].id, 't1');
  assert.equal(result.tasks[0].file, 'huida_uav/docs/maintenance_refactor_analysis.md');
});

test('task-execution-policy: non-edit modes convert write tasks to read-only analysis tasks', () => {
  const result = enforceAgentTaskExecutionPolicy(
    [
      { id: 't1', file: 'src/a.ts', action: 'modify', desc: '修复问题', absPath: '/project/src/a.ts' },
      { id: 't2', file: 'src/b.ts', action: 'analyze', desc: '确认影响范围', absPath: '/project/src/b.ts' },
    ],
    { mode: 'inspect', userPrompt: '先审查当前问题' },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.tasks.map(task => task.action), ['analyze', 'analyze']);
  assert.match(result.tasks[0].desc, /^审查模式只读审查：/);
  assert.equal(result.tasks[1].desc, '确认影响范围');
});

test('task-execution-policy: edit mode leaves write tasks untouched', () => {
  const tasks = [
    { id: 't1', file: 'src/a.ts', action: 'modify', desc: '修复问题', absPath: '/project/src/a.ts' },
  ];
  const result = enforceAgentTaskExecutionPolicy(tasks, { mode: 'edit', userPrompt: '请修复问题' });

  assert.equal(result.changed, false);
  assert.equal(result.tasks, tasks);
  assert.equal(taskModeAllowsWorkspaceWrites('edit'), true);
  assert.equal(taskModeAllowsWorkspaceWrites('destructive'), true);
  assert.equal(taskModeAllowsWorkspaceWrites('plan'), false);
});

test('task-execution-policy: unknown mode is left untouched for legacy internal callers', () => {
  const tasks = [
    { id: 't1', file: 'src/a.ts', action: 'modify', desc: '本地修复', absPath: '/project/src/a.ts' },
  ];
  const result = enforceAgentTaskExecutionPolicy(tasks, { userPrompt: 'local repair' });

  assert.equal(result.changed, false);
  assert.equal(result.tasks, tasks);
});
