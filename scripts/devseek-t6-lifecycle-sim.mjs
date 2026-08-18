#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const bridgeServer = path.join(repositoryRoot, 'packages/bridge/dist/server.js');

if (process.argv[2] === '--spawn-owned-bridge') {
  const [, , , port, workspaceRoot, token, pidFile] = process.argv;
  const child = spawn(process.execPath, [bridgeServer], {
    cwd: path.dirname(bridgeServer),
    detached: true,
    stdio: 'ignore',
    env: bridgeEnvironment({ port, workspaceRoot, token, parentPid: process.pid }),
  });
  writeFileSync(pidFile, String(child.pid), 'utf8');
  child.unref();
  process.exit(0);
}

assert.equal(existsSync(bridgeServer), true, 'build packages/bridge before running the T6 simulation');
const root = mkdtempSync(path.join(tmpdir(), 'devseek-t6-lifecycle-'));
const token = 't6-lifecycle-simulation-token';
const reports = [];

try {
  const httpPort = await reservePort();
  const httpChild = spawn(process.execPath, [bridgeServer], {
    cwd: path.dirname(bridgeServer),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: bridgeEnvironment({ port: httpPort, workspaceRoot: root, token, parentPid: process.pid }),
  });
  await waitForBridge(httpPort);
  const shutdownStartedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${httpPort}/shutdown`, {
    method: 'POST',
    headers: { 'x-devseek-token': token },
  });
  assert.equal(response.ok, true);
  await waitForChildExit(httpChild, 5_000);
  assert.equal(isPidAlive(httpChild.pid), false);
  assert.equal(await isPortOpen(httpPort), false);
  reports.push({
    scenario: 'http-graceful-shutdown',
    passed: true,
    elapsedMs: Date.now() - shutdownStartedAt,
    pid: httpChild.pid,
  });

  const parentExitPort = await reservePort();
  const pidFile = path.join(root, 'parent-owned-bridge.pid');
  const owner = spawn(process.execPath, [
    scriptPath,
    '--spawn-owned-bridge',
    String(parentExitPort),
    root,
    token,
    pidFile,
  ], { stdio: 'ignore' });
  await waitForChildExit(owner, 2_000);
  const ownedPid = Number(readFileSync(pidFile, 'utf8').trim());
  const parentExitStartedAt = Date.now();
  await waitUntil(() => !isPidAlive(ownedPid), 5_000, 'parent-owned Bridge did not exit');
  assert.equal(await isPortOpen(parentExitPort), false);
  reports.push({
    scenario: 'extension-host-parent-exit',
    passed: true,
    elapsedMs: Date.now() - parentExitStartedAt,
    pid: ownedPid,
  });

  console.log(JSON.stringify({ passed: true, reports }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

function bridgeEnvironment({ port, workspaceRoot, token, parentPid }) {
  return {
    ...process.env,
    HEADLESS: 'true',
    BRIDGE_PORT: String(port),
    WORKSPACE_ROOT: workspaceRoot,
    DEVSEEK_BRIDGE_TOKEN: token,
    DEVSEEK_BRIDGE_PARENT_PID: String(parentPid),
  };
}

async function waitForBridge(port) {
  await waitUntil(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ping`, {
        signal: AbortSignal.timeout(200),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, 5_000, `Bridge did not listen on ${port}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function isPortOpen(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(200) });
    return true;
  } catch {
    return false;
  }
}

async function reservePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => { if (error) reject(error); else resolve(port); });
    });
    server.on('error', reject);
  });
}
