#!/usr/bin/env node
/**
 * Runtime regression harness for fake tool transcript display leaks.
 *
 * This intentionally loads the production webview.js in a small standalone DOM
 * and feeds it the same DSML-style transcript seen in manual DevSeek screenshots.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const sanitizerPath = path.join(repoRoot, 'packages/vscode-extension/media/webview-agent-sanitizer.js');
const webviewPath = path.join(repoRoot, 'packages/vscode-extension/media/webview.js');
const markedPath = path.join(repoRoot, 'packages/vscode-extension/media/marked.umd.js');
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'devseek-dsml-webview-'));
const htmlPath = path.join(tmpRoot, 'harness.html');

const sanitizerJs = readFileSync(sanitizerPath, 'utf8');
const webviewJs = readFileSync(webviewPath, 'utf8');
const markedJs = readFileSync(markedPath, 'utf8');

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DevSeek DSML Webview Harness</title>
  <style>
    :root {
      --vscode-editor-background:#1e1e1e;
      --vscode-foreground:#d4d4d4;
      --vscode-descriptionForeground:#a8a8a8;
      --vscode-button-background:#0e639c;
      --vscode-button-foreground:#fff;
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
    body { margin:0; height:720px; background:var(--vscode-editor-background); color:var(--vscode-foreground); font:13px/1.45 sans-serif; display:flex; flex-direction:column; }
    #toolbar { display:flex; gap:4px; padding:6px; border-bottom:1px solid var(--vscode-panel-border); }
    #content-area { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
    #messages { flex:1; min-height:0; overflow:auto; padding:8px 10px 18px; }
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
<script>
window.__postedMessages = [];
window.__wsFolderName = 'devseek_netai';
window.acquireVsCodeApi = function() {
  return {
    postMessage: function(message) { window.__postedMessages.push(message); },
    getState: function() { return null; },
    setState: function() {}
  };
};
window.mermaid = { initialize: function(){}, render: async function(){ return { svg: '<svg></svg>' }; } };
</script>
<script>${markedJs}</script>
<script>${sanitizerJs}</script>
<script>${webviewJs}</script>
</body>
</html>`;

writeFileSync(htmlPath, html, 'utf8');

const dsmlFixtures = [
  {
    label: 'ascii split-bar DSML',
    start: '好的，我先看看当前代码结构。< | DS',
    rest: 'ML | tool_calls< | DSML | invoke name="read_file">< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
  },
  {
    label: 'fullwidth double-bar DSML',
    start: '好的，我先看看当前代码结构。<｜｜DS',
    rest: 'ML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"><｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="list_dir"><｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
  },
];

async function dispatch(page, message) {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

async function textReport(page) {
  return page.evaluate(() => {
    const messages = document.getElementById('messages');
    return {
      text: (messages?.textContent || '').replace(/\s+/g, ' ').trim(),
      html: messages?.innerHTML || '',
    };
  });
}

function assertNoInternalProtocol(report, label) {
  assert.doesNotMatch(report.text, /DSML|tool_calls|read_file|list_dir|filePath|^ML\s*[|｜]/, `${label}: text leaked internal DSML transcript`);
  assert.doesNotMatch(report.html, /DSML|tool_calls|read_file|list_dir|filePath|&lt;\s*[|｜]{1,2}\s*DSML/i, `${label}: html leaked internal DSML transcript`);
  assert.doesNotMatch(report.text, /AFILE:|ASUMRESET|\\x00AFILE|\\x00ASUM/, `${label}: text leaked agent routing marker`);
  assert.doesNotMatch(report.html, /AFILE:|ASUMRESET|\\x00AFILE|\\x00ASUM/, `${label}: html leaked agent routing marker`);
}

async function runNonAgentCompleteFlow(page, fixture) {
  await dispatch(page, { type: 'clearHistory' });
  await dispatch(page, { type: 'userMessage', text: '测试内部协议完整块', prompt: '测试内部协议完整块' });
  await dispatch(page, { type: 'startResponse', agentMode: false, prompt: '测试内部协议完整块' });
  await dispatch(page, { type: 'delta', text: `${fixture.start}${fixture.rest}\n继续实现。` });
  await dispatch(page, { type: 'endResponse' });
  await page.waitForTimeout(250);
  const report = await textReport(page);
  assert.match(report.text, /好的，我先看看当前代码结构/);
  assert.match(report.text, /继续实现/);
  assertNoInternalProtocol(report, `non-agent complete flow (${fixture.label})`);
}

async function runAgentSplitFlow(page, fixture) {
  await dispatch(page, { type: 'clearHistory' });
  await dispatch(page, { type: 'userMessage', text: '测试 Agent 内部协议拆分块', prompt: '测试 Agent 内部协议拆分块' });
  await dispatch(page, { type: 'startResponse', agentMode: true, prompt: '测试 Agent 内部协议拆分块' });
  await dispatch(page, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: '任务计划已生成',
    taskTotal: 1,
    detail: '1. [analyze] main.cpp - 查看当前代码',
  });
  await dispatch(page, { type: 'agentAnnouncement', text: `${fixture.start}${fixture.rest}` });
  await dispatch(page, { type: 'delta', text: fixture.start });
  await page.waitForTimeout(80);
  await dispatch(page, { type: 'delta', text: fixture.rest });
  await dispatch(page, { type: 'endResponse' });
  await page.waitForTimeout(250);
  assertNoInternalProtocol(await textReport(page), `agent split flow (${fixture.label})`);
}

async function runSessionHistoryFlow(page, fixture) {
  await dispatch(page, { type: 'clearHistory' });
  await dispatch(page, {
    type: 'sessionLoaded',
    id: 'session-1',
    history: [
      { role: 'user', content: '继续' },
      { role: 'assistant', content: `${fixture.start}${fixture.rest}\n已处理。` },
    ],
    summary: `${fixture.start}${fixture.rest}`,
    changedFiles: [],
    messageCount: 2,
    createdAt: Date.now(),
  });
  await page.waitForTimeout(250);
  const report = await textReport(page);
  assert.match(report.text, /已处理/);
  assertNoInternalProtocol(report, `session history flow (${fixture.label})`);
}

async function runAgentRoutingMarkerLeakFlow(page) {
  await dispatch(page, { type: 'clearHistory' });
  await dispatch(page, { type: 'userMessage', text: '测试 Agent 路由标记泄露', prompt: '测试 Agent 路由标记泄露' });
  await dispatch(page, { type: 'startResponse', agentMode: true, prompt: '测试 Agent 路由标记泄露' });
  await dispatch(page, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: '任务计划已生成',
    taskTotal: 1,
    detail: '1. [analyze] shape_manager - 检查当前代码',
  });
  await dispatch(page, { type: 'agentAnnouncement', text: 'ASUMRESET公告阶段说明。' });
  await dispatch(page, {
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'analyze',
    taskFile: 'shape_manager',
    taskDesc: '检查当前代码',
  });
  await dispatch(page, { type: 'delta', text: 'AFILE:shape_managerRESET我先检查当前 main.cpp 的实际内容以及相关头文件。' });
  await dispatch(page, { type: 'delta', text: 'ASUMRESET已完成验证。' });
  await dispatch(page, {
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    editedFiles: [],
  });
  await dispatch(page, { type: 'endResponse' });
  await page.waitForTimeout(250);
  const report = await textReport(page);
  assert.match(report.text, /已完成验证/);
  assert.match(report.text, /公告阶段说明/);
  assertNoInternalProtocol(report, 'agent routing marker leak flow');
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error('Playwright Chromium 启动失败。可先运行 `npx playwright install chromium` 后重试。');
    console.error(String(error?.message || error));
    process.exitCode = 2;
    return;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
    page.on('pageerror', (error) => { throw error; });
    await page.goto(pathToFileURL(htmlPath).href);
    for (const fixture of dsmlFixtures) {
      await runNonAgentCompleteFlow(page, fixture);
      await runAgentSplitFlow(page, fixture);
      await runSessionHistoryFlow(page, fixture);
    }
    await runAgentRoutingMarkerLeakFlow(page);
    console.log(JSON.stringify({ ok: true, fixture: htmlPath }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
