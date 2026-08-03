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
  const cancellations = [];
  return {
    id,
    cancellations,
    cancelRun(data) {
      cancellations.push(data);
      return 'cancelled';
    },
  };
}

test('active chat run keeps steering scoped to the current request', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();

  assert.equal(coordinator.pushAgentSteer('inspect the failing test first'), true);
  assert.equal(coordinator.pushAgentSteer('keep the public API stable'), true);
  assert.deepEqual(run.consumeAgentSteer(), [
    'inspect the failing test first',
    'keep the public API stable',
  ]);
  assert.deepEqual(run.consumeAgentSteer(), []);

  run.finish();
  assert.equal(run.signal.aborted, false);
  assert.equal(coordinator.pushAgentSteer('too late'), false);
});

test('a new request cancels the previous Kernel, AbortSignal, and steer queue', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const first = coordinator.startRun();
  const firstKernel = createKernelRun('first');
  assert.equal(first.bindAgentKernelRun(firstKernel), true);
  coordinator.pushAgentSteer('belongs to first');

  const second = coordinator.startRun({
    reason: 'superseded-by-new-run',
    source: 'test-user',
  });

  assert.equal(first.signal.aborted, true);
  assert.deepEqual(firstKernel.cancellations, [{
    reason: 'superseded-by-new-run',
    source: 'test-user',
  }]);
  assert.deepEqual(first.consumeAgentSteer(), []);
  assert.equal(coordinator.pushAgentSteer('belongs to second'), true);
  assert.deepEqual(second.consumeAgentSteer(), ['belongs to second']);

  first.finish();
  assert.equal(second.isCurrent(), true);
});

test('a superseded request cannot bind a late Kernel run', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const first = coordinator.startRun();
  const second = coordinator.startRun({ reason: 'superseded' });
  const lateKernel = createKernelRun('late');

  assert.equal(first.bindAgentKernelRun(lateKernel), false);
  assert.deepEqual(lateKernel.cancellations, [{
    reason: 'superseded-before-kernel-bind',
    source: 'active-chat-run-coordinator',
  }]);
  assert.equal(second.isCurrent(), true);
});

test('user cancellation settles the active Kernel once and aborts host work', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('active');
  run.bindAgentKernelRun(kernel);

  const status = coordinator.cancelActiveRun({
    reason: 'user-cancelled',
    source: 'vscode-webview-cancel',
  });

  assert.equal(status, 'cancelled');
  assert.equal(run.signal.aborted, true);
  assert.equal(run.isCurrent(), false);
  assert.equal(coordinator.pushAgentSteer('after cancel'), false);
  assert.equal(kernel.cancellations.length, 1);
  run.finish();
  assert.equal(kernel.cancellations.length, 1);
});

test('finishing an exceptional request cancels a Kernel that was not explicitly cleared', () => {
  const coordinator = new ActiveChatRunCoordinator();
  const run = coordinator.startRun();
  const kernel = createKernelRun('leaked');
  run.bindAgentKernelRun(kernel);

  assert.equal(run.finish(), 'cancelled');
  assert.equal(run.signal.aborted, true);
  assert.deepEqual(kernel.cancellations, [{
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
  assert.match(provider, /deps\.cancelActiveRun\(\{ reason: 'user-cancelled'/);
  assert.doesNotMatch(extension, /let activeChatAbortController|let activeAgentKernelRun|activeAgentSteerQueue/);
  assert.doesNotMatch(provider, /getActiveChatAbortController|setActiveChatAbortController|cancelActiveAgentRun/);
});
