import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-run-lifecycle-'));
const bundlePath = path.join(bundleRoot, 'run-lifecycle.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-run-lifecycle.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const {
  acceptCliCodingKernelOutput,
  resolveCliRunTerminalStatus,
  settleCliRunFailure,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('CLI run lifecycle retains canonical output before projecting a blocked terminal', async () => {
  const calls = [];
  const lifecycle = { status: 'blocked', events: [] };
  const evidence = {
    retainLifecycle(snapshot) {
      calls.push(['retain', snapshot]);
    },
    settle(status) {
      calls.push(['settle', status]);
    },
    async waitForBridgeProviderTerminals() {
      calls.push(['wait']);
    },
  };
  const completion = { status: 'blocked', reasonCodes: ['permission-denied'] };
  let blockedError;
  try {
    acceptCliCodingKernelOutput(evidence, {
      status: 'blocked',
      lifecycle,
      settlement: { status: 'blocked' },
      completion,
      result: { completion },
    });
  } catch (error) {
    blockedError = error;
  }

  assert.ok(blockedError instanceof Error);
  assert.equal(resolveCliRunTerminalStatus(blockedError, false), 'blocked');
  const firstFlushError = new Error('stdout flush failed');
  let flushCount = 0;
  const result = await settleCliRunFailure({
    error: blockedError,
    cancellation: { cancelled: false, exitCode: 130 },
    usesBridge: false,
    evidence,
    surface: {
      async flush() {
        flushCount++;
        calls.push([`flush-${flushCount}`]);
        if (flushCount === 1) throw firstFlushError;
      },
    },
    renderLifecycle(status, exitCode) {
      calls.push(['render', status, exitCode]);
    },
  });

  assert.deepEqual(result, { error: firstFlushError, status: 'blocked', exitCode: 1 });
  assert.deepEqual(calls, [
    ['retain', lifecycle],
    ['flush-1'],
    ['render', 'blocked', 1],
    ['flush-2'],
    ['settle', 'blocked'],
  ]);
});

test('CLI run lifecycle rejects a Surface terminal that disagrees with canonical settlement', () => {
  assert.throws(
    () => acceptCliCodingKernelOutput({ retainLifecycle() {} }, {
      status: 'completed',
      lifecycle: { status: 'completed', events: [] },
      settlement: { status: 'blocked' },
      result: { completion: { status: 'completed', reasonCodes: [] } },
    }),
    /cli-coding-kernel:settlement-binding-mismatch/u,
  );
});

test('CLI run lifecycle gives explicit cancellation precedence and fails closed otherwise', () => {
  assert.equal(resolveCliRunTerminalStatus(new Error('provider failed'), true), 'cancelled');
  assert.equal(resolveCliRunTerminalStatus(new Error('provider failed'), false), 'failed');
});
