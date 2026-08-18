import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-process-lifecycle-'));
const require = createRequire(import.meta.url);

function bundle(relativePath, name) {
  const outfile = path.join(bundleRoot, `${name}.cjs`);
  buildSync({
    entryPoints: [path.join(extensionRoot, 'src', relativePath)],
    bundle: true,
    outfile,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  return require(outfile);
}

const { BridgeProcessOwner } = bundle('bridge-process-owner.ts', 'bridge-process-owner');
const { CapturedProcessRegistry } = bundle(
  'tools/captured-process-registry.ts',
  'captured-process-registry',
);
const { OwnedProcessTreeController } = bundle(
  'runtime/owned-process-tree.ts',
  'owned-process-tree',
);
const terminalBundlePath = path.join(bundleRoot, 'terminal.cjs');
buildSync({
  entryPoints: [path.join(extensionRoot, 'src/tools/terminal.ts')],
  bundle: true,
  outfile: terminalBundlePath,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  logLevel: 'silent',
});
const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return { workspace: { workspaceFolders: [] }, window: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const terminalModule = require(terminalBundlePath);
Module._load = originalLoad;

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  pid = 4242;
  unrefCalls = 0;
  killCalls = [];

  unref() { this.unrefCalls += 1; }
  kill(signal) { this.killCalls.push(signal); return true; }
  finish() { this.exitCode = 0; this.emit('exit', 0, null); }
}

test('BridgeProcessOwner closes the parent log descriptor and waits for graceful exit', async () => {
  const child = new FakeChild();
  let spawnOptions;
  const closedDescriptors = [];
  const owner = new BridgeProcessOwner({
    platform: 'linux',
    openLog: () => 17,
    closeLog: fd => closedDescriptors.push(fd),
    spawn: (_command, _args, options) => { spawnOptions = options; return child; },
  });

  owner.start({
    command: 'node',
    args: ['server.js'],
    cwd: '/tmp',
    env: {},
    logPath: '/tmp/bridge.log',
  });
  assert.deepEqual(closedDescriptors, [17]);
  assert.equal(spawnOptions.detached, true);
  assert.equal(child.unrefCalls, 1);
  assert.equal(owner.hasRunningProcess, true);

  let gracefulCalls = 0;
  await owner.stop(async () => {
    gracefulCalls += 1;
    child.finish();
  });
  assert.equal(gracefulCalls, 1);
  assert.equal(child.killCalls.length, 0);
  assert.equal(owner.hasRunningProcess, false);
});

test('BridgeProcessOwner closes the log descriptor when spawn throws', () => {
  const closedDescriptors = [];
  const owner = new BridgeProcessOwner({
    openLog: () => 19,
    closeLog: fd => closedDescriptors.push(fd),
    spawn: () => { throw new Error('spawn failed'); },
  });
  assert.throws(() => owner.start({
    command: 'node',
    args: [],
    cwd: '/tmp',
    env: {},
    logPath: '/tmp/bridge.log',
  }), /spawn failed/u);
  assert.deepEqual(closedDescriptors, [19]);
});

test('OwnedProcessTreeController degrades to process-group termination when discovery fails', () => {
  const child = new FakeChild();
  const signals = [];
  const controller = new OwnedProcessTreeController({
    platform: 'linux',
    listDescendants() { throw new Error('process table unavailable'); },
    signalProcess() { throw new Error('unexpected descendant signal'); },
    signalProcessGroup(pid, signal) { signals.push({ pid, signal }); },
    terminateWindowsTree() { throw new Error('unexpected Windows termination'); },
  });
  controller.signal(child, 'SIGTERM');
  assert.deepEqual(signals, [{ pid: 4242, signal: 'SIGTERM' }]);
});

test('CapturedProcessRegistry terminates a complete shell process group', async () => {
  if (process.platform === 'win32') return;
  const registry = new CapturedProcessRegistry();
  const child = spawn('/bin/bash', ['-c', 'setsid sleep 30 & wait'], {
    detached: true,
    stdio: 'ignore',
  });
  registry.register(child);
  try {
    await registry.dispose(100);
    assert.equal(registry.size, 0);
    assert.notEqual(child.signalCode, null);
  } finally {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
});

test('captured terminal command follows the owning chat AbortSignal and reaps descendants', async () => {
  if (process.platform === 'win32') return;
  const controller = new AbortController();
  const startedAt = Date.now();
  const resultPromise = terminalModule.runCommand({
    command: 'setsid sleep 30 & echo $! && wait',
    cwd: '/tmp',
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  await new Promise(resolve => setTimeout(resolve, 80));
  controller.abort(new Error('simulated-user-stop'));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.match(result.output, /命令已取消/u);
  assert.equal(Date.now() - startedAt < 2_000, true);

  const descendantPid = Number(result.stdout.trim().split(/\s+/u)[0]);
  assert.equal(Number.isSafeInteger(descendantPid), true);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.throws(() => process.kill(descendantPid, 0));
  await terminalModule.disposeCapturedTerminalProcesses();
});
