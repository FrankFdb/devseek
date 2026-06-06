#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const vsixPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'devseek-netai-latest.vsix');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForStatus(port, token, deadlineMs = 8000) {
  const deadline = Date.now() + deadlineMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, {
        headers: { 'X-DevSeek-Token': token },
      });
      const text = await res.text();
      if (res.status === 200) return { status: res.status, text };
      lastError = `${res.status} ${text}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Bridge did not become ready: ${lastError}`);
}

async function main() {
  if (!existsSync(vsixPath)) {
    throw new Error(`VSIX not found: ${vsixPath}`);
  }

  const staging = mkdtempSync(path.join(tmpdir(), 'devseek-packaged-bridge-'));
  let child;
  try {
    const unzip = spawnSync('unzip', ['-q', vsixPath, '-d', staging], { stdio: 'inherit' });
    if (unzip.status !== 0) throw new Error(`unzip failed with status ${unzip.status}`);

    const serverJs = path.join(staging, 'extension', 'bridge', 'server.js');
    const playwright = path.join(staging, 'extension', 'node_modules', 'playwright', 'index.js');
    const playwrightCore = path.join(staging, 'extension', 'node_modules', 'playwright-core', 'index.js');
    for (const file of [serverJs, playwright, playwrightCore]) {
      if (!existsSync(file)) throw new Error(`Packaged bridge dependency missing: ${file}`);
    }

    const port = await getFreePort();
    const token = `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    child = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: {
        ...process.env,
        HEADLESS: 'true',
        WORKSPACE_ROOT: root,
        BRIDGE_PORT: String(port),
        DEVSEEK_BRIDGE_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let logs = '';
    child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
    child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logs += `\n[bridge exited with code ${code}]`;
      }
    });

    const ok = await waitForStatus(port, token);
    const unauthorized = await fetch(`http://127.0.0.1:${port}/status`);
    if (unauthorized.status !== 401) {
      throw new Error(`Expected unauthorized status 401, got ${unauthorized.status}`);
    }

    await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: 'POST',
      headers: { 'X-DevSeek-Token': token },
    }).catch(() => {});

    console.log(`Packaged Bridge OK: ${ok.status} ${ok.text}`);
  } catch (error) {
    if (child && !child.killed) child.kill('SIGTERM');
    throw error;
  } finally {
    if (child && !child.killed) child.kill('SIGTERM');
    rmSync(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
