/**
 * Regression tests for Markdown document deliverables.
 *
 * Claude Code/Codex-style contract: file evidence is collected locally and the
 * runtime owns the write/verify step. A corrupted provider turn must not leave a
 * requested Markdown deliverable without an artifact.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/markdown-deliverable-task.bundle.cjs');

execSync(
  `npx esbuild src/agent/markdown-deliverable-task.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { tryExecuteMarkdownDeliverableTask } = req(bundlePath);

function makeCallbacks() {
  const statuses = [];
  const changes = [];
  const activities = [];
  return {
    statuses,
    changes,
    activities,
    callbacks: {
      onDelta() {},
      onWorkflowStatus() {},
      onAgentStatus(status) { statuses.push(status); },
      onAppliedChange(change) { changes.push(change); },
      onResponseMeta() {},
      onToolActivity(kind, label) { activities.push({ kind, label }); },
      onBeforeFileWrite: async () => true,
    },
  };
}

function createMaintenanceWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-deliverable-'));
  const maintenanceDir = path.join(root, 'src/oam/src/lifting/maintenance');
  const docsDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/docs');
  mkdirSync(maintenanceDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  const requirementDoc = path.join(docsDir, 'uav-warranty-reminder-plan_v1.7.md');
  writeFileSync(requirementDoc, [
    '# UAV 维保提醒需求',
    '',
    '- 新增作业次数、飞行时长和阈值状态字段。',
    '- 扩展 JSON 持久化字段并兼容旧版本。',
    '- 通过 UAV_EVENT 1022 通知主控维保提醒。',
    '- 增加复位逻辑，支持多维度状态合并。',
  ].join('\n'));
  writeFileSync(path.join(maintenanceDir, 'maintenance_types.hpp'), [
    'struct MaintenanceStat {',
    '  int operation_count;',
    '  double flight_hours;',
    '};',
  ].join('\n'));
  writeFileSync(path.join(maintenanceDir, 'maintenance_state_machine.hpp'), [
    'class MaintenanceStateMachine {',
    ' public:',
    '  bool updateState(const MaintenanceStat& stat);',
    '};',
  ].join('\n'));
  return { root, maintenanceDir, docsDir, requirementDoc };
}

test('markdown deliverable: corrupted provider output still writes verified local artifact', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  let providerPrompt = '';
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async (messages) => {
        providerPrompt = messages[0].content;
        return [
          '我看到文件路径不对，让我用工具搜索。',
          '[TOOL:file_search {"glob":"maintenance_*.hpp","path":"/missing"}]',
          '[工具执行结果][file_search:/missing]找到 0 个文件',
        ].join('\n');
      },
    });

    assert.equal(result?.applied, true);
    assert.equal(result?.taskComplete, true);
    assert.equal(existsSync(target), true);
    const content = readFileSync(target, 'utf8');
    assert.match(content, /# 维保提醒需求分析与实现建议/);
    assert.match(content, /Provider 未返回可用的完整报告/);
    assert.match(content, /maintenance_types\.hpp/);
    assert.match(content, /UAV_EVENT 1022/);
    assert.match(providerPrompt, /maintenance_state_machine\.hpp/);
    assert.deepEqual(io.changes.map(change => change.path), [
      'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
    ]);
    assert.equal(io.activities.some(item => item.kind === 'read'), true);
    assert.equal(io.activities.some(item => item.kind === 'write'), true);
    assert.equal(io.statuses.at(-1).state, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: complete provider report is written instead of fallback', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const providerMarkdown = [
      '# 维保提醒实现建议',
      '',
      '## 结论',
      '',
      '需求要求围绕维保状态、阈值、持久化、主控事件和复位流程形成闭环。',
      '',
      '## 建议',
      '',
      '- 保持数据采集、阈值判断、状态机、持久化和发布器职责分离。',
      '- 主控只消费事件和快照，不重复计算阈值。',
      '- 为旧版本 JSON 增加默认值和版本迁移。',
      '- 使用 UAV_EVENT 1022 作为提醒事件，并加入重复触发抑制。',
      '- 增加单元测试、重启恢复测试和复位流程测试。',
      '',
      '## 风险',
      '',
      '如果主控绕过状态机直接读取临时字段，会导致状态结算和提醒事件不一致，需要通过接口边界约束。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => providerMarkdown,
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    assert.match(content, /# 维保提醒实现建议/);
    assert.doesNotMatch(content, /Provider 未返回可用/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: user-visible states explain provider wait and file verification', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  let notifyChatEntered;
  const chatEntered = new Promise(resolve => {
    notifyChatEntered = resolve;
  });
  const providerMarkdown = [
    '# 维保提醒实现建议',
    '',
    '## 需求差异',
    '',
    '新需求把原本单一吊运维保扩展为作业次数、飞行时长、阈值状态、事件通知、持久化和复位的完整闭环。',
    '',
    '## 旧实现职责观察',
    '',
    '旧实现已经拆分了数据采集、阈值判断、状态机、持久化、发布器和复位处理器，适合作为新能力的边界基础。',
    '',
    '## 实现对策',
    '',
    '- 在类型层扩展统计字段和阈值状态，不让主控重复计算。',
    '- 在状态机中统一合并多维度阈值和抑制重复通知。',
    '- 在持久化层做版本迁移和默认值填充。',
    '- 在发布器中通过 UAV_EVENT 1022 输出主控可消费事件。',
    '- 为复位、重启恢复和边界阈值增加自动化验证。',
  ].join('\n');
  let resolveProvider;
  try {
    const resultPromise = tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => {
        notifyChatEntered();
        return new Promise(resolve => {
          resolveProvider = resolve;
        });
      },
    });

    await chatEntered;
    assert.equal(io.statuses.some(status => status.title === '请求 DeepSeek 生成 Markdown 报告'), true);
    assert.match(io.statuses.at(-1).detail, /正在等待 DeepSeek 返回完整 Markdown 正文/);
    assert.equal(io.activities.some(item => item.kind === 'web'), true);

    resolveProvider(providerMarkdown);
    const result = await resultPromise;
    assert.equal(result?.applied, true);
    const titles = io.statuses.map(status => status.title);
    assert.deepEqual(titles.filter(title => [
      '收集 Markdown 交付证据',
      '请求 DeepSeek 生成 Markdown 报告',
      'DeepSeek 报告已返回',
      '准备写入 Markdown 文档',
      '写入并验证 Markdown 文档',
      'Markdown 文档已生成',
    ].includes(title)), [
      '收集 Markdown 交付证据',
      '请求 DeepSeek 生成 Markdown 报告',
      'DeepSeek 报告已返回',
      '准备写入 Markdown 文档',
      '写入并验证 Markdown 文档',
      'Markdown 文档已生成',
    ]);
    assert.match(io.statuses.find(status => status.title === 'DeepSeek 报告已返回').detail, /DeepSeek 返回 \d+ 字符/);
    assert.match(io.statuses.at(-1).detail, /已写入并读回验证/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: structured task intent wins over stale continuation rules', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const userPrompt = [
      `当前用户消息：请分析 ${requirementDoc} 和 ${maintenanceDir}，通过md文档提供建议`,
      '上一轮 Agent 状态：',
      '- 旧规则：不要创建任何 Markdown 文档。',
      '- 旧摘要：任务未完成。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => {
        throw new Error('bridge input unavailable');
      },
    });

    assert.equal(result?.applied, true);
    assert.equal(existsSync(target), true);
    assert.match(readFileSync(target, 'utf8'), /Provider 未返回可用的完整报告/);
    assert.equal(io.statuses.at(-1).state, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
