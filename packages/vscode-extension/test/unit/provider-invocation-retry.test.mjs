import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const retryBundlePath = path.join(rootDir, 'test/unit/provider-invocation-retry.bundle.cjs');
const classifierBundlePath = path.join(rootDir, 'test/unit/provider-transport-error.bundle.cjs');

execSync(
  `npx esbuild src/app/provider-invocation-retry.ts --bundle `
  + `--outfile=${retryBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/llm/provider-transport-error.ts --bundle `
  + `--outfile=${classifierBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ProviderInvocationRetryService, PROVIDER_INVOCATION_MAX_ATTEMPTS } = req(retryBundlePath);
const { isTransientProviderTransportError, providerErrorText } = req(classifierBundlePath);

function transportFailure() {
  const cause = Object.assign(new Error('socket disconnected'), { code: 'ECONNRESET' });
  return new TypeError('fetch failed', { cause });
}

test('provider transport classifier follows nested error causes', () => {
  const error = transportFailure();
  assert.equal(isTransientProviderTransportError(error), true);
  assert.match(providerErrorText(error), /ECONNRESET/);
});

test('provider transport classifier excludes user and provider gates', () => {
  assert.equal(isTransientProviderTransportError(new Error('LOGIN_REQUIRED: fetch failed')), false);
  assert.equal(isTransientProviderTransportError(new Error('AbortError: operation cancelled')), false);
  assert.equal(isTransientProviderTransportError(new Error('HTTP 429 rate-limited')), false);
});

test('bridge invocation retries one pre-output transport failure', async () => {
  const attempts = [];
  const delays = [];
  const retries = [];
  const service = new ProviderInvocationRetryService({
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  const result = await service.execute({
    providerType: 'bridge',
    invoke: async ({ attempt }) => {
      attempts.push(attempt);
      if (attempt === 1) throw transportFailure();
      return 'ok';
    },
    onRetry: event => retries.push(event),
  });

  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(delays, [1_000]);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].nextAttempt, 2);
});

test('bridge invocation does not replay after response output starts', async () => {
  let calls = 0;
  const service = new ProviderInvocationRetryService({ sleep: async () => {} });

  await assert.rejects(service.execute({
    providerType: 'bridge',
    invoke: async ({ markOutputObserved }) => {
      calls += 1;
      markOutputObserved();
      throw transportFailure();
    },
  }), /fetch failed/);
  assert.equal(calls, 1);
});

test('direct providers do not use the bridge transport retry policy', async () => {
  let calls = 0;
  const service = new ProviderInvocationRetryService({ sleep: async () => {} });

  await assert.rejects(service.execute({
    providerType: 'deepseek-api',
    invoke: async () => {
      calls += 1;
      throw transportFailure();
    },
  }), /fetch failed/);
  assert.equal(calls, 1);
});

test('bridge transport retry budget is bounded', async () => {
  let calls = 0;
  const service = new ProviderInvocationRetryService({ sleep: async () => {} });

  await assert.rejects(service.execute({
    providerType: 'bridge',
    invoke: async () => {
      calls += 1;
      throw transportFailure();
    },
  }), /fetch failed/);
  assert.equal(calls, PROVIDER_INVOCATION_MAX_ATTEMPTS);
});

test('aborted retry surfaces the cancellation reason', async () => {
  const controller = new AbortController();
  const cancelled = new Error('user cancelled');
  const service = new ProviderInvocationRetryService({ sleep: async () => {} });

  await assert.rejects(service.execute({
    providerType: 'bridge',
    signal: controller.signal,
    invoke: async () => {
      controller.abort(cancelled);
      throw transportFailure();
    },
  }), error => error === cancelled);
});
