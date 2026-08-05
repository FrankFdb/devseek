import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODING_KERNEL_OUTPUT_VERSION,
  buildCodingKernelTaskContract,
} from '../../shared/dist/index.js';
import { HeadlessCodingKernelExecutor } from '../dist/index.js';

test('Headless product entry delegates one immutable request to the shared canonical Kernel', async () => {
  const calls = [];
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical(request) {
      calls.push(request);
      return {
        status: 'completed',
        result: { value: 42 },
        evidenceRefs: ['headless:run:completed'],
      };
    },
  });
  const taskContract = contract();

  const output = await executor.execute({
    runId: 'headless-run-1',
    userPrompt: 'Create and verify src/value.ts.',
    workspaceRoot: '/workspace',
    taskContract,
    runtimeContext: { provider: 'deterministic' },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'canonical');
  assert.equal(calls[0].surface, 'headless');
  assert.equal(Object.isFrozen(calls[0].taskContract), true);
  assert.equal(output.version, CODING_KERNEL_OUTPUT_VERSION);
  assert.equal(output.surface, 'headless');
  assert.equal(output.status, 'completed');
  assert.deepEqual(output.result, { value: 42 });
  assert.deepEqual(output.evidenceRefs, ['headless:run:completed']);
});

test('Headless product entry fails before runtime dispatch when cancellation is already requested', async () => {
  let calls = 0;
  const executor = new HeadlessCodingKernelExecutor({
    async executeCanonical() {
      calls += 1;
      return { status: 'completed', result: null };
    },
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    executor.execute({
      runId: 'headless-cancelled',
      userPrompt: 'Do not start this run.',
      workspaceRoot: '/workspace',
      taskContract: contract(),
      runtimeContext: {},
      signal: controller.signal,
    }),
    /coding-kernel-execution:cancelled-before-start/,
  );
  assert.equal(calls, 0);
});

function contract() {
  return buildCodingKernelTaskContract({
    goal: 'Create and verify the requested source file.',
    mode: 'change',
    include: ['src/value.ts'],
    exclude: ['package-lock.json'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    constraints: ['no-other-files'],
    acceptance: [{ id: 'a-value', statement: 'The source exports the requested value.' }],
    provenanceRefs: ['request:headless-run'],
  });
}
