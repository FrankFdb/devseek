import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { attachBridgeRunEvidence } = require('../dist/run-evidence.js');
const {
  FileSystemRunEvidenceLedger,
  ProductRunEvidenceSession,
  createProductRunEvidenceAuthorityToken,
  productRunEvidenceRoot,
} = require('../../shared/dist/index.js');

test('bridge attaches as a participant to an owner-created product run', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-bridge-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'bridge-run',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const bridge = attachBridgeRunEvidence({
      workspaceRoot,
      runId: 'bridge-run',
      operationId: 'bridge-request-1',
      authorityToken: participantToken,
    });
    bridge.record('provider.requested', { provider: 'deepseek-web', attempt: 1 });
    bridge.record('provider.completed', { response: { length: 2, sha256: 'a'.repeat(64) } });
    owner.settleAndSeal({ status: 'completed', idempotencyKey: 'bridge-run-settled' });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('bridge-run');
    assert.deepEqual(events.map(event => `${event.surface}:${event.type}`), [
      'vscode:run.opened',
      'bridge:provider.requested',
      'bridge:provider.completed',
      'vscode:run.settled',
    ]);
    assert.equal(events[1].payload.attempt, 1);
    assert.equal(events[1].payload.operation_id, 'bridge-request-1');
    assert.equal(events[1].payload.boundary, 'bridge-server');
    assert.equal(events[1].payload.status, 'requested');
    assert.equal(events[1].payload.trust, 'product-runtime-observation');
    assert.equal(events.every(event => event.qualification_eligible === false), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge rejects non-JSON, boxed-secret, and edge-whitespace evidence without head mutation', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-bridge-evidence-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'bridge-strict-run',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    const bridge = attachBridgeRunEvidence({
      workspaceRoot,
      runId: 'bridge-strict-run',
      operationId: 'bridge-strict-operation',
      authorityToken: participantToken,
    });
    const before = owner.head();
    const capability = `devseek-ra1_${'Z'.repeat(43)}`;
    const cycle = {};
    cycle.self = cycle;
    for (const payload of [
      { invalid: new Date() },
      { invalid: new Map([['key', 'value']]) },
      { invalid: new Set(['value']) },
      { invalid: Number.NaN },
      { invalid: Number.POSITIVE_INFINITY },
      { invalid: undefined },
      { invalid: () => 'value' },
      { invalid: new String(capability) },
      { invalid: ' edge-whitespace' },
      cycle,
    ]) {
      assert.throws(
        () => bridge.record('provider.requested', payload),
        error => error?.code === 'INVALID_INPUT' || error?.code === 'RUN_SEMANTIC_INVALID',
      );
      assert.deepEqual(owner.head(), before);
    }
    assert.throws(
      () => attachBridgeRunEvidence({
        workspaceRoot,
        runId: 'bridge-strict-run',
        operationId: ' bridge-operation ',
        authorityToken: participantToken,
      }),
      error => error?.code === 'INVALID_INPUT',
    );
    assert.deepEqual(owner.head(), before);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bridge refuses to create a product run on behalf of a missing owner', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-bridge-evidence-'));
  try {
    assert.throws(
      () => attachBridgeRunEvidence({
        workspaceRoot,
        runId: 'missing-owner',
        operationId: 'missing-owner-operation',
        authorityToken: createProductRunEvidenceAuthorityToken(),
      }),
      error => error?.code === 'RUN_NOT_FOUND',
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
