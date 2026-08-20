import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-session-continuation-'));
const bundlePath = path.join(bundleDir, 'session-continuation.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/session-continuation.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: extensionRoot, stdio: 'pipe' });

const {
  CHECKPOINT_RESUME_COMMAND,
  appendSessionContinuationContext,
  isCheckpointResumeCommand,
  shouldResumeCheckpointFromCommand,
} = createRequire(import.meta.url)(bundlePath);
after(() => rmSync(bundleDir, { recursive: true, force: true }));

test('only the exact explicit slash protocol selects checkpoint resume', () => {
  assert.equal(CHECKPOINT_RESUME_COMMAND, '/resume-checkpoint');
  assert.equal(isCheckpointResumeCommand('/resume-checkpoint'), true);
  assert.equal(isCheckpointResumeCommand('  /resume-checkpoint  '), true);

  for (const text of [
    '继续',
    '继续优化',
    'go ahead',
    'resume the task',
    '/resume',
    'please /resume-checkpoint now',
    '`/resume-checkpoint` 是什么意思？',
    '/RESUME-CHECKPOINT',
  ]) {
    assert.equal(isCheckpointResumeCommand(text), false, text);
  }
});

test('explicit resume command is blocked by new-session and indexed-resume state', () => {
  const base = {
    userDisplay: '/resume-checkpoint',
    prompt: '/resume-checkpoint',
  };

  assert.equal(shouldResumeCheckpointFromCommand(base), true);
  assert.equal(shouldResumeCheckpointFromCommand({ ...base, newSession: true }), false);
  assert.equal(shouldResumeCheckpointFromCommand({ ...base, resumeFromIndex: 0 }), false);
});

test('natural-language steering always remains ordinary model input', () => {
  for (const text of [
    '继续',
    '继续由于网络中断的任务',
    '更正：先不要编译，只修改代码',
    'go ahead but do not touch tests',
    '前面的要求有误，改成只读分析',
  ]) {
    assert.equal(shouldResumeCheckpointFromCommand({
      userDisplay: text,
      prompt: text,
      newSession: false,
    }), false, text);
  }
});

test('continuation context is visibly marked as bounded non-authority', () => {
  const prompt = '当前要求：只解释 GPU。';
  const result = appendSessionContinuationContext(
    prompt,
    '上一轮修改过 src/uav.ts，但任务已经结束。',
  );

  assert.ok(result.startsWith(prompt));
  assert.match(result, /【同一会话有界历史（非执行授权）】/u);
  assert.match(result, /上一轮修改过 src\/uav\.ts/u);
});

test('empty continuation context leaves current prompt byte-for-byte unchanged', () => {
  const prompt = '  exact current input\nwith trailing space  ';
  assert.equal(appendSessionContinuationContext(prompt, ' \n\t '), prompt);
});
