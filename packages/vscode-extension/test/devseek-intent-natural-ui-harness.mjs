#!/usr/bin/env node
/**
 * Natural Webview input smoke for the external intent corpus.
 *
 * This does not call a live Provider. It types every external corpus prompt
 * into the DevSeek Webview input and verifies the user-visible surface stays
 * bound to the user's text, not hidden Provider/Bridge prompts.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { EXTERNAL_INTENT_CORPUS } from './fixtures/external-intent-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mediaDir = path.join(repoRoot, 'packages/vscode-extension/media');
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'devseek-intent-natural-ui-'));
const htmlPath = path.join(tmpRoot, 'harness.html');
const reportPath = path.join(tmpRoot, 'intent-natural-ui-report.json');

function readMediaFile(fileName) {
  return readFileSync(path.join(mediaDir, fileName), 'utf8');
}

function readWebviewRuntimeJs() {
  const manifest = JSON.parse(readMediaFile('webview-runtime.json'));
  const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
    ? manifest.scripts
    : ['webview.js'];
  return scripts.map((fileName) => readMediaFile(fileName)).join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DevSeek Intent Natural UI Harness</title>
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
    body { margin:0; height:720px; background:var(--vscode-editor-background); color:var(--vscode-foreground); font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; display:flex; flex-direction:column; }
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
<script>${readMediaFile('marked.umd.js')}</script>
<script>${readWebviewRuntimeJs()}</script>
</body>
</html>`;

writeFileSync(htmlPath, html, 'utf8');

async function dispatch(page, message) {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

function internalProviderPromptFor(testCase) {
  return [
    `INTERNAL_PROVIDER_PROMPT_DO_NOT_DISPLAY::${testCase.id}`,
    '你正在为 DevSeek 编程智能体构造给 DeepSeek/Provider 的内部提示。',
    '第一行可以包含模型工具协议，但这些内容不得进入用户可见 UI。',
    '[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"internal-only","status":"in-progress"}]}]',
    '',
    `用户任务：${testCase.prompt}`,
  ].join('\n');
}

async function resetPage(page) {
  await page.evaluate(() => {
    window.__postedMessages = [];
    document.getElementById('messages').innerHTML = '';
    document.getElementById('input').value = '';
  });
}

async function runCase(page, testCase) {
  await resetPage(page);
  await page.fill('#input', testCase.prompt);
  await page.click('#send-btn');

  const posted = await page.evaluate(() => window.__postedMessages.slice());
  const chatMessage = posted.find((message) => message.type === 'chat');
  assert(chatMessage, `${testCase.id}: Webview input did not post a chat message`);
  assert(chatMessage.text === testCase.prompt, `${testCase.id}: posted visible text changed`);
  assert(chatMessage.prompt === testCase.prompt, `${testCase.id}: posted prompt diverged without attachments`);
  assert(chatMessage.forceNoAgent === false, `${testCase.id}: agent toggle unexpectedly disabled`);
  assert(!String(chatMessage.text).includes('INTERNAL_PROVIDER_PROMPT_DO_NOT_DISPLAY'), `${testCase.id}: posted text contains internal marker`);
  assert(!String(chatMessage.prompt).includes('INTERNAL_PROVIDER_PROMPT_DO_NOT_DISPLAY'), `${testCase.id}: posted prompt contains internal marker`);

  const internalPrompt = internalProviderPromptFor(testCase);
  await dispatch(page, { type: 'userMessage', text: testCase.prompt, prompt: internalPrompt });

  const visibleAfterUser = await page.evaluate(() => document.getElementById('messages').textContent || '');
  assert(visibleAfterUser.includes(testCase.prompt), `${testCase.id}: user prompt not visible after userMessage`);
  assert(!visibleAfterUser.includes(`INTERNAL_PROVIDER_PROMPT_DO_NOT_DISPLAY::${testCase.id}`), `${testCase.id}: visible user turn leaked internal prompt marker`);
  assert(!visibleAfterUser.includes('[TOOL:manage_todo_list'), `${testCase.id}: visible user turn leaked internal tool protocol`);

  await page.locator('.user-msg-actions button').last().click();
  const editValue = await page.locator('.user-edit-wrap textarea').last().inputValue();
  assert(editValue === testCase.prompt, `${testCase.id}: edit-resend text is not the original user prompt`);
  await page.locator('.user-edit-actions button.cancel').last().click();

  await dispatch(page, { type: 'startResponse', agentMode: false, prompt: internalPrompt, expectGeneratedArtifacts: false });
  await dispatch(page, { type: 'delta', text: `可见响应占位：${testCase.id}` });
  await dispatch(page, { type: 'endResponse' });
  const visibleAfterResponse = await page.evaluate(() => document.getElementById('messages').textContent || '');
  assert(!visibleAfterResponse.includes(`INTERNAL_PROVIDER_PROMPT_DO_NOT_DISPLAY::${testCase.id}`), `${testCase.id}: response leaked internal prompt marker`);
  assert(!visibleAfterResponse.includes('[TOOL:manage_todo_list'), `${testCase.id}: response leaked internal tool protocol`);

  return {
    id: testCase.id,
    taskKind: testCase.taskKind,
    postedType: chatMessage.type,
    postedTextLength: chatMessage.text.length,
    visibleIsolated: true,
  };
}

async function assertAtMentionBoundaries(page) {
  await resetPage(page);
  await page.fill('#input', 'What does pass@k mean in code-generation benchmarks?');
  await page.click('#send-btn');
  let posted = await page.evaluate(() => window.__postedMessages.slice());
  assert(posted.some((message) => message.type === 'chat'), 'word-internal @ must remain plain chat');
  assert(!posted.some((message) => message.type === 'resolveFile'), 'word-internal @ must not resolve a file');

  await resetPage(page);
  await page.fill('#input', 'Explain @src/cache.ts without changing it');
  await page.click('#send-btn');
  posted = await page.evaluate(() => window.__postedMessages.slice());
  const resolved = posted.find((message) => message.type === 'resolveFile');
  assert(resolved?.path === 'src/cache.ts', 'explicit @file mention should still resolve a file');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
    page.on('pageerror', (error) => { throw error; });
    await page.goto(pathToFileURL(htmlPath).href);
    await assertAtMentionBoundaries(page);

    const cases = [];
    for (const testCase of EXTERNAL_INTENT_CORPUS) {
      cases.push(await runCase(page, testCase));
    }

    const distribution = {};
    for (const item of cases) {
      distribution[item.taskKind] = (distribution[item.taskKind] || 0) + 1;
    }
    const report = {
      ok: true,
      mode: 'external-intent-natural-ui',
      fixture: htmlPath,
      reportPath,
      total: cases.length,
      distribution,
      cases,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
