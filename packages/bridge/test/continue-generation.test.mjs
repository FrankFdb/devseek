/**
 * Contract tests for bridge/src/continue-generation.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');
const bundlePath = path.join(rootDir, 'test/continue-generation.bundle.cjs');

execSync(
  `npx esbuild src/continue-generation.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:playwright`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  isContinueGenerationText,
  normalizeContinueGenerationText,
} = req(bundlePath);

test('ContinueGeneration: normalizes split button text', () => {
  assert.equal(normalizeContinueGenerationText(' 继 续 生 成 '), '继续生成');
  assert.equal(normalizeContinueGenerationText('Continue generating'), 'continuegenerating');
});

test('ContinueGeneration: recognizes DeepSeek continue buttons', () => {
  assert.equal(isContinueGenerationText('继续生成'), true);
  assert.equal(isContinueGenerationText('继续生成内容'), true);
  assert.equal(isContinueGenerationText('继续 回复'), true);
  assert.equal(isContinueGenerationText('Continue'), true);
  assert.equal(isContinueGenerationText('Continue generating'), true);
});

test('ContinueGeneration: rejects unrelated continuation actions', () => {
  assert.equal(isContinueGenerationText('Regenerate'), false);
  assert.equal(isContinueGenerationText('Continue with Google'), false);
  assert.equal(isContinueGenerationText('继续登录'), false);
});

console.log('\nBridge continue-generation tests passed.\n');
