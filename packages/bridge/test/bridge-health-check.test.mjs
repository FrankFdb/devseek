/**
 * Contract tests for bridge health check helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');
const bundlePath = path.join(rootDir, 'test/bridge-health-check.bundle.cjs');

execSync(
  `npx esbuild src/bridge-health-check.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { checkBridgeHealth } = req(bundlePath);

test('BridgeHealthCheck: not ready without browser session', () => {
  const health = checkBridgeHealth({ hasBrowser: false, hasContext: false, hasPage: false }, 0);
  assert.equal(health.browserReady, false);
  assert.equal(health.loggedInLikely, false);
  assert.equal(health.reason, 'browser-session-not-ready');
});

test('BridgeHealthCheck: detects login page', () => {
  const health = checkBridgeHealth({ hasBrowser: true, hasContext: true, hasPage: true, url: 'https://chat.deepseek.com/login' }, 1);
  assert.equal(health.browserReady, true);
  assert.equal(health.loggedInLikely, false);
  assert.equal(health.reason, 'login-url');
});

test('BridgeHealthCheck: reports logged-in indicator', () => {
  const health = checkBridgeHealth({ hasBrowser: true, hasContext: true, hasPage: true, url: 'https://chat.deepseek.com/' }, 1);
  assert.equal(health.browserReady, true);
  assert.equal(health.loggedInLikely, true);
  assert.equal(health.reason, 'logged-in-indicator-present');
});

console.log('\nBridge health check tests passed.\n');
