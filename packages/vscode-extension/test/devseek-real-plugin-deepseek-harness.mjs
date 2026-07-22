#!/usr/bin/env node
/**
 * Real DevSeek extension + real DeepSeek Web live harness.
 *
 * This is intentionally opt-in because it opens VS Code, may open a visible
 * browser for login, and depends on the live DeepSeek website.
 *
 * Run from repository root:
 *   npm run test:real-plugin-deepseek --workspace=packages/vscode-extension -- --run
 *   npm run test:real-plugin-deepseek --workspace=packages/vscode-extension -- --run --relogin --headed --keep-window
 *   `--headed --keep-window` keeps user-visible VS Code and DeepSeek pages open for inspection.
 */

import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRealPluginQualityProfile,
  buildRealPluginScenarioSpec,
  parseRequiredArtifactSnippets,
} from './harness/real-plugin-quality-profile.mjs';

const args = process.argv.slice(2);
const runRequested = hasFlag('--run') || process.env.DEVSEEK_REAL_PLUGIN_DEEPSEEK_RUN === '1';

if (!runRequested) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'Real DevSeek plugin + DeepSeek Web harness is opt-in. Re-run with `-- --run`; add `-- --run --relogin --headed` when cookies need refreshing.',
  }, null, 2));
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const extensionRoot = path.join(repoRoot, 'packages/vscode-extension');
const bridgeServerPath = path.join(repoRoot, 'packages/bridge/dist/server.js');
const markdownQualityModulePath = path.join(extensionRoot, 'dist/agent/markdown-document-quality.js');
const formalProjectQualityModulePath = path.join(extensionRoot, 'dist/agent/formal-project-document-quality.js');
const codeBin = getArgValue('--code') || process.env.VSCODE_BIN || 'code';
const timeoutMs = Number(getArgValue('--timeout-ms') || process.env.DEVSEEK_REAL_PLUGIN_TIMEOUT_MS || 900000);
const relogin = hasFlag('--relogin') || process.env.DEVSEEK_REAL_PLUGIN_RELOGIN === '1';
const headed = hasFlag('--headed') || process.env.DEVSEEK_REAL_PLUGIN_HEADED === '1' || relogin;
const keepTmp = hasFlag('--keep') || process.env.DEVSEEK_REAL_PLUGIN_KEEP === '1';
const keepWindow = hasFlag('--keep-window') || process.env.DEVSEEK_REAL_PLUGIN_KEEP_WINDOW === '1';
const keepDeepSeekPage = hasFlag('--keep-deepseek-page')
  || process.env.DEVSEEK_REAL_PLUGIN_KEEP_DEEPSEEK_PAGE === '1'
  || (headed && keepWindow);
const autopilot = !hasFlag('--no-autopilot') && process.env.DEVSEEK_REAL_PLUGIN_AUTOPILOT !== '0';
const promptFromArg = getArgValue('--prompt');
const scenario = getArgValue('--scenario') || process.env.DEVSEEK_REAL_PLUGIN_SCENARIO || 'formal-simulation';
const scenarioSpec = buildRealPluginScenarioSpec(scenario);
const qualityProfile = buildRealPluginQualityProfile(scenario);
const requiredArtifactSnippets = [...new Set([
  ...scenarioSpec.requiredArtifactSnippets,
  ...parseRequiredArtifactSnippets(
    getArgValue('--artifact-must-contain') || process.env.DEVSEEK_REAL_PLUGIN_ARTIFACT_MUST_CONTAIN,
  ),
])];
const harnessMode = normalizeHarnessMode(getArgValue('--mode') || process.env.DEVSEEK_REAL_PLUGIN_MODE || 'fast');
const workspaceDirArg = getArgValue('--workspace-dir') || process.env.DEVSEEK_REAL_PLUGIN_WORKSPACE_DIR || '';
const outputDocArg = getArgValue('--output-doc') || process.env.DEVSEEK_REAL_PLUGIN_OUTPUT_DOC || '';
const artifactRootArg = getArgValue('--artifact-root') || process.env.DEVSEEK_REAL_PLUGIN_ARTIFACT_ROOT || '';
const artifactRunIdArg = getArgValue('--artifact-run-id') || process.env.DEVSEEK_REAL_PLUGIN_ARTIFACT_RUN_ID || '';
const vsixPath = resolveVsixPath();

if (!vsixPath || !fs.existsSync(vsixPath)) {
  failEarly('未找到 DevSeek VSIX。请先运行 `npm run extension:package:debug`，或用 `--vsix /path/to/devseek.vsix` 指定。');
}

if (!fs.existsSync(bridgeServerPath)) {
  failEarly(`Bridge server 不存在：${bridgeServerPath}。请先构建 bridge。`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-real-plugin-deepseek-'));
const usesExistingWorkspace = Boolean(workspaceDirArg);
const workspaceDir = usesExistingWorkspace ? path.resolve(workspaceDirArg) : path.join(tmpRoot, 'workspace');
const driverDir = path.join(tmpRoot, 'driver-extension');
const userDataDir = path.join(tmpRoot, 'user-data');
const extensionsDir = path.join(tmpRoot, 'extensions');
const reportPath = path.join(tmpRoot, 'report.json');
const progressPath = path.join(tmpRoot, 'driver-progress.jsonl');
const vscodeLogPath = path.join(tmpRoot, 'vscode.log');
const pluginPort = await findFreePort();

if (usesExistingWorkspace && !fs.existsSync(workspaceDir)) {
  failEarly(`指定的真实工作区不存在：${workspaceDir}`);
}

for (const dir of [driverDir, userDataDir, extensionsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!usesExistingWorkspace) fs.mkdirSync(workspaceDir, { recursive: true });

const fixture = usesExistingWorkspace
  ? describeExistingWorkspace(workspaceDir, {
      outputDoc: outputDocArg,
      artifactRoot: artifactRootArg,
      artifactRunId: artifactRunIdArg,
    })
  : createFixtureWorkspace(workspaceDir, { scenario });
const expectedArtifact = getArgValue('--expected-artifact')
  || process.env.DEVSEEK_REAL_PLUGIN_EXPECTED_ARTIFACT
  || fixture.expectedArtifactRel;
const expectedArtifacts = normalizeExpectedWorkspacePaths(parseExpectedArtifacts(
  getArgValue('--expected-artifacts')
    || process.env.DEVSEEK_REAL_PLUGIN_EXPECTED_ARTIFACTS
    || expectedArtifact,
));
const expectedCodeArtifacts = normalizeExpectedWorkspacePaths(parseExpectedArtifacts(
  getArgValue('--expected-code-artifacts')
    || process.env.DEVSEEK_REAL_PLUGIN_EXPECTED_CODE_ARTIFACTS
    || '',
));
const expectedCodeDirs = normalizeExpectedWorkspacePaths(parseExpectedArtifacts(
  getArgValue('--expected-code-dirs')
    || process.env.DEVSEEK_REAL_PLUGIN_EXPECTED_CODE_DIRS
    || fixture.expectedCodeDirRel
    || '',
));
const prompt = buildHarnessPrompt(promptFromArg || defaultPrompt(workspaceDir, fixture), fixture);

const loginReport = relogin ? await prepareDeepSeekLogin() : null;
installVsixIntoTempExtensions();
writeDriverExtension();
const report = await runVsCodeDriver();
attachReplayReport(report);

report.harness = {
  ...report.harness,
  tmpRoot,
  workspaceDir,
  reportPath,
  progressPath,
  vscodeLogPath,
  vsixPath,
  codeBin,
  relogin,
  headed,
  keepWindow,
  keepDeepSeekPage,
  autopilot,
  pluginPort,
  scenario,
  scenarioSpec: fixture.scenarioSpec || scenarioSpec,
  qualityProfile,
  requiredArtifactSnippets,
  harnessMode,
  expectedArtifact,
  expectedArtifacts,
  expectedCodeArtifacts,
  expectedCodeDirs,
  artifactRoot: fixture.artifactRoot || '',
  artifactRunId: fixture.artifactRunId || '',
  artifactDocsDir: fixture.artifactDocsDir || '',
  artifactSrcDir: fixture.artifactSrcDir || '',
  usesExistingWorkspace,
  loginReport,
};

const cleanup = !keepTmp && !keepWindow && !keepDeepSeekPage && report.ok;
if (cleanup) {
  report.harness.cleanup = 'temporary directory removed after successful non-visible run';
} else {
  report.harness.cleanup = 'temporary directory retained for inspection';
}
writeHarnessReport(report);

const serialized = JSON.stringify(report, null, 2);
if (report.ok) {
  console.log(serialized);
} else {
  console.error(serialized);
}

if (cleanup) {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Best effort cleanup.
  }
}

process.exit(report.ok ? 0 : 1);

function hasFlag(flag) {
  return args.includes(flag);
}

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return '';
  return args[index + 1] || '';
}

function normalizeHarnessMode(value) {
  return String(value || '').toLowerCase() === 'r1' ? 'r1' : 'fast';
}

function writeHarnessReport(payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function parseExpectedArtifacts(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(item => item.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
}

function normalizeExpectedWorkspacePaths(paths) {
  return paths.map((item) => {
    const absolute = path.isAbsolute(item) ? item : path.resolve(workspaceDir, item);
    const relative = path.relative(workspaceDir, absolute).replace(/\\/g, '/');
    return relative && !relative.startsWith('../') && relative !== '..' ? relative : item;
  });
}

function resolveVsixPath() {
  const explicit = getArgValue('--vsix') || process.env.DEVSEEK_REAL_PLUGIN_VSIX;
  if (explicit) return path.resolve(repoRoot, explicit);
  const candidates = [
    path.join(repoRoot, 'devseek-netai-latest.vsix'),
    path.join(extensionRoot, 'devseek-netai-latest.vsix'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function failEarly(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(2);
}

function isProductRunTerminalEvent(terminal) {
  const data = terminal && terminal.data ? terminal.data : {};
  return Boolean(terminal)
    && (terminal.event === 'agent-run-completed' || terminal.event === 'agent-run-failed')
    && data.mutationKind !== 'pending-edit-resolution'
    && data.mutationKind !== 'pending-edit-undo';
}

function selectProductRunLog(logs) {
  return logs.find((log) => isProductRunTerminalEvent(log.terminal))
    || logs.find((log) => log.terminal)
    || null;
}

function productRunLogSelectionSource() {
  return [
    isProductRunTerminalEvent.toString(),
    selectProductRunLog.toString(),
  ].join('\n\n');
}

function defaultPrompt(root, fixture) {
  if (fixture?.defaultPrompt) return fixture.defaultPrompt;
  return [
    '原来实现的吊运维保功能：设计文档+代码',
    `等${path.join(root, 'src/oam/src/lifting/maintenance')} 下面是最新的维保提醒的需求：`,
    `${path.join(root, 'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md')} 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议，通过md文档提供`,
    fixture?.requestedOutputDoc
      ? `请将仿真测试结果输出到 ${fixture.requestedOutputDoc}，文件名需要保留 simulation 标识。`
      : '',
  ].join('\n');
}

function createFixtureWorkspace(root, options = {}) {
  const scenarioSpec = buildRealPluginScenarioSpec(options.scenario);
  if (scenarioSpec.id === 'r3-07g-skill-aggregate') {
    return createR3SkillAggregateFixture(root, scenarioSpec);
  }

  const maintenanceDir = path.join(root, 'src/oam/src/lifting/maintenance');
  const docsDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/docs');
  const requestedOutputDoc = path.join(docsDir, 'warranty-maintenance-advice-simulation.md');
  const expectedArtifactRel = 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice-simulation-1.md';
  fs.mkdirSync(maintenanceDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/analysis'), { recursive: true });

  writeText(path.join(docsDir, 'uav-warranty-reminder-plan_v1.7.md'), [
    '# UAV 吊运维保提醒需求 v1.7',
    '',
    '## 背景',
    '旧版维保提醒只按单一时间阈值触发，不能覆盖多维度作业次数、累计飞行时长、吊运任务强度和关键部件寿命。',
    '',
    '## 新需求',
    '1. 维保状态需要支持时间、作业次数、飞行时长、吊运重量、风险等级等多维阈值。',
    '2. 主控需要输出结构化维保状态，支持 NORMAL、NOTICE、WARNING、OVERDUE。',
    '3. 每次任务 tick 后需要更新累计状态，并能持久化和恢复。',
    '4. 需要给地面站和日志系统发布状态变化事件。',
    '5. 当前任务只要求分析对策和任务拆解，通过 Markdown 文档提供，不要求直接改正式代码。',
  ].join('\n'));

  writeText(path.join(maintenanceDir, 'maintenance_types.hpp'), [
    '#pragma once',
    'enum class MaintenanceState { Normal, Notice, Warning, Overdue };',
    'struct MaintenanceStat {',
    '  int taskCount = 0;',
    '  double flightHours = 0.0;',
    '  double hoistWeightKg = 0.0;',
    '  MaintenanceState state = MaintenanceState::Normal;',
    '};',
  ].join('\n'));

  writeText(path.join(maintenanceDir, 'maintenance_threshold_engine.hpp'), [
    '#pragma once',
    '#include "maintenance_types.hpp"',
    'class MaintenanceThresholdEngine {',
    'public:',
    '  MaintenanceState evaluate(const MaintenanceStat& stat) const {',
    '    if (stat.taskCount > 300 || stat.flightHours > 120.0) return MaintenanceState::Overdue;',
    '    if (stat.taskCount > 240 || stat.flightHours > 90.0) return MaintenanceState::Warning;',
    '    if (stat.taskCount > 180 || stat.flightHours > 60.0) return MaintenanceState::Notice;',
    '    return MaintenanceState::Normal;',
    '  }',
    '};',
  ].join('\n'));

  writeText(path.join(maintenanceDir, 'maintenance_manager.hpp'), [
    '#pragma once',
    '#include "maintenance_threshold_engine.hpp"',
    'class MaintenanceManager {',
    'public:',
    '  MaintenanceState tick(const MaintenanceStat& current) {',
    '    return engine_.evaluate(current);',
    '  }',
    'private:',
    '  MaintenanceThresholdEngine engine_;',
    '};',
  ].join('\n'));

  writeText(path.join(maintenanceDir, 'maintenance_data_collector.hpp'), [
    '#pragma once',
    '#include "maintenance_types.hpp"',
    'class MaintenanceDataCollector {',
    'public:',
    '  MaintenanceStat snapshot() const { return {}; }',
    '};',
  ].join('\n'));

  writeText(path.join(root, 'README.md'), '# huida_uav fixture\n\nDevSeek live harness workspace.\n');

  if (options.scenario === 'formal-simulation') {
    writeText(path.join(docsDir, 'warranty-maintenance-advice.md'), [
      '# 旧建议文档',
      '',
      '这是正式项目中已经存在的旧分析产物，仿真测试不能覆盖它。',
    ].join('\n'));
    writeText(requestedOutputDoc, [
      '# 旧仿真建议文档',
      '',
      '这是上一次仿真留下的同名产物，本次应自动写入 warranty-maintenance-advice-simulation-1.md。',
    ].join('\n'));
    writeText(path.join(root, 'docs/analysis/uav_warranty_reminder_analysis_v1.7.md'), [
      '# 历史分析产物',
      '',
      '这是历史运行留下的文件。真实仿真不能把它当成本轮成功证据。',
    ].join('\n'));
  }

  return {
    requestedOutputDoc: options.scenario === 'formal-simulation' ? requestedOutputDoc : '',
    expectedArtifactRel: options.scenario === 'formal-simulation'
      ? expectedArtifactRel
      : 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
  };
}

function createR3SkillAggregateFixture(root, scenarioSpec) {
  const docsDir = path.join(root, 'docs/r3-iteration');
  const sourceDir = path.join(root, 'src/devseek-profile');
  const requestedOutputDoc = path.join(root, scenarioSpec.requestedOutputDocRel);
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.dirname(requestedOutputDoc), { recursive: true });

  writeText(path.join(root, 'README.md'), [
    '# DevSeek R3-07G aggregate fixture',
    '',
    'This workspace is created by the visible real-plugin harness for the current R3 iteration.',
  ].join('\n'));
  writeText(path.join(docsDir, 'skill-denominator-plan.md'), [
    '# R3-07G Skill Denominator Plan',
    '',
    '- Profile kind: skill',
    '- Required denominator: 20 task slots and 100 permission-fault slots.',
    '- Parent owner: ExtensionProfilePlanService.',
    '- Aggregate settlement is read-only and must not execute child slots.',
    '- Blocking classes: missing/failed/vetoed/blocked/duplicate/foreign.',
  ].join('\n'));
  writeText(path.join(sourceDir, 'extension-profile-plan-service-contract.ts'), [
    'export const EXTENSION_PROFILE_KIND_AGGREGATE_PROTOCOL = "devseek.extension-profile-kind-aggregate/v1";',
    'export const aggregateExecutionAllowed = false;',
    'export const slotExecutionAllowed = false;',
    'export const skillTaskSlotCount = 20;',
    'export const skillPermissionFaultSlotCount = 100;',
    'export const aggregateOwner = "ExtensionProfilePlanService";',
  ].join('\n'));

  const anchorLines = scenarioSpec.requiredArtifactSnippets
    .map(snippet => `- ${snippet}`)
    .join('\n');
  const defaultPrompt = [
    `请基于 ${path.join(docsDir, 'skill-denominator-plan.md')} 和 ${path.join(sourceDir, 'extension-profile-plan-service-contract.ts')} 创建 Markdown 审计报告。`,
    `请把报告保存到 ${requestedOutputDoc}。`,
    `报告主题是 ${scenarioSpec.promptTitle}。`,
    '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
    '',
    '报告必须解释：',
    '- 为什么 aggregate 只能读取已有 signed plan 和 owned slot receipts，不能在 aggregate 阶段执行 slot。',
    '- 为什么完整通过需要 20 task slots 与 100 permission-fault slots 全部有唯一 parent-owned passed receipt。',
    '- 为什么 missing/failed/vetoed/blocked/duplicate/foreign 任一类 receipt 都必须阻断结算。',
    '- 生成文件要包含本次测试结论、风险、验证建议和用户可检查的证据路径。',
    '',
    '报告必须逐字包含以下验收锚点：',
    anchorLines,
  ].join('\n');

  return {
    requestedOutputDoc,
    expectedArtifactRel: scenarioSpec.expectedArtifactRel,
    scenarioSpec,
    defaultPrompt,
  };
}

function describeExistingWorkspace(root, options = {}) {
  const artifactRoot = options.artifactRoot ? path.resolve(root, options.artifactRoot) : '';
  const artifactRunId = artifactRoot
    ? uniqueArtifactRunId(artifactRoot, options.artifactRunId || minuteTimestamp())
    : '';
  const artifactRunRoot = artifactRoot && artifactRunId ? path.join(artifactRoot, artifactRunId) : '';
  const artifactDocsDir = artifactRunRoot ? path.join(artifactRunRoot, 'docs') : '';
  const artifactSrcDir = artifactRunRoot ? path.join(artifactRunRoot, 'src') : '';
  if (artifactRunRoot) {
    fs.mkdirSync(artifactDocsDir, { recursive: true });
    fs.mkdirSync(artifactSrcDir, { recursive: true });
  }
  const requestedOutputDoc = artifactDocsDir
    ? path.join(artifactDocsDir, path.basename(options.outputDoc || 'warranty-maintenance-implementation.md'))
    : (options.outputDoc ? path.resolve(root, options.outputDoc) : '');
  if (!requestedOutputDoc) {
    return { requestedOutputDoc: '', expectedArtifactRel: '' };
  }
  const expectedAbs = artifactRunRoot
    ? requestedOutputDoc
    : uniqueMarkdownDocumentPath(path.dirname(requestedOutputDoc), path.basename(requestedOutputDoc));
  return {
    requestedOutputDoc,
    expectedArtifactRel: workspaceRelative(root, expectedAbs),
    expectedCodeDirRel: artifactSrcDir ? workspaceRelative(root, artifactSrcDir) : '',
    artifactRoot: artifactRoot ? workspaceRelative(root, artifactRoot) : '',
    artifactRunId,
    artifactRunRoot: artifactRunRoot ? workspaceRelative(root, artifactRunRoot) : '',
    artifactDocsDir: artifactDocsDir ? workspaceRelative(root, artifactDocsDir) : '',
    artifactSrcDir: artifactSrcDir ? workspaceRelative(root, artifactSrcDir) : '',
  };
}

function buildHarnessPrompt(basePrompt, fixtureInfo = {}) {
  const lines = [String(basePrompt || '').trim()].filter(Boolean);
  if (fixtureInfo.artifactRunRoot) {
    lines.push([
      '',
      '【真实测试输出目录要求】',
      `本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：${path.join(workspaceDir, fixtureInfo.artifactRunRoot)}`,
      `- 设计/实施 Markdown 文档放入：${path.join(workspaceDir, fixtureInfo.artifactDocsDir)}`,
      `- 新增代码、测试代码和验证脚本放入：${path.join(workspaceDir, fixtureInfo.artifactSrcDir)}`,
      fixtureInfo.requestedOutputDoc
        ? `- 必须创建主设计 Markdown 文档：${fixtureInfo.requestedOutputDoc}；可以另建事实矩阵、接口文档、修改清单等辅助文档，但主文档必须存在并汇总关键结论。`
        : '',
      '- 文件名使用正式、可读的业务命名，例如 warranty-maintenance-implementation.md、warranty-tunnel-transport.hpp；不要添加 selfloop、codex、verify、simulation 等临时后缀。',
      '- 不要修改正式源码目录里的既有文件；如果正式集成需要改原代码，必须在文档中提供“原有代码修改清单”，写明文件、函数/类、改动内容、原因、风险和验证方式。',
      '- 文档必须包含源项目事实矩阵、遥控器/主控接口文档、原有代码修改清单、验证证据和生成文件路径。',
      '- 遥控器/主控接口文档必须包含 request JSON 示例、response JSON 示例、字段类型/必填、版本兼容、超时/重试/幂等和错误码；JSON 示例必须使用标准 Markdown 三反引号代码块（```json），不能使用单反引号伪代码块。',
    ].filter(Boolean).join('\n'));
  }
  return lines.join('\n');
}

function minuteTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function uniqueArtifactRunId(root, preferred) {
  const base = String(preferred || minuteTimestamp()).replace(/[^0-9A-Za-z_-]/g, '') || minuteTimestamp();
  let candidate = base;
  for (let index = 2; index <= 50; index += 1) {
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
    candidate = `${base}-${String(index).padStart(2, '0')}`;
  }
  return `${base}-${Date.now()}`;
}

function uniqueMarkdownDocumentPath(dir, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(dir, filename);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    if (!fs.existsSync(candidate)) return candidate;
    candidate = path.join(dir, `${parsed.name}-${suffix}${parsed.ext || '.md'}`);
  }
  return candidate;
}

function workspaceRelative(root, filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : filePath.replace(/\\/g, '/');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${text.trimEnd()}\n`, 'utf8');
}

async function prepareDeepSeekLogin() {
  const loginWorkspace = path.join(tmpRoot, 'login-workspace');
  fs.mkdirSync(path.join(loginWorkspace, '.devseek'), { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(loginWorkspace, '.devseek/bridge-token'), token, 'utf8');
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = path.join(tmpRoot, 'login-bridge.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = cp.spawn('node', [bridgeServerPath], {
    cwd: path.dirname(bridgeServerPath),
    detached: keepDeepSeekPage,
    env: {
      ...process.env,
      HEADLESS: headed ? 'false' : 'true',
      DEVSEEK_BRIDGE_KEEP_VISIBLE: keepDeepSeekPage ? '1' : '',
      WORKSPACE_ROOT: loginWorkspace,
      BRIDGE_PORT: String(port),
      DEVSEEK_BRIDGE_TOKEN: token,
      DEVSEEK_TRACE_LEVEL: 'debug',
    },
    stdio: ['ignore', logFd, logFd],
  });

  try {
    await waitForBridge(baseUrl, token);
    const reloginResponse = await fetchJson(`${baseUrl}/relogin`, {
      method: 'POST',
      headers: { 'X-DevSeek-Token': token },
    });
    await waitForBrowserReady(baseUrl, token, 320000);
    return { ok: true, port, logPath, pid: child.pid, keepVisible: keepDeepSeekPage, reloginResponse };
  } finally {
    if (keepDeepSeekPage) {
      child.unref();
    } else {
      await shutdownBridge(baseUrl, token);
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    fs.closeSync(logFd);
  }
}

async function findFreePort() {
  for (let i = 0; i < 40; i++) {
    const port = 47300 + Math.floor(Math.random() * 1200);
    if (await canListen(port)) return port;
  }
  throw new Error('未找到可用本地端口');
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function waitForBridge(baseUrl, token) {
  const deadline = Date.now() + 15000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const ping = await fetch(`${baseUrl}/ping`);
      if (ping.ok) {
        const statusRes = await fetch(`${baseUrl}/status`, { headers: { 'X-DevSeek-Token': token } });
        if (statusRes.ok) return statusRes.json();
        last = `${statusRes.status}: ${await statusRes.text()}`;
      }
    } catch (error) {
      last = String(error?.message || error);
    }
    await delay(500);
  }
  throw new Error(`Bridge 未就绪：${last}`);
}

async function waitForBrowserReady(baseUrl, token, waitMs) {
  const deadline = Date.now() + waitMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/status`, { headers: { 'X-DevSeek-Token': token } });
    if (res.ok) {
      lastStatus = await res.json();
      if (lastStatus.browserReady) return lastStatus;
    }
    await delay(1000);
  }
  throw new Error(`可见登录等待超时：${JSON.stringify(lastStatus)}`);
}

async function shutdownBridge(baseUrl, token) {
  try {
    await fetch(`${baseUrl}/shutdown`, { method: 'POST', headers: { 'X-DevSeek-Token': token } });
  } catch {
    // The process may already be down.
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${url} failed ${res.status}: ${text}`);
  return body;
}

function installVsixIntoTempExtensions() {
  const result = cp.spawnSync(codeBin, [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', vsixPath,
    '--force',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status !== 0) {
    failEarly([
      '安装 DevSeek VSIX 到临时 VS Code 扩展目录失败。',
      `command: ${codeBin} --install-extension ${vsixPath}`,
      `stdout: ${result.stdout || ''}`,
      `stderr: ${result.stderr || ''}`,
    ].join('\n'));
  }
}

function writeDriverExtension() {
  fs.writeFileSync(path.join(driverDir, 'package.json'), JSON.stringify({
    name: 'devseek-real-plugin-deepseek-driver',
    displayName: 'DevSeek Real Plugin DeepSeek Driver',
    version: '0.0.0',
    publisher: 'devseek-harness',
    engines: { vscode: '^1.85.0' },
    activationEvents: ['*'],
    main: './extension.js',
  }, null, 2), 'utf8');

  const source = String.raw`
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const reportPath = __REPORT_PATH__;
const progressPath = __PROGRESS_PATH__;
const workspaceDir = __WORKSPACE_DIR__;
const prompt = __PROMPT__;
const timeoutMs = __TIMEOUT_MS__;
const pluginPort = __PLUGIN_PORT__;
const autopilot = __AUTOPILOT__;
const keepWindow = __KEEP_WINDOW__;
const scenario = __SCENARIO__;
const harnessMode = __HARNESS_MODE__;
const qualityProfile = __QUALITY_PROFILE__;
const requiredArtifactSnippets = __REQUIRED_ARTIFACT_SNIPPETS__;
const expectedArtifact = __EXPECTED_ARTIFACT__;
const expectedArtifacts = __EXPECTED_ARTIFACTS__;
const expectedCodeArtifacts = __EXPECTED_CODE_ARTIFACTS__;
const expectedCodeDirs = __EXPECTED_CODE_DIRS__;
const markdownQualityModulePath = __MARKDOWN_QUALITY_MODULE_PATH__;
const formalProjectQualityModulePath = __FORMAL_PROJECT_QUALITY_MODULE_PATH__;
let assessRuntimeMarkdownDocumentQuality = null;
let assessRuntimeFormalProjectDocumentQuality = null;
try {
  assessRuntimeMarkdownDocumentQuality = require(markdownQualityModulePath).assessMarkdownDocumentQuality;
} catch {
  assessRuntimeMarkdownDocumentQuality = null;
}
try {
  assessRuntimeFormalProjectDocumentQuality = require(formalProjectQualityModulePath).assessFormalProjectDocumentQuality;
} catch {
  assessRuntimeFormalProjectDocumentQuality = null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeReport(payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function logProgress(stage, extra = {}) {
  fs.appendFileSync(progressPath, JSON.stringify({
    ts: new Date().toISOString(),
    stage,
    ...extra,
  }) + '\n', 'utf8');
}

function rel(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function walk(dir, visitor) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visitor);
    } else {
      visitor(full);
    }
  }
}

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function assessMarkdownQuality(content) {
  if (typeof assessRuntimeMarkdownDocumentQuality === 'function') {
    return assessRuntimeMarkdownDocumentQuality(content);
  }
  const lines = String(content || '').split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const firstLineLength = nonEmpty.length ? nonEmpty[0].length : 0;
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const headingCount = lines.filter((line) => /^#{1,6}\s+\S/.test(line.trim())).length;
  const emptyHeadingCount = lines.filter((line) => /^#{1,6}\s*$/.test(line.trim())).length;
  const hasCopyControls = /复制下载|(?:plain\s*text|text|json|cpp|c\+\+|bash|shell|markdown|md)\s*复制\s*下载/i.test(content);
  const gluedMetadataLineCount = lines.filter((line) => {
    const trimmed = line.trim();
    if (!/^\s*(?:[-*]\s*)?(?:\*\*)?(?:文档编号|文档版本|对应需求版本|对应需求|关联需求|关联旧实现|旧实现|参考实现|文档路径|目标路径|创建日期|生成日期|生成时间|文档类型|状态|版本)(?:\*\*)?\s*[:：]/.test(trimmed)) return false;
    const matches = trimmed.match(/(?:\*\*)?(?:文档编号|文档版本|对应需求版本|对应需求|关联需求|关联旧实现|旧实现|参考实现|文档路径|目标路径|创建日期|生成日期|生成时间|文档类型|状态|版本)(?:\*\*)?\s*[:：]/g);
    return matches && matches.length >= 2;
  }).length;
  const rawChineseSectionCount = lines.filter((line) => /^[一二三四五六七八九十]{1,3}[、.．]\s*\S/.test(line.trim())).length;
  const ok = Boolean(nonEmpty.length > 0
    && /^#{1,6}\s+\S/.test(nonEmpty[0])
    && headingCount >= 2
    && emptyHeadingCount === 0
    && firstLineLength <= 260
    && maxLineLength <= 2400
    && gluedMetadataLineCount === 0
    && rawChineseSectionCount === 0
    && !hasCopyControls);
  return {
    ok,
    firstLineLength,
    maxLineLength,
    headingCount,
    emptyHeadingCount,
    hasCopyControls,
    gluedMetadataLineCount,
    rawChineseSectionCount,
    reasons: [
      nonEmpty.length === 0 ? 'empty-document' : '',
      nonEmpty.length > 0 && !/^#{1,6}\s+\S/.test(nonEmpty[0]) ? 'missing-title-heading' : '',
      headingCount < 2 ? 'insufficient-heading-count' : '',
      emptyHeadingCount > 0 ? 'empty-heading' : '',
      firstLineLength > 260 ? 'first-line-too-long' : '',
      maxLineLength > 2400 ? 'line-too-long' : '',
      gluedMetadataLineCount > 0 ? 'glued-metadata-lines' : '',
      rawChineseSectionCount > 0 ? 'raw-chinese-section-headings' : '',
      hasCopyControls ? 'provider-copy-controls' : '',
    ].filter(Boolean),
  };
}

function assessFormalProjectQuality(content, promptText) {
  if (!qualityProfile.requireFormalProjectQuality) {
    return { required: false, ok: true, reasons: [], skippedByProfile: qualityProfile.kind };
  }
  if (typeof assessRuntimeFormalProjectDocumentQuality === 'function') {
    return assessRuntimeFormalProjectDocumentQuality(content, promptText);
  }
  const combined = String(promptText || '') + '\n' + String(content || '');
  const required = /(?:既有|现有|原项目|大项目|正式项目|生产项目|主控|平台|遥控器|模块|接口文档|\/src\/)/i.test(combined);
  const hasSourceRefs = ((String(content || '').match(/(?:[\w.-]+\.(?:cpp|hpp|h|md)(?::\d+)?|src\/[\w./-]+|\/src\/[\w./-]+)/gi) || []).length >= 4);
  const hasProtocolFacts = ((String(content || '').match(/(?:kTunnel\w*|TunnelMsgType|MAVLINK_MSG_TUNNEL|crc32|sessionId|payloadLen|totalLen|topic|UAV_EVENT|COMMAND_LONG|分片|超时|重试)/gi) || []).length >= 6);
  const hasInterfaceDoc = /(?:遥控器|遥控|主控|平台)/i.test(combined)
    ? /(?:JSON|schema|字段|payload).{0,120}(?:示例|request|response)|(?:示例|request|response).{0,120}(?:JSON|schema|字段|payload)/i.test(content)
    : true;
  const hasModificationPlan = /(?:代码实现|实现代码|新增|修改|创建|验证)/i.test(promptText || '')
    ? /(?:原有代码修改清单|修改点|需要修改|目标文件).{0,200}(?:风险|验证|回归)/is.test(content)
    : true;
  const reasons = [
    required && !hasSourceRefs ? 'missing-source-fact-matrix' : '',
    required && !hasProtocolFacts ? 'missing-concrete-protocol-facts' : '',
    required && !hasInterfaceDoc ? 'missing-remote-controller-interface-doc' : '',
    required && !hasModificationPlan ? 'missing-existing-code-modification-plan' : '',
  ].filter(Boolean);
  return { required, ok: !required || reasons.length === 0, reasons };
}

function markdownSnapshot() {
  const map = new Map();
  walk(workspaceDir, (filePath) => {
    if (!/\.(?:md|markdown)$/i.test(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    map.set(rel(workspaceDir, filePath), {
      size: Buffer.byteLength(content),
      hash: hashText(content),
      preview: content.slice(0, 300),
    });
  });
  return map;
}

function selectedArtifactSnapshot(paths) {
  const map = new Map();
  for (const artifactPath of paths) {
    const absolutePath = path.join(workspaceDir, artifactPath);
    if (!fs.existsSync(absolutePath)) {
      map.set(artifactPath, { exists: false, size: 0, hash: '' });
      continue;
    }
    const content = fs.readFileSync(absolutePath);
    map.set(artifactPath, {
      exists: true,
      size: content.length,
      hash: crypto.createHash('sha1').update(content).digest('hex'),
    });
  }
  return map;
}

function selectedArtifactRecords(paths, before, normalizedChangedPaths) {
  return paths.map((artifactPath) => {
    const absolutePath = path.join(workspaceDir, artifactPath);
    const previous = before.get(artifactPath) || { exists: false, size: 0, hash: '' };
    const exists = fs.existsSync(absolutePath);
    const content = exists ? fs.readFileSync(absolutePath) : Buffer.alloc(0);
    const hash = exists ? crypto.createHash('sha1').update(content).digest('hex') : '';
    return {
      path: artifactPath,
      absolutePath,
      exists,
      created: exists && !previous.exists,
      changed: exists && previous.exists && hash !== previous.hash,
      size: content.length,
      inRunLog: normalizedChangedPaths.includes(artifactPath),
    };
  });
}

function isHarnessCodeArtifact(relative) {
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (/(^|\/)docs?\//i.test(normalized)) return false;
  const base = path.posix.basename(normalized);
  return /\.(?:c|cc|cpp|cxx|h|hh|hpp|ipp|inl|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|sh|bash|cmake)$/i.test(base)
    || /^(?:CMakeLists\.txt|Makefile|Dockerfile)$/i.test(base);
}

function selectedCodeDirSnapshot(dirs) {
  const map = new Map();
  for (const dirRel of dirs) {
    const dirAbs = path.join(workspaceDir, dirRel);
    if (!fs.existsSync(dirAbs)) continue;
    walk(dirAbs, (filePath) => {
      const relative = rel(workspaceDir, filePath);
      if (!isHarnessCodeArtifact(relative)) return;
      const content = fs.readFileSync(filePath);
      map.set(relative, {
        exists: true,
        size: content.length,
        hash: crypto.createHash('sha1').update(content).digest('hex'),
      });
    });
  }
  return map;
}

function selectedCodeDirRecords(dirs, before, normalizedChangedPaths) {
  const records = [];
  for (const dirRel of dirs) {
    const dirAbs = path.join(workspaceDir, dirRel);
    if (!fs.existsSync(dirAbs)) continue;
    walk(dirAbs, (filePath) => {
      const relative = rel(workspaceDir, filePath);
      if (!isHarnessCodeArtifact(relative)) return;
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha1').update(content).digest('hex');
      const previous = before.get(relative) || { exists: false, size: 0, hash: '' };
      records.push({
        dir: dirRel,
        path: relative,
        absolutePath: filePath,
        exists: true,
        created: !previous.exists,
        changed: previous.exists && hash !== previous.hash,
        size: content.length,
        qualitySignals: assessCodeArtifactSignals(relative, content.toString('utf8')),
        inRunLog: normalizedChangedPaths.includes(relative),
      });
    });
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function assessCodeArtifactSignals(relative, content) {
  const normalizedPath = String(relative || '').replace(/\\/g, '/');
  const base = path.posix.basename(normalizedPath);
  const text = String(content || '');
  const isTestLike = /(?:^|\/)(?:tests?|selftests?|__tests__)(?:\/|$)/i.test(normalizedPath)
    || /(?:test|spec|selftest|verify|validation)/i.test(base);
  const hasImplementationSyntax = /(?:#include|namespace\s+\w+|class\s+\w+|struct\s+\w+|enum\s+(?:class\s+)?\w+|\b(?:void|bool|int|double|float|std::string)\s+\w+\s*\()/i.test(text);
  const hasFormalProjectAnchor = /(?:UAV_EVENT|MAVLink|mavlink|remote.?controller|RemoteController|platform|Platform|warranty|Warranty|maintenance|Maintenance|主控|遥控器|平台|维保)/i.test(text);
  const hasValidationHook = /(?:assert\s*\(|static_assert|EXPECT_|ASSERT_|self.?test|SelfTest|verify|validate|validation|单元测试|自测|验证)/i.test(text);
  const hasStandaloneSampleMain = /\bint\s+main\s*\(/.test(text) && !isTestLike;
  const hasToySample = /hello\s+world|Hello\s+World|TODO:\s*implement/i.test(text);
  const hasMarkdownDunderCorruption = /\*\*(?:init|name|main|str|repr|len|iter|next|enter|exit|eq|ne|lt|le|gt|ge|hash|call|dict|class|module|all|file|doc|annotations|slots|getattr|setattr|delattr|contains|getitem|setitem|delitem|bool|bytes|format|new|del)\*\*/.test(text);
  const hasToolProtocolContamination = /(?:\[调用\s+(?:create_file|write_file|replace_in_file|run_terminal|read_file|list_dir|search_file)\]|\bCalling:\s*(?:create_file|write_file|replace_in_file|run_terminal|read_file|list_dir|search_file)\b|<TOOL_[A-Za-z0-9_]+>|<\/TOOL_[A-Za-z0-9_]+>)/.test(text);
  return {
    isTestLike,
    hasImplementationSyntax,
    hasFormalProjectAnchor,
    hasValidationHook,
    hasStandaloneSampleMain,
    hasToySample,
    hasMarkdownDunderCorruption,
    hasToolProtocolContamination,
  };
}

function assessCodeDirQuality(records, promptText) {
  const changedRecords = records.filter(record => record.exists && (record.created || record.changed) && record.size > 0);
  const productionRecords = changedRecords.filter(record => !record.qualitySignals.isTestLike);
  const validationRequired = /(?:自闭环|测试|验证|单体|单元|self.?loop|test|verify|validation)/i.test(promptText || '');
  const hasImplementationSyntax = productionRecords.some(record => record.qualitySignals.hasImplementationSyntax);
  const hasFormalProjectAnchor = changedRecords.some(record => record.qualitySignals.hasFormalProjectAnchor);
  const hasValidationHook = changedRecords.some(record => record.qualitySignals.hasValidationHook || record.qualitySignals.isTestLike);
  const standaloneSampleRecords = changedRecords
    .filter(record => record.qualitySignals.hasStandaloneSampleMain || record.qualitySignals.hasToySample)
    .map(record => record.path);
  const markdownDunderCorruptionRecords = changedRecords
    .filter(record => record.qualitySignals.hasMarkdownDunderCorruption)
    .map(record => record.path);
  const toolProtocolContaminationRecords = changedRecords
    .filter(record => record.qualitySignals.hasToolProtocolContamination)
    .map(record => record.path);
  const reasons = [
    changedRecords.length === 0 ? 'no-code-change' : '',
    productionRecords.length === 0 ? 'no-production-code-artifact' : '',
    !hasImplementationSyntax ? 'missing-implementation-syntax' : '',
    !hasFormalProjectAnchor ? 'missing-formal-project-anchor' : '',
    validationRequired && !hasValidationHook ? 'missing-validation-hook' : '',
    standaloneSampleRecords.length > 0 ? 'standalone-sample-code' : '',
    markdownDunderCorruptionRecords.length > 0 ? 'code-markdown-emphasis-corruption' : '',
    toolProtocolContaminationRecords.length > 0 ? 'code-tool-protocol-contamination' : '',
  ].filter(Boolean);
  return {
    ok: reasons.length === 0,
    changedCount: changedRecords.length,
    productionCount: productionRecords.length,
    validationRequired,
    hasImplementationSyntax,
    hasFormalProjectAnchor,
    hasValidationHook,
    standaloneSampleRecords,
    markdownDunderCorruptionRecords,
    toolProtocolContaminationRecords,
    reasons,
  };
}

function assessStageArtifactQuality(input) {
  const formal = input.formalProjectQuality || {};
  const codeQuality = input.expectedCodeDirQuality || { ok: true, reasons: [], hasValidationHook: false };
  const promptText = String(input.promptText || '');
  const formalSignal = (key) => Object.prototype.hasOwnProperty.call(formal, key)
    ? Boolean(formal[key])
    : Boolean(formal.ok);
  const codeEvidenceRequired = Boolean(input.codeEvidenceRequired);
  const validationRequired = codeEvidenceRequired
    || /(?:自闭环|测试|验证|单体|单元|编译|运行|self.?loop|test|verify|validation|compile|build)/i.test(promptText);
  const stages = [];

  const contextReasons = [
    formal.required && !formalSignal('hasSourceFactMatrix') ? 'missing-source-fact-matrix' : '',
    formal.required && !formalSignal('hasConcreteProtocolFacts') ? 'missing-concrete-protocol-facts' : '',
    formal.required && formal.requiresLicenseReference && !formalSignal('hasProjectWideCommunicationChain') ? 'missing-project-wide-communication-chain' : '',
  ].filter(Boolean);
  stages.push({
    id: 'context-investigation',
    label: '需求/原项目事实调查',
    required: Boolean(formal.required),
    ok: !formal.required || contextReasons.length === 0,
    reasons: contextReasons,
  });

  const designReasons = [
    formal.required && formal.requiresRemoteControllerInterface && !formalSignal('hasRemoteControllerInterfaceDoc') ? 'missing-remote-controller-interface-doc' : '',
    formal.required && formal.requiresRemoteControllerInterface && !formalSignal('hasInterfaceRequestExample') ? 'missing-interface-request-example' : '',
    formal.required && formal.requiresRemoteControllerInterface && !formalSignal('hasInterfaceResponseExample') ? 'missing-interface-response-example' : '',
    formal.required && formal.requiresRemoteControllerInterface && !formalSignal('hasInterfaceFencedJsonExample') ? 'missing-fenced-json-interface-example' : '',
    formal.required && formal.requiresModificationPlan && !formalSignal('hasExistingCodeModificationPlan') ? 'missing-existing-code-modification-plan' : '',
  ].filter(Boolean);
  stages.push({
    id: 'design-interface',
    label: '设计/接口/原代码修改清单',
    required: Boolean(formal.required),
    ok: !formal.required || designReasons.length === 0,
    reasons: designReasons,
  });

  const implementationReasons = [
    codeEvidenceRequired && !input.expectedCodeArtifactsWritten ? 'expected-code-artifacts-not-written' : '',
    codeEvidenceRequired && !input.expectedCodeArtifactsInRunLog ? 'expected-code-artifacts-not-in-run-log' : '',
    codeEvidenceRequired && !input.expectedCodeDirArtifactsWritten ? 'expected-code-dir-not-written' : '',
    codeEvidenceRequired && !input.expectedCodeDirArtifactsInRunLog ? 'expected-code-dir-not-in-run-log' : '',
    codeEvidenceRequired && !codeQuality.ok ? 'code-quality:' + (codeQuality.reasons || []).join('|') : '',
  ].filter(Boolean);
  stages.push({
    id: 'implementation',
    label: '代码实现成果物',
    required: codeEvidenceRequired,
    ok: !codeEvidenceRequired || implementationReasons.length === 0,
    reasons: implementationReasons,
  });

  const verificationReasons = [
    validationRequired && !input.successTerminal ? 'agent-run-not-successful' : '',
    validationRequired && Number(input.tasksApplied || 0) <= 0 ? 'no-applied-task' : '',
    validationRequired && Number(input.tasksFailed || 0) > 0 ? 'task-failed' : '',
    codeEvidenceRequired && !codeQuality.hasValidationHook ? 'missing-code-validation-hook' : '',
  ].filter(Boolean);
  stages.push({
    id: 'verification',
    label: '编译/测试/自闭环验证',
    required: validationRequired,
    ok: !validationRequired || verificationReasons.length === 0,
    reasons: verificationReasons,
  });

  const deliveryReasons = [
    input.markdownRequired && !input.markdownEvidenceOk ? 'markdown-deliverable-missing-or-not-in-run-log' : '',
    formal.required && !formal.ok ? 'formal-document-quality:' + (formal.reasons || []).join('|') : '',
  ].filter(Boolean);
  stages.push({
    id: 'delivery',
    label: '最终交付与用户可读成果',
    required: Boolean(input.markdownRequired || formal.required),
    ok: (!input.markdownRequired || input.markdownEvidenceOk) && (!formal.required || formal.ok),
    reasons: deliveryReasons,
  });

  return {
    ok: stages.every(stage => stage.ok),
    stages,
  };
}

function changedMarkdownArtifacts(before) {
  const artifacts = [];
  walk(workspaceDir, (filePath) => {
    if (!/\.(?:md|markdown)$/i.test(filePath)) return;
    const relative = rel(workspaceDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const requiredContentMatches = requiredArtifactSnippets.map((snippet) => ({
      snippet,
      present: content.includes(snippet),
    }));
    const current = {
      path: relative,
      absolutePath: filePath,
      size: Buffer.byteLength(content),
      hash: hashText(content),
      preview: content.slice(0, 600),
      requiredContentMatches,
      requiredContentOk: requiredContentMatches.every((item) => item.present),
      markdownQuality: assessMarkdownQuality(content),
      formalProjectQuality: assessFormalProjectQuality(content, prompt),
    };
    const previous = before.get(relative);
    if (!previous || previous.hash !== current.hash) {
      artifacts.push({
        ...current,
        created: !previous,
        changed: Boolean(previous && previous.hash !== current.hash),
        markdownQualityOk: current.markdownQuality.ok,
        formalProjectQualityOk: current.formalProjectQuality.ok,
      });
    }
  });
  return artifacts.sort((a, b) => b.size - a.size);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseRunLogStartedAtMs(name) {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.log$/.exec(String(name || ''));
  if (!match) return 0;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
}

${productRunLogSelectionSource()}

function collectRunLogs(startedAtMs) {
  const runDir = path.join(workspaceDir, '.devseek', 'runs');
  const logs = [];
  if (!fs.existsSync(runDir)) return { logs, terminal: null };
  for (const name of fs.readdirSync(runDir)) {
    if (!name.endsWith('.log')) continue;
    const full = path.join(runDir, name);
    const stat = fs.statSync(full);
    const runStartedAtMs = parseRunLogStartedAtMs(name);
    const isCurrentRun = runStartedAtMs
      ? runStartedAtMs + 2000 >= startedAtMs
      : stat.mtimeMs + 2000 >= startedAtMs;
    if (!isCurrentRun) continue;
    const events = fs.readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean);
    const terminal = events.find((event) => event.event === 'agent-run-completed' || event.event === 'agent-run-failed');
    logs.push({
      path: rel(workspaceDir, full),
      absolutePath: full,
      runStartedAtMs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      events: events.length,
      lastEvent: events.length ? events[events.length - 1].event : '',
      terminal: terminal ? { event: terminal.event, data: terminal.data || {} } : null,
      providerFailures: events
        .filter((event) => /failed|corrupt|truncated|LOGIN_REQUIRED|HTTP/i.test(String(event.event) + ' ' + JSON.stringify(event.data || {})))
        .slice(-8)
        .map((event) => ({ event: event.event, data: event.data || {} })),
    });
  }
  logs.sort((a, b) => (b.runStartedAtMs - a.runStartedAtMs) || (b.mtimeMs - a.mtimeMs) || (b.size - a.size));
  const terminal = selectProductRunLog(logs)?.terminal || null;
  return { logs, terminal };
}

async function waitForCommand(command, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const commands = await vscode.commands.getCommands(false);
    if (commands.includes(command)) return true;
    await delay(500);
  }
  return false;
}

async function updateConfig(key, value) {
  await vscode.workspace.getConfiguration('devseek').update(key, value, vscode.ConfigurationTarget.Workspace);
}

function evaluate(before, startedAtMs, expectedCodeBefore = new Map(), expectedCodeDirBefore = new Map()) {
  const artifacts = changedMarkdownArtifacts(before);
  const runLogs = collectRunLogs(startedAtMs);
  const terminalData = runLogs.terminal && runLogs.terminal.data ? runLogs.terminal.data : {};
  const tasksFailed = Number(terminalData.tasksFailed || 0);
  const tasksApplied = Number(terminalData.tasksApplied || 0);
  const changedPaths = Array.isArray(terminalData.changedPaths) ? terminalData.changedPaths : [];
  const normalizedChangedPaths = changedPaths.map(normalizeChangedPathForWorkspace);
  const changedMarkdownByLog = normalizedChangedPaths.some((item) => /\.(?:md|markdown)$/i.test(item));
  const hasUsefulMarkdown = artifacts.some((artifact) => artifact.size >= qualityProfile.minimumMarkdownBytes
    && artifact.requiredContentOk
    && artifact.markdownQualityOk);
  const formalProjectQuality = assessFormalProjectQuality(
    artifacts.map(artifact => fs.readFileSync(artifact.absolutePath, 'utf8')).join('\n\n'),
    prompt,
  );
  const expectedArtifactRecords = expectedArtifacts.map((artifactPath) => ({
    path: artifactPath,
    artifact: artifacts.find((artifact) => artifact.path === artifactPath) || null,
    inRunLog: normalizedChangedPaths.includes(artifactPath),
  }));
  const expectedArtifactRecord = expectedArtifact
    ? artifacts.find((artifact) => artifact.path === expectedArtifact)
    : null;
  const expectedArtifactWritten = expectedArtifacts.length > 0
    ? expectedArtifactRecords.every((record) => Boolean(record.artifact
      && record.artifact.created
      && record.artifact.size >= qualityProfile.minimumMarkdownBytes
      && record.artifact.requiredContentOk
      && record.artifact.markdownQualityOk))
    : hasUsefulMarkdown;
  const expectedArtifactInRunLog = expectedArtifacts.length > 0
    ? expectedArtifactRecords.every((record) => record.inRunLog)
    : changedMarkdownByLog;
  const expectedCodeArtifactRecords = selectedArtifactRecords(expectedCodeArtifacts, expectedCodeBefore, normalizedChangedPaths);
  const expectedCodeArtifactsWritten = expectedCodeArtifacts.length > 0
    ? expectedCodeArtifactRecords.every((record) => record.exists && (record.created || record.changed) && record.size > 0)
    : true;
  const expectedCodeArtifactsInRunLog = expectedCodeArtifacts.length > 0
    ? expectedCodeArtifactRecords.every((record) => record.inRunLog)
    : true;
  const expectedCodeDirRecords = selectedCodeDirRecords(expectedCodeDirs, expectedCodeDirBefore, normalizedChangedPaths);
  const expectedCodeDirQuality = assessCodeDirQuality(expectedCodeDirRecords, prompt);
  const expectedCodeDirArtifactsWritten = expectedCodeDirs.length > 0
    ? expectedCodeDirRecords.some((record) => record.exists && (record.created || record.changed) && record.size > 0)
    : true;
  const expectedCodeDirArtifactsInRunLog = expectedCodeDirs.length > 0
    ? expectedCodeDirRecords.some((record) => record.inRunLog && (record.created || record.changed))
    : true;
  const expectedCodeDirQualityOk = expectedCodeDirs.length > 0
    ? expectedCodeDirQuality.ok
    : true;
  const codeEvidenceRequired = expectedCodeArtifacts.length > 0 || expectedCodeDirs.length > 0;
  const markdownRequired = expectedArtifacts.length > 0 || !codeEvidenceRequired;
  const markdownEvidenceOk = markdownRequired
    ? changedMarkdownByLog && hasUsefulMarkdown && expectedArtifactWritten && expectedArtifactInRunLog
    : true;
  const formalProjectQualityOk = formalProjectQuality.required ? formalProjectQuality.ok : true;
  const staleAnalysisChanged = artifacts.some((artifact) => artifact.path === 'docs/analysis/uav_warranty_reminder_analysis_v1.7.md');
  const successTerminal = runLogs.terminal
    && runLogs.terminal.event === 'agent-run-completed'
    && String(terminalData.status || '') === 'completed'
    && tasksFailed === 0;
  const stageArtifactQuality = assessStageArtifactQuality({
    formalProjectQuality,
    expectedCodeDirQuality,
    expectedCodeArtifactsWritten,
    expectedCodeArtifactsInRunLog,
    expectedCodeDirArtifactsWritten,
    expectedCodeDirArtifactsInRunLog,
    markdownRequired,
    markdownEvidenceOk,
    successTerminal: Boolean(successTerminal),
    tasksApplied,
    tasksFailed,
    codeEvidenceRequired,
    promptText: prompt,
  });
  const ok = Boolean(successTerminal
    && tasksApplied > 0
    && markdownEvidenceOk
    && expectedCodeArtifactsWritten
    && expectedCodeArtifactsInRunLog
    && expectedCodeDirArtifactsWritten
    && expectedCodeDirArtifactsInRunLog
    && expectedCodeDirQualityOk
    && formalProjectQualityOk
    && stageArtifactQuality.ok);
  return {
    ok,
    artifacts,
    runLogs,
    checks: {
      successTerminal: Boolean(successTerminal),
      tasksApplied,
      tasksFailed,
      changedMarkdownByLog,
      hasUsefulMarkdown,
      expectedArtifact,
      expectedArtifacts,
      expectedArtifactRecords,
      expectedArtifactWritten,
      expectedArtifactInRunLog,
      qualityProfile,
      requiredArtifactSnippets,
      markdownRequired,
      markdownEvidenceOk,
      formalProjectQuality,
      formalProjectQualityOk,
      expectedCodeArtifacts,
      expectedCodeArtifactRecords,
      expectedCodeArtifactsWritten,
      expectedCodeArtifactsInRunLog,
      expectedCodeDirs,
      expectedCodeDirRecords,
      expectedCodeDirArtifactsWritten,
      expectedCodeDirArtifactsInRunLog,
      expectedCodeDirQuality,
      expectedCodeDirQualityOk,
      stageArtifactQuality,
      staleAnalysisChanged,
    },
  };
}

function normalizeChangedPathForWorkspace(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) return rel(workspaceDir, normalized);
  return normalized;
}

async function activate() {
  const startedAtMs = Date.now();
  const before = markdownSnapshot();
  const expectedCodeBefore = selectedArtifactSnapshot(expectedCodeArtifacts);
  const expectedCodeDirBefore = selectedCodeDirSnapshot(expectedCodeDirs);
  logProgress('activate-started', { workspaceDir });
  const baseReport = {
    ok: false,
    mode: 'real-plugin-deepseek',
    scenario,
    harnessMode,
    expectedArtifact,
    expectedArtifacts,
    expectedCodeArtifacts,
    expectedCodeDirs,
    startedAt: new Date(startedAtMs).toISOString(),
    workspaceDir,
    promptPreview: prompt.slice(0, 600),
    commandInjected: false,
    commandName: '',
    commandCompleted: false,
    errors: [],
    artifacts: [],
    runLogs: { logs: [], terminal: null },
    checks: {},
  };

  try {
    logProgress('config-update-started');
    await updateConfig('provider', 'bridge');
    await updateConfig('agentEnabled', true);
    await updateConfig('autopilotMode', autopilot);
    await updateConfig('traceLevel', 'debug');
    await updateConfig('serverPort', pluginPort);
    await updateConfig('newSessionPerRequest', true);
    await updateConfig('requestTimeoutMs', 180000);
    logProgress('config-update-completed');

    logProgress('focus-sidebar-started');
    await vscode.commands.executeCommand('workbench.view.extension.devseek-sidebar').catch(() => {});
    logProgress('focus-sidebar-completed');
    logProgress('wait-command-started');
    const commandName = await waitForCommand('_devseek.harnessSubmitChatMessage', 60000)
      ? '_devseek.harnessSubmitChatMessage'
      : (await waitForCommand('_devseek.harnessRunChat', 1000)
          ? '_devseek.harnessRunChat'
          : (await waitForCommand('_deepseek.askChat', 1000) ? '_deepseek.askChat' : ''));
    if (!commandName) throw new Error('DevSeek chat command was not registered within 60s');
    baseReport.commandName = commandName;
    logProgress('wait-command-completed', { commandName });
    logProgress('open-chat-started');
    await vscode.commands.executeCommand('devseek.openChat').catch(() => {});
    await delay(1500);
    logProgress('open-chat-completed');
    let commandError = '';
    let commandCompletedAt = 0;
    logProgress('execute-command-started', { commandName, harnessMode });
    void vscode.commands.executeCommand(commandName, prompt, prompt, true, harnessMode)
      .then(() => {
        baseReport.commandCompleted = true;
        commandCompletedAt = Date.now();
        logProgress('execute-command-completed', { commandName });
      })
      .catch((error) => {
        commandError = String(error && error.stack || error && error.message || error);
        logProgress('execute-command-failed', { commandName, error: commandError });
      });
    baseReport.commandInjected = true;
    logProgress('poll-started');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const evaluation = evaluate(before, startedAtMs, expectedCodeBefore, expectedCodeDirBefore);
      Object.assign(baseReport, evaluation);
      if (commandError) {
        baseReport.errors.push(commandError);
        break;
      }
      if (commandCompletedAt > 0
        && Date.now() - commandCompletedAt > 15_000
        && evaluation.runLogs.logs.length === 0
        && evaluation.artifacts.length === 0) {
        baseReport.errors.push('DevSeek harness command completed without creating run log, Bridge request, or Markdown artifact.');
        break;
      }
      if (evaluation.ok) break;
      const terminal = evaluation.runLogs.terminal;
      if (terminal && terminal.event === 'agent-run-completed') break;
      if (terminal && terminal.event === 'agent-run-failed') break;
      await delay(3000);
    }

    const finalEvaluation = evaluate(before, startedAtMs, expectedCodeBefore, expectedCodeDirBefore);
    Object.assign(baseReport, finalEvaluation);
    if (!baseReport.ok) {
      if (baseReport.checks?.formalProjectQualityOk === false) {
        baseReport.errors.push('正式项目文档质量不达标：' + (baseReport.checks.formalProjectQuality.reasons || []).join(', '));
      }
      if (baseReport.checks?.stageArtifactQuality?.ok === false) {
        const failedStages = baseReport.checks.stageArtifactQuality.stages
          .filter(stage => !stage.ok)
          .map(stage => (stage.label || stage.id) + ':' + ((stage.reasons || []).join('|') || 'not-ok'))
          .join('; ');
        baseReport.errors.push('阶段成果物质量不达标：' + failedStages);
      }
      baseReport.errors.push((expectedCodeArtifacts.length > 0 || expectedCodeDirs.length > 0)
        ? '真实插件链路未形成成功 agent-run-completed + 预期 Markdown 与代码产物写盘证据。'
        : expectedArtifacts.length > 0
          ? '真实插件链路未形成成功 agent-run-completed + 预期 Markdown 仿真产物写盘证据。'
          : '真实插件链路未形成成功 agent-run-completed + Markdown 写盘证据。');
    }
    logProgress('write-report', { ok: baseReport.ok, errors: baseReport.errors.length });
    writeReport(baseReport);
  } catch (error) {
    baseReport.errors.push(String(error && error.stack || error && error.message || error));
    Object.assign(baseReport, evaluate(before, startedAtMs, expectedCodeBefore, expectedCodeDirBefore));
    logProgress('activate-failed', { error: baseReport.errors[baseReport.errors.length - 1] });
    writeReport(baseReport);
  } finally {
    await delay(500);
    if (!keepWindow) {
      await vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
    }
  }
}

module.exports = { activate };
  `
    .replace('__REPORT_PATH__', JSON.stringify(reportPath))
    .replace('__PROGRESS_PATH__', JSON.stringify(progressPath))
    .replace('__WORKSPACE_DIR__', JSON.stringify(workspaceDir))
    .replace('__PROMPT__', JSON.stringify(prompt))
    .replace('__TIMEOUT_MS__', JSON.stringify(timeoutMs))
    .replace('__PLUGIN_PORT__', JSON.stringify(pluginPort))
    .replace('__AUTOPILOT__', JSON.stringify(autopilot))
    .replace('__KEEP_WINDOW__', JSON.stringify(keepWindow))
    .replace('__SCENARIO__', JSON.stringify(scenario))
    .replace('__HARNESS_MODE__', JSON.stringify(harnessMode))
    .replace('__QUALITY_PROFILE__', JSON.stringify(qualityProfile))
    .replace('__REQUIRED_ARTIFACT_SNIPPETS__', JSON.stringify(requiredArtifactSnippets))
    .replace('__EXPECTED_ARTIFACT__', JSON.stringify(expectedArtifact))
    .replace('__EXPECTED_ARTIFACTS__', JSON.stringify(expectedArtifacts))
    .replace('__EXPECTED_CODE_ARTIFACTS__', JSON.stringify(expectedCodeArtifacts))
    .replace('__EXPECTED_CODE_DIRS__', JSON.stringify(expectedCodeDirs))
    .replace('__MARKDOWN_QUALITY_MODULE_PATH__', JSON.stringify(markdownQualityModulePath))
    .replace('__FORMAL_PROJECT_QUALITY_MODULE_PATH__', JSON.stringify(formalProjectQualityModulePath));

  fs.writeFileSync(path.join(driverDir, 'extension.js'), source, 'utf8');
}

function attachReplayReport(report) {
  const logs = report?.runLogs?.logs;
  if (!Array.isArray(logs) || logs.length === 0) {
    report.replay = { ok: false, skipped: true, reason: 'no run log found' };
    report.ok = false;
    report.errors = [...(report.errors || []), '真实插件链路没有生成可 replay 的运行日志。'];
    return;
  }

  const selected = selectProductRunLog(logs)?.absolutePath || logs[0]?.absolutePath;
  if (!selected || !fs.existsSync(selected)) {
    report.replay = { ok: false, skipped: true, reason: 'selected run log missing', selected };
    report.ok = false;
    report.errors = [...(report.errors || []), '真实插件链路运行日志路径不可读，无法 replay。'];
    return;
  }

  const result = cp.spawnSync(process.execPath, [
    path.join(extensionRoot, 'test/devseek-run-log-replay-harness.mjs'),
    '--json',
    selected,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  report.replay = {
    ok: result.status === 0,
    selected,
    status: result.status,
    stdout: safeParseJson(result.stdout) || result.stdout.slice(0, 4000),
    stderr: result.stderr.slice(0, 4000),
  };
  if (result.status !== 0) {
    report.ok = false;
    report.errors = [...(report.errors || []), '真实插件链路生成的运行日志未通过 Runtime Replay。'];
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runVsCodeDriver() {
  const logFd = fs.openSync(vscodeLogPath, 'a');
  const child = cp.spawn(codeBin, [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--extensionDevelopmentPath', driverDir,
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    '--new-window',
    '--wait',
    workspaceDir,
  ], {
    cwd: repoRoot,
    detached: keepWindow,
    env: {
      ...process.env,
      DEVSEEK_REAL_PLUGIN_DEEPSEEK: '1',
      DEVSEEK_REAL_PLUGIN_PROGRESS_PATH: progressPath,
      DEVSEEK_BRIDGE_HEADLESS: headed ? 'false' : 'true',
      DEVSEEK_BRIDGE_KEEP_VISIBLE: headed ? '1' : '',
    },
    stdio: ['ignore', logFd, logFd],
  });
  if (keepWindow) child.unref();

  let exited = false;
  let exitCode = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  const deadline = Date.now() + timeoutMs + 60000;
  try {
    while (Date.now() < deadline) {
      if (fs.existsSync(reportPath)) {
        if (!keepWindow) await waitForChildExit(child, 10000);
        return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      }
      if (exited) {
        return {
          ok: false,
          errors: [`VS Code exited before writing report. exitCode=${exitCode}`],
          harness: { tmpRoot, workspaceDir, vscodeLogPath, progressPath },
          progress: readProgressTail(),
        };
      }
      await delay(1000);
    }
    if (child.exitCode === null) child.kill('SIGTERM');
    return {
      ok: false,
      errors: [`VS Code live harness timed out after ${timeoutMs}ms`],
      harness: { tmpRoot, workspaceDir, vscodeLogPath, progressPath },
      progress: readProgressTail(),
    };
  } finally {
    if (child.exitCode === null && !keepWindow) child.kill('SIGTERM');
    fs.closeSync(logFd);
  }
}

function waitForChildExit(child, waitMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProgressTail() {
  try {
    return fs.readFileSync(progressPath, 'utf8').trim().split(/\r?\n/).slice(-30).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
  } catch {
    return [];
  }
}
