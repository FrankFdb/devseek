import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const bundlePath = path.join(extensionRoot, 'test/unit/provider-run-evidence.bundle.cjs');
execSync(
  `npx esbuild src/app/provider-run-evidence.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: extensionRoot, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { invokeProviderWithRunEvidence } = req(bundlePath);
const {
  FileSystemRunEvidenceLedger,
  ProductRunEvidenceSession,
  createProductRunEvidenceAuthorityToken,
  productRunEvidenceIdempotencyKey,
  productRunEvidenceRoot,
} = req(path.join(extensionRoot, '../shared/dist/index.js'));

test('provider wrapper appends direct provider request and completion to the owning run', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-success',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const response = await invokeProviderWithRunEvidence({
      request: { prompt: 'secret prompt', traceRunId: 'provider-success', traceWorkspaceRoot: workspaceRoot, traceEvidenceParticipantToken: participantToken },
      providerType: 'deepseek-api',
      newOperationId: () => 'provider-op-1',
      invoke: async () => 'secret response',
    });
    assert.equal(response, 'secret response');
    owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settled' });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('provider-success');
    assert.deepEqual(events.map(event => event.type), [
      'run.opened',
      'provider.requested',
      'provider.completed',
      'run.settled',
    ]);
    assert.equal(JSON.stringify(events).includes('secret prompt'), false);
    assert.equal(JSON.stringify(events).includes('secret response'), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('provider wrapper records failure and preserves the original exception', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-failure',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    await assert.rejects(
      invokeProviderWithRunEvidence({
        request: { prompt: 'hello', traceRunId: 'provider-failure', traceWorkspaceRoot: workspaceRoot, traceEvidenceParticipantToken: participantToken },
        providerType: 'vscode-lm',
        newOperationId: () => 'provider-op-2',
        invoke: async () => { throw new Error('provider exploded'); },
      }),
      /provider exploded/,
    );
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    assert.deepEqual(ledger.read('provider-failure').map(event => event.type), [
      'run.opened',
      'provider.requested',
      'provider.failed',
    ]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('provider wrapper never creates a participant-owned run when the owner is absent', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  const errors = [];
  try {
    const response = await invokeProviderWithRunEvidence({
      request: { prompt: 'hello', traceRunId: 'missing-owner', traceWorkspaceRoot: workspaceRoot, traceEvidenceParticipantToken: createProductRunEvidenceAuthorityToken() },
      providerType: 'bridge',
      newOperationId: () => 'provider-op-3',
      onEvidenceError: error => errors.push(error),
      invoke: async () => 'still-routed',
    });
    assert.equal(response, 'still-routed');
    assert.equal(errors.length, 1);
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    assert.equal(ledger.verify('missing-owner').found, false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge provider shares one operation id across client and server evidence boundaries', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-bridge-correlation',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const errors = [];
    const response = await invokeProviderWithRunEvidence({
      request: {
        prompt: 'hello',
        traceRunId: 'provider-bridge-correlation',
        traceWorkspaceRoot: workspaceRoot,
        traceOperationId: 'shared-provider-op',
        traceEvidenceParticipantToken: participantToken,
      },
      providerType: 'bridge',
      onEvidenceError: error => errors.push(error),
      invoke: async () => {
        const bridge = ProductRunEvidenceSession.forWorkspace({
          workspaceRoot,
          runId: 'provider-bridge-correlation',
          surface: 'bridge',
          authority: { role: 'participant', token: participantToken },
        });
        for (const type of ['provider.requested', 'provider.completed']) {
          bridge.record({
            type,
            idempotencyKey: productRunEvidenceIdempotencyKey(`bridge-${type}`, { operationId: 'shared-provider-op' }),
            payload: {
              operation_id: 'shared-provider-op',
              boundary: 'bridge-server',
              status: type.slice('provider.'.length),
              trust: 'product-runtime-observation',
            },
          });
        }
        return 'bridge response';
      },
    });
    assert.equal(response, 'bridge response');
    assert.deepEqual(errors, []);
    owner.settleAndSeal({ status: 'completed', idempotencyKey: 'bridge-settled' });

    const events = owner.readEvents().filter(event => event.type.startsWith('provider.'));
    assert.equal(events.every(event => event.payload.operation_id === 'shared-provider-op'), true);
    assert.deepEqual([...new Set(events.map(event => event.payload.boundary))].sort(), [
      'bridge-server',
      'vscode-provider-client',
    ]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge provider verifies the failed server boundary and preserves the provider error', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-bridge-failure',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const errors = [];
    await assert.rejects(invokeProviderWithRunEvidence({
      request: {
        prompt: 'hello',
        traceRunId: 'provider-bridge-failure',
        traceWorkspaceRoot: workspaceRoot,
        traceOperationId: 'shared-failed-op',
        traceEvidenceParticipantToken: participantToken,
      },
      providerType: 'bridge',
      onEvidenceError: error => errors.push(error),
      invoke: async () => {
        const bridge = ProductRunEvidenceSession.forWorkspace({
          workspaceRoot,
          runId: 'provider-bridge-failure',
          surface: 'bridge',
          authority: { role: 'participant', token: participantToken },
        });
        for (const type of ['provider.requested', 'provider.failed']) {
          bridge.record({
            type,
            idempotencyKey: productRunEvidenceIdempotencyKey(`bridge-${type}`, { operationId: 'shared-failed-op' }),
            payload: {
              operation_id: 'shared-failed-op',
              boundary: 'bridge-server',
              status: type.slice('provider.'.length),
              trust: 'product-runtime-observation',
            },
          });
        }
        throw new Error('bridge provider exploded');
      },
    }), /bridge provider exploded/);
    assert.deepEqual(errors, []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge provider marks a missing failed server boundary as degraded without replacing the original error', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-bridge-missing-failure',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const errors = [];
    await assert.rejects(invokeProviderWithRunEvidence({
      request: {
        prompt: 'hello',
        traceRunId: 'provider-bridge-missing-failure',
        traceWorkspaceRoot: workspaceRoot,
        traceOperationId: 'missing-server-failed-op',
        traceEvidenceParticipantToken: participantToken,
      },
      providerType: 'bridge',
      onEvidenceError: error => errors.push(error),
      invoke: async () => { throw new Error('transport failed first'); },
    }), /transport failed first/);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /expected provider\.failed/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
