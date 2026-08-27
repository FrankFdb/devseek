import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  ownedProcessDetached,
  terminateOwnedProcessTree,
} from '../harness/owned-process-lifecycle.mjs';

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  pid = 4242;
  killCalls = [];

  kill(signal) {
    this.killCalls.push(signal);
    return true;
  }

  finish(signal = null) {
    this.signalCode = signal;
    this.exitCode = signal ? null : 0;
    this.emit('exit', this.exitCode, signal);
  }
}

test('owned process lifecycle creates a process group on POSIX only', () => {
  assert.equal(ownedProcessDetached('linux'), true);
  assert.equal(ownedProcessDetached('darwin'), true);
  assert.equal(ownedProcessDetached('win32'), false);
});

test('owned process lifecycle waits for graceful process-group exit', async () => {
  const child = new FakeChild();
  const signals = [];
  const stopped = await terminateOwnedProcessTree(child, {
    platform: 'linux',
    gracefulWaitMs: 20,
    listDescendants: () => [],
    signalGroup(pid, signal) {
      signals.push({ pid, signal });
      child.finish(signal);
    },
  });

  assert.equal(stopped, true);
  assert.deepEqual(signals, [{ pid: 4242, signal: 'SIGTERM' }]);
  assert.deepEqual(child.killCalls, []);
});

test('owned process lifecycle escalates an unresponsive process group', async () => {
  const child = new FakeChild();
  const signals = [];
  const stopped = await terminateOwnedProcessTree(child, {
    platform: 'linux',
    gracefulWaitMs: 5,
    forceWaitMs: 20,
    listDescendants: () => [],
    signalGroup(pid, signal) {
      signals.push({ pid, signal });
      if (signal === 'SIGKILL') child.finish(signal);
    },
  });

  assert.equal(stopped, true);
  assert.deepEqual(signals, [
    { pid: 4242, signal: 'SIGTERM' },
    { pid: 4242, signal: 'SIGKILL' },
  ]);
});

test('owned process lifecycle reaps a real POSIX descendant', async () => {
  if (process.platform === 'win32') return;
  const child = spawn('/bin/bash', ['-c', 'setsid sleep 30 & echo $!; wait'], {
    detached: ownedProcessDetached(),
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const descendantPid = await new Promise((resolve, reject) => {
    child.stdout.once('data', chunk => resolve(Number(String(chunk).trim())));
    child.once('error', reject);
  });

  try {
    assert.equal(await terminateOwnedProcessTree(child, {
      gracefulWaitMs: 200,
      forceWaitMs: 200,
    }), true);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.throws(() => process.kill(descendantPid, 0));
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
});

test('owned process lifecycle signals detached descendants from the captured tree', async () => {
  const child = new FakeChild();
  const signals = [];
  const stopped = await terminateOwnedProcessTree(child, {
    platform: 'linux',
    gracefulWaitMs: 20,
    listDescendants: () => [5001, 5002],
    signalProcess(pid, signal) {
      signals.push({ target: pid, signal });
    },
    signalGroup(pid, signal) {
      signals.push({ target: -pid, signal });
      child.finish(signal);
    },
  });

  assert.equal(stopped, true);
  assert.deepEqual(signals, [
    { target: 5002, signal: 'SIGTERM' },
    { target: 5001, signal: 'SIGTERM' },
    { target: -4242, signal: 'SIGTERM' },
  ]);
});
