import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/idempotency-guard.bundle.cjs');

execSync(
  `npx esbuild src/agent/idempotency-guard.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { IdempotencyGuard, defaultReplayPolicy } = req(bundlePath);

test('IdempotencyGuard: committed edit with never policy returns cached result', () => {
  const guard = new IdempotencyGuard([
    {
      operationId: 'op-edit',
      workflowId: 'wf-1',
      kind: 'edit',
      inputHash: 'hash-1',
      status: 'committed',
      replayPolicy: 'never',
      resultRef: 'change-1',
    },
  ]);

  const decision = guard.decideReplay({ operationId: 'op-edit', workflowId: 'wf-1', kind: 'edit', inputHash: 'hash-1' });

  assert.equal(decision.action, 'cached');
  assert.equal(decision.resultRef, 'change-1');
});

test('IdempotencyGuard: committed terminal command requires confirmation by default', () => {
  const guard = new IdempotencyGuard();
  guard.markCommitted({ operationId: 'op-term', workflowId: 'wf-1', kind: 'terminal', inputHash: 'cmd-hash' }, 'terminal-1');

  const decision = guard.decideReplay({ operationId: 'op-term', workflowId: 'wf-1', kind: 'terminal', inputHash: 'cmd-hash' });

  assert.equal(defaultReplayPolicy('terminal'), 'requires-confirmation');
  assert.equal(decision.action, 'requires-confirmation');
});

test('IdempotencyGuard: read-only terminal replay can execute', () => {
  const guard = new IdempotencyGuard();
  guard.markCommitted({
    operationId: 'op-read',
    workflowId: 'wf-1',
    kind: 'terminal',
    inputHash: 'ls-hash',
    readOnly: true,
  }, 'terminal-read');

  const decision = guard.decideReplay({
    operationId: 'op-read',
    workflowId: 'wf-1',
    kind: 'terminal',
    inputHash: 'ls-hash',
    readOnly: true,
  });

  assert.equal(decision.action, 'execute');
  assert.equal(decision.reason, 'read-only-replay-allowed');
});

test('IdempotencyGuard: operation id cannot be reused for different input', () => {
  const guard = new IdempotencyGuard();
  guard.markCommitted({ operationId: 'op-edit', workflowId: 'wf-1', kind: 'edit', inputHash: 'hash-1' }, 'change-1');

  const decision = guard.decideReplay({ operationId: 'op-edit', workflowId: 'wf-1', kind: 'edit', inputHash: 'hash-2' });

  assert.equal(decision.action, 'blocked');
  assert.equal(decision.reason, 'operation-id-input-mismatch');
});

console.log('\nIdempotency guard tests passed.\n');
