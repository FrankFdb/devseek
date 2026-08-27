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

test('provider recovery lifecycle keeps a rejected mutation pending across reads and validation', async () => {
  const statuses = [];
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/x11_app.cpp', 'repair', {
    onAgentStatus(status) { statuses.push(status); },
  });

  lifecycle.begin('malformed-mutation', ['replace_in_file']);
  assert.equal(lifecycle.hasUnresolvedToolAction(), true);
  assert.equal(
    await lifecycle.completeAcceptedResponse('tool-protocol', 'validation-op', ['run_terminal']),
    false,
  );
  assert.equal(
    await lifecycle.completeAcceptedResponse('tool-protocol', 'context-op', ['read_file']),
    false,
  );
  assert.equal(statuses.length, 0);
  assert.match(lifecycle.unresolvedToolActionFeedback({
    version: 'devseek.text-tools/v1',
    channelId: 'recovery-channel-1234',
  }), /尚未解决上一轮被隔离的结构化动作[\s\S]*fenced CDATA/u);

  assert.equal(
    await lifecycle.completeAcceptedResponse('tool-protocol', 'mutation-op', ['replace_in_file']),
    true,
  );
  assert.equal(lifecycle.hasUnresolvedToolAction(), false);
  assert.deepEqual(statuses.map(status => status.state), ['completed']);
});

test('provider recovery lifecycle locally admits only one concrete recovery action', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/x11_app.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-mutation', ['replace_in_file']);

  const screened = lifecycle.screenToolProposals([
    { name: 'manage_todo_list' },
    { name: 'read_file' },
    { name: 'read_file' },
    { name: 'replace_in_file' },
    { name: 'task_complete' },
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], [0, 2, 3, 4]);
  assert.match(screened.warnings[0], /只执行一个具体工具/u);
  assert.equal(lifecycle.hasUnresolvedToolAction(), true);
});

test('provider recovery lifecycle blocks actions unrelated to the quarantined proposal', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-read', ['read_file']);

  const screened = lifecycle.screenToolProposals([
    { name: 'create_file' },
    { name: 'read_file' },
    { name: 'task_complete' },
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], [0, 2]);
  assert.match(screened.warnings[0], /不匹配/u);
});

test('provider recovery lifecycle does not screen ordinary provider turns', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'explore', {
    onAgentStatus() {},
  });

  const screened = lifecycle.screenToolProposals([
    { name: 'read_file' },
    { name: 'replace_in_file' },
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], []);
  assert.deepEqual(screened.warnings, []);
});
