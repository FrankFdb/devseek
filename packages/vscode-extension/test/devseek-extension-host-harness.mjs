#!/usr/bin/env node
/**
 * DevSeek VS Code Extension Host human-input harness.
 *
 * Non-invasive by design:
 * - does not modify production extension source files;
 * - creates a temporary VS Code test extension under /tmp;
 * - loads the real packages/vscode-extension/media/webview.js in a real VS Code webview;
 * - simulates human typing inside that webview and replays mock extension/provider events.
 *
 * Run from repository root:
 *   node packages/vscode-extension/test/devseek-extension-host-harness.mjs --run
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runRequested = process.argv.includes('--run') || process.env.DEVSEEK_RUN_EXTENSION_HOST_HARNESS === '1';
if (!runRequested) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'VS Code Extension Host harness opens a real Electron window and is opt-in. Re-run with `-- --run` or set DEVSEEK_RUN_EXTENSION_HOST_HARNESS=1.',
  }, null, 2));
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const sanitizerPath = path.join(repoRoot, 'packages/vscode-extension/media/webview-agent-sanitizer.js');
const todosPath = path.join(repoRoot, 'packages/vscode-extension/media/webview-agent-todos.js');
const webviewPath = path.join(repoRoot, 'packages/vscode-extension/media/webview.js');
const markedPath = path.join(repoRoot, 'packages/vscode-extension/media/marked.umd.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-extension-host-harness-'));
const extensionDir = path.join(tmpRoot, 'extension');
const workspaceDir = path.join(tmpRoot, 'workspace');
const userDataDir = path.join(tmpRoot, 'user-data');
const extensionsDir = path.join(tmpRoot, 'extensions');
const reportPath = path.join(tmpRoot, 'report.json');

const prompt = '在code目录下面编写一个三维动画世界C++程序，小孩可以通过鼠标操作各种三维物体，注意使用系统有的能力实现';

for (const dir of [extensionDir, workspaceDir, userDataDir, extensionsDir, path.join(workspaceDir, 'code')]) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(
  path.join(extensionDir, 'package.json'),
  JSON.stringify({
    name: 'devseek-extension-host-harness',
    displayName: 'DevSeek Extension Host Harness',
    version: '0.0.0',
    publisher: 'devseek-harness',
    engines: { vscode: '^1.85.0' },
    activationEvents: ['*'],
    main: './extension.js',
  }, null, 2),
  'utf8',
);

const extensionSource = String.raw`
const vscode = require('vscode');
const fs = require('fs');

const reportPath = __REPORT_PATH__;
const sanitizerPath = __SANITIZER_PATH__;
const todosPath = __TODOS_PATH__;
const webviewPath = __WEBVIEW_PATH__;
const markedPath = __MARKED_PATH__;
const prompt = __PROMPT__;
const fixture = __FIXTURE__;

function writeReport(payload) {
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(panel, message, waitMs = 50) {
  await panel.webview.postMessage(message);
  await delay(waitMs);
}

function validate(report, chatSeen) {
  const errors = [];
  const steps = Array.isArray(report.stepTexts) ? report.stepTexts : [];
  const summaries = Array.isArray(report.summaryTexts) ? report.summaryTexts : [];
  const hasStep = (needle) => steps.some((text) => text.includes(needle));
  if (!chatSeen && !report.chatPosted) errors.push('输入框点击发送后没有产生 chat postMessage');
  if (!hasStep('分析任务')) errors.push('没有显示计划开始信息');
  if (!hasStep('任务计划已生成')) errors.push('没有显示计划完成信息');
  if (!hasStep('开始执行 4 个任务')) errors.push('没有显示批量执行开始信息');
  if (summaries.length < 3) errors.push('过程信息被覆盖，只剩 ' + summaries.length + ' 个 Thinking summary：' + summaries.join(' | '));
  if (!summaries.some((text) => text.includes('开始执行 4 个任务'))) errors.push('完成后的 Thinking summary 没有保留执行开始信息：' + summaries.join(' | '));
  if (!summaries.some((text) => text.includes('Analyzing') || text.includes('Creating') || text.includes('Created') || text.includes('编写3D动画世界'))) errors.push('完成后的 Thinking summary 没有保留任务执行信息：' + summaries.join(' | '));
  if (!steps.some((text) => text.includes('Wrote') && text.includes('3d_world.cpp'))) errors.push('没有显示写文件工具活动');
  if (!steps.some((text) => text.includes('Ran') && text.includes('g++'))) errors.push('没有显示终端工具活动');
  if (!String(report.todoText || '').includes('Todos (4/4)')) errors.push('Todos 没有显示 4/4 完成状态：' + String(report.todoText || ''));
  if ((report.detailsCount || 0) < 2) errors.push('计划/执行详情没有折叠显示');
  if ((report.terminalDetails || 0) < 1) errors.push('终端输出没有折叠显示');
  if (!report.scrolledToBottom) errors.push('消息区域没有自动滚动到底部');
  if (!String(report.finalText || '').includes('已完成三维动画世界 C++ 程序')) errors.push('最终反馈没有显示');
  return errors;
}

async function replayMockRun(panel, chatMessage) {
  await post(panel, { type: 'userMessage', text: chatMessage.text || prompt, prompt });
  await post(panel, { type: 'startResponse', agentMode: true, prompt });
  await post(panel, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '分析任务，正在生成执行计划...',
    taskTotal: 0,
  });
  await post(panel, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: '任务计划已生成：4 个子任务',
    taskTotal: 4,
    detail: [
      '1. [analyze] code - 分析现有环境与 OpenGL/GLUT 支持',
      '2. [analyze] scene - 设计3D世界场景结构（物体、光照、相机控制）',
      '3. [create] 3d_world.cpp - 编写3D动画世界主程序',
      '4. [analyze] 3d_world.cpp - 编译并运行程序，验证鼠标操作',
    ].join('\n'),
  });
  await post(panel, {
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    title: '开始执行 4 个任务',
    detail: [
      '1. [analyze] code - 分析现有环境与 OpenGL/GLUT 支持',
      '2. [analyze] scene - 设计3D世界场景结构（物体、光照、相机控制）',
      '3. [create] 3d_world.cpp - 编写3D动画世界主程序',
      '4. [analyze] 3d_world.cpp - 编译并运行程序，验证鼠标操作',
    ].join('\n'),
    taskTotal: 4,
  });
  await post(panel, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'in-progress' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'not-started' },
      { id: 3, title: '编写3D动画世界主程序', status: 'not-started' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'not-started' },
    ],
  });
  await post(panel, { type: 'agentToolActivity', activityKind: 'list', activityLabel: 'code' });
  await post(panel, {
    type: 'agentStatus',
    phase: 'execute',
    taskId: 't1',
    taskFile: 'code',
    taskAction: 'analyze',
    taskIndex: 1,
    taskTotal: 4,
    state: 'started',
    title: '分析现有环境与 OpenGL/GLUT 支持',
  });
  await post(panel, {
    type: 'agentStatus',
    phase: 'execute',
    taskId: 't1',
    taskFile: 'code',
    taskAction: 'analyze',
    taskIndex: 1,
    taskTotal: 4,
    state: 'completed',
    title: '已分析 code 目录',
  });
  await post(panel, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'completed' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'completed' },
      { id: 3, title: '编写3D动画世界主程序', status: 'in-progress' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'not-started' },
    ],
  });
  await post(panel, { type: 'agentToolActivity', activityKind: 'write', activityLabel: 'code/3d_world.cpp' });
  await post(panel, {
    type: 'agentStatus',
    phase: 'execute',
    taskId: 't2',
    taskFile: '3d_world.cpp',
    taskAction: 'create',
    taskIndex: 3,
    taskTotal: 4,
    state: 'started',
    title: '编写3D动画世界主程序',
  });
  await post(panel, {
    type: 'agentStatus',
    phase: 'execute',
    taskId: 't2',
    taskFile: '3d_world.cpp',
    taskAction: 'create',
    taskIndex: 3,
    taskTotal: 4,
    state: 'completed',
    title: '已创建 3d_world.cpp',
    detail: '写入 code/3d_world.cpp',
    linesAdded: 180,
    linesRemoved: 0,
  });
  await post(panel, { type: 'agentToolActivity', activityKind: 'terminal', activityLabel: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world' });
  await post(panel, {
    type: 'terminalRanNotice',
    command: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world',
    exitCode: 0,
    output: 'compile ok\nmouse controls enabled',
  });
  await post(panel, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'completed' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'completed' },
      { id: 3, title: '编写3D动画世界主程序', status: 'completed' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'completed' },
    ],
  });
  await post(panel, {
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    title: '全部 4 个任务已完成',
    taskTotal: 4,
    editedFiles: [{ path: 'code/3d_world.cpp', basename: '3d_world.cpp', linesAdded: 180, linesRemoved: 0, action: 'create' }],
  });
  await post(panel, { type: 'delta', text: '\x00ASUM\x00已完成三维动画世界 C++ 程序，并完成编译验证。' });
  await post(panel, { type: 'endResponse' }, 250);
  await panel.webview.postMessage({ type: '__harnessCollect' });
}

function getHtml() {
  const nonce = String(Date.now());
  const markedJs = fs.readFileSync(markedPath, 'utf8');
  const sanitizerJs = fs.readFileSync(sanitizerPath, 'utf8');
  const todosJs = fs.readFileSync(todosPath, 'utf8');
  const webviewJs = fs.readFileSync(webviewPath, 'utf8');
  const apiCaptureJs = \`
    (function() {
      const nativeAcquireVsCodeApi = acquireVsCodeApi;
      window.acquireVsCodeApi = function() {
        const api = nativeAcquireVsCodeApi();
        window.__devseekHarnessApi = api;
        return api;
      };
    })();
  \`;
  const testJs = \`
    (function() {
      const prompt = \${JSON.stringify(prompt)};
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      async function typeLikeHuman() {
        await delay(500);
        const input = document.getElementById('input');
        const send = document.getElementById('send-btn');
        input.focus();
        input.value = '';
        for (const ch of prompt) {
          input.value += ch;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
          await delay(3);
        }
        send.click();
      }

      function collectReport() {
        const messages = document.getElementById('messages');
        const summaryTexts = [...document.querySelectorAll('.aut-summary')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
        const stepTexts = [...document.querySelectorAll('.aut-step')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
        const todoText = document.getElementById('agent-todos-widget')?.textContent.replace(/\\s+/g, ' ').trim() || '';
        window.__devseekHarnessApi.postMessage({
          type: 'harnessReport',
          report: {
            summaryTexts,
            stepTexts,
            todoText,
            detailsCount: document.querySelectorAll('.aut-step-details').length,
            containers: document.querySelectorAll('.aut-container').length,
            terminalDetails: document.querySelectorAll('.term-output-details').length,
            scrollTop: messages.scrollTop,
            scrollHeight: messages.scrollHeight,
            clientHeight: messages.clientHeight,
            scrolledToBottom: messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 4,
            finalText: messages.textContent || '',
          },
        });
      }

      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === '__harnessCollect') {
          setTimeout(collectReport, 250);
        }
      });
      window.addEventListener('DOMContentLoaded', () => {
        typeLikeHuman().catch((error) => {
          window.__devseekHarnessApi.postMessage({ type: 'harnessError', message: String(error && error.message || error) });
        });
      });
    })();
  \`;

  return \`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-\${nonce}'; style-src 'unsafe-inline';">
  <title>DevSeek Extension Host Harness</title>
  <style>
    :root {
      --vscode-editor-background:#1e1e1e;
      --vscode-foreground:#d4d4d4;
      --vscode-descriptionForeground:#a8a8a8;
      --vscode-button-background:#0e639c;
      --vscode-button-foreground:#fff;
      --vscode-button-hoverBackground:#1177bb;
      --vscode-button-secondaryBackground:#333;
      --vscode-button-secondaryForeground:#ddd;
      --vscode-panel-border:#3a3a3a;
      --vscode-input-background:#252526;
      --vscode-input-foreground:#ddd;
      --vscode-input-border:#3c3c3c;
      --vscode-focusBorder:#007fd4;
      --vscode-textLink-foreground:#4ea6ff;
      --vscode-charts-blue:#63b3ff;
      --vscode-charts-green:#78dc96;
      --vscode-errorForeground:#ff8080;
      --vscode-editorWarning-foreground:#cca700;
      --vscode-terminal-foreground:#d4d4d4;
      --vscode-sideBar-background:#181818;
    }
    html, body {
      margin:0;
      height:100%;
      overflow:hidden;
      background:var(--vscode-editor-background);
      color:var(--vscode-foreground);
      font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
      display:flex;
      flex-direction:column;
    }
    #toolbar { display:flex; gap:4px; padding:6px; border-bottom:1px solid var(--vscode-panel-border); }
    #content-area { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
    #messages { flex:1; min-height:0; overflow:auto; padding:8px 10px 18px; scroll-behavior:auto; }
    .turn { margin:4px 0; }
    .user-turn { display:flex; justify-content:flex-end; }
    .user-bubble { background:#173248; border-radius:8px; padding:7px 10px; max-width:82%; }
    .assistant-bubble { padding:6px 10px; max-width:100%; }
    #input-area { border-top:1px solid var(--vscode-panel-border); padding:6px; flex-shrink:0; }
    #input-row { display:flex; gap:4px; }
    #input { flex:1; min-height:38px; resize:none; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); border-radius:6px; padding:6px 8px; }
    #send-btn, button { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:0; border-radius:5px; padding:4px 9px; }
    #jump-latest, #suggest-popup, #sessions-panel { display:none; }
    #status-bar { display:flex; align-items:center; gap:6px; border-top:1px solid var(--vscode-panel-border); padding:4px 8px; font-size:11px; }
    #file-badges, #context-files-row { display:flex; gap:4px; }
  </style>
</head>
<body class="vscode-dark">
<div id="toolbar">
  <button id="sessions-btn">历史对话</button>
  <button id="new-session-btn">新对话</button>
  <button id="clear-btn">清空</button>
</div>
<div id="content-area">
  <div id="sessions-panel">
    <div id="sessions-panel-header"><span>历史对话</span><button id="sessions-close-btn">x</button></div>
    <div id="sessions-list"></div>
    <div id="sessions-panel-footer"><button id="sessions-new-btn">新建对话</button></div>
  </div>
  <div id="ready-progress"><div class="bar"></div></div>
  <div id="messages"></div>
  <button id="jump-latest">新内容</button>
  <div id="input-area">
    <div id="suggest-popup"></div>
    <div id="file-badges"></div>
    <div id="context-files-row"></div>
    <div id="agent-queue-indicator"></div>
    <div id="input-row">
      <textarea id="input" rows="1"></textarea>
      <button id="send-btn">send</button>
    </div>
    <div id="input-hint"></div>
  </div>
</div>
<div id="status-bar">
  <span id="s-dot"></span>
  <span id="status-text">连接中...</span>
  <button id="login-btn">登录</button>
  <button id="switch-provider-btn">provider</button>
  <span class="s-spacer"></span>
  <div id="mode-switcher">
    <button class="mode-btn active" data-mode="fast">快速</button>
    <button class="mode-btn" data-mode="r1">R1</button>
  </div>
  <button id="agent-toggle-btn">Agent</button>
  <button id="autopilot-btn">自动</button>
</div>
<script nonce="\${nonce}">\${apiCaptureJs}</script>
<script nonce="\${nonce}">\${markedJs}</script>
<script nonce="\${nonce}">window.__wsFolderName = 'devseek_netai'; window.mermaid = { initialize(){}, render: async () => ({ svg: '<svg></svg>' }) };</script>
<script nonce="\${nonce}">\${sanitizerJs}</script>
<script nonce="\${nonce}">\${todosJs}</script>
<script nonce="\${nonce}">\${webviewJs}</script>
<script nonce="\${nonce}">\${testJs}</script>
</body>
</html>\`;
}

function activate(context) {
  const panel = vscode.window.createWebviewPanel(
    'devseekExtensionHostHarness',
    'DevSeek Extension Host Harness',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = getHtml();

  let chatSeen = false;
  const timeout = setTimeout(async () => {
    writeReport({ ok: false, fixture, reportPath, errors: ['等待 harnessReport 超时'] });
    await vscode.commands.executeCommand('workbench.action.closeWindow');
  }, 30000);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'ready') {
      await panel.webview.postMessage({ type: 'statusUpdate', online: true, text: 'Extension Host harness ready', agentEnabled: true });
      return;
    }
    if (message.type === 'chat') {
      chatSeen = true;
      await replayMockRun(panel, message);
      return;
    }
    if (message.type === 'harnessReport') {
      clearTimeout(timeout);
      const report = message.report || {};
      const errors = validate(report, chatSeen);
      writeReport({
        ok: errors.length === 0,
        fixture,
        reportPath,
        errors,
        checks: {
          steps: Array.isArray(report.stepTexts) ? report.stepTexts.length : 0,
          summaries: Array.isArray(report.summaryTexts) ? report.summaryTexts : [],
          details: report.detailsCount || 0,
          terminalDetails: report.terminalDetails || 0,
          todos: report.todoText || '',
          scrolledToBottom: !!report.scrolledToBottom,
        },
        raw: { ...report, finalText: String(report.finalText || '').slice(0, 4000) },
      });
      await vscode.commands.executeCommand('workbench.action.closeWindow');
      return;
    }
    if (message.type === 'harnessError') {
      clearTimeout(timeout);
      writeReport({ ok: false, fixture, reportPath, errors: [message.message || 'webview harness error'] });
      await vscode.commands.executeCommand('workbench.action.closeWindow');
    }
  });

  context.subscriptions.push(panel);
}

function deactivate() {}

module.exports = { activate, deactivate };
`;

fs.writeFileSync(
  path.join(extensionDir, 'extension.js'),
  extensionSource
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${')
    .replace('__REPORT_PATH__', JSON.stringify(reportPath))
    .replace('__SANITIZER_PATH__', JSON.stringify(sanitizerPath))
    .replace('__TODOS_PATH__', JSON.stringify(todosPath))
    .replace('__WEBVIEW_PATH__', JSON.stringify(webviewPath))
    .replace('__MARKED_PATH__', JSON.stringify(markedPath))
    .replace('__PROMPT__', JSON.stringify(prompt))
    .replace('__FIXTURE__', JSON.stringify(tmpRoot)),
  'utf8',
);

function readReportIfExists() {
  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function readVsCodeLogTail() {
  const logsDir = path.join(userDataDir, 'logs');
  if (!fs.existsSync(logsDir)) return '';
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile() && entry.name.endsWith('.log')) files.push(fullPath);
    }
  };
  visit(logsDir);
  return files
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .slice(0, 4)
    .map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return `--- ${path.relative(userDataDir, file)} ---\n${text.slice(-3000)}`;
    })
    .join('\n');
}

async function main() {
  const args = [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--extensionDevelopmentPath', extensionDir,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--skip-add-to-recently-opened',
    '--disable-crash-reporter',
    '--disable-updates',
    '--disable-telemetry',
    '--disable-chromium-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-software-rasterizer',
    '--disable-features=UseOzonePlatform,VizDisplayCompositor',
    '--ozone-platform=x11',
    '--verbose',
    '--log', 'trace',
    '--new-window',
    '--wait',
    workspaceDir,
  ];
  const child = cp.spawn('code', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DEVSEEK_EXTENSION_HOST_HARNESS: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let exitSignal = null;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const timeoutMs = 45000;
  const start = Date.now();
  let exited = false;
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  while (Date.now() - start < timeoutMs) {
    const report = readReportIfExists();
    if (report) {
      if (!exited && child.exitCode === null) child.kill('SIGTERM');
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!exited && child.exitCode === null) child.kill('SIGTERM');
  const report = readReportIfExists();
  if (report) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  console.error(JSON.stringify({
    ok: false,
    fixture: tmpRoot,
    reportPath,
    errors: ['VS Code Extension Host harness 未生成报告'],
    codeCommand: 'code',
    args,
    exited,
    exitCode,
    exitSignal,
    stdout: stdout.slice(-2000),
    stderr: stderr.slice(-4000),
    vscodeLogTail: readVsCodeLogTail(),
  }, null, 2));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
