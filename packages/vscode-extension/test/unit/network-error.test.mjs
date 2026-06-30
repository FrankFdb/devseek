/**
 * Unit tests for agent/network-error.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/network-error.bundle.cjs');

execSync(
  `npx esbuild src/agent/network-error.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { isNetworkError } = req(bundlePath);

test('NetworkError: classifies transient connection errors but not login failures', () => {
  assert.equal(isNetworkError(new Error('fetch failed')), true);
  assert.equal(isNetworkError(new Error('HTTP 503 service unavailable')), true);
  assert.equal(isNetworkError(new Error('LOGIN_REQUIRED')), false);
});
