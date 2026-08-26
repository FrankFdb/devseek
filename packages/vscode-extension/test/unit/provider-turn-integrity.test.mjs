import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-turn-integrity.bundle.cjs');

execSync(
  `npx esbuild src/agent/provider-turn-integrity.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { assertProviderTurnIntegrity } = createRequire(import.meta.url)(bundlePath);

test('provider turn integrity rejects reserved DevSeek tool transcripts with a recoverable status', () => {
  assert.throws(
    () => assertProviderTurnIntegrity(
      '[DevSeek 已执行工具请求摘要]\n[工具结果 Round 38]\nrun_terminal: ./test.sh exitCode: 0',
    ),
    /RESPONSE_CORRUPTED:provider-authored-tool-transcript:/,
  );
});

test('provider turn integrity accepts ordinary prose and structurally normalized tool calls', () => {
  assert.doesNotThrow(() => assertProviderTurnIntegrity('请解释 run_terminal: npm test 的含义。'));
  assert.doesNotThrow(() => assertProviderTurnIntegrity('准备读取文件。', { toolCallCount: 1 }));
});
