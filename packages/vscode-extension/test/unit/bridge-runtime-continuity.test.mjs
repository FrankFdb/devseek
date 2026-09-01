import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '../..');
const bundlePath = path.join(testDir, 'bridge-runtime-continuity.bundle.cjs');

execSync(
  `npx esbuild src/bridge-runtime-continuity.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  bridgeRuntimeChangedErrorFromPayload,
  BridgeRuntimeContinuity,
  decideBridgeRuntimePreparation,
} = require(bundlePath);

function runtime(runtimeInstanceId = 'runtime-instance-a', buildId = 'build-1') {
  return {
    protocolVersion: 'devseek.bridge-runtime/v1',
    runtimeInstanceId,
    buildId,
    connector: {},
  };
}

test('BridgeRuntimeContinuity retains known identity across a transient probe failure', () => {
  const continuity = new BridgeRuntimeContinuity();
  assert.equal(continuity.observe(runtime()), 'initial');
  continuity.markUnverified();

  assert.equal(continuity.isVerified, false);
  assert.equal(continuity.runtimeInstanceId, 'runtime-instance-a');
  assert.equal(decideBridgeRuntimePreparation({
    forceRestart: false,
    reachable: true,
    knownRuntimeInstanceId: continuity.runtimeInstanceId,
    expectedBuild: { buildId: 'build-1' },
  }), 'preserve-known');
});

test('BridgeRuntimeContinuity distinguishes instance replacement from same-process reuse', () => {
  const continuity = new BridgeRuntimeContinuity();
  continuity.observe(runtime());
  assert.equal(continuity.observe(runtime()), 'same');
  assert.equal(continuity.observe(runtime('runtime-instance-b')), 'changed');
  assert.equal(continuity.runtimeInstanceId, 'runtime-instance-b');
});

test('Bridge runtime preparation restarts only on explicit request or proven build mismatch', () => {
  const expectedBuild = { buildId: 'build-1' };
  assert.equal(decideBridgeRuntimePreparation({
    forceRestart: false,
    reachable: true,
    runtime: runtime(),
    expectedBuild,
  }), 'reuse');
  assert.equal(decideBridgeRuntimePreparation({
    forceRestart: false,
    reachable: true,
    runtime: runtime('runtime-instance-a', 'build-2'),
    expectedBuild,
  }), 'restart');
  assert.equal(decideBridgeRuntimePreparation({
    forceRestart: false,
    reachable: true,
    expectedBuild,
  }), 'blocked-unknown');
  assert.equal(decideBridgeRuntimePreparation({
    forceRestart: false,
    reachable: false,
    expectedBuild,
  }), 'start');
});

test('Bridge runtime replacement responses are parsed from structured payloads only', () => {
  const error = bridgeRuntimeChangedErrorFromPayload({
    error: 'BRIDGE_RUNTIME_CHANGED',
    runtimeInstanceId: 'runtime-instance-b',
  });

  assert.equal(error?.message, 'BRIDGE_RUNTIME_CHANGED');
  assert.equal(error?.currentRuntimeInstanceId, 'runtime-instance-b');
  assert.equal(bridgeRuntimeChangedErrorFromPayload('BRIDGE_RUNTIME_CHANGED'), undefined);
  assert.equal(bridgeRuntimeChangedErrorFromPayload({ error: 'other' }), undefined);
});
