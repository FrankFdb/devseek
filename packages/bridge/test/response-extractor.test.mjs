/**
 * Contract tests for bridge/src/response-extractor.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');
const bundlePath = path.join(rootDir, 'test/response-extractor.bundle.cjs');

execSync(
  `npx esbuild src/response-extractor.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  extractDeepSeekResponse,
  isLoginUrl,
  normalizeDeepSeekAnswer,
} = req(bundlePath);

test('ResponseExtractor: extracts the last non-empty assistant answer', () => {
  const result = extractDeepSeekResponse({
    assistantMessages: ['old answer', '  \n', 'new answer\n\n\nwith spacing  \n'],
  });
  assert.equal(result.lastAnswer, 'new answer\n\nwith spacing');
});

test('ResponseExtractor: reports first non-empty error text', () => {
  const result = extractDeepSeekResponse({
    assistantMessages: ['answer'],
    errorTexts: ['', '  Something went wrong  '],
  });
  assert.equal(result.errorText, 'Something went wrong');
});

test('ResponseExtractor: derives login state from indicator count and url', () => {
  assert.equal(extractDeepSeekResponse({ assistantMessages: [], loggedInIndicatorCount: 1, url: 'https://chat.deepseek.com/' }).isLoggedIn, true);
  assert.equal(extractDeepSeekResponse({ assistantMessages: [], loggedInIndicatorCount: 1, url: 'https://chat.deepseek.com/sign_in' }).isLoggedIn, false);
  assert.equal(extractDeepSeekResponse({ assistantMessages: [], loggedInIndicatorCount: 0, url: 'https://chat.deepseek.com/' }).isLoggedIn, false);
  assert.equal(isLoginUrl('https://chat.deepseek.com/login'), true);
});

test('ResponseExtractor: normalizes answer whitespace', () => {
  assert.equal(normalizeDeepSeekAnswer('a  \r\n\r\n\r\nb\t\n'), 'a\n\nb');
});

console.log('\nBridge response extractor tests passed.\n');
