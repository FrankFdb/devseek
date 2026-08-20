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
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-turn-routing-'));

execFileSync('npx', [
  'esbuild',
  'src/app/agent-turn-routing-service.ts',
  'src/app/chat-controller.ts',
  '--bundle',
  `--outdir=${bundleDir}`,
  '--outbase=src',
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { decideAgentTurnRoute } = require(path.join(bundleDir, 'app/agent-turn-routing-service.js'));
const { ChatRouteController } = require(path.join(bundleDir, 'app/chat-controller.js'));
const controller = new ChatRouteController();
after(() => rmSync(bundleDir, { recursive: true, force: true }));

test('turn routing uses only the complete current raw turn', () => {
  const userDisplay = '  更正：只说明 GPU 和 CPU，不要继续旧任务。  ';
  const resolution = decideAgentTurnRoute(controller, {
    userDisplay,
    prompt: userDisplay,
    files: ['/workspace/src/old-task.ts'],
    agentEnabled: true,
    newSession: false,
    priorSemanticContract: {
      intent: { mode: 'destructive' },
      mutation: { requested: true, targets: ['/workspace/src/old-task.ts'] },
    },
  });

  assert.equal(resolution.decision.intentRoutingText, userDisplay);
  assert.equal(resolution.decision.intent.semanticContract.prompt, userDisplay);
  assert.equal(resolution.decision.intent.mode, 'model-led');
  assert.equal(resolution.decision.intent.semanticContract.mutation.requested, false);
  assert.equal(resolution.decision.workflow.kind, 'model-agent');
});

test('new-session state is projected elsewhere and cannot alter turn semantics', () => {
  const input = {
    userDisplay: '继续详细说明',
    prompt: '继续详细说明',
    files: [],
    agentEnabled: true,
  };
  const sameSession = decideAgentTurnRoute(controller, { ...input, newSession: false });
  const newSession = decideAgentTurnRoute(controller, { ...input, newSession: true });

  assert.deepEqual(newSession, sameSession);
});

test('explicit no-agent controls survive the routing boundary', () => {
  for (const input of [
    { agentEnabled: false, forceNoAgent: false, reason: 'agent-disabled' },
    { agentEnabled: true, forceNoAgent: true, reason: 'force-no-agent' },
  ]) {
    const resolution = decideAgentTurnRoute(controller, {
      userDisplay: '创建 src/new.ts',
      prompt: '创建 src/new.ts',
      files: [],
      newSession: false,
      ...input,
    });

    assert.equal(resolution.decision.intent.mode, 'model-led');
    assert.equal(resolution.decision.workflow.kind, 'plain-chat');
    assert.equal(resolution.decision.workflow.reason, input.reason);
  }
});

test('empty current turn remains blocked even when old files exist', () => {
  const resolution = decideAgentTurnRoute(controller, {
    userDisplay: '',
    prompt: '',
    files: ['/workspace/src/old.ts'],
    agentEnabled: true,
    newSession: false,
  });

  assert.deepEqual(resolution.decision.intent.blockers, ['empty-prompt']);
  assert.equal(resolution.decision.workflow.useAgent, false);
});
