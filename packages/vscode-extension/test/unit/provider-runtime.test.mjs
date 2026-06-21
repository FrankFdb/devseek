/**
 * Contract tests for ARCH-05 Phase 8 Provider Runtime.
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
  ProviderConfigService,
  sanitizeProviderConfigSnapshot,
} = bundle('src/llm/provider-config-service.ts', 'provider-config-service');
const { LLMProviderRuntime } = bundle('src/llm/provider-runtime.ts', 'provider-runtime');
const { llmEventsToToolCalls, redactProviderSecrets } = bundle('src/llm/provider-events.ts', 'provider-events');
const {
  buildProviderStatusResponse,
  isProviderStatusRequest,
} = bundle('src/app/provider-status-service.ts', 'provider-status-service');

function config(values = {}) {
  return {
    get(key, defaultValue) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue;
    },
  };
}

test('ProviderConfigService: no configured provider defaults to DeepSeek Web bridge', () => {
  const snapshot = new ProviderConfigService(config()).getSnapshot();
  assert.equal(snapshot.activeProvider, 'bridge');
  assert.equal(snapshot.providers.bridge.displayName, 'DeepSeek 网页');
  assert.ok(snapshot.providers.bridge.capabilities.includes('text-tools'));
});

test('Provider status request is answered from local redacted configuration', () => {
  const prompt = '请检查当前 Provider 配置是否可用，并说明是否发现了密钥。不要输出密钥原文，不要修改文件。';
  const snapshot = new ProviderConfigService(config({
    provider: 'deepseek-api',
    model: 'deepseek-reasoner',
    apiKey: 'sk-secret-phase8-redaction',
    providerFallbackOrder: ['bridge'],
  })).getSnapshot();

  assert.equal(isProviderStatusRequest(prompt), true);
  const report = buildProviderStatusResponse({
    prompt,
    snapshot,
    availability: { available: true },
  }) ?? '';

  assert.match(report, /本地读取 VS Code `devseek` 配置/);
  assert.match(report, /DeepSeek API/);
  assert.match(report, /deepseek-reasoner/);
  assert.match(report, /devseek\.apiKey 已配置（已脱敏）/);
  assert.match(report, /当前 Provider 自检可用/);
  assert.doesNotMatch(report, /sk-secret-phase8-redaction/);
  assert.doesNotMatch(report, /无法直接访问 VS Code 插件/);
});

test('Provider runtime: API provider can switch model without changing workflow facts', () => {
  const snapshot = new ProviderConfigService(config({
    provider: 'deepseek-api',
    model: 'deepseek-reasoner',
    apiKey: 'sk-secret-phase8',
    providerFallbackOrder: ['openai-compat', 'bridge'],
  })).getSnapshot();

  const route = new LLMProviderRuntime(snapshot).selectProvider({
    workflowId: 'wf-8',
    checkpointId: 'cp-8',
    reviewLedgerId: 'review-8',
    idempotencyLedgerId: 'idem-8',
  });

  assert.equal(route.primary.type, 'deepseek-api');
  assert.equal(route.primary.model, 'deepseek-reasoner');
  assert.equal(route.workflow.workflowId, 'wf-8');
  assert.equal(JSON.stringify(snapshot).includes('sk-secret-phase8'), false);
});

test('Provider events: DeepSeek Web text tool parsing normalizes to ToolCall', () => {
  const calls = llmEventsToToolCalls([{
    type: 'message',
    provider: 'bridge',
    content: '准备读取文件。\n[TOOL:read_file] {"path":"src/index.ts"}',
  }]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'read_file');
  assert.equal(calls[0].source, 'fake-tool');
  assert.deepEqual(calls[0].input, { path: 'src/index.ts' });
  assert.equal(calls[0].registered, true);
});

test('Provider events: API native tool calling normalizes to the same ToolCall contract', () => {
  const calls = llmEventsToToolCalls([{
    type: 'tool-call',
    provider: 'openai-compat',
    call: {
      id: 'call_1',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ path: 'docs/phase8.md', content: 'ok' }),
      },
    },
  }]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'write_file');
  assert.equal(calls[0].source, 'native');
  assert.equal(calls[0].kind, 'edit');
  assert.equal(calls[0].registered, true);
});

test('Provider runtime: fallback inherits workflow facts and does not replay destructive tools', () => {
  const snapshot = new ProviderConfigService(config({
    provider: 'deepseek-api',
    providerFallbackOrder: ['openai-compat', 'bridge'],
  })).getSnapshot();
  const runtime = new LLMProviderRuntime(snapshot, {
    'deepseek-api': { status: 'available' },
    'openai-compat': { status: 'available' },
  });
  const route = runtime.selectProvider({
    workflowId: 'wf-fallback',
    checkpointId: 'cp-fallback',
    reviewLedgerId: 'review-fallback',
    idempotencyLedgerId: 'idem-fallback',
  });
  const [writeCall] = llmEventsToToolCalls([{
    type: 'tool-call',
    provider: 'deepseek-api',
    call: { function: { name: 'write_file', arguments: '{"path":"a.txt","content":"x"}' } },
  }]);

  const fallback = runtime.buildFallbackPlan(route, 'deepseek-api', [{ toolCalls: [writeCall] }]);
  assert.equal(fallback.workflow.workflowId, 'wf-fallback');
  assert.equal(fallback.workflow.checkpointId, 'cp-fallback');
  assert.equal(fallback.workflow.reviewLedgerId, 'review-fallback');
  assert.equal(fallback.workflow.idempotencyLedgerId, 'idem-fallback');
  assert.equal(fallback.nextProvider.type, 'openai-compat');
  assert.equal(fallback.allowToolReplay, false);
  assert.match(fallback.replayBlockedReason, /destructive|workspace-mutating/);
});

test('Provider runtime: API keys, cookies and tokens are redacted from persisted facts/log text', () => {
  const snapshot = new ProviderConfigService(config({
    provider: 'local-api',
    localApiApiKey: 'sk-local-secret',
    localApiBaseUrl: 'http://localhost:11434/v1',
  })).getSnapshot();
  const persisted = JSON.stringify(sanitizeProviderConfigSnapshot(snapshot));
  assert.equal(persisted.includes('sk-local-secret'), false);
  assert.equal(persisted.includes('devseek.localApiApiKey'), true);

  const redacted = redactProviderSecrets('authorization: Bearer abcdefgh123456 token=secret cookie=session api_key: sk-abcdef123456');
  assert.equal(redacted.includes('abcdefgh123456'), false);
  assert.equal(redacted.includes('secret'), false);
  assert.equal(redacted.includes('sk-abcdef123456'), false);
});

console.log('\nProvider runtime tests passed.\n');
