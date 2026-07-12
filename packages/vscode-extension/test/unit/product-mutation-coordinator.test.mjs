import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/product-mutation-coordinator.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/product-mutation-coordinator.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const {
  ProductMutationCoordinator,
  ProductMutationDeniedError,
  ProductMutationIndeterminateError,
} = require(bundlePath);

function createHarness(failOnType) {
  const events = [];
  const degradations = [];
  const session = {
    record(input) {
      if (input.type === failOnType) throw new Error(`injected append failure: ${input.type}`);
      events.push(input);
    },
  };
  const runContext = {
    workspaceRoot: '/workspace',
    runId: 'mutation-test-run',
    evidenceParticipantToken: 'participant-test-token',
    markEvidenceDegraded(error) { degradations.push(error); },
  };
  return {
    events,
    degradations,
    coordinator: new ProductMutationCoordinator(runContext, 'test-boundary', session),
  };
}

function baseRequest(invoke) {
  return {
    kind: 'mcp-tool',
    label: 'test mutation',
    authorize: () => ({ allowed: true, source: 'execution-policy' }),
    invoke,
  };
}

test('Product mutation: missing completion strategy fails before dispatch', async () => {
  const harness = createHarness();
  let invoked = false;
  await assert.rejects(
    harness.coordinator.run(baseRequest(() => { invoked = true; })),
    ProductMutationDeniedError,
  );
  assert.equal(invoked, false);
  assert.deepEqual(harness.events.map(event => event.type), [
    'side_effect.requested',
    'side_effect.failed',
  ]);
  assert.equal(harness.events[1].payload.failure_phase, 'preflight');
});

test('Product mutation: independent readback commits with an external-state proof', async () => {
  const harness = createHarness();
  const value = await harness.coordinator.run({
    ...baseRequest(() => ({ content: 'persisted' })),
    completionEvidence: {
      kind: 'verified-postcondition',
      verify: result => result.content === 'persisted',
      proof: result => ({ content_length: result.content.length }),
    },
  });
  assert.equal(value.content, 'persisted');
  assert.deepEqual(harness.events.map(event => event.type), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.committed',
  ]);
  assert.deepEqual(harness.events.at(-1).payload.proof, {
    scope: 'verified-postcondition',
    external_effect_verified: true,
    evidence: { content_length: 9 },
  });
});

test('Product mutation: accepted tool receipt is explicit that external state is not verified', async () => {
  const harness = createHarness();
  await harness.coordinator.run({
    ...baseRequest(() => 'json-rpc-result'),
    completionEvidence: {
      kind: 'invocation-receipt',
      proof: () => ({ receipt: 'json-rpc-call-resolved' }),
    },
  });
  const committed = harness.events.at(-1);
  assert.equal(committed.type, 'side_effect.committed');
  assert.deepEqual(committed.payload.proof, {
    scope: 'invocation-receipt',
    external_effect_verified: false,
    receipt: { receipt: 'json-rpc-call-resolved' },
  });
});

for (const failingType of [
  'side_effect.requested',
  'side_effect.authorized',
  'side_effect.started',
]) {
  test(`Product mutation: ${failingType} append failure prevents callback and does not advance past the durable prefix`, async () => {
    const harness = createHarness(failingType);
    let invoked = false;
    await assert.rejects(harness.coordinator.run({
      ...baseRequest(() => { invoked = true; }),
      completionEvidence: {
        kind: 'invocation-receipt',
        proof: () => ({ receipt: 'resolved' }),
      },
    }), ProductMutationDeniedError);
    assert.equal(invoked, false);
    assert.equal(harness.events.some(event => event.type === failingType), false);
    assert.equal(harness.events.some(event => event.type === 'side_effect.started'), false);
    assert.equal(harness.degradations.length > 0, true);
  });
}

test('Product mutation: committed append failure becomes indeterminate and degraded, never committed', async () => {
  const harness = createHarness('side_effect.committed');
  let invoked = false;
  await assert.rejects(harness.coordinator.run({
    ...baseRequest(() => { invoked = true; return 'done'; }),
    completionEvidence: {
      kind: 'invocation-receipt',
      proof: () => ({ receipt: 'resolved' }),
    },
  }), ProductMutationIndeterminateError);
  assert.equal(invoked, true);
  assert.equal(harness.events.some(event => event.type === 'side_effect.committed'), false);
  assert.equal(harness.events.at(-1).type, 'side_effect.indeterminate');
  assert.equal(harness.events.at(-1).payload.failure_phase, 'terminal-evidence');
  assert.equal(harness.degradations.length > 0, true);
});
