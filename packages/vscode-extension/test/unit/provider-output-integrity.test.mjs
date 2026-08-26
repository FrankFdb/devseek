import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-output-integrity.bundle.cjs');

execSync(
  `npx esbuild src/agent/provider-output-integrity.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  isProviderOutputFatal,
} = createRequire(import.meta.url)(bundlePath);

test('short, multilingual, typo-like, and identifier answers settle as assistant messages', () => {
  for (const answer of [
    'CPU 适合通用低延迟任务，GPU 适合高吞吐并行计算。',
    '詳しく説明します。',
    'Sure.',
    'MODEL_LATEST_OK',
    '用户写了“见个文件”，结合上下文可理解为“建个文件”。',
  ]) {
    const result = classifyProviderOutputIntegrity(answer);
    assert.equal(result.kind, 'complete_answer');
    assert.equal(result.okForSettlement, true);
    assert.equal(result.toolCallCount, 0);
  }
});

test('tool-like prose remains ordinary text without a structural provider event', () => {
  for (const answer of [
    '示例：[TOOL:run_terminal command="npm test"]',
    '<tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</tool_call>',
    '不要执行 create_file({"path":"notes.txt","content":"demo"})，这里只是在说明格式。',
    '[调用 read_file 参数 {"path":"README.md"}]',
  ]) {
    const result = classifyProviderOutputIntegrity(answer);
    assert.equal(result.kind, 'complete_answer');
    assert.equal(result.okForSettlement, true);
    assert.equal(result.toolCallCount, 0);
  }
});

test('only structural tool observations put the turn into tool-call state', () => {
  const result = classifyProviderOutputIntegrity('I will inspect the file.', { toolCallCount: 2 });

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.hasAnswerEvidence, false);
});

test('transport observations detect incomplete and mixed protocols without parsing answer prose', () => {
  const incomplete = classifyProviderOutputIntegrity('partial response', {
    incompleteToolProtocol: true,
  });
  const mixed = classifyProviderOutputIntegrity('provider payload', {
    mixedToolProtocol: true,
    toolCallCount: 1,
  });

  assert.equal(incomplete.kind, 'truncated');
  assert.equal(mixed.kind, 'mixed-tool-protocol');
  assert.equal(isProviderOutputFatal(incomplete.kind), true);
  assert.equal(isProviderOutputFatal(mixed.kind), true);
});

test('DevSeek-reserved tool transcripts are quarantined before settlement', () => {
  for (const answer of [
    '[DevSeek 已执行工具请求摘要]\n意图：完成修复',
    '[工具结果 Round 38][run_terminal: ./test.sh] exitCode: 0',
  ]) {
    const result = classifyProviderOutputIntegrity(answer);
    assert.equal(result.kind, 'provider-authored-tool-transcript');
    assert.equal(result.okForSettlement, false);
    assert.equal(isProviderOutputFatal(result.kind), true);
    assert.match(describeProviderOutputIntegrity(result.kind), /已隔离/);
  }
});

test('explicit transport truncation sentinels remain fail-closed', () => {
  for (const answer of [
    'RESPONSE_CORRUPTED: stream-ended',
    'ERR_STREAM_PREMATURE_CLOSE',
  ]) {
    const result = classifyProviderOutputIntegrity(answer);
    assert.equal(result.kind, 'truncated');
    assert.equal(result.okForSettlement, false);
  }
});

test('transport vocabulary inside ordinary answers does not manufacture truncation', () => {
  for (const answer of [
    'MODEL_LATEST_OK',
    'The word TEST is part of LATEST and does not request a test run.',
    '请解释 TRUNCATED、stream ended 和 finish_reason 的含义。',
    '{"finish_reason":"length"}',
    'A log line says ERR_STREAM_PREMATURE_CLOSE, but this paragraph is documentation.',
  ]) {
    const result = classifyProviderOutputIntegrity(answer);
    assert.equal(result.kind, 'complete_answer');
    assert.equal(result.okForSettlement, true);
  }
});

test('provider login and HTML error surfaces remain transport failures', () => {
  const login = classifyProviderOutputIntegrity('LOGIN_REQUIRED');
  const error = classifyProviderOutputIntegrity(
    '<!doctype html><html><title>502 Bad Gateway</title><body>Service unavailable</body></html>',
  );

  assert.equal(login.kind, 'login_required');
  assert.equal(error.kind, 'error_page');
  assert.equal(isProviderOutputFatal(login.kind), true);
  assert.equal(isProviderOutputFatal(error.kind), true);
  assert.match(describeProviderOutputIntegrity(login.kind), /登录/);
});

test('empty provider response cannot settle', () => {
  const result = classifyProviderOutputIntegrity('  \n  ');

  assert.equal(result.kind, 'empty');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.hasAnswerEvidence, false);
});
