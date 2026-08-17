import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-terminal-presentation.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/agent-terminal-presentation.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  AgentTerminalPresentationBuffer,
  deliverSettledAgentTodoPresentation,
  deliverSettledAgentTerminalPresentation,
} = req(bundlePath);

test('model-loop terminal claims remain invisible until canonical settlement', async () => {
  const recorder = createRecorder();
  const buffer = new AgentTerminalPresentationBuffer(recorder.callbacks);
  const activeTodos = [
    { id: 1, title: '创建程序', status: 'completed' },
    { id: 2, title: '编译并验证程序', status: 'in-progress' },
  ];
  const completeTodos = activeTodos.map(item => ({ ...item, status: 'completed' }));

  await buffer.onTodoUpdate(activeTodos);
  await buffer.onAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '正在验证' });
  await buffer.onTodoUpdate(completeTodos);
  await buffer.onAgentStatus({ type: 'agentStatus', phase: 'done', state: 'completed', title: '任务已完成' });
  buffer.onDelta('\x00ASUM\x00实现和验证均已完成');
  buffer.captureCompletedCheckpoint();

  assert.deepEqual(recorder.events.map(event => event.kind), ['todo', 'status']);
  assert.equal(recorder.events.some(event => event.kind === 'delta'), false);
  assert.equal(recorder.events.some(event => event.kind === 'checkpoint'), false);

  await deliverSettledAgentTerminalPresentation({
    presentation: buffer.snapshot(),
    status: 'completed',
    callbacks: recorder.callbacks,
  });

  assert.deepEqual(recorder.events.slice(-4).map(event => event.kind), [
    'todo',
    'status',
    'delta',
    'checkpoint',
  ]);
  assert.equal(recorder.events.at(-4).items.every(item => item.status === 'completed'), true);
});

test('failed canonical validation cannot be presented as green todos or successful delivery', async () => {
  const recorder = createRecorder();
  const buffer = new AgentTerminalPresentationBuffer(recorder.callbacks);
  await buffer.onTodoUpdate([
    { id: 1, title: '创建 C++ 程序', status: 'completed' },
    { id: 2, title: '编译并验证程序', status: 'completed' },
  ]);
  await buffer.onAgentStatus({ type: 'agentStatus', phase: 'done', state: 'completed', title: '任务已完成' });
  buffer.onDelta('\x00ASUM\x00程序已编译验证通过');

  assert.deepEqual(recorder.events, [], 'all terminal success claims must still be buffered');

  await deliverSettledAgentTerminalPresentation({
    presentation: buffer.snapshot(),
    status: 'failed',
    reasonCodes: ['required-verification-failed'],
    callbacks: recorder.callbacks,
  });

  const todoEvent = recorder.events.find(event => event.kind === 'todo');
  const statusEvent = recorder.events.find(event => event.kind === 'status');
  const deltaEvent = recorder.events.find(event => event.kind === 'delta');
  assert.equal(todoEvent.items.some(item => item.status === 'failed'), true);
  assert.equal(todoEvent.items.every(item => item.status === 'completed'), false);
  assert.equal(statusEvent.status.state, 'failed');
  assert.match(statusEvent.status.title, /验证|复核/);
  assert.doesNotMatch(deltaEvent.text, /required-verification-failed/);
});

test('nested repair settles its todos without claiming the outer task is complete', async () => {
  const recorder = createRecorder();
  await deliverSettledAgentTodoPresentation({
    presentation: {
      todos: [{ id: 1, title: '修复源码', status: 'completed' }],
      status: { type: 'agentStatus', phase: 'done', state: 'completed', title: '修复完成' },
      answerDelta: '\x00ASUM\x00修复完成',
      completedCheckpointRequested: true,
    },
    status: 'completed',
    callbacks: recorder.callbacks,
  });

  assert.deepEqual(recorder.events.map(event => event.kind), ['todo']);
  assert.equal(recorder.events[0].items[0].status, 'completed');
});

function createRecorder() {
  const events = [];
  return {
    events,
    callbacks: {
      onDelta(text) { events.push({ kind: 'delta', text }); },
      async onAgentStatus(status) { events.push({ kind: 'status', status }); },
      async onTodoUpdate(items) { events.push({ kind: 'todo', items }); },
      async onTaskCheckpoint(first, remaining, reason) {
        events.push({ kind: 'checkpoint', first, remaining, reason });
      },
    },
  };
}
