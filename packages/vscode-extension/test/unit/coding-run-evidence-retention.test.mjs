import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-lifecycle-retention-'));
const bundlePath = path.join(bundleRoot, 'coding-run-evidence-retention.cjs');

buildSync({
  entryPoints: [path.join(extensionRoot, 'src/app/coding-run-evidence-retention.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { retainVsCodeCodingRunLifecycle } = require(bundlePath);
const {
  CanonicalRunLifecycleService,
  ProductRunEvidenceSession,
  ProductRunEvidenceWorkspaceReader,
  createProductRunEvidenceAuthorityToken,
} = require(path.join(extensionRoot, '../shared/dist/index.js'));

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('VS Code retains canonical lifecycle transitions through its participant authority', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-lifecycle-workspace-'));
  try {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const owner = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'vscode-lifecycle-run',
      surface: 'vscode',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
    });
    owner.record({ type: 'command.accepted', idempotencyKey: 'command:accepted' });
    const lifecycle = new CanonicalRunLifecycleService().start({
      runId: 'vscode-lifecycle-run',
      surface: 'vscode',
    });
    lifecycle.beginExecution();
    lifecycle.settle('blocked');

    assert.equal(retainVsCodeCodingRunLifecycle({
      workspaceRoot,
      runId: 'vscode-lifecycle-run',
      participantToken,
      lifecycle: lifecycle.snapshot(),
    }), true);
    owner.settleAndSeal({ status: 'blocked', idempotencyKey: 'settlement:blocked' });

    const reader = ProductRunEvidenceWorkspaceReader.forWorkspace({ workspaceRoot });
    const events = reader.readSnapshot('vscode-lifecycle-run').records.map(record => record.event);
    assert.deepEqual(
      events.filter(event => event.type === 'agent.status').map(event => event.payload.status),
      ['accepted', 'running', 'blocked'],
    );
    assert.equal(reader.verify('vscode-lifecycle-run').status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('VS Code reports missing participant authority without creating a shadow owner', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-lifecycle-workspace-'));
  const errors = [];
  try {
    const lifecycle = new CanonicalRunLifecycleService().start({
      runId: 'missing-owner',
      surface: 'vscode',
    });
    lifecycle.beginExecution();
    lifecycle.settle('failed');

    assert.equal(retainVsCodeCodingRunLifecycle({
      workspaceRoot,
      runId: 'missing-owner',
      lifecycle: lifecycle.snapshot(),
      onError: error => errors.push(error),
    }), false);
    assert.equal(errors.length, 1);
    assert.deepEqual(
      ProductRunEvidenceWorkspaceReader.forWorkspace({ workspaceRoot }).discoverRunIds(),
      [],
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
