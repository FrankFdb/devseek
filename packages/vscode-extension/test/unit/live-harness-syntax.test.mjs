/**
 * Syntax guards for opt-in live harnesses.
 *
 * Live DeepSeek/VS Code harnesses are not executed in the default suite because
 * they need a browser session and may take minutes, but they must still parse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

const liveHarnesses = [
  'test/devseek-real-plugin-deepseek-harness.mjs',
  'test/devseek-human-input-harness.mjs',
  'test/devseek-bridge-smoke.mjs',
];

test('Live harness syntax: opt-in harnesses parse before user-facing runs', () => {
  const failures = [];
  for (const relPath of liveHarnesses) {
    try {
      execFileSync(process.execPath, ['--check', relPath], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      failures.push({
        relPath,
        stderr: error.stderr || error.stdout || error.message,
      });
    }
  }

  assert.deepEqual(failures, []);
});
