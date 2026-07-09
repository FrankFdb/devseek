#!/usr/bin/env node
/**
 * Real DevSeek extension + real DeepSeek Web live harness.
 *
 * This is intentionally opt-in because it opens VS Code, may open a visible
 * browser for login, and depends on the live DeepSeek website.
 *
 * Run from repository root:
 *   npm run test:real-plugin-deepseek --workspace=packages/vscode-extension -- --run
 *   npm run test:real-plugin-deepseek --workspace=packages/vscode-extension -- --run --relogin --headed
 */

import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const codeBin = getArgValue('--code') || process.env.VSCODE_BIN || 'code';
const timeoutMs = Number(getArgValue('--timeout-ms') || process.env.DEVSEEK_REAL_PLUGIN_TIMEOUT_MS || 900000);
const relogin = hasFlag('--relogin') || process.env.DEVSEEK_REAL_PLUGIN_RELOGIN === '1';
const headed = hasFlag('--headed') || process.env.DEVSEEK_REAL_PLUGIN_HEADED === '1' || relogin;
const keepTmp = hasFlag('--keep') || process.env.DEVSEEK_REAL_PLUGIN_KEEP === '1';
const autopilot = !hasFlag('--no-autopilot') && process.env.DEVSEEK_REAL_PLUGIN_AUTOPILOT !== '0';
const promptFromArg = getArgValue('--prompt');
const scenario = getArgValue('--scenario') || process.env.DEVSEEK_REAL_PLUGIN_SCENARIO || 'formal-simulation';
const harnessMode = normalizeHarnessMode(getArgValue('--mode') || process.env.DEVSEEK_REAL_PLUGIN_MODE || 'fast');
const workspaceDirArg = getArgValue('--workspace-dir') || process.env.DEVSEEK_REAL_PLUGIN_WORKSPACE_DIR || '';
const outputDocArg = getArgValue('--output-doc') || process.env.DEVSEEK_REAL_PLUGIN_OUTPUT_DOC || '';
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
  ? describeExistingWorkspace(workspaceDir, { outputDoc: outputDocArg })
  : createFixtureWorkspace(workspaceDir, { scenario });
const expectedArtifact = getArgValue('--expected-artifact')
  || process.env.DEVSEEK_REAL_PLUGIN_EXPECTED_ARTIFACT
  || fixture.expectedArtifactRel;
const prompt = promptFromArg || defaultPrompt(workspaceDir, fixture);

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
  autopilot,
  pluginPort,
  scenario,
  harnessMode,
  expectedArtifact,
  usesExistingWorkspace,
  loginReport,
};

const cleanup = !keepTmp && report.ok;
if (cleanup) {
  report.harness.cleanup = 'temporary directory retained only when --keep is passed';
} else {
  report.harness.cleanup = 'temporary directory retained for inspection';
}

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

function defaultPrompt(root, fixture) {
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

function describeExistingWorkspace(root, options = {}) {
  const requestedOutputDoc = options.outputDoc
    ? path.resolve(root, options.outputDoc)
    : '';
  if (!requestedOutputDoc) {
    return { requestedOutputDoc: '', expectedArtifactRel: '' };
  }
  const expectedAbs = uniqueMarkdownDocumentPath(path.dirname(requestedOutputDoc), path.basename(requestedOutputDoc));
  return {
    requestedOutputDoc,
    expectedArtifactRel: workspaceRelative(root, expectedAbs),
  };
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
    env: {
      ...process.env,
      HEADLESS: headed ? 'false' : 'true',
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
    return { ok: true, port, logPath, reloginResponse };
  } finally {
    await shutdownBridge(baseUrl, token);
    if (child.exitCode === null) child.kill('SIGTERM');
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
const scenario = __SCENARIO__;
const harnessMode = __HARNESS_MODE__;
const expectedArtifact = __EXPECTED_ARTIFACT__;

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

function changedMarkdownArtifacts(before) {
  const artifacts = [];
  walk(workspaceDir, (filePath) => {
    if (!/\.(?:md|markdown)$/i.test(filePath)) return;
    const relative = rel(workspaceDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const current = {
      path: relative,
      absolutePath: filePath,
      size: Buffer.byteLength(content),
      hash: hashText(content),
      preview: content.slice(0, 600),
    };
    const previous = before.get(relative);
    if (!previous || previous.hash !== current.hash) {
      artifacts.push({
        ...current,
        created: !previous,
        changed: Boolean(previous && previous.hash !== current.hash),
        containsMaintenanceAnalysis: /(维保|主控|task|任务|阈值|对策|重构|吊运)/i.test(content),
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

function collectRunLogs(startedAtMs) {
  const runDir = path.join(workspaceDir, '.devseek', 'runs');
  const logs = [];
  if (!fs.existsSync(runDir)) return { logs, terminal: null };
  for (const name of fs.readdirSync(runDir)) {
    if (!name.endsWith('.log')) continue;
    const full = path.join(runDir, name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs + 2000 < startedAtMs) continue;
    const events = fs.readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean);
    const terminal = events.find((event) => event.event === 'agent-run-completed' || event.event === 'agent-run-failed');
    logs.push({
      path: rel(workspaceDir, full),
      absolutePath: full,
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
  logs.sort((a, b) => b.size - a.size);
  const terminal = logs.map((log) => log.terminal).find(Boolean) || null;
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

function evaluate(before, startedAtMs) {
  const artifacts = changedMarkdownArtifacts(before);
  const runLogs = collectRunLogs(startedAtMs);
  const terminalData = runLogs.terminal && runLogs.terminal.data ? runLogs.terminal.data : {};
  const tasksFailed = Number(terminalData.tasksFailed || 0);
  const tasksApplied = Number(terminalData.tasksApplied || 0);
  const changedPaths = Array.isArray(terminalData.changedPaths) ? terminalData.changedPaths : [];
  const normalizedChangedPaths = changedPaths.map(normalizeChangedPathForWorkspace);
  const changedMarkdownByLog = normalizedChangedPaths.some((item) => /\.(?:md|markdown)$/i.test(item));
  const hasUsefulMarkdown = artifacts.some((artifact) => artifact.size >= 500 && artifact.containsMaintenanceAnalysis);
  const expectedArtifactRecord = expectedArtifact
    ? artifacts.find((artifact) => artifact.path === expectedArtifact)
    : null;
  const expectedArtifactWritten = expectedArtifact
    ? Boolean(expectedArtifactRecord
      && expectedArtifactRecord.created
      && expectedArtifactRecord.size >= 500
      && expectedArtifactRecord.containsMaintenanceAnalysis)
    : hasUsefulMarkdown;
  const expectedArtifactInRunLog = expectedArtifact
    ? normalizedChangedPaths.includes(expectedArtifact)
    : changedMarkdownByLog;
  const staleAnalysisChanged = artifacts.some((artifact) => artifact.path === 'docs/analysis/uav_warranty_reminder_analysis_v1.7.md');
  const successTerminal = runLogs.terminal
    && runLogs.terminal.event === 'agent-run-completed'
    && String(terminalData.status || '') === 'completed'
    && tasksFailed === 0;
  const ok = Boolean(successTerminal
    && tasksApplied > 0
    && changedMarkdownByLog
    && hasUsefulMarkdown
    && expectedArtifactWritten
    && expectedArtifactInRunLog);
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
      expectedArtifactWritten,
      expectedArtifactInRunLog,
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
  logProgress('activate-started', { workspaceDir });
  const baseReport = {
    ok: false,
    mode: 'real-plugin-deepseek',
    scenario,
    harnessMode,
    expectedArtifact,
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
      const evaluation = evaluate(before, startedAtMs);
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

    const finalEvaluation = evaluate(before, startedAtMs);
    Object.assign(baseReport, finalEvaluation);
    if (!baseReport.ok) {
      baseReport.errors.push(expectedArtifact
        ? '真实插件链路未形成成功 agent-run-completed + 预期 Markdown 仿真产物写盘证据。'
        : '真实插件链路未形成成功 agent-run-completed + Markdown 写盘证据。');
    }
    logProgress('write-report', { ok: baseReport.ok, errors: baseReport.errors.length });
    writeReport(baseReport);
  } catch (error) {
    baseReport.errors.push(String(error && error.stack || error && error.message || error));
    Object.assign(baseReport, evaluate(before, startedAtMs));
    logProgress('activate-failed', { error: baseReport.errors[baseReport.errors.length - 1] });
    writeReport(baseReport);
  } finally {
    await delay(500);
    await vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
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
    .replace('__SCENARIO__', JSON.stringify(scenario))
    .replace('__HARNESS_MODE__', JSON.stringify(harnessMode))
    .replace('__EXPECTED_ARTIFACT__', JSON.stringify(expectedArtifact));

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

  const selected = logs.find((log) => log.terminal)?.absolutePath || logs[0]?.absolutePath;
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
    env: {
      ...process.env,
      DEVSEEK_REAL_PLUGIN_DEEPSEEK: '1',
      DEVSEEK_REAL_PLUGIN_PROGRESS_PATH: progressPath,
      DEVSEEK_BRIDGE_HEADLESS: headed ? 'false' : 'true',
      DEVSEEK_BRIDGE_KEEP_VISIBLE: headed ? '1' : '',
    },
    stdio: ['ignore', logFd, logFd],
  });

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
        await waitForChildExit(child, 10000);
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
    if (child.exitCode === null) child.kill('SIGTERM');
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
