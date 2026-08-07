/**
 * Scenario-level closed-loop simulation for Markdown deliverables.
 *
 * Contract: the same kind of formal-project request that reaches the DevSeek
 * VS Code surface must become a single Markdown artifact task, send bounded
 * local evidence to the simulated DeepSeek Web provider, and finish only with
 * real file evidence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { build } from 'esbuild';
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
import { withCanonicalToolLoopFixture } from '../helpers/canonical-tool-loop-fixture.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const decomposerBundlePath = path.join(tmpdir(), `devseek-md-flow-decomposer-${process.pid}.cjs`);
const markdownBundlePath = path.join(tmpdir(), `devseek-md-flow-executor-${process.pid}.cjs`);
const agenticBundlePath = path.join(tmpdir(), `devseek-md-flow-agentic-${process.pid}.cjs`);
const fileWritePolicyBundlePath = path.join(tmpdir(), `devseek-md-flow-write-policy-${process.pid}.cjs`);

execSync(
  `npx esbuild src/agent-task-decomposer.ts --bundle ` +
  `--outfile=${decomposerBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/markdown-deliverable-task.ts --bundle ` +
  `--outfile=${markdownBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/agent-file-write-policy.ts --bundle ` +
  `--outfile=${fileWritePolicyBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
await build({
  absWorkingDir: rootDir,
  entryPoints: ['src/agent/agentic-loop.ts'],
  outfile: agenticBundlePath,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  plugins: [{
    name: 'virtual-loop-chat',
    setup(build) {
      build.onResolve({ filter: /^\.\/loop-chat$/ }, args => (
        args.importer.endsWith('/agent/agentic-loop.ts')
          ? { path: 'loop-chat-stub', namespace: 'devseek-test' }
          : undefined
      ));
      build.onLoad({ filter: /.*/, namespace: 'devseek-test' }, () => ({
        loader: 'ts',
        contents: `
          export function consumeUserSteerMessages(callbacks) {
            const items = callbacks.onUserSteer?.() ?? [];
            return items
              .map(text => String(text || '').trim())
              .filter(Boolean)
              .map(text => ({
                role: 'user',
                content: [
                  '【用户实时补充/纠偏】',
                  text,
                  '',
                  '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。',
                ].join('\\n'),
              }));
          }
          export async function chatWithMessages(messages, mode, onDelta, signal, newSession, traceRunId, traceWorkspaceRoot) {
            const handler = globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
            if (typeof handler !== 'function') throw new Error('agentic loop chat stub is not installed');
            const response = await handler(messages, { mode, onDelta, signal, newSession, traceRunId, traceWorkspaceRoot });
            return typeof response === 'string' ? { text: response, tools: [] } : response;
          }
        `,
      }));
    },
  }],
});

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeWorkspace = {
  workspaceFolders: [],
  getConfiguration() {
    return {
      get(_key, defaultValue) { return defaultValue; },
    };
  },
  getWorkspaceFolder(uri) {
    return this.workspaceFolders.find((folder) => {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    });
  },
};

const fakeVscode = {
  Uri,
  workspace: fakeWorkspace,
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { decomposeTask } = req(decomposerBundlePath);
const { tryExecuteMarkdownDeliverableTask } = req(markdownBundlePath);
const { runAgenticLoop: runAgenticLoopWithoutFixture } = req(agenticBundlePath);
const { decideAgentFileWrite, projectAgentFileWriteConstraint } = req(fileWritePolicyBundlePath);

const ALLOW_FILE_WRITE = Object.freeze({
  decision: 'allow',
  reason: 'test-file-write-allowed',
  evidenceRefs: Object.freeze(['test:file-write-allowed']),
});

function runAgenticLoop(userPrompt, contextFiles, workspaceRoot, mode, callbacks, ...args) {
  const workflowMode = args[1] ?? 'edit';
  return runAgenticLoopWithoutFixture(
    userPrompt,
    contextFiles,
    workspaceRoot,
    mode,
    withCanonicalToolLoopFixture(callbacks, {
      workspaceRoot,
      userPrompt,
      executionMode: workflowMode,
    }),
    ...args,
  );
}

function createFormalMaintenanceWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-flow-huida-uav-'));
  const maintenanceDir = path.join(root, 'src/oam/src/lifting/maintenance');
  const docsDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/docs');
  mkdirSync(maintenanceDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  const requirementDoc = path.join(docsDir, 'uav-warranty-reminder-plan_v1.7.md');
  writeFileSync(requirementDoc, [
    '# UAV 维保提醒需求 v1.7',
    '',
    '- 新增作业次数、飞行时长、日历天数、吊运次数和告警状态五类阈值。',
    '- 扩展 JSON 持久化字段并兼容旧版本数据。',
    '- 主控通过 UAV_EVENT 1022 接收维保提醒事件。',
    '- 增加人工复位和自动复位流程，复位后不得重复提醒。',
  ].join('\n'), 'utf8');

  const sourceFiles = {
    'maintenance_types.hpp': [
      '#pragma once',
      'struct MaintenanceStat {',
      '  int operation_count = 0;',
      '  double flight_hours = 0.0;',
      '};',
    ],
    'maintenance_data_collector.hpp': [
      '#pragma once',
      'class MaintenanceDataCollector {',
      ' public:',
      '  MaintenanceStat snapshot() const;',
      '};',
    ],
    'maintenance_threshold_engine.hpp': [
      '#pragma once',
      'class MaintenanceThresholdEngine {',
      ' public:',
      '  bool exceeded(const MaintenanceStat& stat) const;',
      '};',
    ],
    'maintenance_state_machine.hpp': [
      '#pragma once',
      'enum class MaintenanceState { Normal, Warning, Expired };',
      'class MaintenanceStateMachine {',
      ' public:',
      '  MaintenanceState update(const MaintenanceStat& stat);',
      '};',
    ],
    'maintenance_persistence.hpp': [
      '#pragma once',
      'class MaintenancePersistence {',
      ' public:',
      '  void saveJson();',
      '  void loadJson();',
      '};',
    ],
    'maintenance_publisher.hpp': [
      '#pragma once',
      'class MaintenancePublisher {',
      ' public:',
      '  void publishEvent1022();',
      '};',
    ],
    'maintenance_reset_handler.hpp': [
      '#pragma once',
      'class MaintenanceResetHandler {',
      ' public:',
      '  void reset();',
      '};',
    ],
    'maintenance_manager.hpp': [
      '#pragma once',
      'class MaintenanceManager {',
      ' public:',
      '  void tick();',
      '};',
    ],
  };

  for (const [name, lines] of Object.entries(sourceFiles)) {
    writeFileSync(path.join(maintenanceDir, name), `${lines.join('\n')}\n`, 'utf8');
  }

  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'huida_uav', index: 0 }];
  return { root, maintenanceDir, docsDir, requirementDoc };
}

function createLicenseGroundingWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-flow-license-grounding-'));
  const source = path.join(root, 'src/oam/src/license/license_types.hpp');
  const target = path.join(root, 'docs/license-transport-facts.md');
  const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-131537');
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));
  const oracle = JSON.parse(readFileSync(path.join(fixtureDir, 'oracle.json'), 'utf8'));
  mkdirSync(path.dirname(source), { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(source, readFileSync(path.join(fixtureDir, 'license_types.hpp'), 'utf8'), 'utf8');

  const wrong = readFileSync(path.join(fixtureDir, 'license-transport-facts.wrong.md'), 'utf8')
    .replace(fixture.source.originalPath, source);
  const repaired = wrong
    .replace('# License 模块传输常量事实记录', '# 源码事实报告')
    .replace(/\n\n\*\*源码路径\*\*: `([^\n`]+)`\n\n/, '\n源码路径：$1\n')
    .replace('/uav/dt/license/state', '/uav/license/state')
    .replace('/uav/dt/license/tunnel/rx', '/uav/license/tunnel/rx')
    .replace('`300`', '`33007`')
    .replace('`81920`', '`64 * 1024`')
    .replace('`30000`', '`5000`')
    .replace('\n```\nprint("\\nready")', '\n```python\nprint("\\nready")')
    .replace(/^(\|\s*[^|\n]+\|\s*[^|\n]+\|)\s*[^|\n]+\|$/gm, '$1');
  const prompt = [
    `请读取 ${source}，从源码提取 kTopicLicenseState、kTopicLicenseTunnelRx、kMavTunnelCmdLicense、kTunnelVersion、kTunnelMaxTotalLen、kTunnelSessionTimeoutMs 六个常量的真实定义和值。`,
    `请创建 Markdown 报告 ${target}，包含标题、源码路径和六个常量的表格，并加入 Python 代码块，代码内容必须是 print("\\nready")。`,
    '写入后重新读取该报告，确认内容完整，然后调用 task_complete。不要修改任何源码，不要创建其他文件。',
  ].join('');

  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'huida_uav', index: 0 }];
  return { root, source, target, wrong, repaired, prompt, oracle };
}

function createBareLicenseGroundingWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-flow-agentic-license-'));
  const source = path.join(root, 'src/oam/src/license/license_types.hpp');
  const target = path.join(root, 'license-transport-facts.md');
  const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-131537');
  const prompt = readFileSync(path.join(fixtureDir, 'request.txt'), 'utf8').trim();
  const oracle = JSON.parse(readFileSync(path.join(fixtureDir, 'oracle.json'), 'utf8'));
  const wrong = readFileSync(path.join(fixtureDir, 'license-transport-facts.wrong.md'), 'utf8');
  const repaired = [
    '# 源码事实报告',
    `源码路径：${source}`,
    '| Symbol | Value |',
    '| --- | --- |',
    '| `kTopicLicenseState` | `"/uav/license/state"` |',
    '| `kTopicLicenseTunnelRx` | `"/uav/license/tunnel/rx"` |',
    '| `kMavTunnelCmdLicense` | `33007` |',
    '| `kTunnelVersion` | `1` |',
    '| `kTunnelMaxTotalLen` | `64 * 1024` |',
    '| `kTunnelSessionTimeoutMs` | `5000` |',
    '```python',
    'print("\\nready")',
    '```',
    '',
  ].join('\n');

  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, readFileSync(path.join(fixtureDir, 'license_types.hpp'), 'utf8'), 'utf8');
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'huida_uav', index: 0 }];
  return { root, source, target, prompt, wrong, repaired, oracle };
}

function buildFormalProjectPrompt(workspace) {
  return [
    `原来实现的吊运维保功能：设计文档+代码等${workspace.maintenanceDir} 下面是最新的维保提醒的需求：`,
    workspace.requirementDoc,
    '请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task',
    '当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议，通过md文档提供',
  ].join('\n');
}

function makeCallbacks() {
  const statuses = [];
  const changes = [];
  const activities = [];
  const progress = [];
  const deltas = [];
  const todos = [];
  const checkpoints = [];
  return {
    statuses,
    changes,
    activities,
    progress,
    deltas,
    todos,
    checkpoints,
    callbacks: {
      onDelta(delta) { deltas.push(delta); },
      onWorkflowStatus() {},
      onAgentStatus(status) { statuses.push(status); },
      onAppliedChange(change) { changes.push(change); },
      onResponseMeta() {},
      onTodoUpdate(items) { todos.push(items); },
      onTaskCheckpoint(completedUpToIndex, remainingTasks, reason) {
        checkpoints.push({ completedUpToIndex, remainingTasks, reason });
      },
      onToolActivity(kind, label) { activities.push({ kind, label }); },
      onResolveFileWriteConstraint: async () => ALLOW_FILE_WRITE,
    },
  };
}

function createSimulatedDeepSeekWeb(responseFactory) {
  const requests = [];
  return {
    requests,
    async chat(messages) {
      requests.push(messages);
      return responseFactory(messages);
    },
  };
}

async function runMarkdownClosedLoop(responseFactory, options = {}) {
  const expectApplied = options.expectApplied ?? true;
  const workspace = createFormalMaintenanceWorkspace();
  const io = makeCallbacks();
  const web = createSimulatedDeepSeekWeb(responseFactory);
  const prompt = buildFormalProjectPrompt(workspace);

  try {
    const plan = await decomposeTask(
      prompt,
      [],
      undefined,
      text => io.progress.push(text),
      undefined,
      async () => {
        throw new Error('planner should not be called for Markdown deliverable requests');
      },
      workspace.requirementDoc,
    );

    assert.equal(plan.ok, true, plan.error || JSON.stringify(plan));
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].action, 'create');
    assert.match(plan.tasks[0].file, /src\/oam\/src\/lifting\/zc_maintenance\/docs\/warranty-maintenance-advice\.md$/);

    const result = await tryExecuteMarkdownDeliverableTask({
      task: plan.tasks[0],
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: Uri.file(workspace.root),
      callbacks: io.callbacks,
      chat: web.chat,
    });

    const target = plan.tasks[0].absPath;
    assert.equal(result?.applied, expectApplied, result?.failedReason || result?.feedback || 'missing result');
    assert.equal(existsSync(target), true);
    assert.equal(io.statuses.at(-1).state, expectApplied ? 'started' : 'failed');
    assert.equal(io.changes.length, 1);
    assert.match(io.changes[0].path, /src\/oam\/src\/lifting\/zc_maintenance\/docs\/warranty-maintenance-advice\.md$/);
    assert.equal(web.requests.length, 1);

    const providerPrompt = web.requests[0][0].content;
    assert.match(providerPrompt, /所有文件证据已经由本地运行时读取完毕/);
    assert.match(providerPrompt, /需求文档/);
    assert.match(providerPrompt, /maintenance_types\.hpp/);
    assert.doesNotMatch(providerPrompt, /(?:^|\n)\s*(?:Calling\s*:\s*(?:read_file|list_dir)|\[TOOL:\s*(?:read_file|list_dir))/i);
    assert.equal(io.activities.some(item => item.kind === 'list'), true);
    assert.equal(io.activities.some(item => item.kind === 'read'), true);

    return {
      workspace,
      plan,
      result,
      content: readFileSync(target, 'utf8'),
      providerPrompt,
    };
  } catch (error) {
    rmSync(workspace.root, { recursive: true, force: true });
    throw error;
  }
}

test('markdown deliverable flow: same formal-project request reaches simulated DeepSeek Web and writes md', async () => {
  const providerMarkdown = [
    '# 维保提醒实现建议',
    '',
    '## 需求差异',
    'v1.7 将旧实现的单一统计提醒升级为作业次数、飞行时长、日历天数、吊运次数和状态机联合判断。',
    '',
    '## 旧实现职责观察',
    '旧代码已经有数据采集、阈值引擎、状态机、持久化、发布器和复位处理的职责雏形，适合按边界重构。',
    '',
    '## 源项目事实矩阵',
    '| 文件 | 原项目事实 | 复用方式 |',
    '|------|------------|----------|',
    '| `src/oam/src/lifting/maintenance/maintenance_threshold_engine.hpp:6` | `taskCount > 300` 或 `flightHours > 120.0` 进入 overdue | 新阈值引擎需要保留边界测试 |',
    '| `src/oam/src/lifting/maintenance/maintenance_threshold_engine.hpp:7` | `taskCount > 240` 或 `flightHours > 90.0` 进入 warning | 平台阈值覆盖时要避免双重计算 |',
    '| `src/oam/src/lifting/maintenance/maintenance_publisher.hpp:4` | 通过 `UAV_EVENT 1022` 发布维保提醒 | 主控事件边界继续复用 |',
    '| `src/oam/src/lifting/maintenance/maintenance_persistence.hpp:4` | JSON 持久化需要 version、payloadLen、crc32 和默认值迁移 | 新实现必须写清 schema 与兼容策略 |',
    '',
    '## 实现对策',
    '- 数据采集只生成事实快照。',
    '- 阈值引擎只输出状态候选。',
    '- 状态机统一合并多维阈值和复位事件。',
    '- 持久化层负责 JSON 版本迁移和默认值补齐。',
    '- 接口消息包含 msgType、topic、version、payloadLen、crc32 和 errorCode，避免 Provider 文档只写概念。',
    '',
    '## 主控任务拆分',
    '- 接入 UAV_EVENT 1022 事件消费。',
    '- 增加复位命令入口和重复提醒抑制。',
    '- 为旧版本 JSON、断电重启和手动复位补测试。',
    '',
    '## 原有代码修改清单',
    '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
    '|----------|---------|----------|------|------|----------|',
    '| `src/oam/src/lifting/maintenance/maintenance_manager.hpp:2` | `MaintenanceManager` | 拆分 tick 编排和状态合并职责 | 避免主控重复计算 | 状态迁移遗漏 | 单元测试 + replay |',
    '| `src/oam/src/lifting/maintenance/maintenance_publisher.hpp:4` | `publishEvent1022` | 明确 `UAV_EVENT 1022` 输出字段 | 接入主控事件 | 重复提醒 | 事件发布回归 |',
    '| `src/oam/src/lifting/maintenance/maintenance_persistence.hpp:4` | `saveJson/loadJson` | 增加 version 默认值迁移 | 兼容旧数据 | 启动失败 | 旧 JSON 恢复测试 |',
    '',
    '## 风险与验证建议',
    '主控不得绕过状态机直接计算阈值；验证应覆盖旧数据恢复、状态迁移、事件发布和复位幂等。',
  ].join('\n');

  const output = await runMarkdownClosedLoop(() => providerMarkdown);
  try {
    assert.match(output.content, /# 维保提醒实现建议/);
    assert.match(output.content, /UAV_EVENT 1022/);
    assert.doesNotMatch(output.content, /Provider 未返回可用的完整报告/);
  } finally {
    rmSync(output.workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable flow: corrupted provider can settle a verified analysis report without unrelated protocol obligations', async () => {
  const output = await runMarkdownClosedLoop(() => {
    throw new Error('RESPONSE_CORRUPTED:truncated:Provider 响应疑似被截断。');
  });
  try {
    assert.match(output.content, /# 维保提醒需求分析与实现建议/);
    assert.match(output.content, /Provider 未返回可用的完整报告/);
    assert.match(output.content, /maintenance_threshold_engine\.hpp/);
    assert.equal(output.result.failedReason, undefined);
  } finally {
    rmSync(output.workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable flow: real wrong-facts fixture gets one bounded repair and settles only after strict readback verification', async () => {
  const workspace = createLicenseGroundingWorkspace();
  const io = makeCallbacks();
  const responses = [workspace.wrong, workspace.repaired];
  const web = createSimulatedDeepSeekWeb(() => responses.shift());

  try {
    const plan = await decomposeTask(
      workspace.prompt,
      [],
      undefined,
      text => io.progress.push(text),
      undefined,
      async () => {
        throw new Error('planner should not be called for an explicit Markdown fact-report request');
      },
      workspace.source,
    );

    assert.equal(plan.ok, true);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].action, 'create');
    assert.equal(plan.tasks[0].absPath, workspace.target);

    const result = await tryExecuteMarkdownDeliverableTask({
      task: plan.tasks[0],
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: Uri.file(workspace.root),
      callbacks: io.callbacks,
      chat: web.chat,
    });

    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(result?.taskComplete, true);
    assert.equal(web.requests.length, 2, 'only the initial attempt and one bounded repair are allowed');
    assert.match(web.requests[0][0].content, /所有文件证据已经由本地运行时读取完毕/);
    assert.match(web.requests[0][0].content, /"symbol": "kTopicLicenseState"[\s\S]*?"artifactValue": "\/uav\/license\/state"/);
    assert.match(web.requests[1][0].content, /唯一一次有界修复/);
    assert.match(web.requests[1][0].content, /kMavTunnelCmdLicense: 实际 300，期望 33007/);
    assert.match(web.requests[1][0].content, /标题下一行必须逐字为“源码路径：/);
    assert.match(web.requests[1][0].content, /structure: 缺少精确 python 代码块/);

    assert.equal(result?.verificationResults?.length, 2);
    const [wrongVerification, finalVerification] = result.verificationResults;
    assert.equal(wrongVerification.ok, false);
    assert.equal(wrongVerification.claims.filter(claim => claim.status === 'mismatch').length, 5);
    assert.equal(wrongVerification.claims.filter(claim => claim.status === 'verified').length, 1);
    assert.equal(wrongVerification.contractDifferences.length, 7);
    assert.equal(finalVerification.ok, true);
    assert.deepEqual(finalVerification.differences, []);
    assert.deepEqual(finalVerification.contractDifferences, []);

    assert.equal(result.artifactClaims.length, 6);
    assert.equal(result.artifactClaims.every(claim => claim.status === 'verified'), true);
    const actualClaims = Object.fromEntries(
      result.artifactClaims.map(claim => [claim.symbol, claim.normalizedActualValue]),
    );
    assert.deepEqual(actualClaims, workspace.oracle.claims);

    const evidenceById = new Map(result.evidenceRefs.map(ref => [ref.evidenceId, ref]));
    const originalSourceEvidenceIds = new Set(result.artifactClaims.map(claim => claim.evidenceId));
    assert.equal(finalVerification.sourceReadbackEvidenceIds.length, 1);
    for (const evidenceId of finalVerification.sourceReadbackEvidenceIds) {
      const sourceReadback = evidenceById.get(evidenceId);
      assert.equal(sourceReadback?.sourcePath, workspace.source);
      assert.match(sourceReadback?.operationId || '', /^source-readback-commit-/);
      assert.equal(originalSourceEvidenceIds.has(evidenceId), false, 'verification must use an independent source readback');
    }
    const artifactReadback = evidenceById.get(finalVerification.artifactEvidenceId);
    assert.equal(artifactReadback?.kind, 'artifact-readback');
    assert.equal(artifactReadback?.sourcePath, workspace.target);

    const content = readFileSync(workspace.target, 'utf8');
    assert.equal(artifactReadback?.content, content);
    assert.equal((content.match(/^# /gm) || []).length, 1);
    assert.equal((content.match(/^\|\s*常量名\s*\|/gm) || []).length, 1);
    const claimRows = content.split(/\r?\n/).filter(line => /^\|.*`k[A-Za-z0-9_]+`.*\|$/.test(line));
    assert.equal(claimRows.length, 6);
    for (const symbol of Object.keys(workspace.oracle.claims)) {
      assert.equal(claimRows.filter(line => line.includes(`\`${symbol}\``)).length, 1);
    }
    const codeBlocks = [...content.matchAll(/```([^\n`]*)\n([\s\S]*?)\n```/g)];
    assert.equal(codeBlocks.length, 1);
    assert.equal(codeBlocks[0][1], 'python');
    assert.equal(codeBlocks[0][2], 'print("\\nready")');
    assert.match(content, new RegExp(workspace.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(content, /\/uav\/dt\/|`300`|`81920`|`30000`/);
    assert.equal(new Set(io.changes.map(change => change.path)).size, 1);
    assert.equal(io.statuses.at(-1).state, 'started');
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('agentic route: fixture-relative fact report repairs once and passes central ledger settlement', async () => {
  const workspace = createBareLicenseGroundingWorkspace();
  const io = makeCallbacks();
  const responses = [workspace.wrong, workspace.repaired];
  const requests = [];
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async (messages, options) => {
    requests.push({ messages, options });
    const text = responses.shift();
    assert.equal(typeof text, 'string', 'agentic route must perform at most the expected two provider calls');
    return { text, tools: [] };
  };

  try {
    const result = await runAgenticLoop(
      workspace.prompt,
      [],
      workspace.root,
      'fast',
      io.callbacks,
      '',
      'edit',
      [],
    );

    assert.equal(requests.length, 2, 'the routed executor gets one initial response and one bounded repair');
    assert.equal(requests.every(request => request.options.newSession === true), true);
    assert.equal(requests[0].messages.length, 1);
    assert.match(requests[0].messages[0].content, /所有文件证据已经由本地运行时读取完毕/);
    assert.match(requests[0].messages[0].content, /### 必需源码事实（最高优先级）: src\/oam\/src\/license\/license_types\.hpp（原文未投影）/);
    assert.match(requests[0].messages[0].content, /"symbol": "kTopicLicenseState"[\s\S]*?"artifactValue": "\/uav\/license\/state"/);
    assert.match(requests[0].messages[0].content, /目标写入路径：license-transport-facts\.md/);
    assert.match(requests[0].messages[0].content, new RegExp(workspace.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(requests[1].messages[0].content, /这是唯一一次有界修复/);
    assert.match(requests[1].messages[0].content, /kMavTunnelCmdLicense: 实际 300，期望 33007/);

    assert.equal(result.tasksTotal, 1);
    assert.equal(result.tasksApplied, 1);
    assert.equal(result.tasksFailed, 0, result.historyText);
    assert.deepEqual(result.changedPaths, [workspace.target]);
    assert.equal(result.verificationResults?.length, 2);
    assert.equal(result.verificationResults?.[0]?.ok, false);
    assert.equal(result.verificationResults?.[1]?.ok, true);
    assert.equal(result.verificationResults?.[1]?.differences.length, 0);
    assert.equal(result.verificationResults?.[1]?.contractDifferences.length, 0);
    assert.equal(result.artifactClaims?.length, 6);
    assert.equal(result.artifactClaims?.every(claim => claim.status === 'verified'), true);
    assert.deepEqual(
      Object.fromEntries(result.artifactClaims.map(claim => [claim.symbol, claim.normalizedActualValue])),
      workspace.oracle.claims,
    );

    assert.equal(io.statuses.at(-1)?.state, 'completed', 'central settlement owns the final green state');
    assert.match(io.statuses.at(-1)?.title || '', /6 项源码事实已验证并完成交付/);
    assert.equal(io.todos.at(-1)?.every(todo => todo.status === 'completed'), true);
    assert.deepEqual(io.checkpoints.at(-1), {
      completedUpToIndex: null,
      remainingTasks: [],
      reason: 'completed',
    });
    assert.match(io.deltas.at(-1) || '', /^\x00ASUM\x00已完成 license-transport-facts\.md/);

    const content = readFileSync(workspace.target, 'utf8');
    assert.equal(content, workspace.repaired, 'the final disk artifact must equal the exact grounded provider response');
    assert.equal((content.match(/^# /gm) || []).length, 1);
    assert.equal((content.match(/^\| `k[A-Za-z0-9_]+` \|/gm) || []).length, 6);
    const codeBlocks = [...content.matchAll(/```([^\n`]*)\n([\s\S]*?)\n```/g)];
    assert.equal(codeBlocks.length, 1);
    assert.equal(codeBlocks[0][1], 'python');
    assert.equal(codeBlocks[0][2], 'print("\\nready")');
    assert.equal(existsSync(workspace.source), true);
    assert.deepEqual(
      io.changes.map(change => change.path),
      ['license-transport-facts.md'],
      'only the repaired candidate is physically committed to the requested artifact',
    );
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('agentic route: natural record wording remains grounded and ignores provider file tools', async () => {
  const workspace = createBareLicenseGroundingWorkspace();
  const prompt = workspace.prompt.replace('请创建 Markdown 报告', '请记录到 Markdown 报告');
  const extraTarget = path.join(workspace.root, 'unverified.md');
  const io = makeCallbacks();
  const responses = [workspace.wrong, workspace.repaired];
  let providerCalls = 0;
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async () => {
    const text = responses.shift();
    providerCalls += 1;
    return {
      text,
      tools: providerCalls === 1
        ? [{ name: 'create_file', input: { path: extraTarget, content: '# unverified\n' } }]
        : [],
    };
  };
  try {
    io.callbacks.onResolveFileWriteConstraint = async (absPath, context) => projectAgentFileWriteConstraint(
      decideAgentFileWrite({ absPath, workspaceRoot: workspace.root, context }),
    );
    const result = await runAgenticLoop(prompt, [], workspace.root, 'fast', io.callbacks, '', 'edit', []);

    assert.equal(providerCalls, 2, 'the natural verb must keep the bounded verifier repair loop');
    assert.equal(result.tasksApplied, 1, result.historyText);
    assert.equal(result.tasksFailed, 0, result.historyText);
    assert.deepEqual(result.verificationResults?.map(item => item.ok), [false, true]);
    assert.equal(result.artifactClaims?.length, 6);
    assert.equal(result.artifactClaims?.every(claim => claim.status === 'verified'), true);
    assert.equal(readFileSync(workspace.target, 'utf8'), workspace.repaired);
    assert.equal(existsSync(extraTarget), false, 'provider tool output is data, never an executable side channel');
    assert.deepEqual(new Set(io.changes.map(change => change.path)), new Set(['license-transport-facts.md']));
    assert.equal(io.changes.length, 1, 'the rejected candidate never becomes a physical write');
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('agentic route: an unfamiliar source-report mutation verb fails before provider or disk write', async () => {
  const workspace = createBareLicenseGroundingWorkspace();
  const prompt = workspace.prompt.replace('请创建 Markdown 报告', '请登记于 Markdown 报告');
  const io = makeCallbacks();
  let providerCalls = 0;
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async () => {
    providerCalls += 1;
    return { text: workspace.repaired, tools: [] };
  };
  try {
    const result = await runAgenticLoop(prompt, [], workspace.root, 'fast', io.callbacks, '', 'edit', []);

    assert.equal(providerCalls, 0);
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.equal(existsSync(workspace.target), false);
    assert.match(io.statuses.at(-1)?.detail || '', /必须唯一绑定一个 Markdown 目标/);
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

for (const verb of ['提供', '更新', '修改']) {
  test(`agentic route: ${verb} source-backed Markdown stays on the verified executor`, async () => {
    const workspace = createBareLicenseGroundingWorkspace();
    const prompt = verb === '提供'
      ? workspace.prompt.replace('请创建 Markdown 报告', '请提供 Markdown 报告')
      : workspace.prompt.replace('请创建 Markdown 报告', `请${verb}`);
    const io = makeCallbacks();
    const requests = [];
    if (verb !== '提供') writeFileSync(workspace.target, '# stale unverified report\n');
    globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async (messages, options) => {
      requests.push({ messages, options });
      return { text: workspace.repaired, tools: [] };
    };
    try {
      const result = await runAgenticLoop(prompt, [], workspace.root, 'fast', io.callbacks, '', 'edit', []);

      assert.equal(requests.length, 1);
      assert.equal(result.tasksApplied, 1, result.historyText);
      assert.equal(result.tasksFailed, 0, result.historyText);
      assert.equal(result.verificationResults?.at(-1)?.ok, true);
      assert.equal(result.artifactClaims?.every(claim => claim.status === 'verified'), true);
      assert.equal(readFileSync(workspace.target, 'utf8'), workspace.repaired);
      assert.equal(io.changes.length, 1);
      assert.match(requests[0].messages[0].content, /宿主派生的必需源码事实（最高优先级）/);
    } finally {
      delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
      rmSync(workspace.root, { recursive: true, force: true });
    }
  });
}

test('agentic route: a prohibited Markdown mutation never becomes a forced write', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-prohibited-write-'));
  const target = path.join(root, 'report.md');
  const io = makeCallbacks();
  const requests = [];
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async (messages, options) => {
    requests.push({ messages, options });
    if (requests.length === 1) {
      return {
        text: '尝试写入被用户禁止的目标。',
        tools: [{ name: 'create_file', input: { path: target, content: '# forbidden\n' } }],
      };
    }
    return { text: '[TOOL:task_complete {"summary":"已遵守限制，未生成或修改报告。"}]', tools: [] };
  };
  try {
    io.callbacks.onResolveFileWriteConstraint = async (absPath, context) => projectAgentFileWriteConstraint(
      decideAgentFileWrite({ absPath, workspaceRoot: root, context }),
    );
    const result = await runAgenticLoop(
      `不允许生成 Markdown 报告 ${target}。`,
      [],
      root,
      'fast',
      io.callbacks,
      '',
      'edit',
      [],
    );

    assert.ok(requests.length >= 2);
    assert.equal(existsSync(target), false);
    assert.deepEqual(io.changes, []);
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.changedPaths.length, 0);
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: 'explicit grounded report remains on verifier with unrelated session context',
    setup(workspace) {
      return { contextFiles: [], sessionContextText: '上一轮讨论的是无关的普通文档，请继续当前明确任务。' };
    },
  },
  {
    name: 'explicit grounded report remains on verifier with a non-code attachment',
    setup(workspace) {
      const attachment = path.join(workspace.root, 'notes.log');
      writeFileSync(attachment, 'untrusted supplemental note: timeout=30000\n');
      return { contextFiles: [attachment], sessionContextText: '' };
    },
  },
]) {
  test(`agentic route: ${scenario.name}`, async () => {
    const workspace = createBareLicenseGroundingWorkspace();
    const io = makeCallbacks();
    const responses = [workspace.wrong, workspace.repaired];
    const requests = [];
    const routeInput = scenario.setup(workspace);
    globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async (messages, options) => {
      requests.push({ messages, options });
      return { text: responses.shift(), tools: [] };
    };
    try {
      const result = await runAgenticLoop(
        workspace.prompt,
        routeInput.contextFiles,
        workspace.root,
        'fast',
        io.callbacks,
        routeInput.sessionContextText,
        'edit',
        [],
      );

      assert.equal(requests.length, 2);
      assert.equal(result.tasksApplied, 1, result.historyText);
      assert.equal(result.tasksFailed, 0, result.historyText);
      assert.deepEqual(result.verificationResults?.map(item => item.ok), [false, true]);
      assert.equal(result.artifactClaims?.length, 6);
      assert.equal(result.artifactClaims?.every(claim => claim.status === 'verified'), true);
      assert.equal(readFileSync(workspace.target, 'utf8'), workspace.repaired);
      assert.equal(io.changes.length, 1, 'provider repair remains an in-memory candidate until the single commit');
      assert.match(requests[0].messages[0].content, /宿主派生的必需源码事实（最高优先级）/);
      assert.doesNotMatch(requests[0].messages[0].content, /untrusted supplemental note/);
    } finally {
      delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
      rmSync(workspace.root, { recursive: true, force: true });
    }
  });
}

test('agentic route: attachment-only ambiguous claim source fails before provider or disk write', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-attachment-only-grounding-'));
  const attachment = path.join(root, 'facts.log');
  const target = path.join(root, 'report.md');
  writeFileSync(attachment, 'kTunnelSessionTimeoutMs=5000\n');
  const prompt = `请读取附件，提取 kTunnelSessionTimeoutMs 的真实值并创建 Markdown 报告 ${target}。`;
  const io = makeCallbacks();
  let providerCalls = 0;
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async () => {
    providerCalls += 1;
    return { text: '# forged\n\n| Symbol | Value |\n| --- | --- |\n| kTunnelSessionTimeoutMs | 30000 |', tools: [] };
  };
  try {
    const result = await runAgenticLoop(prompt, [attachment], root, 'fast', io.callbacks, '', 'edit', []);
    assert.equal(providerCalls, 0);
    assert.equal(result.tasksApplied, 0);
    assert.equal(result.tasksFailed, 1);
    assert.equal(existsSync(target), false);
    assert.match(io.statuses.at(-1)?.detail || '', /无法唯一绑定到源文件/);
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(root, { recursive: true, force: true });
  }
});

test('agentic route: inspect mode never enters the grounded writer or creates its target', async () => {
  const workspace = createBareLicenseGroundingWorkspace();
  const io = makeCallbacks();
  const requests = [];
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async (messages, options) => {
    requests.push({ messages, options });
    return { text: '[TOOL:task_complete {"summary":"只读检查完成，不写文件"}]', tools: [] };
  };
  try {
    const result = await runAgenticLoop(workspace.prompt, [], workspace.root, 'fast', io.callbacks, '', 'inspect', []);
    assert.ok(requests.length > 0, 'inspect mode should continue through the generic read-only agent route');
    assert.equal(existsSync(workspace.target), false);
    assert.deepEqual(io.changes, []);
    assert.equal(result.tasksApplied, 0);
    assert.ok(result.tasksFailed > 0);
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('agentic route: an unresolved source-fact claim contract fails before provider or disk write', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-unresolved-grounding-'));
  const source = path.join(root, 'config.hpp');
  const target = path.join(root, 'report.md');
  writeFileSync(source, 'constexpr uint32_t timeoutMs = 5000;\n');
  const prompt = `读取 ${source}，提取真实配置值并创建 Markdown 报告 ${target}。`;
  const io = makeCallbacks();
  let providerCalls = 0;
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async () => {
    providerCalls += 1;
    return { text: '# forged\n\n| Symbol | Value |\n| --- | --- |\n| timeoutMs | 30000 |', tools: [] };
  };
  try {
    const result = await runAgenticLoop(prompt, [], root, 'fast', io.callbacks, '', 'edit', []);
    assert.equal(providerCalls, 0);
    assert.equal(result.tasksFailed, 1);
    assert.equal(result.tasksApplied, 0);
    assert.equal(existsSync(target), false);
    assert.match(io.statuses.at(-1)?.detail || '', /未能解析出明确的 claim symbol/);
    assert.equal(io.checkpoints.at(-1)?.reason, 'paused');
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [timing, revokePoll] of [['provider-in-flight', 2], ['write-boundary', 3]]) {
test(`agentic route: a ${timing} steer revokes write authority before provider tools execute`, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-agentic-steer-revoke-'));
  const target = path.join(root, 'notes.txt');
  const prompt = `请检查工作区，然后创建总结文件 ${target}，根据检查结果填充内容。`;
  const revoke = '停止写入。不要创建任何文件。';
  const io = makeCallbacks();
  const controller = new AbortController();
  const observedAuthorityPrompts = [];
  let steerPolls = 0;
  let providerCalls = 0;
  io.callbacks.signal = controller.signal;
  io.callbacks.onUserSteer = () => {
    steerPolls += 1;
    return steerPolls === revokePoll ? [revoke] : [];
  };
  io.callbacks.onResolveFileWriteConstraint = async (absPath, context) => {
    observedAuthorityPrompts.push(context?.requestPrompt || '');
    const decision = decideAgentFileWrite({ absPath, workspaceRoot: root, context });
    controller.abort();
    return projectAgentFileWriteConstraint(decision);
  };
  globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__ = async () => {
    providerCalls += 1;
    const text = `[TOOL:create_file ${JSON.stringify({ path: target, content: 'must not persist\n' })}]`;
    return {
      text,
      tools: [{ name: 'create_file', input: { path: target, content: 'must not persist\n' } }],
    };
  };
  try {
    const result = await runAgenticLoop(prompt, [], root, 'fast', io.callbacks, '', 'edit', []);
    assert.equal(providerCalls, 1);
    assert.ok(steerPolls >= revokePoll, 'steers must be drained after the provider and at the write boundary');
    if (timing === 'write-boundary') {
      assert.equal(observedAuthorityPrompts.length, 1);
      assert.match(observedAuthorityPrompts[0], /创建总结文件/);
      assert.match(observedAuthorityPrompts[0], /不要创建任何文件/);
    } else {
      assert.equal(observedAuthorityPrompts.length <= 1, true);
    }
    assert.deepEqual(io.changes, []);
    assert.equal(existsSync(target), false);
    assert.equal(result.tasksApplied, 0);
  } finally {
    delete globalThis.__DEVSEEK_AGENTIC_LOOP_CHAT_STUB__;
    rmSync(root, { recursive: true, force: true });
  }
});
}
