import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentApplicationService } from '../dist/index.js';

const PARTICIPANT_CAPABILITY = `devseek-ra1_${'P'.repeat(43)}`;

function provider(response, calls) {
  return {
    type: 'deepseek-api',
    displayName: 'test-provider',
    async available() { return true; },
    async chat(options) {
      calls.push(options);
      return response;
    },
  };
}

test('participant capability is delivered only through the Bridge transport envelope', async () => {
  const bridgeRequests = [];
  const providerCalls = [];
  const historyCalls = [];
  const bridge = new AgentApplicationService({
    getProviderType: () => 'bridge',
    getProvider: () => provider('unused', providerCalls),
    bridgeChat: async request => {
      bridgeRequests.push(request);
      return 'bridge-response';
    },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => historyCalls.push({ request, response }),
  });

  await bridge.routeChat({
    prompt: 'hello bridge',
    trackHistory: true,
    traceEvidenceParticipantToken: PARTICIPANT_CAPABILITY,
  });
  assert.equal(bridgeRequests.length, 1);
  assert.deepEqual(bridgeRequests[0].evidenceCapability, {
    role: 'participant',
    token: PARTICIPANT_CAPABILITY,
  });
  assert.equal(Object.hasOwn(bridgeRequests[0], 'traceEvidenceParticipantToken'), false);
  assert.equal(providerCalls.length, 0);
  assert.equal(historyCalls.length, 1);
  assert.equal(JSON.stringify(historyCalls).includes(PARTICIPANT_CAPABILITY), false);
  assert.deepEqual(Object.keys(historyCalls[0].request).sort(), ['displayPrompt', 'prompt', 'trackHistory']);
});

test('generic providers and history adapters cannot observe the participant capability', async () => {
  const providerCalls = [];
  const historyCalls = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => provider('provider-response', providerCalls),
    bridgeChat: async () => { throw new Error('bridge must not run'); },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => historyCalls.push({ request, response }),
  });

  assert.equal(await service.routeChat({
    prompt: 'hello provider',
    trackHistory: true,
    traceEvidenceParticipantToken: PARTICIPANT_CAPABILITY,
  }), 'provider-response');
  assert.equal(providerCalls.length, 1);
  assert.equal(Object.hasOwn(providerCalls[0], 'traceEvidenceParticipantToken'), false);
  assert.equal(JSON.stringify(providerCalls).includes(PARTICIPANT_CAPABILITY), false);
  assert.equal(JSON.stringify(historyCalls).includes(PARTICIPANT_CAPABILITY), false);
});

test('request files, images, and history persistence fields are detached from getter and Proxy TOCTOU inputs', async () => {
  const providerCalls = [];
  const historyCalls = [];
  let fileLengthReads = 0;
  let fileReads = 0;
  let imageLengthReads = 0;
  let imageReads = 0;
  let displayPromptReads = 0;
  const files = new Proxy(['unused'], {
    get(target, key, receiver) {
      if (key === 'length') {
        fileLengthReads += 1;
        return 1;
      }
      if (key === '0') {
        fileReads += 1;
        return fileReads === 1 ? '/workspace/safe.txt' : PARTICIPANT_CAPABILITY;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const images = new Proxy(['unused'], {
    get(target, key, receiver) {
      if (key === 'length') {
        imageLengthReads += 1;
        return 1;
      }
      if (key === '0') {
        imageReads += 1;
        return imageReads === 1 ? 'data:image/png;base64,c2FmZQ==' : PARTICIPANT_CAPABILITY;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const request = {
    prompt: 'safe request',
    trackHistory: true,
    files,
    images,
    traceEvidenceParticipantToken: PARTICIPANT_CAPABILITY,
  };
  Object.defineProperty(request, 'displayPrompt', {
    enumerable: true,
    get() {
      displayPromptReads += 1;
      return displayPromptReads === 1 ? 'safe display prompt' : PARTICIPANT_CAPABILITY;
    },
  });
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => provider('safe response', providerCalls),
    bridgeChat: async () => { throw new Error('bridge must not run'); },
    getChatHistory: () => [],
    recordChatHistory: (historyRequest, response) => historyCalls.push({ request: historyRequest, response }),
  });

  assert.equal(await service.routeChat(request), 'safe response');
  assert.equal(fileLengthReads, 1);
  assert.equal(fileReads, 1);
  assert.equal(imageLengthReads, 1);
  assert.equal(imageReads, 1);
  assert.equal(displayPromptReads, 1);
  assert.equal(JSON.stringify(providerCalls).includes(PARTICIPANT_CAPABILITY), false);
  assert.equal(JSON.stringify(historyCalls).includes(PARTICIPANT_CAPABILITY), false);
  assert.deepEqual(providerCalls[0].files, ['/workspace/safe.txt']);
  assert.equal(historyCalls[0].request.displayPrompt, 'safe display prompt');
});

test('generic and Bridge history consumers receive one detached content snapshot', async t => {
  for (const providerType of ['deepseek-api', 'bridge']) {
    await t.test(providerType, async () => {
      let contentReads = 0;
      const message = { role: 'user' };
      Object.defineProperty(message, 'content', {
        enumerable: true,
        get() {
          contentReads += 1;
          return contentReads === 1 ? 'safe prior history' : PARTICIPANT_CAPABILITY;
        },
      });
      const providerCalls = [];
      const bridgeRequests = [];
      const historyCalls = [];
      const service = new AgentApplicationService({
        getProviderType: () => providerType,
        getProvider: () => provider('safe response', providerCalls),
        bridgeChat: async request => {
          bridgeRequests.push(request);
          return 'safe response';
        },
        getChatHistory: () => [message],
        recordChatHistory: (request, response) => historyCalls.push({ request, response }),
      });

      assert.equal(await service.routeChat({ prompt: 'safe prompt', trackHistory: true }), 'safe response');
      assert.equal(contentReads, 1);
      assert.equal(JSON.stringify(providerCalls).includes(PARTICIPANT_CAPABILITY), false);
      assert.equal(JSON.stringify(bridgeRequests).includes(PARTICIPANT_CAPABILITY), false);
      assert.equal(JSON.stringify(historyCalls).includes(PARTICIPANT_CAPABILITY), false);
      if (providerType === 'deepseek-api') {
        assert.equal(providerCalls[0].messages[0].content, 'safe prior history');
      } else {
        assert.match(bridgeRequests[0].prompt, /safe prior history/);
      }
    });
  }
});

test('API-key retry uses fresh provider messages and files after the first provider mutates its input', async () => {
  const providerCalls = [];
  const historyCalls = [];
  const retryingProvider = {
    type: 'deepseek-api',
    displayName: 'retry-provider',
    async available() { return true; },
    async chat(options) {
      providerCalls.push(options);
      if (providerCalls.length === 1) {
        options.messages[0].content = PARTICIPANT_CAPABILITY;
        options.files[0] = PARTICIPANT_CAPABILITY;
        throw new Error('DEEPSEEK_INVALID_API_KEY');
      }
      assert.equal(JSON.stringify(options).includes(PARTICIPANT_CAPABILITY), false);
      assert.deepEqual(options.files, ['/workspace/safe.txt']);
      return 'recovered response';
    },
  };
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek-api',
    getProvider: () => retryingProvider,
    bridgeChat: async () => { throw new Error('bridge must not run'); },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => historyCalls.push({ request, response }),
    promptForApiKeyUpdate: async () => true,
  });

  assert.equal(await service.routeChat({
    prompt: 'safe retry prompt',
    files: ['/workspace/safe.txt'],
    trackHistory: true,
  }), 'recovered response');
  assert.equal(providerCalls.length, 2);
  assert.equal(JSON.stringify(providerCalls[1]).includes(PARTICIPANT_CAPABILITY), false);
  assert.equal(JSON.stringify(historyCalls).includes(PARTICIPANT_CAPABILITY), false);
});

test('provider and Bridge errors are copied once into safe plain errors before delivery or event emission', async t => {
  await t.test('provider-error-getter', async () => {
    let messageReads = 0;
    const hostileError = new Error('unused');
    Object.defineProperty(hostileError, 'message', {
      configurable: true,
      get() {
        messageReads += 1;
        return messageReads === 1 ? 'safe provider failure' : PARTICIPANT_CAPABILITY;
      },
    });
    const emitted = [];
    const service = new AgentApplicationService({
      getProviderType: () => 'deepseek-api',
      getProvider: () => ({
        type: 'deepseek-api',
        displayName: 'error-provider',
        async available() { return true; },
        async chat() { throw hostileError; },
      }),
      bridgeChat: async () => { throw new Error('bridge must not run'); },
      getChatHistory: () => [],
      recordChatHistory: () => { throw new Error('history must not run'); },
      emitEvent: event => emitted.push(event),
    });
    await assert.rejects(service.handle({
      type: 'chat.request',
      commandId: 'hostile-provider-error',
      surface: 'test',
      request: { prompt: 'safe', trackHistory: false },
    }), error => {
      assert.notEqual(error, hostileError);
      assert.equal(error?.message, 'safe provider failure');
      assert.equal(String(error?.message).includes(PARTICIPANT_CAPABILITY), false);
      return true;
    });
    assert.equal(messageReads, 1);
    assert.equal(JSON.stringify(emitted).includes(PARTICIPANT_CAPABILITY), false);
    assert.equal(emitted.some(event => event.type === 'error' && event.message === 'safe provider failure'), true);
  });

  await t.test('bridge-error-proxy', async () => {
    let messageReads = 0;
    const hostileError = new Proxy({}, {
      get(_target, key) {
        if (key === 'message') {
          messageReads += 1;
          return messageReads === 1 ? 'safe bridge failure' : PARTICIPANT_CAPABILITY;
        }
        return undefined;
      },
    });
    const service = new AgentApplicationService({
      getProviderType: () => 'bridge',
      getProvider: () => { throw new Error('generic provider must not run'); },
      bridgeChat: async () => { throw hostileError; },
      getChatHistory: () => [],
      recordChatHistory: () => { throw new Error('history must not run'); },
    });
    await assert.rejects(service.routeChat({ prompt: 'safe', trackHistory: false }), error => {
      assert.notEqual(error, hostileError);
      assert.equal(error?.message, 'safe bridge failure');
      assert.equal(String(error?.message).includes(PARTICIPANT_CAPABILITY), false);
      return true;
    });
    assert.equal(messageReads, 1);
  });
});

test('capabilities embedded in prompt, prior history, or provider response never reach a durable history sink', async t => {
  const cases = [
    {
      name: 'prompt',
      prompt: `prompt:${PARTICIPANT_CAPABILITY}`,
      priorHistory: [],
      response: 'safe',
      expectedProviderCalls: 0,
    },
    {
      name: 'prior-history',
      prompt: 'safe',
      priorHistory: [{ role: 'user', content: `history:${PARTICIPANT_CAPABILITY}` }],
      response: 'safe',
      expectedProviderCalls: 0,
    },
    {
      name: 'provider-response',
      prompt: 'safe',
      priorHistory: [],
      response: `response:${PARTICIPANT_CAPABILITY}`,
      expectedProviderCalls: 1,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const providerCalls = [];
      const historyCalls = [];
      const service = new AgentApplicationService({
        getProviderType: () => 'deepseek-api',
        getProvider: () => provider(scenario.response, providerCalls),
        bridgeChat: async () => { throw new Error('bridge must not run'); },
        getChatHistory: () => scenario.priorHistory,
        recordChatHistory: (request, response) => historyCalls.push({ request, response }),
      });
      await assert.rejects(
        service.routeChat({ prompt: scenario.prompt, trackHistory: true }),
        error => error?.code === 'INVALID_INPUT'
          && !String(error?.message).includes(PARTICIPANT_CAPABILITY),
      );
      assert.equal(providerCalls.length, scenario.expectedProviderCalls);
      assert.equal(historyCalls.length, 0);
    });
  }
});

test('boxed text, split stream capabilities, non-text responses, and secret errors fail closed', async t => {
  const scenarios = [
    {
      name: 'boxed-prompt',
      prompt: new String(PARTICIPANT_CAPABILITY),
      providerFactory: calls => provider('safe', calls),
      expectedProviderCalls: 0,
    },
    {
      name: 'boxed-response',
      prompt: 'safe',
      providerFactory: calls => provider(new String(PARTICIPANT_CAPABILITY), calls),
      expectedProviderCalls: 1,
    },
    {
      name: 'object-response',
      prompt: 'safe',
      providerFactory: calls => provider({ content: 'must-not-coerce' }, calls),
      expectedProviderCalls: 1,
    },
    {
      name: 'secret-error',
      prompt: 'safe',
      providerFactory: calls => ({
        type: 'deepseek-api',
        displayName: 'test-provider',
        async available() { return true; },
        async chat(options) {
          calls.push(options);
          throw new Error(`provider:${PARTICIPANT_CAPABILITY}`);
        },
      }),
      expectedProviderCalls: 1,
    },
    {
      name: 'split-stream',
      prompt: 'safe',
      providerFactory: calls => ({
        type: 'deepseek-api',
        displayName: 'test-provider',
        async available() { return true; },
        async chat(options) {
          calls.push(options);
          options.onDelta?.('safe-prefix:');
          options.onDelta?.(PARTICIPANT_CAPABILITY.slice(0, 9));
          options.onDelta?.(PARTICIPANT_CAPABILITY.slice(9, 31));
          options.onDelta?.(PARTICIPANT_CAPABILITY.slice(31));
          return 'safe';
        },
      }),
      expectedProviderCalls: 1,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const providerCalls = [];
      const historyCalls = [];
      const deltas = [];
      const service = new AgentApplicationService({
        getProviderType: () => 'deepseek-api',
        getProvider: () => scenario.providerFactory(providerCalls),
        bridgeChat: async () => { throw new Error('bridge must not run'); },
        getChatHistory: () => [],
        recordChatHistory: (request, response) => historyCalls.push({ request, response }),
      });
      await assert.rejects(
        service.routeChat({
          prompt: scenario.prompt,
          trackHistory: true,
          onDelta: delta => deltas.push(delta),
        }),
        error => !String(error?.message).includes(PARTICIPANT_CAPABILITY),
      );
      assert.equal(providerCalls.length, scenario.expectedProviderCalls);
      assert.equal(historyCalls.length, 0);
      assert.equal(deltas.join('').includes(PARTICIPANT_CAPABILITY), false);
    });
  }
});

test('Bridge transport cannot expose a capability split across response deltas', async () => {
  const historyCalls = [];
  const delivered = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'bridge',
    getProvider: () => { throw new Error('generic provider must not run'); },
    bridgeChat: async request => {
      request.onDelta?.('safe-prefix:');
      request.onDelta?.(PARTICIPANT_CAPABILITY.slice(0, 7));
      request.onDelta?.(PARTICIPANT_CAPABILITY.slice(7, 28));
      request.onDelta?.(PARTICIPANT_CAPABILITY.slice(28));
      return 'safe-response';
    },
    getChatHistory: () => [],
    recordChatHistory: (request, response) => historyCalls.push({ request, response }),
  });

  await assert.rejects(
    service.routeChat({
      prompt: 'safe bridge prompt',
      trackHistory: true,
      onDelta: delta => delivered.push(delta),
      traceEvidenceParticipantToken: PARTICIPANT_CAPABILITY,
    }),
    error => !String(error?.message).includes(PARTICIPANT_CAPABILITY),
  );
  assert.equal(delivered.join('').includes(PARTICIPANT_CAPABILITY), false);
  assert.equal(historyCalls.length, 0);
});
