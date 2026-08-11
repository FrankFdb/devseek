import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/vscode-surface-adapter.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/ui/vscode-surface-adapter.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const fakeVscode = {
  env: { remoteName: undefined },
  workspace: {
    getConfiguration() {
      return { get(_key, fallback) { return fallback; } };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { VSCodeSurfaceAdapter } = req(bundlePath);

function coreEvent(type, patch = {}) {
  return {
    type,
    eventId: `${type}-event`,
    commandId: 'cmd-r3-08a',
    taskId: 'task-r3-08a',
    surface: 'vscode',
    timestamp: 1784726400000,
    ...patch,
  };
}

test('R3-08A VSCodeSurfaceAdapter projects every collaboration event with same trace metadata', () => {
  const sent = [];
  const adapter = new VSCodeSurfaceAdapter(() => ({
    postMessage(message) {
      sent.push(message);
      return true;
    },
  }));

  const events = [
    coreEvent('chat.started', { prompt: 'review the current diff' }),
    coreEvent('provider.selected', { providerType: 'bridge' }),
    coreEvent('provider.status', { providerType: 'bridge', status: 'waiting', message: 'waiting for DeepSeek' }),
    coreEvent('permission.requested', { requestId: 'perm-1', action: 'run terminal', target: 'npm test' }),
    coreEvent('fileChanges.proposed', { files: ['src/app.ts', 'test/app.test.ts'] }),
    coreEvent('validation.completed', { passed: true, evidenceRefs: ['terminal:npm-test'] }),
    coreEvent('qualityGate.completed', { passed: false, evidenceRefs: ['quality:missing-diff-review'] }),
    coreEvent('taskHistory.updated', { taskId: 'task-r3-08a' }),
    coreEvent('checkpoint.available', { checkpointId: 'checkpoint-r3-08a' }),
    coreEvent('provider.recovery', { reason: 'LOGIN_REQUIRED', recovered: false }),
    coreEvent('chat.delta', { delta: 'visible answer' }),
    coreEvent('chat.completed', { response: 'done' }),
    coreEvent('error', { errorType: 'ProviderError', message: 'failed' }),
  ];

  for (const event of events) adapter.renderEvent(event);

  assert.deepEqual(sent.map(message => message.type), [
    'startResponse',
    'agentStatus',
    'agentStatus',
    'agentNotice',
    'agentStatus',
    'agentStatus',
    'agentStatus',
    'agentNotice',
    'agentCheckpointAvailable',
    'agentNotice',
    'delta',
    'endResponse',
    'error',
  ]);
  assert.equal(sent.find(message => message.type === 'delta')?.text, 'visible answer');
  assert.equal(sent.find(message => message.type === 'error')?.text, 'failed');
  assert.deepEqual(
    sent.find(message => message.type === 'agentStatus' && /文件变更/.test(message.title || ''))?.editedFiles.map(file => file.path),
    ['src/app.ts', 'test/app.test.ts'],
  );
  for (const [index, message] of sent.entries()) {
    assert.equal(message.surfaceTrace.eventId, events[index].eventId, `${message.type} keeps eventId`);
    assert.equal(message.surfaceTrace.commandId, 'cmd-r3-08a', `${message.type} keeps commandId`);
    assert.equal(message.surfaceTrace.taskId, 'task-r3-08a', `${message.type} keeps taskId`);
    assert.equal(message.surfaceTrace.surface, 'vscode', `${message.type} keeps surface`);
    assert.equal(message.surfaceTrace.timestamp, 1784726400000, `${message.type} keeps timestamp`);
    assert.equal(message.surfaceTrace.sourceEventType, events[index].type, `${message.type} keeps source event type`);
  }
});

test('VSCodeSurfaceAdapter exposes canonical command and host delivery conformance', () => {
  const adapter = new VSCodeSurfaceAdapter();
  const command = adapter.toChatCommand({ prompt: ' inspect repo ', commandId: 'vscode-command' });
  const receipt = adapter.conformance();
  const collaboration = adapter.collaboration();
  const accessibility = adapter.accessibility();

  assert.equal(command.version, 'devseek.agent-command/v1');
  assert.equal(command.surface, 'vscode');
  assert.equal(command.request.prompt, 'inspect repo');
  assert.equal(receipt.adapterId, 'vscode-webview');
  assert.deepEqual(receipt.eventDelivery, {
    channel: 'webview',
    ordering: 'host-ordered',
    backpressure: 'host-managed',
  });
  assert.equal(collaboration.status, 'conformant');
  assert.equal(accessibility.status, 'conformant');
});
