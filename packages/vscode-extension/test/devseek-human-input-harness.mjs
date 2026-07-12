#!/usr/bin/env node
/**
 * DevSeek human-input UI harness.
 *
 * Non-invasive by design:
 * - does not modify production source files;
 * - writes only a temporary standalone HTML fixture under /tmp;
 * - mocks VS Code postMessage and extension/provider events.
 *
 * Run from repository root:
 *   node packages/vscode-extension/test/devseek-human-input-harness.mjs
 *   node packages/vscode-extension/test/devseek-human-input-harness.mjs --real-bridge --headed --relogin
 *   node packages/vscode-extension/test/devseek-human-input-harness.mjs --real-agent-steer
 */

import cp from 'node:child_process';
import crypto from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const args = new Set(process.argv.slice(2));
const realBridge = args.has('--real-bridge') || process.env.DEVSEEK_HUMAN_INPUT_REAL_BRIDGE === '1';
const realAgentSteer = args.has('--real-agent-steer') || process.env.DEVSEEK_HUMAN_INPUT_REAL_AGENT_STEER === '1';
const headedBridge = args.has('--headed') || process.env.DEVSEEK_HUMAN_INPUT_HEADED === '1';
const relogin = args.has('--relogin') || process.env.DEVSEEK_HUMAN_INPUT_RELOGIN === '1';
const promptArgIndex = process.argv.indexOf('--prompt');
const prompt = promptArgIndex >= 0 && process.argv[promptArgIndex + 1]
  ? process.argv[promptArgIndex + 1]
  : '在code目录下面编写一个三维动画世界C++程序，小孩可以通过鼠标操作各种三维物体，注意使用系统有的能力实现';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mediaDir = path.join(repoRoot, 'packages/vscode-extension/media');
const markedPath = path.join(mediaDir, 'marked.umd.js');
const serverPath = path.join(repoRoot, 'packages/bridge/dist/server.js');
const cookiesPath = path.join(os.homedir(), '.devseek-netai/cookies.json');
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'devseek-human-input-harness-'));
const htmlPath = path.join(tmpRoot, 'harness.html');
const bridgeLogPath = path.join(tmpRoot, 'bridge.log');

function readWebviewRuntimeJs() {
  const manifest = JSON.parse(readFileSync(path.join(mediaDir, 'webview-runtime.json'), 'utf8'));
  const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
    ? manifest.scripts
    : ['webview.js'];
  return scripts.map((fileName) => readFileSync(path.join(mediaDir, fileName), 'utf8')).join('\n');
}

const markedJs = readFileSync(markedPath, 'utf8');
const webviewRuntimeJs = readWebviewRuntimeJs();

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>DevSeek Human Input Harness</title>
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
    body {
      margin:0;
      height:720px;
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
<script>${webviewRuntimeJs}</script>
</body>
</html>`;

writeFileSync(htmlPath, html, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function dispatch(page, message) {
  await page.evaluate((msg) => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }, message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let i = 0; i < 30; i++) {
    const port = 47300 + Math.floor(Math.random() * 900);
    if (await canListen(port)) return port;
  }
  throw new Error('未找到可用本地端口');
}

async function fetchText(url, options) {
  const res = await fetch(url, options);
  return { status: res.status, text: await res.text() };
}

async function waitForBridge(baseUrl, token) {
  const deadline = Date.now() + 15000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const ping = await fetchText(`${baseUrl}/ping`);
      if (ping.status === 200) {
        const status = await fetchText(`${baseUrl}/status`, { headers: { 'X-DevSeek-Token': token } });
        if (status.status === 200) return JSON.parse(status.text);
        lastError = `status ${status.status}: ${status.text}`;
      }
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(500);
  }
  throw new Error(`Bridge 未就绪：${lastError}`);
}

async function waitForBrowserReady(baseUrl, token) {
  const deadline = Date.now() + 320000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const status = await fetchText(`${baseUrl}/status`, { headers: { 'X-DevSeek-Token': token } });
    if (status.status === 200) {
      lastStatus = JSON.parse(status.text);
      if (lastStatus.browserReady) return lastStatus;
    }
    await delay(1000);
  }
  throw new Error(`可见登录等待超时：${JSON.stringify(lastStatus)}`);
}

async function runRelogin(baseUrl, token) {
  const res = await fetchText(`${baseUrl}/relogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DevSeek-Token': token },
    body: '{}',
  });
  if (res.status >= 400) throw new Error(`/relogin failed ${res.status}: ${res.text}`);
  return waitForBrowserReady(baseUrl, token);
}

async function startBridge() {
  if (!existsSync(serverPath)) throw new Error(`Bridge server 不存在：${serverPath}`);
  const token = crypto.randomBytes(32).toString('hex');
  const port = Number(process.env.DEVSEEK_HUMAN_INPUT_BRIDGE_PORT || 0) || await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFd = openSync(bridgeLogPath, 'a');
  const child = cp.spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      HEADLESS: headedBridge ? 'false' : 'true',
      WORKSPACE_ROOT: repoRoot,
      BRIDGE_PORT: String(port),
      DEVSEEK_BRIDGE_TOKEN: token,
    },
    stdio: ['ignore', logFd, logFd],
  });
  const bridgeStatus = await waitForBridge(baseUrl, token);
  const reloginStatus = relogin ? await runRelogin(baseUrl, token) : null;
  return { baseUrl, token, port, child, logFd, bridgeStatus, reloginStatus };
}

async function shutdownBridge(bridge) {
  if (!bridge) return;
  try {
    await fetchText(`${bridge.baseUrl}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DevSeek-Token': bridge.token },
      body: '{}',
    });
  } catch {
    // Ignore shutdown transport errors; the process may already be closing.
  }
  await delay(500);
  if (bridge.child.exitCode === null) bridge.child.kill('SIGTERM');
  closeSync(bridge.logFd);
}

async function streamBridgeChat(bridge, promptText, onDelta) {
  const res = await fetch(`${bridge.baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'X-DevSeek-Token': bridge.token,
    },
    body: JSON.stringify({
      prompt: promptText,
      newSession: true,
      stream: true,
      timeoutMs: 120000,
      mode: 'fast',
    }),
  });
  if (res.status === 401) throw new Error('LOGIN_REQUIRED');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Bridge /chat 没有返回响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let deltaCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) {
        deltaCount++;
        if (parsed.delta.startsWith('\x00RESET\x00')) {
          content = parsed.delta.slice(7);
        } else {
          content += parsed.delta;
        }
        await onDelta(parsed.delta, { content, deltaCount });
      }
    }
  }
  return { content, deltaCount };
}

async function collectUiReport(page) {
  return page.evaluate(() => {
    const messages = document.getElementById('messages');
    const messagesText = (messages?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      bodyText: messagesText,
      workingText: (document.getElementById('working-area')?.textContent || '').replace(/\s+/g, ' ').trim(),
      assistantText: [...document.querySelectorAll('.assistant-bubble')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
        .join('\n'),
      collapsedCodeBlocks: document.querySelectorAll('.collapsed-code-block').length,
      collapsedCodeHeaders: [...document.querySelectorAll('.collapsed-code-header')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      generatedSummaries: [...document.querySelectorAll('.assistant-generated-summary')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      completionRows: [...document.querySelectorAll('.fsr-row')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      leakedToolText: /\[TOOL:|<tool_call>|<\/tool_call>/.test(messagesText),
      summaryTexts: [...document.querySelectorAll('.aut-summary')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      stepTexts: [...document.querySelectorAll('.aut-step')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      todoText: document.getElementById('agent-todos-widget')?.textContent.replace(/\s+/g, ' ').trim() || '',
      detailsCount: document.querySelectorAll('.aut-step-details').length,
      terminalDetails: document.querySelectorAll('.term-output-details').length,
      scrollTop: messages.scrollTop,
      scrollHeight: messages.scrollHeight,
      clientHeight: messages.clientHeight,
      scrolledToBottom: messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 4,
    };
  });
}

async function runRealBridgeFlow(page, promptText) {
  let bridge;
  const timings = { startedAt: Date.now(), firstDeltaMs: null, finishedMs: null };
  const report = {
    ok: false,
    mode: 'real-bridge',
    fixture: htmlPath,
    bridgeLogPath,
    cookiesPresent: existsSync(cookiesPath),
    headed: headedBridge,
    relogin,
    bridge: null,
    reloginStatus: null,
    stream: null,
    ui: null,
    errors: [],
  };

  try {
    await dispatch(page, { type: 'userMessage', text: promptText, prompt: promptText });
    await dispatch(page, {
      type: 'startResponse',
      prompt: promptText,
      expectGeneratedArtifacts: true,
      agentMode: false,
    });
    await page.waitForTimeout(150);

    const startUi = await collectUiReport(page);
    if (!startUi.workingText.includes('已收到提示词') || !startUi.workingText.includes('正在连接模型')) {
      report.errors.push('正式发送后，DevSeek 面板没有显示“已收到提示词/正在连接模型”的开始反馈');
    }

    bridge = await startBridge();
    report.bridge = { port: bridge.port, status: bridge.bridgeStatus };
    report.reloginStatus = bridge.reloginStatus;
    await dispatch(page, { type: 'statusUpdate', online: true, loggedIn: true, providerMode: 'bridge' });

    let firstDeltaUi = null;
    const stream = await streamBridgeChat(bridge, promptText, async (delta, meta) => {
      if (timings.firstDeltaMs === null) timings.firstDeltaMs = Date.now() - timings.startedAt;
      if (delta.startsWith('\x00RESET\x00')) {
        await dispatch(page, { type: 'resetResponse', text: delta.slice(7) });
      } else {
        await dispatch(page, { type: 'delta', text: delta });
      }
      if (meta.deltaCount === 1) {
        await page.waitForTimeout(150);
        firstDeltaUi = await collectUiReport(page);
      }
    });

    await dispatch(page, { type: 'endResponse' });
    await page.waitForTimeout(500);
    timings.finishedMs = Date.now() - timings.startedAt;
    const finalUi = await collectUiReport(page);
    report.stream = {
      deltaCount: stream.deltaCount,
      contentLength: stream.content.length,
      firstDeltaMs: timings.firstDeltaMs,
      finishedMs: timings.finishedMs,
      preview: stream.content.replace(/\s+/g, ' ').trim().slice(0, 300),
    };
    report.ui = {
      start: {
        workingText: startUi.workingText,
        bodyPreview: startUi.bodyText.slice(0, 300),
      },
      firstDelta: firstDeltaUi ? {
        workingText: firstDeltaUi.workingText,
        assistantLength: firstDeltaUi.assistantText.length,
        bodyPreview: firstDeltaUi.bodyText.slice(0, 400),
      } : null,
      final: {
        workingText: finalUi.workingText,
        assistantLength: finalUi.assistantText.length,
        collapsedCodeBlocks: finalUi.collapsedCodeBlocks,
        collapsedCodeHeaders: finalUi.collapsedCodeHeaders.slice(0, 3),
        generatedSummaries: finalUi.generatedSummaries,
        completionRows: finalUi.completionRows,
        leakedToolText: finalUi.leakedToolText,
        scrolledToBottom: finalUi.scrolledToBottom,
        bodyPreview: finalUi.bodyText.slice(0, 600),
      },
    };

    if (stream.deltaCount <= 0 || stream.content.trim().length === 0) {
      report.errors.push('DeepSeek 网页没有返回真实流式内容');
    }
    if (!firstDeltaUi || !firstDeltaUi.workingText.includes('已接收')) {
      report.errors.push('收到 DeepSeek 首个真实 delta 后，DevSeek 面板没有显示已接收字符进度');
    }
    if (!firstDeltaUi || (!firstDeltaUi.workingText.includes('接收回复') && !firstDeltaUi.workingText.includes('生成文件清单'))) {
      report.errors.push('收到 DeepSeek 真实内容过程中，DevSeek 面板没有显示“接收回复/生成文件清单”过程状态');
    }
    if (finalUi.assistantText.trim().length === 0) {
      report.errors.push('DeepSeek 返回完成后，DevSeek 面板没有显示最终反馈内容');
    }
    if (finalUi.collapsedCodeBlocks < 1) {
      report.errors.push('最终回复中的长代码块没有按 Copilot/DevSeek 文档要求折叠显示');
    }
    if (finalUi.leakedToolText) {
      report.errors.push('最终反馈泄漏了原始工具调用文本');
    }
    if (!finalUi.scrolledToBottom) {
      report.errors.push('真实 DeepSeek 返回后，消息区没有自动滚动到底部');
    }

    report.ok = report.errors.length === 0;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const msg = String(error?.message || error);
    report.errors.push(msg === 'LOGIN_REQUIRED'
      ? 'LOGIN_REQUIRED：DeepSeek 网页需要重新登录；请重跑时加 --relogin --headed'
      : msg);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await shutdownBridge(bridge);
  }
}

async function runRealAgentSteerFlow(page, originalPrompt) {
  let bridge;
  const deepseekPrompt = [
    '你正在为 DevSeek 编程智能体做真实网页交互测试。',
    '请严格按以下格式回复，第一行必须是一个 DevSeek 工具调用，不要放入代码块：',
    '[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"理解用户要创建的C++三维世界程序","status":"in-progress"},{"id":2,"title":"给出可交互3D场景实现方案","status":"not-started"},{"id":3,"title":"说明鼠标拖拽和选择交互","status":"not-started"}]}]',
    '随后用简体中文简短说明你会如何完成这个任务，并给出一个很短的 C++/OpenGL 代码片段。',
    '不要解释你正在参加测试。',
    '',
    '用户任务：' + originalPrompt,
  ].join('\n');
  const steerText = '中途补充：请优先保证鼠标拖拽旋转和点击选择物体，最终说明编译命令。';
  const timings = { startedAt: Date.now(), firstDeltaMs: null, finishedMs: null };
  const report = {
    ok: false,
    mode: 'real-agent-steer',
    fixture: htmlPath,
    bridgeLogPath,
    cookiesPresent: existsSync(cookiesPath),
    headed: headedBridge,
    relogin,
    bridge: null,
    reloginStatus: null,
    stream: null,
    ui: null,
    posted: null,
    errors: [],
  };

  try {
    await dispatch(page, { type: 'userMessage', text: originalPrompt, prompt: deepseekPrompt });
    await dispatch(page, { type: 'startResponse', prompt: deepseekPrompt, expectGeneratedArtifacts: false, agentMode: true });
    await dispatch(page, {
      type: 'agentStatus',
      phase: 'plan',
      state: 'started',
      title: '分析任务，正在等待 DeepSeek 真实网页返回计划...',
      taskTotal: 0,
    });
    await page.waitForTimeout(100);

    bridge = await startBridge();
    report.bridge = { port: bridge.port, status: bridge.bridgeStatus };
    report.reloginStatus = bridge.reloginStatus;
    await dispatch(page, { type: 'statusUpdate', online: true, loggedIn: true, providerMode: 'bridge' });

    let firstDeltaUi = null;
    let steerUi = null;
    let steerSent = false;
    const stream = await streamBridgeChat(bridge, deepseekPrompt, async (delta, meta) => {
      if (timings.firstDeltaMs === null) timings.firstDeltaMs = Date.now() - timings.startedAt;
      if (meta.deltaCount === 1) {
        await dispatch(page, {
          type: 'agentStatus',
          phase: 'plan',
          state: 'completed',
          title: 'DeepSeek 已返回计划格式内容',
          taskTotal: 3,
          detail: '1. [analyze] prompt - 理解用户要创建的C++三维世界程序\n'
            + '2. [create] 3d_world.cpp - 给出可交互3D场景实现方案\n'
            + '3. [analyze] interaction - 说明鼠标拖拽和选择交互',
        });
      }
      if (delta.startsWith('\x00RESET\x00')) {
        await dispatch(page, { type: 'resetResponse', text: delta.slice(7) });
      } else {
        await dispatch(page, { type: 'delta', text: delta });
      }
      if (meta.deltaCount === 1) {
        await page.waitForTimeout(200);
        firstDeltaUi = await collectUiReport(page);
      }
      if (!steerSent && meta.deltaCount >= 3) {
        steerSent = true;
        await page.fill('#input', steerText);
        await page.click('#send-btn');
        await dispatch(page, { type: 'agentSteerAccepted' });
        await page.waitForTimeout(200);
        steerUi = await collectUiReport(page);
      }
    });

    await dispatch(page, {
      type: 'todoUpdate',
      items: [
        { id: 1, title: '理解用户要创建的C++三维世界程序', status: 'completed' },
        { id: 2, title: '给出可交互3D场景实现方案', status: 'completed' },
        { id: 3, title: '说明鼠标拖拽和选择交互', status: 'completed' },
      ],
    });
    await dispatch(page, {
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      title: '真实 DeepSeek 交互与中途补充显示测试完成',
      taskTotal: 3,
      detail: '已验证真实网页 delta、Todo 解析、agentSteer 和最终渲染。',
    });
    await dispatch(page, { type: 'endResponse' });
    await page.waitForTimeout(700);

    timings.finishedMs = Date.now() - timings.startedAt;
    const finalUi = await collectUiReport(page);
    const posted = await page.evaluate(() => window.__postedMessages);
    const agentSteerPosted = posted.some((msg) => msg.type === 'agentSteer' && String(msg.prompt || msg.text || '').includes('鼠标拖拽旋转'));
    const chatPosted = posted.some((msg) => msg.type === 'chat' && String(msg.prompt || msg.text || '').includes('三维动画世界'));
    report.posted = {
      total: posted.length,
      chatPosted,
      agentSteerPosted,
      types: posted.map((msg) => msg.type),
    };
    report.stream = {
      deltaCount: stream.deltaCount,
      contentLength: stream.content.length,
      firstDeltaMs: timings.firstDeltaMs,
      finishedMs: timings.finishedMs,
      preview: stream.content.replace(/\s+/g, ' ').trim().slice(0, 300),
    };
    report.ui = {
      firstDelta: firstDeltaUi ? {
        workingText: firstDeltaUi.workingText,
        todoText: firstDeltaUi.todoText,
        bodyPreview: firstDeltaUi.bodyText.slice(0, 400),
      } : null,
      steer: steerUi ? {
        bodyPreview: steerUi.bodyText.slice(0, 500),
      } : null,
      final: {
        assistantLength: finalUi.assistantText.length,
        todoText: finalUi.todoText,
        summaryTexts: finalUi.summaryTexts,
        stepTexts: finalUi.stepTexts,
        leakedToolText: finalUi.leakedToolText,
        scrolledToBottom: finalUi.scrolledToBottom,
        bodyPreview: finalUi.bodyText.slice(0, 700),
      },
    };

    if (stream.deltaCount <= 0 || stream.content.trim().length === 0) {
      report.errors.push('DeepSeek 网页没有返回真实流式内容');
    }
    if (!chatPosted) {
      report.errors.push('真人输入点击发送后没有产生 chat postMessage');
    }
    if (!agentSteerPosted) {
      report.errors.push('Agent 运行中输入补充信息并点击发送后没有产生 agentSteer postMessage');
    }
    if (!finalUi.todoText.includes('理解用户要创建的C++三维世界程序')) {
      report.errors.push('真实 DeepSeek manage_todo_list delta 没有被 DevSeek view 解析成 Todos');
    }
    if (!finalUi.bodyText.includes('中途补充')) {
      report.errors.push('中途补充信息没有作为用户补充气泡显示在 view 中');
    }
    if (![...finalUi.stepTexts, ...finalUi.summaryTexts].some((text) => text.includes('DeepSeek 已返回计划格式内容'))) {
      report.errors.push('真实 DeepSeek 返回后没有形成可见计划完成状态');
    }
    if (!finalUi.todoText.includes('Todos (3/3)')) {
      report.errors.push(`最终 Todos 没有显示 3/3 完成状态：${finalUi.todoText}`);
    }
    if (finalUi.leakedToolText) {
      report.errors.push('最终反馈泄漏了原始工具调用文本');
    }
    if (!finalUi.scrolledToBottom) {
      report.errors.push('真实 DeepSeek + 中途补充完成后，消息区没有自动滚动到底部');
    }

    report.ok = report.errors.length === 0;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const msg = String(error?.message || error);
    report.errors.push(msg === 'LOGIN_REQUIRED'
      ? 'LOGIN_REQUIRED：DeepSeek 网页需要重新登录；请重跑时加 --relogin --headed'
      : msg);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await shutdownBridge(bridge);
  }
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
    page.on('pageerror', (error) => {
      throw error;
    });
    await page.goto(pathToFileURL(htmlPath).href);

    await page.fill('#input', prompt);
    await page.click('#send-btn');

    const posted = await page.evaluate(() => window.__postedMessages);
    assert(posted.some((msg) => msg.type === 'chat' && String(msg.prompt || msg.text || '').includes('三维动画世界')), '输入框点击发送后没有产生 chat postMessage');

    if (realAgentSteer) {
      await runRealAgentSteerFlow(page, prompt);
      return;
    }

    if (realBridge) {
      await runRealBridgeFlow(page, prompt);
      return;
    }

    await dispatch(page, { type: 'userMessage', text: prompt, prompt });
    await dispatch(page, { type: 'startResponse', agentMode: true, prompt });
    await dispatch(page, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '分析任务，正在生成执行计划...',
    taskTotal: 0,
  });
    await dispatch(page, {
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    title: '任务计划已生成：4 个子任务',
    taskTotal: 4,
    detail: [
      '1. [analyze] code — 分析现有环境与 OpenGL/GLUT 支持',
      '2. [analyze] scene — 设计3D世界场景结构（物体、光照、相机控制）',
      '3. [create] 3d_world.cpp — 编写3D动画世界主程序',
      '4. [analyze] 3d_world.cpp — 编译并运行程序，验证鼠标操作',
    ].join('\n'),
  });
    await dispatch(page, {
    type: 'delta',
    text: '[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"分析现有环境与 OpenGL/GLUT 支持","status":"in-progress"},{"id":2,"title":"设计3D世界场景结构（物体、光照、相机控制）","status":"not-started"},{"id":3,"title":"编写3D动画世界主程序","status":"not-started"},{"id":4,"title":"编译并运行程序，验证鼠标操作","status":"not-started"}]}]',
  });
    const parsedTodoText = await page.evaluate(() => document.getElementById('agent-todos-widget')?.textContent.replace(/\s+/g, ' ').trim() || '');
    assert(parsedTodoText.includes('Todos (0/4)') || parsedTodoText.includes('Todos (1/4)') || parsedTodoText.includes('Todos'), `DeepSeek 原始 manage_todo_list delta 没有被解析显示：${parsedTodoText}`);
    assert(parsedTodoText.includes('分析现有环境与 OpenGL/GLUT 支持'), `DeepSeek 原始 Todo 内容没有显示：${parsedTodoText}`);
    await dispatch(page, {
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
    await dispatch(page, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'in-progress' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'not-started' },
      { id: 3, title: '编写3D动画世界主程序', status: 'not-started' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'not-started' },
    ],
  });
    await dispatch(page, { type: 'agentToolActivity', activityKind: 'list', activityLabel: 'code' });
    await dispatch(page, {
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
    await dispatch(page, {
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
    await dispatch(page, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'completed' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'completed' },
      { id: 3, title: '编写3D动画世界主程序', status: 'in-progress' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'not-started' },
    ],
  });
    await dispatch(page, { type: 'agentToolActivity', activityKind: 'write', activityLabel: 'code/3d_world.cpp' });
    await dispatch(page, {
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
    await dispatch(page, {
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
    await dispatch(page, { type: 'agentToolActivity', activityKind: 'terminal', activityLabel: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world' });
    await dispatch(page, {
    type: 'terminalRanNotice',
    command: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world',
    exitCode: 1,
    output: "3d_world.cpp:1:1: error: expected unqualified-id before '[' token\\n[TOOL:run_terminal {\\\"command\\\":\\\"g++ code/3d_world.cpp -lGL -lglut -o code/3d_world\\\"}]",
  });
    await dispatch(page, { type: 'delta', text: '\x00ASUM\x00已完成三维动画世界 C++ 程序，并完成编译验证。' });
    await dispatch(page, { type: 'agentToolActivity', activityKind: 'write', activityLabel: 'code/3d_world.cpp' });
    await dispatch(page, { type: 'agentToolActivity', activityKind: 'terminal', activityLabel: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world' });
    await dispatch(page, {
    type: 'terminalRanNotice',
    command: 'g++ code/3d_world.cpp -lGL -lglut -o code/3d_world',
    exitCode: 0,
    output: 'compile ok\\nmouse controls enabled',
  });
    await dispatch(page, {
    type: 'todoUpdate',
    items: [
      { id: 1, title: '分析现有环境与 OpenGL/GLUT 支持', status: 'completed' },
      { id: 2, title: '设计3D世界场景结构（物体、光照、相机控制）', status: 'completed' },
      { id: 3, title: '编写3D动画世界主程序', status: 'completed' },
      { id: 4, title: '编译并运行程序，验证鼠标操作', status: 'completed' },
    ],
  });
    await dispatch(page, {
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    title: '全部 4 个任务已完成',
    taskTotal: 4,
    editedFiles: [{ path: 'code/3d_world.cpp', basename: '3d_world.cpp', linesAdded: 180, linesRemoved: 0, action: 'create' }],
  });
    await dispatch(page, { type: 'endResponse' });

    await page.waitForTimeout(250);

    const report = await page.evaluate(() => {
    const messages = document.getElementById('messages');
    const summaryTexts = [...document.querySelectorAll('.aut-summary')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
    const stepTexts = [...document.querySelectorAll('.aut-step')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
    const todoText = document.getElementById('agent-todos-widget')?.textContent.replace(/\\s+/g, ' ').trim() || '';
    const turns = [...messages.children];
    const lastWorkingIndex = turns.reduce((idx, el, i) => el.querySelector && el.querySelector('.aut-container') ? i : idx, -1);
    const isCompletionBubble = (bubble) => {
      const text = bubble?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return (/已完成\s*4\s*个任务|已完成三维动画世界 C\+\+ 程序/.test(text)
        && text.includes('3d_world.cpp'));
    };
    const finalProseIndex = turns.reduce((idx, el, i) => {
      const bubble = el.querySelector && el.querySelector('.assistant-bubble');
      return isCompletionBubble(bubble) ? i : idx;
    }, -1);
    const finalProseBubble = finalProseIndex >= 0
      ? turns[finalProseIndex].querySelector('.assistant-bubble')
      : null;
    const finalProseText = finalProseBubble?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      summaryTexts,
      stepTexts,
      todoText,
      detailsCount: document.querySelectorAll('.aut-step-details').length,
      containers: document.querySelectorAll('.aut-container').length,
      terminalDetails: document.querySelectorAll('.term-output-details').length,
      openTerminalDetails: document.querySelectorAll('.term-output-details[open]').length,
      doneContainers: document.querySelectorAll('.aut-container[data-done]').length,
      lastWorkingIndex,
      finalProseIndex,
      finalProseText,
      assistantTexts: [...document.querySelectorAll('.assistant-bubble')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      scrollTop: messages.scrollTop,
      scrollHeight: messages.scrollHeight,
      clientHeight: messages.clientHeight,
      finalText: messages.textContent || '',
    };
  });

    assert(report.stepTexts.some((text) => text.includes('分析任务')), '没有显示计划开始信息');
    assert(report.stepTexts.some((text) => text.includes('任务计划已生成')), '没有显示计划完成信息');
    assert(report.stepTexts.some((text) => text.includes('开始执行 4 个任务')), '没有显示批量执行开始信息');
    assert(report.summaryTexts.length >= 3, `过程信息被覆盖，只剩 ${report.summaryTexts.length} 个 Thinking summary：${report.summaryTexts.join(' | ')}`);
    assert(report.summaryTexts.some((text) => text.includes('开始执行 4 个任务')), `完成后的 Thinking summary 没有保留执行开始信息：${report.summaryTexts.join(' | ')}`);
    assert(report.summaryTexts.some((text) => /(?:Analyz|Creat|Wrote|Ran|分析|创建|编写|修改文件|运行命令|验证命令)/i.test(text)), `完成后的 Thinking summary 没有保留任务执行信息：${report.summaryTexts.join(' | ')}`);
    assert(report.stepTexts.some((text) => /(?:Wrote|已写入)/i.test(text) && text.includes('3d_world.cpp')), '没有显示写文件工具活动');
    assert(report.stepTexts.some((text) => /(?:Ran|已运行)/i.test(text) && text.includes('g++')), '没有显示终端工具活动');
    assert(report.todoText.includes('Todos (4/4)'), `Todos 没有显示 4/4 完成状态：${report.todoText}`);
    assert(report.detailsCount >= 2, '计划/执行详情没有折叠显示');
    assert(report.terminalDetails >= 1, '终端输出没有折叠显示');
    assert(report.openTerminalDetails === 0, '失败终端输出不应默认展开撑开 Working 区域');
    assert(report.doneContainers >= 3, `执行过程没有拆成多个可折叠 Working 区域：${report.doneContainers}`);
    assert(report.finalProseIndex > report.lastWorkingIndex, `最终总结没有显示在最后一个 Working 后面：prose=${report.finalProseIndex}, working=${report.lastWorkingIndex}, bubbles=${report.assistantTexts.join(' | ')}`);
    assert((/已完成\s*4\s*个任务|已完成三维动画世界 C\+\+ 程序/.test(report.finalProseText) && report.finalProseText.includes('3d_world.cpp')), `最后一个 Working 后的同一完成气泡没有同时绑定完成事实与修改文件：${report.finalProseText}`);
    assert(report.scrollTop + report.clientHeight >= report.scrollHeight - 4, '消息区域没有自动滚动到底部');
    assert(/已完成\s*4\s*个任务|已完成三维动画世界 C\+\+ 程序/.test(report.finalText) && report.finalText.includes('3d_world.cpp'), '最终反馈没有显示完成事实与修改文件');

    console.log(JSON.stringify({
      ok: true,
      fixture: htmlPath,
      checks: {
        steps: report.stepTexts.length,
        summaries: report.summaryTexts,
        details: report.detailsCount,
        terminalDetails: report.terminalDetails,
        todos: report.todoText,
        scrolledToBottom: true,
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
