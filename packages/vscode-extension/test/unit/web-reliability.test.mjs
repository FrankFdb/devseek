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
