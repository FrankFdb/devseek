import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-recovery-lifecycle-'));
const bundlePath = path.join(tempRoot, 'agentic-provider-recovery-boundary.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/agentic-provider-recovery-boundary.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { AgenticProviderRecoveryLifecycle } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('provider recovery lifecycle identifies only the first accepted recovery result', async () => {
  const statuses = [];
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'explore', {
    onAgentStatus(status) { statuses.push(status); },
  });

  assert.equal(await lifecycle.completeAcceptedResponse('tool-protocol', 'ordinary-op'), false);

  lifecycle.begin('failed-op');
  assert.equal(await lifecycle.completeAcceptedResponse('tool-protocol', 'recovered-op'), true);
  assert.equal(await lifecycle.completeAcceptedResponse('tool-protocol', 'later-op'), false);
  assert.deepEqual(statuses.map(status => ({
    state: status.state,
    target: status.recoveryTargetOperationIds,
    result: status.recoveryResultOperationId,
  })), [{
    state: 'completed',
    target: ['failed-op'],
    result: 'recovered-op',
  }]);
});
