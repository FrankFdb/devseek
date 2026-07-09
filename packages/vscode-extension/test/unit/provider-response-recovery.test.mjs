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

  const submitFailed = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:prompt-submit-failed:PROMPT_SUBMIT_FAILED: composer did not clear.'),
  );
  assert.equal(submitFailed.status, 'prompt-submit-failed');
  assert.equal(submitFailed.recoverable, true);
  assert.equal(canRecoverAgentProviderFailure(submitFailed, 1, 3), true);

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
    terminalEvidence: [{ command: 'npm test', ok: false, exitCode: 1, detail: 'failed' }],
    partialResponseLength: 46000,
  }).content;

  assert.match(prompt, /已阻止执行损坏内容/);
  assert.match(prompt, /不要引用、续写或执行上一轮损坏文本/);
  assert.match(prompt, /不要重复已读取路径/);
  assert.match(prompt, /最多 6 个只读工具/);
  assert.match(prompt, /content 控制在 6000 字符以内/);
  assert.match(prompt, /正式既有工程任务必须继续沿既有入口/);
  assert.match(prompt, /src\/lifting\/lifting_manager\.hpp/);
  assert.doesNotMatch(prompt, /Tool block is incomplete[\s\S]*```/);
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
  assert.match(prompt, /原始用户任务：.{100,900}/s);
  assert.doesNotMatch(prompt, /实现一个正式项目功能.{1800}/s);
});

test('Agent provider recovery display tells the user a safe retry is running', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:unclosed-markdown-fence:Markdown code fence is not closed.'),
  );
  const display = describeAgentProviderRecoveryForUser(failure, 2, 3);
  assert.match(display.title, /正在安全续跑/);
  assert.match(display.detail, /已阻止执行/);
  assert.match(display.activityLabel, /安全续跑 2\/3/);
});

test('Agent provider recovery display distinguishes submit failures from truncated responses', () => {
  const failure = parseAgentProviderFailure(
    new Error('RESPONSE_CORRUPTED:prompt-submit-failed:PROMPT_SUBMIT_FAILED: composer did not clear.'),
  );
  const display = describeAgentProviderRecoveryForUser(failure, 1, 3);

  assert.match(display.title, /请求未送达/);
  assert.match(display.detail, /网页确认接收/);
  assert.match(display.activityLabel, /安全重试 1\/3/);
});
