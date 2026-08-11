import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  TOOL_PROTOCOL_SAMPLES,
  TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES,
} from '../fixtures/tool-protocol-samples.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/web-reliability.bundle.cjs');

execSync(
  `npx esbuild src/llm/providers/web-reliability.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ResponseIntegrityChecker, StreamWatchdog, BridgeHealthMonitor } = req(bundlePath);

const maintenanceAnalysisWithBusinessVerificationCode = [
  '我已完整分析了相关文件。现在整理分析报告。',
  '# 吊运维保功能重做分析报告',
  '结论：当前实现需要重构维保码流程，新增伙伴后台生成验证码、管理后台校验验证码的闭环。',
  '依据：旧实现只保留阈值统计，没有覆盖新增的作业状态和维保码校验职责。',
  '建议：先统一状态机，再拆分数据结构，最后补充验证用例。',
  '[TOOL:task_complete {"summary":"完成吊运维保功能重做分析，包含生成验证码、管理后台校验和任务拆解建议。"}]',
].join('\n\n');

const quoteDamagedChineseTaskComplete = [
  '我理解。task_complete 需要 summary 必填参数。现在补全调用。',
  '[调用 task_complete] {"summary": "审计报告已完成并验证通过。',
  '1. "为什么通过插件按钮打开的 DeepSeek 页面就是当前 bridge 会话的用户路径，不能把它误认为另一个浏览器登录。"',
  '2. "send button selector drift is not LOGIN_REQUIRED""}',
  '',
  '本回答由 AI 生成，内容仅供参考，请仔细甄别。',
].join('\n');

test('ResponseIntegrityChecker: passes complete responses', () => {
  const result = new ResponseIntegrityChecker().check('```ts\nexport const ok = 1;\n```');

  assert.equal(result.ok, true);
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: does not treat business verification-code analysis as provider captcha', () => {
  const result = new ResponseIntegrityChecker().check(maintenanceAnalysisWithBusinessVerificationCode);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: does not treat a rate-limiter tool response as provider throttling', () => {
  const response = [
    '我会重构 C++17 令牌桶限流器，并运行测试。',
    '<tool_call name="list_dir">{"path":"/workspace"}</tool_call>',
    '<tool_call name="manage_todo_list">{"todoList":[{"id":1,"title":"实现限流器","status":"in-progress"}]}</tool_call>',
  ].join('\n');
  const result = new ResponseIntegrityChecker().check(response);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: does not treat log-index workspace paths as provider login gates', () => {
  const response = [
    '我先探索工作区结构，了解现有代码、测试和构建配置。',
    '[调用 list_dir] {"path":"/workspace/cases/04-log-index/workspace"}',
    '[调用 file_search] {"glob":"**/*.{h,hpp,cpp,cc}"}',
  ].join('');
  const result = new ResponseIntegrityChecker().check(response);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: accepts a complete tool request in a structured text envelope', () => {
  const response = `我先读取实现。\n\n\`\`\`\n${JSON.stringify([{
    type: 'text',
    text: '<tool_call>\n[TOOL:read_file {"path":"/workspace/src/rate_limiter.cpp"}]\n</tool_call>',
  }], null, 2)}\n\`\`\``;
  const result = new ResponseIntegrityChecker().check(response);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: still blocks provider login and captcha control surfaces', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(checker.check('<html><title>Login</title>请先登录后继续</html>').status, 'login-required');
  assert.equal(checker.check('Log in to continue').status, 'login-required');
  assert.equal(checker.check('Sign-in required').status, 'login-required');
  assert.equal(checker.check('请输入验证码完成安全验证').status, 'rate-limited');
  assert.equal(checker.check('HTTP 429 Too Many Requests，请稍后再试').status, 'rate-limited');
  assert.equal(checker.check('当前请求已被限流，请稍后再试').status, 'rate-limited');
});

test('ResponseIntegrityChecker: blocks truncated markdown and tool blocks', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(checker.check('```ts\nexport const broken = ').status, 'unclosed-markdown-fence');
  assert.equal(checker.check('[TOOL:write_file {"path":"a.ts","content":"x"').status, 'incomplete-tool-block');
  assert.equal(
    checker.check('<TOOL:read_file><path>/tmp/workspace/src/contract.ts</path>').status,
    'incomplete-tool-block',
  );
});

test('ResponseIntegrityChecker: does not treat complete DevSeek tool protocol as invalid provider JSON', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(
    checker.check('[TOOL:list_dir {"path":"/workspace/code/shape_manager"}]').safeToExecute,
    true,
  );
  assert.equal(
    checker.check('<TOOL:read_file><path>/tmp/workspace/src/contract.ts</path></TOOL:read_file>').safeToExecute,
    true,
  );
  assert.equal(
    checker.check('[{"tool":"list_dir","arguments":{"path":"/workspace/code/shape_manager",}}]').safeToExecute,
    true,
  );
  assert.equal(
    checker.check('{"choices":[{"message":}],"id":"x"}').status,
    'invalid-json-response',
  );
});

test('ResponseIntegrityChecker: accepts complete DeepSeek create_file tools wrapped in uneven fences', () => {
  const checker = new ResponseIntegrityChecker();
  const fence = '```';
  const report = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
    '',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ].join('\n');
  const response = [
    '文件未写入成功。我需要重新创建，并确保内容完整。',
    fence,
    `[TOOL:create_file {"path":"/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(report)}}${fence}`,
    fence,
  ].join('\n');

  const result = checker.check(response);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: recognizes Markdown-bold Calling tool protocol', () => {
  const checker = new ResponseIntegrityChecker();
  const response = [
    '我先核查一下当前代码状态。',
    '**Calling:** `read_file`',
    '```json',
    '{"path": "/workspace/code/shape_manager/main.cpp"}',
    '```',
  ].join('\n');

  assert.equal(checker.check(response).safeToExecute, true);
});

test('ResponseIntegrityChecker: shared tool protocol samples are safe only when complete', () => {
  const checker = new ResponseIntegrityChecker();

  for (const sample of TOOL_PROTOCOL_SAMPLES) {
    const result = checker.check(sample.text);
    assert.equal(
      result.safeToExecute,
      true,
      `${sample.id} should pass response integrity checks`,
    );
  }

  for (const sample of TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES) {
    const result = checker.check(sample.text);
    assert.equal(result.status, 'incomplete-tool-block', `${sample.id} should be blocked before execution`);
    assert.equal(result.safeToExecute, false, `${sample.id} should not be safe to execute`);
  }
});

test('ResponseIntegrityChecker: accepts complete DeepSeek TOOL_call inline-name envelopes', () => {
  const checker = new ResponseIntegrityChecker();
  const text = [
    '我先读取两个源文件。',
    '<TOOL_call>read_file {"path":"/tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md"}</TOOL_call><TOOL_call>read_file {"path":"/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts","startLine":1,"endLine":0}</TOOL_call>',
  ].join('\n\n');

  const result = checker.check(text);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: accepts complete DeepSeek named-parameter tool_call envelopes', () => {
  const checker = new ResponseIntegrityChecker();
  const content = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ].join('\n');
  const text = [
    '我已读取到两份源文件。现在创建审计报告文件。',
    '<tool_call><name>manage_todo_list</name><parameter>{"todoList":[{"id":1,"title":"读取源文件内容","status":"completed"},{"id":2,"title":"创建审计报告 Markdown 文件","status":"in-progress"}]}</parameter></tool_call>',
    `<tool_call><name>create_file</name><parameter>{"path":"/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(content)}}</parameter></tool_call>`,
  ].join('');

  const result = checker.check(text);

  assert.equal(result.status, 'ok');
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: blocks unfinished DeepSeek TOOL_call inline-name envelopes', () => {
  const checker = new ResponseIntegrityChecker();
  const result = checker.check('<TOOL_call>read_file {"path":"/tmp/a.md"}');

  assert.equal(result.status, 'incomplete-tool-block');
  assert.equal(result.safeToExecute, false);
});

test('ResponseIntegrityChecker: blocks unfinished assistant action cues', () => {
  const checker = new ResponseIntegrityChecker();
  const response = '编译失败了，因为字符串字面量中有换行符。我需要在字符串中使用 \\\\n 而不是直接换行。让我修复这个问题：';

  const result = checker.check(response);

  assert.equal(result.status, 'incomplete-assistant-intent');
  assert.equal(result.safeToExecute, false);
});

test('ResponseIntegrityChecker: allows recoverable malformed file tool blocks', () => {
  const checker = new ResponseIntegrityChecker();
  const response = String.raw`好的，我需要修改CMakeLists.txt来同时编译二维和三维程序。
[TOOL:create_file] {"path":"/tmp/shape_manager/CMakeLists.txt","content":"set(CMAKE_CXX_FLAGS "{CMAKE_CXX_FLAGS} -Wall -Wextra\")\nadd_executable(shape_manager_2d {SOURCES_2D} {HEADERS_2D})\nset_target_properties(shape_manager_2d shape_manager_3d PROPERTIES\n RUNTIME_OUTPUT_DIRECTORY \"{CMAKE_BINARY_DIR}/bin"\n)\nmessage(STATUS "构建二维图形程序: shape_manager_2d (使用 X11)")\n"}`;

  const result = checker.check(response);

  assert.equal(result.safeToExecute, true);
  assert.equal(result.status, 'ok');
});

test('ResponseIntegrityChecker: allows recoverable malformed Chinese task completion calls', () => {
  const checker = new ResponseIntegrityChecker();
  const result = checker.check(quoteDamagedChineseTaskComplete);

  assert.equal(result.safeToExecute, true);
  assert.equal(result.status, 'ok');
});

test('ResponseIntegrityChecker: still blocks unfinished Chinese task completion calls', () => {
  const checker = new ResponseIntegrityChecker();
  const result = checker.check('[调用 task_complete] {"summary": "审计报告已完成');

  assert.equal(result.safeToExecute, false);
  assert.equal(result.status, 'incomplete-tool-block');
});

test('StreamWatchdog: reports stalled stream after idle threshold', () => {
  const watchdog = new StreamWatchdog(100);
  watchdog.start(1_000);
  watchdog.observeChunk('hello', 1_050);

  const state = watchdog.state(1_200);

  assert.equal(state.status, 'stalled');
  assert.equal(state.reason, 'stream-stalled');
});

test('BridgeHealthMonitor: login indicator absence blocks prompt sending', () => {
  const decision = new BridgeHealthMonitor().evaluate({
    browserReady: true,
    loggedInLikely: false,
    reason: 'login-url',
  });

  assert.equal(decision.status, 'login-required');
  assert.equal(decision.canSendPrompt, false);
});

test('BridgeHealthMonitor: send button selector drift does not request relogin', () => {
  const decision = new BridgeHealthMonitor().evaluate({
    browserReady: true,
    loggedInLikely: true,
    reason: 'deepseek-dom-send-button-missing',
    queueLength: 0,
  });

  assert.equal(decision.status, 'ok');
  assert.equal(decision.canSendPrompt, true);
  assert.equal(decision.reason, 'deepseek-dom-send-button-missing');
});

console.log('\nWeb reliability tests passed.\n');
