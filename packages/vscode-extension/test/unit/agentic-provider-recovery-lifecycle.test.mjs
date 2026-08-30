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

const {
  AgenticProviderRecoveryLifecycle,
  projectProviderRecoveryScreenFeedback,
} = createRequire(import.meta.url)(bundlePath);

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

test('provider recovery settles a valid proposal before local duplicate suppression', async () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-read', ['read_file']);
  const tools = [{ name: 'read_file', input: { path: 'src/main.cpp' } }];
  const screen = lifecycle.screenToolProposals(tools);

  assert.equal(
    await lifecycle.completeAdmittedToolProposal(tools, screen, 'valid-read-proposal'),
    true,
  );
  assert.equal(lifecycle.hasUnresolvedToolAction(), false);
  assert.equal(lifecycle.unresolvedToolActionFeedback({
    version: 'devseek.text-tools/v1',
    channelId: 'recovery-channel-1234',
  }), '');
});

test('a newer quarantined response replaces stale recovery action names', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-read', ['read_file']);
  lifecycle.begin('malformed-write', ['apply_patch']);

  assert.deepEqual(lifecycle.pendingObservedToolNames(), ['apply_patch']);
  assert.deepEqual(
    [...lifecycle.screenToolProposals([{ name: 'read_file' }]).blockedToolIndexes],
    [0],
  );
  assert.deepEqual(
    [...lifecycle.screenToolProposals([{ name: 'apply_patch' }]).blockedToolIndexes],
    [],
  );
});

test('provider recovery lifecycle keeps a rejected mutation pending across reads and validation', async () => {
  const statuses = [];
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/x11_app.cpp', 'repair', {
    onAgentStatus(status) { statuses.push(status); },
  });

  lifecycle.begin('malformed-mutation', ['replace_in_file'], {
    allowRejectedWriteContextRefresh: true,
  });
  assert.equal(lifecycle.hasUnresolvedToolAction(), true);
  assert.match(lifecycle.completionBlocker(), /replace_in_file[\s\S]*此前证据/u);
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
  assert.equal(lifecycle.completionBlocker(), undefined);
  assert.deepEqual(statuses.map(status => status.state), ['completed']);
});

test('provider recovery lifecycle blocks completion while a transport response is rebuilding', async () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'repair', {
    onAgentStatus() {},
  });

  lifecycle.begin('truncated-response');
  assert.match(lifecycle.completionBlocker(), /响应恢复仍未完成/u);
  assert.equal(await lifecycle.completeAcceptedResponse('plain-response', 'clean-response'), true);
  assert.equal(lifecycle.completionBlocker(), undefined);
});

test('provider recovery lifecycle locally admits only one concrete recovery action', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/x11_app.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-mutation', ['replace_in_file'], {
    allowRejectedWriteContextRefresh: true,
  });

  const screened = lifecycle.screenToolProposals([
    { name: 'manage_todo_list' },
    { name: 'read_file' },
    { name: 'read_file' },
    { name: 'replace_in_file' },
    { name: 'task_complete' },
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], [0, 2, 3, 4]);
  assert.deepEqual([...screened.contextRefreshToolIndexes], [1]);
  assert.match(projectProviderRecoveryScreenFeedback(
    screened,
    {},
    true,
  )[0], /只执行一个具体工具[\s\S]*仍未解决/u);
  assert.equal(lifecycle.hasUnresolvedToolAction(), true);
});

test('provider recovery admits bounded distinct read ranges while rebuilding a rejected write', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/lesson_controller.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-mutation', ['replace_in_file'], {
    allowRejectedWriteContextRefresh: true,
  });

  const initialRefresh = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 107, endLine: 215 },
  }]);
  assert.deepEqual([...initialRefresh.blockedToolIndexes], []);
  assert.deepEqual([...initialRefresh.contextRefreshToolIndexes], [0]);

  const repeatedRefresh = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 107, endLine: 215 },
  }]);
  assert.deepEqual([...repeatedRefresh.blockedToolIndexes], [0]);
  assert.deepEqual([...repeatedRefresh.contextRefreshToolIndexes], []);

  const tailRefresh = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 216, endLine: 320 },
  }]);
  assert.deepEqual([...tailRefresh.blockedToolIndexes], []);
  assert.deepEqual([...tailRefresh.contextRefreshToolIndexes], [0]);

  const headRefresh = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 1, endLine: 106 },
  }]);
  assert.deepEqual([...headRefresh.blockedToolIndexes], []);
  assert.deepEqual([...headRefresh.contextRefreshToolIndexes], [0]);

  const exhaustedRefresh = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 321, endLine: 420 },
  }]);
  assert.deepEqual([...exhaustedRefresh.blockedToolIndexes], [0]);
  assert.deepEqual([...exhaustedRefresh.contextRefreshToolIndexes], []);
  assert.deepEqual([...lifecycle.screenToolProposals([{ name: 'apply_patch' }]).blockedToolIndexes], []);
});

test('provider recovery admits a host-created projected continuation without spending replay budget', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/lesson_controller.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-mutation', ['replace_in_file'], {
    allowRejectedWriteContextRefresh: true,
  });

  const projectedContinuation = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 107, endLine: 215 },
  }], {
    projectedReadContinuationToolIndexes: new Set([0]),
  });
  assert.deepEqual([...projectedContinuation.blockedToolIndexes], []);
  assert.deepEqual([...projectedContinuation.contextRefreshToolIndexes], []);

  const firstReplay = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 216, endLine: 320 },
  }]);
  assert.deepEqual([...firstReplay.blockedToolIndexes], []);
  assert.deepEqual([...firstReplay.contextRefreshToolIndexes], [0]);
});

test('provider recovery applies the replay budget when a damaged response exposed reads and a write', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/raster_canvas.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('malformed-mixed-response', ['read_file', 'replace_in_file'], {
    allowRejectedWriteContextRefresh: false,
  });

  const read = lifecycle.screenToolProposals([{
    name: 'read_file',
    input: { path: 'src/raster_canvas.cpp', startLine: 1, endLine: 100 },
  }]);
  assert.deepEqual([...read.blockedToolIndexes], [0]);
  assert.deepEqual([...read.contextRefreshToolIndexes], []);
  assert.deepEqual([...lifecycle.screenToolProposals([{ name: 'replace_in_file' }]).blockedToolIndexes], []);
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
  assert.deepEqual([...screened.contextRefreshToolIndexes], []);
  assert.match(projectProviderRecoveryScreenFeedback(screened, {}, true)[0], /不匹配/u);
});

test('provider recovery lifecycle preserves an in-session rejected write without admitting more reads', () => {
  const lifecycle = new AgenticProviderRecoveryLifecycle('src/main.cpp', 'repair', {
    onAgentStatus() {},
  });
  lifecycle.begin('native-xml-mutation', ['replace_in_file'], {
    allowRejectedWriteContextRefresh: false,
  });

  const screened = lifecycle.screenToolProposals([
    { name: 'read_file' },
    { name: 'grep_search' },
    { name: 'replace_in_file' },
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], [0, 1]);
  assert.deepEqual([...screened.contextRefreshToolIndexes], []);
  assert.match(projectProviderRecoveryScreenFeedback(
    screened,
    { toolFailures: [{ tool: 'replace_in_file' }] },
    false,
  )[0], /执行失败[\s\S]*改变参数或工具策略/u);
  assert.equal(lifecycle.hasUnresolvedToolAction(), true);
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
  assert.deepEqual([...screened.contextRefreshToolIndexes], []);
  assert.deepEqual(projectProviderRecoveryScreenFeedback(screened, {}, false), []);
});

test('provider recovery screen feedback does not reissue an accepted write', () => {
  const feedback = projectProviderRecoveryScreenFeedback({
    blockedToolIndexes: new Set([1, 2]),
    contextRefreshToolIndexes: new Set(),
  }, {
    writtenFiles: [{ path: 'result.txt' }],
  }, false);

  assert.match(feedback[0], /已形成真实写盘[\s\S]*不要重发/u);
  assert.doesNotMatch(feedback[0], /仍未解决/u);
});
