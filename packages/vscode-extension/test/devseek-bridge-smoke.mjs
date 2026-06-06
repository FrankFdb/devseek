#!/usr/bin/env node
/**
 * DevSeek Bridge + real DeepSeek web smoke test.
 *
 * Non-invasive by design:
 * - does not modify production source files;
 * - starts a temporary bridge on an isolated localhost port;
 * - uses a temporary token and shuts the bridge down after the check;
 * - writes only /tmp/devseek-bridge-smoke-* logs/reports.
 *
 * Run from repository root:
 *   node packages/vscode-extension/test/devseek-bridge-smoke.mjs --chat
 *   node packages/vscode-extension/test/devseek-bridge-smoke.mjs --chat --headed
 *   node packages/vscode-extension/test/devseek-bridge-smoke.mjs --chat --relogin
 */

import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const serverPath = path.join(repoRoot, 'packages/bridge/dist/server.js');
const cookiesPath = path.join(os.homedir(), '.devseek-netai/cookies.json');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-bridge-smoke-'));
const logPath = path.join(tmpRoot, 'bridge.log');
const reportPath = path.join(tmpRoot, 'report.json');

const defaultPrompt = '在code目录下面编写一个三维动画世界C++程序，小孩可以通过鼠标操作各种三维物体，注意使用系统有的能力实现';
const args = new Set(process.argv.slice(2));
const chatEnabled = args.has('--chat') || process.env.DEVSEEK_BRIDGE_SMOKE_CHAT === '1';
const headed = args.has('--headed') || process.env.DEVSEEK_BRIDGE_SMOKE_HEADED === '1';
const relogin = args.has('--relogin') || process.env.DEVSEEK_BRIDGE_SMOKE_RELOGIN === '1';
const promptArgIndex = process.argv.indexOf('--prompt');
const prompt = promptArgIndex >= 0 && process.argv[promptArgIndex + 1]
  ? process.argv[promptArgIndex + 1]
  : defaultPrompt;

function writeReport(payload) {
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort() {
  for (let i = 0; i < 30; i++) {
    const port = 47300 + Math.floor(Math.random() * 900);
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
  if (res.status >= 400) {
    throw new Error(`/relogin failed ${res.status}: ${res.text}`);
  }
  return waitForBrowserReady(baseUrl, token);
}

async function shutdownBridge(baseUrl, token, child) {
  try {
    await fetchText(`${baseUrl}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DevSeek-Token': token },
      body: '{}',
    });
  } catch {
    // Ignore shutdown transport errors; the process may already be closing.
  }
  await delay(500);
  if (child.exitCode === null) child.kill('SIGTERM');
}

async function runChat(baseUrl, token) {
  const res = await fetchText(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DevSeek-Token': token },
    body: JSON.stringify({
      prompt,
      newSession: true,
      stream: false,
      timeoutMs: 120000,
      mode: 'fast',
    }),
  });
  if (res.status === 401 || res.text.includes('LOGIN_REQUIRED')) {
    return {
      ok: false,
      loginRequired: true,
      status: res.status,
      body: res.text.slice(0, 1000),
      message: 'DeepSeek 网页需要重新登录或 cookies 已失效',
    };
  }
  if (res.status >= 400) {
    return {
      ok: false,
      status: res.status,
      body: res.text.slice(0, 2000),
      message: 'Bridge /chat 返回错误',
    };
  }
  let content = '';
  try {
    const parsed = JSON.parse(res.text);
    content = String(parsed.content || '');
  } catch {
    content = res.text;
  }
  return {
    ok: content.trim().length > 0,
    status: res.status,
    contentLength: content.length,
    preview: content.replace(/\s+/g, ' ').trim().slice(0, 300),
    message: content.trim().length > 0 ? 'DeepSeek 网页返回内容' : 'DeepSeek 返回为空',
  };
}

async function main() {
  const token = crypto.randomBytes(32).toString('hex');
  const port = Number(process.env.DEVSEEK_BRIDGE_SMOKE_PORT || 0) || await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFd = fs.openSync(logPath, 'a');
  const child = cp.spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      HEADLESS: headed ? 'false' : 'true',
      WORKSPACE_ROOT: repoRoot,
      BRIDGE_PORT: String(port),
      DEVSEEK_BRIDGE_TOKEN: token,
    },
    stdio: ['ignore', logFd, logFd],
  });

  const report = {
    ok: false,
    fixture: tmpRoot,
    reportPath,
    logPath,
    port,
    cookiesPresent: fs.existsSync(cookiesPath),
    headed,
    relogin,
    bridgeStatus: null,
    reloginStatus: null,
    chat: null,
  };

  try {
    if (!fs.existsSync(serverPath)) throw new Error(`Bridge server 不存在：${serverPath}`);
    report.bridgeStatus = await waitForBridge(baseUrl, token);
    if (relogin) {
      report.reloginStatus = await runRelogin(baseUrl, token);
    }
    if (chatEnabled) {
      report.chat = await runChat(baseUrl, token);
      report.ok = !!report.bridgeStatus && report.chat.ok === true;
    } else {
      report.ok = !!report.bridgeStatus;
    }
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    report.error = String(error?.message || error);
    writeReport(report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    await shutdownBridge(baseUrl, token, child);
    fs.closeSync(logFd);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
