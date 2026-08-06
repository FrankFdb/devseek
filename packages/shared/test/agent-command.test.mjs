import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_COMMAND_VERSION,
  AgentApplicationService,
  CanonicalAgentCommandService,
} from '../dist/index.js';

const platform = {
  os: 'linux',
  shell: 'posix',
  pathStyle: 'posix',
  lineEnding: 'lf',
  caseSensitive: true,
  workspaceKind: 'local',
};

const capabilities = {
  supportsHunkReview: false,
  supportsInlineSelection: false,
  supportsTerminalEmbedding: false,
  supportsBrowserPreview: false,
  supportsJsonl: true,
  supportsDiagnostics: false,
};

test('CanonicalAgentCommandService snapshots and seals chat commands at the application boundary', () => {
  const files = [' src/value.ts '];
  const command = {
    type: 'chat.request',
    commandId: ' command-1 ',
    surface: 'jsonl',
    capabilities,
    platform,
    createdAt: 42,
    request: {
      prompt: ' implement value ',
      mode: 'fast',
      files,
      stream: true,
    },
  };

  const accepted = new CanonicalAgentCommandService().accept(command);
  files.push('src/later.ts');
  capabilities.supportsJsonl = false;

  assert.equal(accepted.version, AGENT_COMMAND_VERSION);
  assert.equal(accepted.commandId, 'command-1');
  assert.equal(accepted.request.prompt, 'implement value');
  assert.deepEqual(accepted.request.files, ['src/value.ts']);
  assert.equal(accepted.capabilities.supportsJsonl, true);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.isFrozen(accepted.request), true);
  assert.equal(Object.isFrozen(accepted.request.files), true);
  assert.equal(Object.isFrozen(accepted.capabilities), true);
  assert.throws(() => accepted.request.files.push('src/forbidden.ts'), TypeError);
});

test('CanonicalAgentCommandService accepts every protocol control command without changing intent', () => {
  const authority = new CanonicalAgentCommandService();
  const commands = [
    { type: 'plan.reviewDecision', commandId: 'plan', surface: 'vscode', taskId: ' task ', decision: 'approve' },
    { type: 'permission.decision', commandId: 'permission', surface: 'cli', requestId: ' request ', decision: 'deny' },
    { type: 'task.resume', commandId: 'resume', surface: 'headless', checkpointId: ' checkpoint ' },
    { type: 'task.cancel', commandId: 'cancel', surface: 'test', taskId: ' task ' },
  ];

  assert.deepEqual(
    commands.map(command => authority.accept(command)),
    [
      { version: AGENT_COMMAND_VERSION, type: 'plan.reviewDecision', commandId: 'plan', surface: 'vscode', taskId: 'task', decision: 'approve' },
      { version: AGENT_COMMAND_VERSION, type: 'permission.decision', commandId: 'permission', surface: 'cli', requestId: 'request', decision: 'deny' },
      { version: AGENT_COMMAND_VERSION, type: 'task.resume', commandId: 'resume', surface: 'headless', checkpointId: 'checkpoint' },
      { version: AGENT_COMMAND_VERSION, type: 'task.cancel', commandId: 'cancel', surface: 'test', taskId: 'task' },
    ],
  );
});

test('CanonicalAgentCommandService fails closed on malformed and unknown commands', () => {
  const authority = new CanonicalAgentCommandService();
  assert.throws(
    () => authority.accept({ type: 'chat.request', commandId: '', surface: 'cli', request: { prompt: 'work' } }),
    /agent-command:missing-command-id/u,
  );
  assert.throws(
    () => authority.accept({ type: 'task.cancel', commandId: 'cancel', surface: 'browser' }),
    /agent-command:invalid-surface/u,
  );
  assert.throws(
    () => authority.accept({ type: 'permission.decision', commandId: 'permission', surface: 'cli', requestId: 'request', decision: 'maybe' }),
    /agent-command:invalid-permission-decision/u,
  );
  assert.throws(
    () => authority.accept({ type: 'tool.execute', commandId: 'tool', surface: 'cli' }),
    /agent-command:unsupported-type:tool\.execute/u,
  );
});

test('AgentApplicationService invokes the command authority before command dispatch', async () => {
  const canonical = new CanonicalAgentCommandService();
  const acceptedIds = [];
  const service = new AgentApplicationService({
    getProviderType: () => 'deepseek',
    getProvider: () => ({ chat: async () => 'unused' }),
    bridgeChat: async () => 'unused',
    getChatHistory: () => [],
    recordChatHistory: () => {},
    commandAuthority: {
      accept(command) {
        acceptedIds.push(command.commandId);
        return canonical.accept(command);
      },
    },
  });

  const events = await service.handle({
    type: 'task.cancel',
    commandId: ' cancel-1 ',
    surface: 'cli',
  });

  assert.deepEqual(acceptedIds, [' cancel-1 ']);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].commandId, 'cancel-1');
});
