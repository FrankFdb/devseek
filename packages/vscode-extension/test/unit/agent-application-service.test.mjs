/**
 * Contract tests for ARCH-05 Phase 10 AgentApplicationService.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, name) {
  const out = path.join(rootDir, `test/unit/${name}.bundle.cjs`);
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${out} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return createRequire(import.meta.url)(out);
}

const {
  AgentApplicationService,
} = bundle('src/app/agent-application-service.ts', 'agent-application-service');
const {
  buildTextUserMessage,
} = bundle('src/app/agent-protocol.ts', 'agent-protocol');

function createProvider(response, calls, options = {}) {
  return {
    type: 'deepseek-api',
    displayName: 'fake',
    async available() { return true; },
    async chat(opts) {
      calls.push(opts);
      if (options.throwOnce && calls.length === 1) {
        throw new Error(options.throwOnce);
      }
      opts.onDelta?.('delta-1');
      return response;
    },
  };
}

test('AgentApplicationService routes bridge chat through bridge port and records history', async () => {
  const records = [];
  const bridgeRequests = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'bridge',
    getProvider: () => {
      throw new Error('bridge must not request API provider');
    },
    bridgeChat: async (request) => {
      bridgeRequests.push(request);
      return 'bridge response';
    },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => records.push({ request, response }),
  });

  const response = await service.routeChat({ prompt: 'hello', trackHistory: true, files: ['a.ts'] });

  assert.equal(response, 'bridge response');
  assert.equal(bridgeRequests.length, 1);
  assert.equal(bridgeRequests[0].prompt, 'hello');
  assert.deepEqual(records, [{ request: bridgeRequests[0], response: 'bridge response' }]);
});

test('AgentApplicationService builds provider messages from tracked history and vision input', async () => {
  const calls = [];
  const provider = createProvider('api response', calls);
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => provider,
    bridgeChat: async () => {
      throw new Error('API route must not use bridge');
    },
    getChatHistory: () => [{ role: 'assistant', content: 'previous answer' }],
    recordChatHistory: () => {},
  });

  const deltas = [];
  const response = await service.routeChat({
    prompt: 'inspect image',
    trackHistory: true,
    images: ['data:image/png;base64,abc'],
    onDelta: (delta) => deltas.push(delta),
  });

  assert.equal(response, 'api response');
  assert.deepEqual(deltas, ['delta-1']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.length, 2);
  assert.deepEqual(calls[0].messages[0], { role: 'assistant', content: 'previous answer' });
  assert.equal(calls[0].messages[1].role, 'user');
  assert.equal(calls[0].messages[1].content[0].type, 'text');
  assert.equal(calls[0].messages[1].content[1].type, 'image_url');
});

test('AgentApplicationService retries API provider after key refresh and records retry response once', async () => {
  const calls = [];
  const records = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => createProvider('retry response', calls, { throwOnce: 'DEEPSEEK_INVALID_API_KEY' }),
    bridgeChat: async () => {
      throw new Error('API route must not use bridge');
    },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => records.push({ request, response }),
    promptForApiKeyUpdate: async () => true,
  });

  const response = await service.routeChat({ prompt: 'retry me', trackHistory: true });

  assert.equal(response, 'retry response');
  assert.equal(calls.length, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].response, 'retry response');
});

test('AgentApplicationService handle emits protocol events for chat command', async () => {
  const emitted = [];
  const calls = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => createProvider('done', calls),
    bridgeChat: async () => 'bridge',
    getChatHistory: () => [],
    recordChatHistory: () => {},
    emitEvent: (event) => emitted.push(event),
    now: () => 123,
    newId: () => `e${emitted.length + 1}`,
  });

  const events = await service.handle({
    type: 'chat.request',
    commandId: 'cmd-1',
    surface: 'test',
    request: { prompt: 'hello', stream: true },
  });

  assert.deepEqual(events.map(event => event.type), [
    'chat.started',
    'chat.delta',
    'chat.completed',
  ]);
  assert.deepEqual(emitted.map(event => event.type), [
    'chat.started',
    'provider.selected',
    'chat.delta',
    'chat.completed',
  ]);
  assert.equal(events.at(-1).response, 'done');
});

test('buildTextUserMessage keeps plain text and vision payloads explicit', () => {
  assert.deepEqual(buildTextUserMessage('plain'), { role: 'user', content: 'plain' });
  const vision = buildTextUserMessage('see', ['data:image/png;base64,abc']);
  assert.equal(vision.content[0].text, 'see');
  assert.equal(vision.content[1].image_url.url, 'data:image/png;base64,abc');
});

console.log('\nAgent application service tests passed.\n');
