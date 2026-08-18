import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundlePath = path.join(extensionRoot, 'test/unit/tool-loop-scheduler.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-loop-scheduler.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: extensionRoot, stdio: 'pipe' },
);

const { executeScheduledToolLoop } = createRequire(import.meta.url)(bundlePath);

test('ToolLoopScheduler: independent local observations execute concurrently with ordered feedback', async () => {
  const tools = [
    fakeTool('read_file'),
    fakeTool('grep_search'),
    fakeTool('list_dir'),
    fakeTool('file_search'),
  ];
  let active = 0;
  let maxActive = 0;
  const batches = [];

  const result = await executeScheduledToolLoop(tools, async batch => {
    batches.push(batch.map(tool => tool.name));
    active += 1;
    maxActive = Math.max(maxActive, active);
    const index = tools.indexOf(batch[0]);
    await new Promise(resolve => setTimeout(resolve, 35 - index * 5));
    active -= 1;
    return loopResult(batch[0].name, index + 1);
  });

  assert.equal(maxActive, 4);
  assert.deepEqual(batches, tools.map(tool => [tool.name]));
  assert.equal(result.feedbackForAI, tools.map(tool => tool.name).join('\n\n'));
  assert.deepEqual(result.toolExecutionReceipts.map(receipt => receipt.sequence), [1, 2, 3, 4]);
});

test('ToolLoopScheduler: an effectful or mixed batch stays on the established serial owner', async () => {
  const tools = [fakeTool('read_file'), fakeTool('write_file')];
  const batches = [];
  await executeScheduledToolLoop(tools, async batch => {
    batches.push(batch.map(tool => tool.name));
    return loopResult('serial', 1);
  });
  assert.deepEqual(batches, [['read_file', 'write_file']]);
});

test('ToolLoopScheduler: parallel admission is bounded to four observations per wave', async () => {
  const tools = Array.from({ length: 5 }, (_, index) => fakeTool(
    index % 2 === 0 ? 'read_file' : 'grep_search',
  ));
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  await executeScheduledToolLoop(tools, async batch => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    completed += 1;
    return loopResult(batch[0].name, completed);
  });
  assert.equal(maxActive, 4);
  assert.equal(completed, 5);
});

test('ToolLoopScheduler: canonical metadata can veto a read-named tool from parallel execution', async () => {
  const tools = [
    canonicalTool('read_file', 'workspace-mutation', ['workspace-mutation']),
    canonicalTool('read_file', 'observe', ['read']),
  ];
  const batches = [];
  await executeScheduledToolLoop(tools, async batch => {
    batches.push(batch.length);
    return loopResult('serial', 1);
  });
  assert.deepEqual(batches, [2]);
});

function fakeTool(name) {
  return { name, input: {} };
}

function canonicalTool(name, purpose, effects) {
  return {
    ...fakeTool(name),
    id: `${name}-${purpose}`,
    source: 'native',
    registered: true,
    kind: 'read',
    risk: 'low',
    purpose,
    effects,
    protectedPath: false,
    targetPaths: [],
    executable: true,
  };
}

function loopResult(feedbackForAI, sequence) {
  return {
    taskComplete: false,
    toolCallsMade: true,
    workToolCallsMade: true,
    feedbackForAI,
    readFiles: [feedbackForAI],
    toolExecutionReceipts: [{ sequence }],
  };
}
