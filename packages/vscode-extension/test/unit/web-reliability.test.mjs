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
  `npx esbuild src/llm/providers/web-reliability.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ResponseIntegrityChecker, StreamWatchdog, BridgeHealthMonitor } = req(bundlePath);

test('ResponseIntegrityChecker: passes complete responses', () => {
  const result = new ResponseIntegrityChecker().check('```ts\nexport const ok = 1;\n```');

  assert.equal(result.ok, true);
  assert.equal(result.safeToExecute, true);
});

test('ResponseIntegrityChecker: blocks truncated markdown and tool blocks', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(checker.check('```ts\nexport const broken = ').status, 'unclosed-markdown-fence');
  assert.equal(checker.check('[TOOL:write_file {"path":"a.ts","content":"x"').status, 'incomplete-tool-block');
});

test('ResponseIntegrityChecker: does not treat complete DevSeek tool protocol as invalid provider JSON', () => {
  const checker = new ResponseIntegrityChecker();

  assert.equal(
    checker.check('[TOOL:list_dir {"path":"/workspace/code/shape_manager"}]').safeToExecute,
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

console.log('\nWeb reliability tests passed.\n');
