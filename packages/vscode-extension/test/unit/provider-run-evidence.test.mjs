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
const {
  BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP,
  BridgeProviderFailureEvidenceGapError,
  invokeProviderWithRunEvidence,
} = req(bundlePath);
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
    const prompt = 'secret prompt 说明';
    const ticks = [0, 10, 20, 40, 50];
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
      request: { prompt, traceRunId: 'provider-success', traceWorkspaceRoot: workspaceRoot, traceEvidenceParticipantToken: participantToken },
      providerType: 'deepseek-api',
      samplingId: 'semantic-sampling-1',
      transportAttempt: 2,
      now: () => ticks.shift(),
      newOperationId: () => 'provider-op-1',
      invoke: async observation => {
        observation.observeOutput('首');
        return 'secret response';
      },
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
    assert.equal(events[1].payload.sampling_id, 'semantic-sampling-1');
    assert.equal(events[1].payload.transport_attempt, 2);
    assert.equal(events[1].payload.prompt_budget.total_bytes, Buffer.byteLength(prompt));
    assert.equal(events[2].payload.efficiency.total_ms, 50);
    assert.equal(events[2].payload.efficiency.time_to_first_output_ms, 20);
    assert.equal(events[2].payload.efficiency.stream_bytes_observed, Buffer.byteLength('首'));
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

test('bridge provider waits for a server failure recorded after client transport cancellation', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-bridge-delayed-failure',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const errors = [];
    await assert.rejects(invokeProviderWithRunEvidence({
      request: {
        prompt: 'hello',
        traceRunId: 'provider-bridge-delayed-failure',
        traceWorkspaceRoot: workspaceRoot,
        traceOperationId: 'delayed-failed-op',
        traceEvidenceParticipantToken: participantToken,
      },
      providerType: 'bridge',
      onEvidenceError: error => errors.push(error),
      invoke: async () => {
        const bridge = ProductRunEvidenceSession.forWorkspace({
          workspaceRoot,
          runId: 'provider-bridge-delayed-failure',
          surface: 'bridge',
          authority: { role: 'participant', token: participantToken },
        });
        setTimeout(() => {
          for (const type of ['provider.requested', 'provider.failed']) {
            bridge.record({
              type,
              idempotencyKey: productRunEvidenceIdempotencyKey(`bridge-${type}`, {
                operationId: 'delayed-failed-op',
              }),
              payload: {
                operation_id: 'delayed-failed-op',
                boundary: 'bridge-server',
                status: type.slice('provider.'.length),
                trust: 'product-runtime-observation',
              },
            });
          }
        }, 40);
        throw new Error('client stream timed out');
      },
    }), /client stream timed out/);

    assert.deepEqual(errors, []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge provider accepts server completion when client integrity rejects the response', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-bridge-local-integrity-failure',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const errors = [];
    await assert.rejects(invokeProviderWithRunEvidence({
      request: {
        prompt: 'hello',
        traceRunId: 'provider-bridge-local-integrity-failure',
        traceWorkspaceRoot: workspaceRoot,
        traceOperationId: 'integrity-rejected-op',
        traceEvidenceParticipantToken: participantToken,
      },
      providerType: 'bridge',
      onEvidenceError: error => errors.push(error),
      invoke: async () => {
        const bridge = ProductRunEvidenceSession.forWorkspace({
          workspaceRoot,
          runId: 'provider-bridge-local-integrity-failure',
          surface: 'bridge',
          authority: { role: 'participant', token: participantToken },
        });
        for (const type of ['provider.requested', 'provider.completed']) {
          bridge.record({
            type,
            idempotencyKey: productRunEvidenceIdempotencyKey(`bridge-${type}`, { operationId: 'integrity-rejected-op' }),
            payload: {
              operation_id: 'integrity-rejected-op',
              boundary: 'bridge-server',
              status: type.slice('provider.'.length),
              trust: 'product-runtime-observation',
            },
          });
        }
        throw new Error('RESPONSE_CORRUPTED:incomplete-tool-block');
      },
    }), /RESPONSE_CORRUPTED:incomplete-tool-block/);

    assert.deepEqual(errors, []);
    owner.settleAndSeal({ status: 'failed', idempotencyKey: 'integrity-rejected-settled' });
    const events = owner.readEvents().filter(event => event.type.startsWith('provider.'));
    assert.deepEqual(events.map(event => `${event.payload.boundary}:${event.type}`), [
      'vscode-provider-client:provider.requested',
      'bridge-server:provider.requested',
      'bridge-server:provider.completed',
      'vscode-provider-client:provider.failed',
    ]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge provider reports a recoverable missing failed server boundary without replacing the original error', async () => {
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
    assert.equal(errors[0] instanceof BridgeProviderFailureEvidenceGapError, true);
    assert.equal(errors[0].code, BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP);
    assert.equal(errors[0].operationId, 'missing-server-failed-op');
    assert.match(String(errors[0]), /expected provider\.completed or provider\.failed/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('T9 transport retries keep one semantic sampling identity and distinct operation evidence', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'provider-retry-correlation',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const request = {
      prompt: '继续完成这个任务',
      traceRunId: 'provider-retry-correlation',
      traceWorkspaceRoot: workspaceRoot,
      traceEvidenceParticipantToken: participantToken,
    };

    await assert.rejects(invokeProviderWithRunEvidence({
      request: { ...request, traceOperationId: 'transport-operation-1' },
      providerType: 'deepseek-api',
      samplingId: 'one-semantic-turn',
      transportAttempt: 1,
      invoke: async () => { throw new Error('temporary transport failure'); },
    }), /temporary transport failure/);
    assert.equal(await invokeProviderWithRunEvidence({
      request: { ...request, traceOperationId: 'transport-operation-2' },
      providerType: 'deepseek-api',
      samplingId: 'one-semantic-turn',
      transportAttempt: 2,
      invoke: async observation => {
        observation.observeOutput('完成');
        return '完成';
      },
    }), '完成');

    const providerEvents = owner.readEvents().filter(event => event.type.startsWith('provider.'));
    const requested = providerEvents.filter(event => event.type === 'provider.requested');
    assert.deepEqual(requested.map(event => event.payload.operation_id), [
      'transport-operation-1',
      'transport-operation-2',
    ]);
    assert.deepEqual(requested.map(event => event.payload.sampling_id), [
      'one-semantic-turn',
      'one-semantic-turn',
    ]);
    assert.deepEqual(requested.map(event => event.payload.transport_attempt), [1, 2]);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('T9 profiler failures remain diagnostic and preserve the original provider result', async () => {
  const diagnostics = [];
  const ticks = [10, 5];
  let invoked = false;

  const result = await invokeProviderWithRunEvidence({
    request: { prompt: 'hello' },
    providerType: 'vscode-lm',
    newOperationId: () => 'diagnostic-isolation',
    now: () => ticks.shift(),
    onEvidenceError: error => diagnostics.push(error),
    invoke: async () => {
      invoked = true;
      return 'provider result';
    },
  });

  assert.equal(result, 'provider result');
  assert.equal(invoked, true);
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0]), /clock-regressed/);
});
