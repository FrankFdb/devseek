import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-session-transition-'));
const bundlePath = path.join(bundleRoot, 'deepseek-session-transition.cjs');

buildSync({
  entryPoints: [path.join(bridgeRoot, 'src/deepseek-session-transition.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const {
  DEEPSEEK_SESSION_INPUT_TIMEOUT_MS,
  DEEPSEEK_SESSION_NAVIGATION_TIMEOUT_MS,
  DeepSeekSessionTransitionError,
  startDeepSeekSession,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createPort(overrides = {}) {
  const events = [];
  const port = {
    findNewChatButton: async () => ({ click: async () => { events.push('click'); } }),
    navigateHome: async options => { events.push(['navigate', options]); },
    waitForChatInput: async timeout => { events.push(['input', timeout]); },
    waitForTimeout: async timeout => { events.push(['wait', timeout]); },
    ...overrides,
  };
  return { events, port };
}

test('DeepSeek session transition proves the new-chat button path without navigation', async () => {
  const { events, port } = createPort();

  assert.deepEqual(await startDeepSeekSession(port), { mechanism: 'new-chat-button' });
  assert.deepEqual(events, [
    'click',
    ['wait', 300],
    ['input', DEEPSEEK_SESSION_INPUT_TIMEOUT_MS],
  ]);
});

test('DeepSeek session transition performs one bounded commit navigation after click failure', async () => {
  const { events, port } = createPort({
    findNewChatButton: async () => ({
      click: async () => {
        events.push('click');
        throw new Error('detached button');
      },
    }),
  });

  assert.deepEqual(await startDeepSeekSession(port), {
    mechanism: 'home-navigation',
    clickFailure: 'detached button',
  });
  assert.deepEqual(events, [
    'click',
    ['navigate', { waitUntil: 'commit', timeout: DEEPSEEK_SESSION_NAVIGATION_TIMEOUT_MS }],
    ['input', DEEPSEEK_SESSION_INPUT_TIMEOUT_MS],
  ]);
});

test('DeepSeek session transition accepts committed SPA navigation without DOMContentLoaded', async () => {
  const { events, port } = createPort({ findNewChatButton: async () => null });

  assert.deepEqual(await startDeepSeekSession(port), { mechanism: 'home-navigation' });
  assert.equal(events[0][0], 'navigate');
  assert.equal(events[0][1].waitUntil, 'commit');
  assert.equal(events.some(event => Array.isArray(event) && event[1]?.waitUntil === 'domcontentloaded'), false);
});

test('DeepSeek session transition propagates navigation failure without a stale input wait', async () => {
  const { events, port } = createPort({
    findNewChatButton: async () => null,
    navigateHome: async options => {
      events.push(['navigate', options]);
      throw new Error('commit timeout');
    },
  });

  await assert.rejects(
    startDeepSeekSession(port),
    error => error instanceof DeepSeekSessionTransitionError
      && error.stage === 'navigation'
      && /DEEPSEEK_SESSION_TRANSITION_FAILED:navigation:commit timeout/u.test(error.message),
  );
  assert.deepEqual(events, [
    ['navigate', { waitUntil: 'commit', timeout: DEEPSEEK_SESSION_NAVIGATION_TIMEOUT_MS }],
  ]);
});

test('DeepSeek session transition rejects a committed page without a usable input', async () => {
  const { port } = createPort({
    findNewChatButton: async () => null,
    waitForChatInput: async () => { throw new Error('input missing'); },
  });

  await assert.rejects(
    startDeepSeekSession(port),
    error => error instanceof DeepSeekSessionTransitionError
      && error.stage === 'readiness'
      && /input missing/u.test(error.message),
  );
});
