import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-response-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/provider-response-recovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildAgentProviderRecoveryPrompt,
  canRecoverAgentProviderFailure,
  describeAgentProviderRecoveryForUser,
  parseAgentProviderFailure,
  shouldResetProviderSessionForRecovery,
} = req(bundlePath);

test('Agent provider recovery: response corruption is recoverable but login is not', () => {
  const corruption = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:unclosed-markdown-fence:Markdown code fence is not closed.'),
  );
  assert.equal(corruption.status, 'unclosed-markdown-fence');
  assert.equal(corruption.recoverable, true);
  assert.equal(canRecoverAgentProviderFailure(corruption, 0, 3), true);
  assert.equal(canRecoverAgentProviderFailure(corruption, 3, 3), false);

  const timeout = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:stream-timeout:Bridge SSE stream exceeded 210000ms without completion.'),
  );
  assert.equal(timeout.status, 'stream-timeout');
  assert.equal(timeout.recoverable, true);
  assert.equal(canRecoverAgentProviderFailure(timeout, 1, 3), true);
  assert.equal(shouldResetProviderSessionForRecovery(timeout), true);

  const submitFailed = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:prompt-submit-failed:PROMPT_SUBMIT_FAILED: composer did not clear.'),
  );
  assert.equal(submitFailed.status, 'prompt-submit-failed');
  assert.equal(submitFailed.recoverable, true);
  assert.equal(canRecoverAgentProviderFailure(submitFailed, 1, 3), true);
  assert.equal(shouldResetProviderSessionForRecovery(submitFailed), true);

  const legacySubmitFailed = parseAgentProviderFailure(
    new Error('PROMPT_SUBMIT_FAILED: DeepSeek 网页未确认收到本轮请求。'),
  );
  assert.equal(legacySubmitFailed.status, 'prompt-submit-failed');
  assert.equal(legacySubmitFailed.recoverable, true);

  const login = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:login-required:Provider requires login.'),
  );
  assert.equal(login.recoverable, false);
  assert.equal(canRecoverAgentProviderFailure(login, 0, 3), false);
  assert.equal(shouldResetProviderSessionForRecovery(login), false);

  const transientStreamError = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:stream-error:provider-error:Bridge stream failed; retryAfterMs=1000.'),
  );
  assert.equal(transientStreamError.recoverable, true);
  assert.equal(shouldResetProviderSessionForRecovery(transientStreamError), true);

  const rateLimitedStream = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:stream-error:rate-limited:Bridge stream failed; retryAfterMs=30000.'),
  );
  assert.equal(rateLimitedStream.recoverable, false);
  assert.equal(shouldResetProviderSessionForRecovery(rateLimitedStream), false);
});

test('Agent provider recovery prompt keeps only durable facts and forces small tool batches', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:incomplete-tool-block:Tool block is incomplete.'),
  );
  const prompt = buildAgentProviderRecoveryPrompt({
    userPrompt: '正式既有工程中实现功能并创建文档',
    failure,
    recoveryAttempt: 1,
    maxRecoveryAttempts: 3,
    promptRequiresTools: true,
    currentTodos: [{ id: 1, title: '分析既有入口', status: 'in-progress' }],
    readEvidencePaths: ['src/main.cpp', 'src/lifting/lifting_manager.hpp'],
    writtenFiles: [{ path: 'docs/01-design.md', basename: '01-design.md', linesAdded: 10, linesRemoved: 0, action: 'create' }],
    terminalEvidence: [{
      command: 'npm test',
      ok: false,
      exitCode: 1,
      detail: 'FAIL: quiz state incorrect',
    }],
    partialResponseLength: 46000,
  }).content;

  assert.match(prompt, /已阻止执行损坏内容/);
  assert.match(prompt, /不要引用、续写或执行上一轮损坏文本/);
  assert.match(prompt, /不要重复已读取路径/);
  assert.match(prompt, /最多 6 个只读工具/);
  assert.match(prompt, /content 控制在 6000 字符以内/);
  assert.match(prompt, /可验证、可继续扩展的完整责任切片/);
  assert.match(prompt, /不得用占位骨架、近似接口或“最小可编译版本”冒充原始契约已经完成/);
  assert.match(prompt, /本轮只输出 1 个工具调用/);
  assert.match(prompt, /不要再次把含源码双引号或多行文本的 old_str\/new_str 手写进 JSON/);
  assert.match(prompt, /<replace_in_file>/);
  assert.match(prompt, /<old_str><!\[CDATA\[if \(ready\) \{/);
  assert.match(prompt, /<new_str><!\[CDATA\[if \(ready\) \{/);
  assert.match(prompt, /```xml\n<replace_in_file>[\s\S]*<\/replace_in_file>\n```/);
  assert.match(prompt, /每轮只修复 1 个多行替换/);
  assert.match(prompt, /command 必须是合法 JSON 字符串/);
  assert.match(prompt, /输出工具块后立即停止/);
  assert.match(prompt, /正式既有工程任务必须继续沿既有入口/);
  assert.match(prompt, /FAIL: quiz state incorrect/);
  assert.match(prompt, /src\/lifting\/lifting_manager\.hpp/);
  assert.equal(prompt.match(/```xml/g)?.length, 1);
});

test('Agent provider recovery omits validation failures cleared by newer success', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:invalid-tool-block:authorized envelope was malformed.'),
  );
  const prompt = buildAgentProviderRecoveryPrompt({
    userPrompt: '修复并验证当前项目',
    failure,
    recoveryAttempt: 1,
    maxRecoveryAttempts: 3,
    promptRequiresTools: true,
    currentTodos: [],
    readEvidencePaths: ['src/lesson_controller.cpp'],
    writtenFiles: [],
    terminalEvidence: [
      { command: 'cmake --build build', kind: 'compile', ok: false, exitCode: 2, detail: 'duplicate definition' },
      { command: 'cmake --build build2', kind: 'compile', ok: true, exitCode: 0 },
      { command: './build2/math_visual_lab --self-test', kind: 'test', ok: true, exitCode: 0 },
    ],
    textToolProtocol: {
      version: 'devseek.text-tools/v1',
      channelId: 'current-state-channel',
    },
  }).content;

  assert.doesNotMatch(prompt, /duplicate definition/);
  assert.doesNotMatch(prompt, /failed: cmake --build build/);
  assert.match(prompt, /ok: cmake --build build2/);
  assert.match(prompt, /ok: \.\/build2\/math_visual_lab --self-test/);
});

test('Agent provider recovery prompt tightens the last retry', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:stream-timeout:timeout'),
  );
  const prompt = buildAgentProviderRecoveryPrompt({
    userPrompt: '实现一个正式项目功能'.repeat(200),
    failure,
    recoveryAttempt: 3,
    maxRecoveryAttempts: 3,
    promptRequiresTools: true,
    currentTodos: [],
    readEvidencePaths: [],
    writtenFiles: [],
    terminalEvidence: [],
    partialResponseLength: 90000,
  }).content;

  assert.match(prompt, /最后一次恢复/);
  assert.match(prompt, /最多 3 个只读工具或 1 个写入工具/);
  assert.match(prompt, /本轮会重建 Provider 会话/);
  assert.match(prompt, /原始用户任务：.{100,900}/s);
  assert.doesNotMatch(prompt, /实现一个正式项目功能.{1800}/s);
});

test('Agent provider recovery quarantines out-of-envelope actions and reissues the current channel', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:out-of-envelope-tool-block:react-action was quarantined.'),
  );
  const prompt = buildAgentProviderRecoveryPrompt({
    userPrompt: '读取 README.md 后创建 report.md',
    failure,
    recoveryAttempt: 1,
    maxRecoveryAttempts: 3,
    promptRequiresTools: true,
    currentTodos: [],
    readEvidencePaths: [],
    writtenFiles: [],
    terminalEvidence: [],
    textToolProtocol: {
      version: 'devseek.text-tools/v1',
      channelId: 'provider-recovery-channel',
    },
  }).content;
  const display = describeAgentProviderRecoveryForUser(failure, 1, 3);

  assert.equal(failure.recoverable, true);
  assert.match(prompt, /不要使用 Action\/Action Input/);
  assert.match(prompt, /channel="provider-recovery-channel"/);
  assert.match(display.title, /工具请求未通过协议门禁/);
  assert.match(display.detail, /已隔离且未执行/);
});

test('Agent provider recovery reissues malformed authorized envelopes in bounded chunks', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:invalid-tool-block:authorized envelope had no registered tool.'),
  );
  const prompt = buildAgentProviderRecoveryPrompt({
    userPrompt: '创建 docs/report.md',
    failure,
    recoveryAttempt: 1,
    maxRecoveryAttempts: 3,
    promptRequiresTools: true,
    currentTodos: [],
    readEvidencePaths: ['README.md'],
    writtenFiles: [],
    terminalEvidence: [],
    textToolProtocol: {
      version: 'devseek.text-tools/v1',
      channelId: 'invalid-envelope-channel',
    },
  }).content;

  assert.equal(failure.recoverable, true);
  assert.match(prompt, /channel="invalid-envelope-channel"/);
  assert.match(prompt, /不超过 1800 字符/);
});

test('Agent provider recovery resets browser state after every rejected response', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:incomplete-tool-block:Tool block is incomplete.'),
  );
  const mixed = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:mixed-tool-protocol:incompatible tool dialects.'),
  );

  assert.equal(shouldResetProviderSessionForRecovery(failure), true);
  assert.equal(mixed.recoverable, true);
  assert.equal(shouldResetProviderSessionForRecovery(mixed), true);
});

test('Agent provider recovery display tells the user a safe retry is running', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:unclosed-markdown-fence:Markdown code fence is not closed.'),
  );
  const display = describeAgentProviderRecoveryForUser(failure, 2, 3);
  assert.match(display.title, /正在安全续跑/);
  assert.match(display.detail, /已阻止执行/);
  assert.match(display.activityLabel, /重建模型会话，安全恢复 2\/3/);
});

test('Agent provider recovery display names provider session rebuilds', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:stream-timeout:DeepSeek response did not complete.'),
  );
  const display = describeAgentProviderRecoveryForUser(failure, 1, 3);

  assert.match(display.detail, /重建模型会话/);
  assert.match(display.activityLabel, /重建模型会话/);
});

test('Agent provider recovery display distinguishes submit failures from truncated responses', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:prompt-submit-failed:PROMPT_SUBMIT_FAILED: composer did not clear.'),
  );
  const display = describeAgentProviderRecoveryForUser(failure, 1, 3);

  assert.match(display.title, /请求未送达/);
  assert.match(display.detail, /网页确认接收/);
  assert.match(display.detail, /重建模型会话/);
  assert.match(display.activityLabel, /重建模型会话，安全恢复 1\/3/);
});
