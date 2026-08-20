import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/active-chat-run-coordinator.bundle.cjs');

execSync(
  `npx esbuild src/app/active-chat-run-coordinator.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ActiveChatRunCoordinator } = req(bundlePath);

function createKernelRun(id) {
  const cancellationRequests = [];
  const settlements = [];
  return {
    id,
    runContext: { runId: id },
    cancellationRequests,
    settlements,
    requestCancellation(data) {
      cancellationRequests.push(data);
    },
    cancelRun(data) {
      settlements.push(data);
      return 'cancelled';
    },
  };
}

test('active chat run keeps steering scoped to the current request', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('current-run');
  assert.equal(run.bindAgentKernelRun(kernel), true);

  assert.equal(coordinator.pushAgentSteer({
    steeringId: 'steer-1', instruction: 'inspect the failing test first', expectedRunId: 'current-run',
  }).status, 'accepted');
  assert.equal(coordinator.pushAgentSteer({
    steeringId: 'steer-2', instruction: 'keep the public API stable', expectedRunId: 'current-run',
  }).status, 'accepted');
  assert.deepEqual(run.consumeAgentSteer().map(item => item.instruction), [
    'inspect the failing test first',
    'keep the public API stable',
  ]);
  assert.deepEqual(run.consumeAgentSteer(), []);

  run.clearAgentKernelRun(kernel);
  run.finish();
  assert.equal(run.signal.aborted, false);
  assert.equal(coordinator.pushAgentSteer({ instruction: 'too late' }).status, 'rejected');
});

test('completion fence atomically drains accepted input and rejects late submissions until reopened', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('fenced-run');
  run.bindAgentKernelRun(kernel);

  coordinator.pushAgentSteer({ steeringId: 'before-fence', instruction: 'do not edit tests' });
  assert.deepEqual(
    run.closeAgentSteeringAndConsume().map(item => item.instruction),
    ['do not edit tests'],
  );
  assert.equal(
    coordinator.pushAgentSteer({ steeringId: 'too-late', instruction: 'change it again' }).reason,
    'turn-completing',
  );
  assert.equal(run.reopenAgentSteering(), true);
  assert.equal(
    coordinator.pushAgentSteer({ steeringId: 'after-reopen', instruction: 'preserve API' }).status,
    'accepted',
  );
  assert.deepEqual(run.consumeAgentSteer().map(item => item.steeringId), ['after-reopen']);

  run.closeAgentSteeringAndConsume();
  run.clearAgentKernelRun(kernel);
  run.finish();
  const snapshot = coordinator.steeringSnapshot();
  assert.equal(snapshot.runs[0].steeringOpen, false);
  assert.deepEqual(snapshot.runs[0].submissions.map(item => item.state), ['consumed', 'consumed']);
});

test('stale run identity and conflicting steering identity fail closed', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('identity-run');
  run.bindAgentKernelRun(kernel);

  assert.equal(coordinator.pushAgentSteer({
    steeringId: 'stable', instruction: 'first meaning', expectedRunId: 'old-run',
  }).reason, 'expected-run-mismatch');
  assert.equal(coordinator.pushAgentSteer({ steeringId: 'stable', instruction: 'first meaning' }).status, 'accepted');
  assert.equal(coordinator.pushAgentSteer({ steeringId: 'stable', instruction: 'first meaning' }).status, 'duplicate');
  assert.equal(coordinator.pushAgentSteer({ steeringId: 'stable', instruction: 'different meaning' }).reason, 'conflicting-steering-id');

  run.closeAgentSteeringAndConsume();
  run.clearAgentKernelRun(kernel);
  run.finish();
});

test('a new request cancels the previous Kernel, AbortSignal, and steer queue', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const first = coordinator.startRun();
  const firstKernel = createKernelRun('first');
  assert.equal(first.bindAgentKernelRun(firstKernel), true);
  coordinator.pushAgentSteer({ instruction: 'belongs to first' });

  const second = coordinator.startRun({
    reason: 'superseded-by-new-run',
    source: 'test-user',
  });

  assert.equal(first.signal.aborted, true);
  assert.deepEqual(firstKernel.cancellationRequests, [{
    reason: 'superseded-by-new-run',
    source: 'test-user',
  }]);
  assert.deepEqual(firstKernel.settlements, []);
  assert.deepEqual(first.consumeAgentSteer(), []);
  const secondKernel = createKernelRun('second');
  second.bindAgentKernelRun(secondKernel);
  assert.equal(coordinator.pushAgentSteer({ instruction: 'belongs to second' }).status, 'accepted');
  assert.deepEqual(second.consumeAgentSteer().map(item => item.instruction), ['belongs to second']);

  first.finish();
  assert.equal(second.isCurrent(), true);
});

test('a superseded request cannot bind a late Kernel run', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const first = coordinator.startRun();
  const second = coordinator.startRun({ reason: 'superseded' });
  const lateKernel = createKernelRun('late');

  assert.equal(first.bindAgentKernelRun(lateKernel), false);
  assert.deepEqual(lateKernel.cancellationRequests, [{
    reason: 'superseded-before-kernel-bind',
    source: 'active-chat-run-coordinator',
  }]);
  assert.deepEqual(lateKernel.settlements, [{
    reason: 'superseded-before-kernel-bind',
    source: 'active-chat-run-coordinator',
  }]);
  assert.equal(second.isCurrent(), true);
});

test('user cancellation records cancelling and aborts host work before terminal settlement', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('active');
  run.bindAgentKernelRun(kernel);

  coordinator.cancelActiveRun({
    reason: 'user-cancelled',
    source: 'vscode-webview-cancel',
  });

  assert.equal(run.signal.aborted, true);
  assert.equal(run.isCurrent(), false);
  assert.equal(coordinator.pushAgentSteer({ instruction: 'after cancel' }).status, 'rejected');
  assert.equal(kernel.cancellationRequests.length, 1);
  assert.equal(kernel.settlements.length, 0);
  assert.deepEqual(run.cancellationData(), {
    reason: 'user-cancelled',
    source: 'vscode-webview-cancel',
  });
  run.finish();
  assert.equal(kernel.cancellationRequests.length, 1);
  assert.equal(kernel.settlements.length, 0);
});

test('finishing an exceptional request cancels a Kernel that was not explicitly cleared', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('leaked');
  run.bindAgentKernelRun(kernel);

  run.finish();
  assert.equal(run.signal.aborted, true);
  assert.deepEqual(kernel.cancellationRequests, [{
    reason: 'request-finished-with-active-kernel',
    source: 'active-chat-run-coordinator',
  }]);
  assert.deepEqual(kernel.settlements, [{
    reason: 'request-finished-with-active-kernel',
    source: 'active-chat-run-coordinator',
  }]);
});

test('extension and Webview route cancellation through the single lifecycle owner', () => {
  const extension = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const provider = readFileSync(path.join(rootDir, 'src/ui/deepseek-view-provider.ts'), 'utf8');

  assert.match(extension, /new ActiveChatRunCoordinator\(\)/);
  assert.match(extension, /activeChatRunCoordinator\.startRun\(/);
  assert.match(extension, /activeRun\.bindAgentKernelRun\(agentKernelRun\)/);
  assert.match(extension, /onUserSteerCompletionFence: closeAgentSteeringAndConsume/);
  assert.match(provider, /deps\.cancelActiveRun\(\{ reason: 'user-cancelled'/);
  assert.doesNotMatch(extension, /let activeChatAbortController|let activeAgentKernelRun|activeAgentSteerQueue/);
  assert.doesNotMatch(provider, /getActiveChatAbortController|setActiveChatAbortController|cancelActiveAgentRun/);
});
