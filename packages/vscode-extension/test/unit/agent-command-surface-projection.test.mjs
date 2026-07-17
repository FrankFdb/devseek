import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-command-surface-projection.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-command-surface-projection.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createAgentCommandSurfaceProjection } = req(bundlePath);

test('agent command projector preserves visible display and hidden prompt semantics', async () => {
  const calls = [];
  const projector = createAgentCommandSurfaceProjection({
    isProviderAvailable: () => true,
    pushChatPanel: (userDisplay, prompt, newSession) => {
      calls.push(['push', { userDisplay, prompt, newSession }]);
    },
    focusView: () => {
      calls.push(['focus']);
    },
  });

  const result = await projector.projectToChat({
    source: 'devseek.explain',
    userDisplay: 'visible selected code preview',
    prompt: 'hidden provider prompt with full context',
    newSession: true,
    focus: true,
  });

  assert.deepEqual(result, { projected: true, source: 'devseek.explain' });
  assert.deepEqual(calls, [
    ['push', {
      userDisplay: 'visible selected code preview',
      prompt: 'hidden provider prompt with full context',
      newSession: true,
    }],
    ['focus'],
  ]);
});

test('agent command projector fails closed when provider is unavailable', async () => {
  const calls = [];
  const projector = createAgentCommandSurfaceProjection({
    isProviderAvailable: () => false,
    pushChatPanel: () => {
      calls.push('push');
    },
    onProviderUnavailable: request => {
      calls.push(['unavailable', request.source]);
    },
  });

  const result = await projector.projectToChat({
    source: 'devseek.runTerminalCommand',
    userDisplay: '> npm test',
    prompt: 'analyze output',
  });

  assert.deepEqual(result, {
    projected: false,
    source: 'devseek.runTerminalCommand',
    reason: 'provider-unavailable',
  });
  assert.deepEqual(calls, [['unavailable', 'devseek.runTerminalCommand']]);
});

test('agent command projector rejects incomplete projection requests', async () => {
  const calls = [];
  const projector = createAgentCommandSurfaceProjection({
    isProviderAvailable: () => {
      calls.push('provider-check');
      return true;
    },
    pushChatPanel: () => {
      calls.push('push');
    },
    onInvalidRequest: (_request, reason) => {
      calls.push(['invalid', reason]);
    },
  });

  const result = await projector.projectToChat({
    source: 'devseek.ask',
    userDisplay: 'visible question',
    prompt: '   ',
  });

  assert.deepEqual(result, {
    projected: false,
    source: 'devseek.ask',
    reason: 'invalid-request',
  });
  assert.deepEqual(calls, [['invalid', 'invalid-request']]);
});
