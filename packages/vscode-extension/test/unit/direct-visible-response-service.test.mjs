/**
 * Direct visible response service contract.
 *
 * Direct replies bypass the full Agent loop, but they still must publish the
 * same visible UI turn and history projection as normal chat responses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/direct-visible-response-service.bundle.cjs');

execSync(
  `npx esbuild src/app/direct-visible-response-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createDirectVisibleResponsePublisher } = req(bundlePath);

test('direct visible response publishes UI turn and records displayPrompt history', () => {
  const messages = [];
  const deltas = [];
  const history = [];
  const publisher = createDirectVisibleResponsePublisher({
    postMessage: message => messages.push(message),
    postDelta: message => deltas.push(message),
    recordHistory: (opts, response) => history.push({ opts, response }),
  });

  publisher.publish({
    userDisplay: '你好 DevSeek',
    userMessagePrompt: 'hidden resend prompt',
    responsePrompt: 'HIDDEN ROUTER PROMPT\nSYSTEM transport detail',
    responseText: '你好，我在。',
    images: ['image-a'],
    newSession: true,
  });

  assert.deepEqual(messages[0], { type: 'newSessionStarted' });
  assert.deepEqual(messages[1], {
    type: 'userMessage',
    text: '你好 DevSeek',
    prompt: 'hidden resend prompt',
    images: ['image-a'],
  });
  assert.deepEqual(messages[2], {
    type: 'startResponse',
    prompt: 'HIDDEN ROUTER PROMPT\nSYSTEM transport detail',
    expectGeneratedArtifacts: false,
    agentMode: false,
  });
  assert.deepEqual(deltas, [{ type: 'delta', text: '你好，我在。' }]);
  assert.deepEqual(messages.slice(3), [
    { type: 'responseMeta', hasGeneratedArtifacts: false, generatedPaths: [] },
    { type: 'endResponse' },
  ]);
  assert.deepEqual(history, [{
    opts: {
      prompt: 'HIDDEN ROUTER PROMPT\nSYSTEM transport detail',
      displayPrompt: '你好 DevSeek',
      trackHistory: true,
    },
    response: '你好，我在。',
  }]);
});

test('direct visible response can suppress duplicate user message while still recording history', () => {
  const messages = [];
  const history = [];
  const publisher = createDirectVisibleResponsePublisher({
    postMessage: message => messages.push(message),
    postDelta: () => undefined,
    recordHistory: (opts, response) => history.push({ opts, response }),
  });

  publisher.publish({
    userDisplay: '/init',
    userMessagePrompt: '/init hidden',
    responsePrompt: '/init hidden',
    responseText: '初始化草稿',
    suppressUserMessage: true,
  });

  assert.equal(messages.some(message => message.type === 'userMessage'), false);
  assert.equal(history[0].opts.displayPrompt, '/init');
});
