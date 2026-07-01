/**
 * Static regression guards for DeepSeek Web response latency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');

function src(relPath) {
  return readFileSync(path.join(rootDir, relPath), 'utf8');
}

test('DeepSeekAgent: streaming completion uses short stable windows', () => {
  const agent = src('src/deepseek-agent.ts');

  assert.match(agent, /STOP_DISAPPEARED_STABLE_TICKS = 5/);
  assert.match(agent, /READY_INPUT_STABLE_TICKS = 30/);
  assert.match(agent, /RESPONSE_CONTENT_QUIET_MS = 2_400/);
  assert.match(agent, /RESPONSE_LATE_GROWTH_PROBE_MS = 900/);
  assert.match(agent, /getContentQuietMs/);
  assert.doesNotMatch(agent, /stableFor >= 20|stableFor >= 35/);
});

test('DeepSeekAgent: final extraction avoids unconditional post-response waits', () => {
  const agent = src('src/deepseek-agent.ts');

  assert.doesNotMatch(agent, /waitForTimeout\(600\)/);
  assert.match(agent, /if \(clicked\) await page\.waitForTimeout\(CODE_TAB_RENDER_WAIT_MS\)/);
  assert.match(agent, /DEVSEEK_BRIDGE_DIAG === '1'/);
});

test('DeepSeekAgent: incomplete action cues keep generation open', () => {
  const agent = src('src/deepseek-agent.ts');

  assert.match(agent, /looksLikeIncompleteAssistantIntent/);
  assert.match(agent, /INCOMPLETE_INTENT_WAIT_MS/);
  assert.match(agent, /incomplete-intent/);
});

console.log('\nDeepSeek agent latency guard tests passed.\n');
