import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/web-reliability.bundle.cjs');

execSync(
  `npx esbuild src/llm/providers/web-reliability.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { ResponseIntegrityChecker, StreamWatchdog, BridgeHealthMonitor } =
  createRequire(import.meta.url)(bundlePath);

test('response integrity accepts arbitrary assistant prose at the transport boundary', () => {
  const checker = new ResponseIntegrityChecker();
  for (const response of [
    'CPU 适合低延迟通用计算，GPU 适合高吞吐并行计算。',
    '```ts\nexport const intentionallyOpen = ',
    '[TOOL:write_file {"path":"a.ts","content":"example"',
    '<TOOL_call>read_file {"path":"/tmp/a.md"}',
    '让我修复这个问题：',
    '{"choices":[{"message":}],"id":"documentation-example"}',
    '[调用 task_complete] {"summary": "这是未完成协议的示例',
  ]) {
    const result = checker.check(response);
    assert.equal(result.status, 'ok');
    assert.equal(result.safeToExecute, true);
  }
});

test('response integrity blocks exact provider login and verification surfaces', () => {
  const checker = new ResponseIntegrityChecker();
  for (const response of [
    '<html><title>Login</title>请先登录后继续</html>',
    'Log in to continue',
    'Sign-in required',
  ]) {
    assert.equal(checker.check(response).status, 'login-required');
  }
  for (const response of [
    '请输入验证码完成安全验证',
    'HTTP 429 Too Many Requests，请稍后再试',
    '当前请求已被限流，请稍后再试',
  ]) {
    assert.equal(checker.check(response).status, 'rate-limited');
  }
});

test('business prose containing provider words remains ordinary content', () => {
  const checker = new ResponseIntegrityChecker();
  for (const response of [
    '请说明 LOGIN_REQUIRED、captcha 和 HTTP 429 的差异。',
    '结论：业务需要生成验证码，并让后台校验验证码。',
    'The rate limiter test handles too many requests without requiring login.',
    'send button selector drift is not LOGIN_REQUIRED',
  ]) {
    assert.equal(checker.check(response).status, 'ok');
  }
});

test('structured provider controls are recognized only through control fields', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(checker.check('{"error":"LOGIN_REQUIRED"}').status, 'login-required');
  assert.equal(checker.check('{"status":"RATE_LIMITED"}').status, 'rate-limited');
  assert.equal(checker.check('{"example":"LOGIN_REQUIRED"}').status, 'ok');
  assert.equal(checker.check('{"message":"HTTP 429"}').status, 'ok');
});

test('empty provider content is not executable', () => {
  const result = new ResponseIntegrityChecker().check(' \n ');
  assert.equal(result.status, 'empty');
  assert.equal(result.safeToExecute, false);
});

test('StreamWatchdog reports stalled stream from timing facts', () => {
  const watchdog = new StreamWatchdog(100);
  watchdog.start(1_000);
  watchdog.observeChunk('hello', 1_050);

  assert.equal(watchdog.state(1_200).status, 'stalled');
  assert.equal(watchdog.finish(1_210).status, 'finished');
});

test('BridgeHealthMonitor uses typed browser and login state', () => {
  const monitor = new BridgeHealthMonitor();

  assert.equal(monitor.evaluate(undefined).status, 'unavailable');
  assert.equal(monitor.evaluate({ browserReady: false, loggedInLikely: false }).canSendPrompt, false);
  assert.equal(monitor.evaluate({ browserReady: true, loggedInLikely: false }).status, 'login-required');
  assert.equal(monitor.evaluate({ browserReady: true, loggedInLikely: true, queueLength: 2 }).status, 'degraded');
  assert.equal(monitor.evaluate({ browserReady: true, loggedInLikely: true }).status, 'ok');
});
