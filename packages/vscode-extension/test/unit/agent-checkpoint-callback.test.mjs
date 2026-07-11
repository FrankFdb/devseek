import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(tmpdir(), `devseek-agent-checkpoint-callback-${process.pid}.cjs`);
execFileSync(
  'npx',
  [
    'esbuild',
    'src/app/agent-checkpoint-callback.ts',
    '--bundle',
    `--outfile=${bundlePath}`,
    '--format=cjs',
    '--platform=node',
  ],
  { cwd: rootDir, stdio: 'pipe' },
);

const { createAgentCheckpointCallback } = createRequire(import.meta.url)(bundlePath);

after(() => {
  rmSync(bundlePath, { force: true });
});

function task(id) {
  return {
    id,
    action: 'create',
    file: `${id}.md`,
    desc: `create ${id}`,
  };
}

function makeHarness() {
  const saved = [];
  const messages = [];
  const callback = createAgentCheckpointCallback({
    userPrompt: 'create the reports',
    displayPrompt: 'Create the reports',
    mode: 'fast',
    workspaceRoot: '/repo',
    sessionId: 'session-1',
    save: async checkpoint => { saved.push(checkpoint); },
    postMessage: message => { messages.push(message); },
  });
  return { callback, saved, messages };
}

test('agent checkpoint callback rebases a remaining-task slice to its local index space', async () => {
  const harness = makeHarness();
  const remainingTasks = [task('t3'), task('t4')];

  await harness.callback(2, remainingTasks, 'progress');
  remainingTasks.length = 0;

  assert.equal(harness.saved.length, 1);
  assert.deepEqual(harness.saved[0].allTasks.map(item => item.id), ['t3', 't4']);
  assert.equal(harness.saved[0].startFromIndex, 0);
  assert.equal(harness.saved[0].completedCount, 0);
  assert.equal(harness.saved[0].pauseReason, undefined);
  assert.deepEqual(harness.messages, []);
});

test('agent checkpoint callback preserves original progress only in paused UI metadata', async () => {
  const harness = makeHarness();

  await harness.callback(3, [task('t4'), task('t5')], 'paused');

  assert.equal(harness.saved[0].startFromIndex, 0);
  assert.equal(harness.saved[0].allTasks.length, 2);
  assert.match(harness.saved[0].pauseReason, /2 unfinished task/);
  assert.deepEqual(harness.messages, [{
    type: 'agentCheckpointAvailable',
    resumeTaskIndex: 3,
    totalTasks: 5,
    userPrompt: 'Create the reports',
    savedAt: harness.saved[0].savedAt,
    pauseReason: harness.saved[0].pauseReason,
  }]);
});

test('agent checkpoint callback clears completed or contradictory empty checkpoints', async () => {
  const completed = makeHarness();
  await completed.callback(null, [], 'completed');
  assert.deepEqual(completed.saved, [null]);
  assert.deepEqual(completed.messages, [{ type: 'agentCheckpointCleared' }]);

  const emptyPaused = makeHarness();
  await emptyPaused.callback(4, [], 'paused');
  assert.deepEqual(emptyPaused.saved, [null]);
  assert.deepEqual(emptyPaused.messages, [{ type: 'agentCheckpointCleared' }]);
});
