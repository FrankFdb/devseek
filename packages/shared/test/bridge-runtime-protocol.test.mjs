import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '..');
const bundlePath = path.join(testDir, 'bridge-runtime-protocol.bundle.cjs');

execSync(
  `npx esbuild src/bridge-runtime-protocol.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  BRIDGE_RUNTIME_PROTOCOL_VERSION,
  requireBridgeRuntimeAdvertisement,
} = require(bundlePath);

function advertisement(overrides = {}) {
  return {
    protocolVersion: BRIDGE_RUNTIME_PROTOCOL_VERSION,
    runtimeInstanceId: 'runtime-instance-1234567890',
    buildId: 'build-1',
    connector: {
      protocolVersion: 'devseek.deepseek-web-connector/v1',
      provider: 'deepseek-web',
      capabilities: [
        'text',
        'vision',
        'streaming',
        'text-tools',
        'web',
        'cancellation',
        'request-correlation',
        'bounded-retry',
      ],
      maxAttempts: 2,
      activeRequestCount: 0,
    },
    ...overrides,
  };
}

test('Bridge runtime advertisement authenticates one concrete process instance', () => {
  const value = requireBridgeRuntimeAdvertisement(advertisement());
  assert.equal(value.runtimeInstanceId, 'runtime-instance-1234567890');
  assert.equal(value.buildId, 'build-1');
  assert.equal(value.connector.provider, 'deepseek-web');
});

test('Bridge runtime advertisement rejects missing identity and connector drift', () => {
  assert.throws(
    () => requireBridgeRuntimeAdvertisement(advertisement({ runtimeInstanceId: '' })),
    /instance-id-invalid/u,
  );
  assert.throws(
    () => requireBridgeRuntimeAdvertisement(advertisement({
      connector: { ...advertisement().connector, protocolVersion: 'legacy' },
    })),
    /protocol-version-mismatch/u,
  );
});
