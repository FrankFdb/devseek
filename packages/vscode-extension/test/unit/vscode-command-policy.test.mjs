import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/vscode-command-policy.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/agent-host-tools.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const commandCalls = [];
const fakeVscode = {
  workspace: {
    getConfiguration() {
      return { get(_key, fallback) { return fallback; } };
    },
  },
  commands: {
    async executeCommand(command, ...args) {
      commandCalls.push({ command, args });
      return { accepted: true };
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { createAgentHostToolCallbacks } = req(bundlePath);
const {
  createProductRunEvidenceAuthorityToken,
  ProductRunEvidenceSession,
} = req(path.join(rootDir, '../shared/dist/index.js'));

function openHarness(t) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-command-policy-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = `vscode-command-policy-${Date.now()}-${Math.random()}`;
  const ownerToken = createProductRunEvidenceAuthorityToken();
  const participantToken = createProductRunEvidenceAuthorityToken();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId,
    surface: 'vscode-command-policy-test-owner',
    authority: { role: 'owner', token: ownerToken, participantToken },
    openIfMissing: true,
  });
  const confirmations = [];
  const degradations = [];
  const callbacks = createAgentHostToolCallbacks({
    workspaceRoot,
    webview: { postMessage() { return true; } },
    terminalPermissionCoordinator: {
      async requestInlineConfirmation(_webview, command) {
        confirmations.push(command);
        return { allow: true, reason: 'test-confirmed' };
      },
    },
    runContext: {
      workspaceRoot,
      runId,
      evidenceParticipantToken: participantToken,
      markEvidenceDegraded(error) { degradations.push(error); },
    },
  });
  return { callbacks, confirmations, degradations, owner };
}

test('VS Code command registry: terminal-owned and unknown commands fail before dispatch', async t => {
  commandCalls.length = 0;
  const { callbacks, owner } = openHarness(t);
  const terminalOwned = await callbacks.onPrepareVscodeCommand('workbench.action.tasks.build');
  const unknown = await callbacks.onPrepareVscodeCommand('evil.extension.arbitraryMutation');
  assert.equal(terminalOwned.authority.status, 'denied');
  assert.match(terminalOwned.authority.reason, /must use run_terminal/);
  assert.equal(unknown.authority.status, 'denied');
  assert.match(unknown.authority.reason, /closed VS Code command registry/);
  assert.deepEqual(commandCalls, []);
  const sideEffects = owner.readEvents().filter(event => event.type.startsWith('side_effect.'));
  assert.deepEqual(sideEffects.map(event => event.type), [
    'side_effect.requested',
    'side_effect.failed',
    'side_effect.requested',
    'side_effect.failed',
  ]);
});

test('VS Code command registry: non-empty opaque args are rejected instead of silently ignored', async t => {
  commandCalls.length = 0;
  const { callbacks } = openHarness(t);
  const prepared = await callbacks.onPrepareVscodeCommand('editor.action.formatDocument', ['unexpected']);
  assert.equal(prepared.authority.status, 'denied');
  assert.match(prepared.authority.reason, /does not accept opaque agent-supplied arguments/);
  assert.deepEqual(commandCalls, []);
});

test('VS Code command registry: supported read-only and mutating actions use honest Promise receipts', async t => {
  commandCalls.length = 0;
  const { callbacks, confirmations, owner } = openHarness(t);
  const refresh = await callbacks.onPrepareVscodeCommand('workbench.files.action.refreshFilesExplorer');
  const format = await callbacks.onPrepareVscodeCommand('editor.action.formatDocument');
  assert.deepEqual(commandCalls, []);
  assert.equal(refresh.authority.status, 'authorized');
  assert.equal(format.authority.decision, 'require-confirmation');
  const refreshResult = await refresh.execute();
  const formatResult = await format.execute();
  assert.match(refreshResult.result, /仅证明命令 Promise 已成功返回/);
  assert.match(formatResult.result, /仅证明命令 Promise 已成功返回/);
  assert.deepEqual(commandCalls, [
    { command: 'workbench.files.action.refreshFilesExplorer', args: [] },
    { command: 'editor.action.formatDocument', args: [] },
  ]);
  assert.deepEqual(confirmations, ['⚡ VS Code: editor.action.formatDocument']);
  const committed = owner.readEvents().filter(event => event.type === 'side_effect.committed');
  assert.equal(committed.length, 2);
  for (const event of committed) {
    assert.equal(event.payload.proof.scope, 'invocation-receipt');
    assert.equal(event.payload.proof.external_effect_verified, false);
    assert.equal(event.payload.proof.receipt.receipt, 'vscode-command-promise-resolved');
  }
});
