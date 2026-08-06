import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { CanonicalRunLifecycleService } from '../../shared/dist/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(testDir, '..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-cli-run-evidence-'));
const bundlePath = path.join(bundleRoot, 'run-evidence.cjs');

buildSync({
  entryPoints: [path.join(cliRoot, 'src/cli-run-evidence.ts')],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});

const require = createRequire(import.meta.url);
const { CliRunEvidence } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function createHarness({ openError, failRecordType } = {}) {
  const events = [];
  const settlements = [];
  const warnings = [];
  const openCalls = [];
  const tokens = ['owner-token', 'participant-token'];
  let failedRecord = false;
  const session = {
    record(entry) {
      if (!failedRecord && entry.type === failRecordType) {
        failedRecord = true;
        throw new Error('append denied');
      }
      events.push(entry);
    },
    readEvents() {
      return events;
    },
    settleAndSeal(input) {
      settlements.push(input);
    },
  };
  const runtime = {
    createAuthorityToken() {
      return tokens.shift();
    },
    openSession(options) {
      openCalls.push(options);
      if (openError) throw openError;
      return session;
    },
    formatError(error) {
      return error instanceof Error ? error.message : String(error);
    },
    warn(message) {
      warnings.push(message);
    },
  };
  const evidence = CliRunEvidence.open({
    workspaceRoot: '/workspace',
    runId: 'run-1',
    prompt: 'fix src/main.ts',
    surface: 'jsonl',
  }, runtime);

  return { evidence, events, settlements, warnings, openCalls };
}

test('CLI run evidence owns authority setup, operation enrichment, and terminal sealing', () => {
  const harness = createHarness();

  harness.evidence.recordOperation({
    type: 'provider.requested',
    idempotencyKey: 'provider-requested-1',
    payload: { provider: 'bridge' },
  }, 'provider-1', 'cli-provider-client');
  harness.evidence.settle('completed');

  assert.equal(harness.evidence.participantToken, 'participant-token');
  assert.equal(harness.evidence.surface, 'jsonl');
  assert.equal(harness.openCalls.length, 1);
  assert.deepEqual(harness.openCalls[0].authority, {
    role: 'owner',
    token: 'owner-token',
    participantToken: 'participant-token',
  });
  assert.equal(harness.events[0].type, 'command.accepted');
  assert.deepEqual(harness.events[1].payload, {
    provider: 'bridge',
    operation_id: 'provider-1',
    boundary: 'cli-provider-client',
    status: 'requested',
    trust: 'product-runtime-observation',
  });
  assert.equal(harness.settlements.length, 1);
  assert.equal(harness.settlements[0].status, 'completed');
  assert.deepEqual(harness.settlements[0].payload, { surface: 'jsonl' });
});

test('CLI run evidence preserves a blocked product terminal', () => {
  const harness = createHarness();

  harness.evidence.settle('blocked');

  assert.deepEqual(harness.settlements.map(settlement => settlement.status), ['blocked']);
});

test('CLI run evidence retains the canonical lifecycle before settlement', () => {
  const harness = createHarness();
  const lifecycle = new CanonicalRunLifecycleService().start({ runId: 'run-1', surface: 'cli' });
  lifecycle.beginExecution();
  lifecycle.settle('blocked');

  harness.evidence.retainLifecycle(lifecycle.snapshot());
  harness.evidence.settle('blocked');

  assert.deepEqual(
    harness.events.filter(event => event.type === 'agent.status').map(event => event.payload.status),
    ['accepted', 'running', 'blocked'],
  );
  assert.deepEqual(harness.settlements.map(settlement => settlement.status), ['blocked']);
});

test('CLI run evidence degrades without losing its participant token when the store cannot open', () => {
  const harness = createHarness({ openError: new Error('store unavailable') });

  harness.evidence.recordOperation({
    type: 'provider.requested',
    idempotencyKey: 'provider-requested-1',
  }, 'provider-1');
  harness.evidence.settle('completed');

  assert.equal(harness.evidence.participantToken, 'participant-token');
  assert.deepEqual(harness.warnings, ['DevSeek evidence warning: store unavailable']);
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.settlements, []);
});

test('CLI run evidence refuses completed settlement after an append failure', () => {
  const harness = createHarness({ failRecordType: 'provider.requested' });

  harness.evidence.recordOperation({
    type: 'provider.requested',
    idempotencyKey: 'provider-requested-1',
  }, 'provider-1');
  harness.evidence.settle('completed');
  harness.evidence.settle('failed');

  assert.deepEqual(harness.events.map(event => event.type), [
    'command.accepted',
    'evidence.degraded',
  ]);
  assert.deepEqual(harness.warnings, [
    'DevSeek evidence warning: append denied',
    'DevSeek evidence warning: completed settlement refused because evidence is degraded',
  ]);
  assert.deepEqual(harness.settlements.map(settlement => settlement.status), ['failed']);
});

test('CLI run evidence degrades when the Bridge server boundary lacks one terminal', () => {
  const harness = createHarness();
  harness.events.push({
    type: 'provider.requested',
    payload: { operation_id: 'provider-1', boundary: 'bridge-server' },
  });

  harness.evidence.assertBridgeComplete('provider-1', 'completed');
  harness.evidence.settle('completed');

  assert.equal(harness.events.some(event => event.type === 'evidence.degraded'), true);
  assert.match(harness.warnings[0], /Bridge evidence boundary is incomplete for provider-1/);
  assert.equal(harness.warnings.at(-1), 'DevSeek evidence warning: completed settlement refused because evidence is degraded');
  assert.deepEqual(harness.settlements, []);
});
