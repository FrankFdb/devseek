/**
 * Unit tests for app/agent-display-presenter.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-display-presenter.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-display-presenter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { AgentDisplayPresenter } = req(bundlePath);

const presenter = new AgentDisplayPresenter();

test('AgentDisplayPresenter: hides internal validation command titles', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'failed',
    title: 'Failed cmake -S /repo/code/shape_manager -B /repo/code/shape_manager/build && make',
    detail: 'stderr: main.cpp:92: error',
  });

  assert.equal(status.title, '验证未通过');
  assert.equal(status.displayTitle, '验证未通过');
  assert.equal(status.detail, 'stderr: main.cpp:92: error');
});

test('AgentDisplayPresenter: converts generic completion text to validation language', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'completed',
    title: '执行完成✓',
  });

  assert.equal(status.title, '运行验证完成 ✓');
});

test('AgentDisplayPresenter: source snippets never become user-facing titles', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'run',
    state: 'started',
    title: 'int main() { return 0; }',
  });

  assert.equal(status.title, '处理中');
});

test('AgentDisplayPresenter: long user prompt execute titles become engineering progress', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'explore',
    title: '关于遥控器的通讯请参考：/home/ff/uav/tars/huida_uav/src/oam/src/license 模块的方式，并分析主控通信链路后实现。',
  });

  assert.equal(status.title, '正在建立任务上下文');
});

test('AgentDisplayPresenter: tool transcripts never become done titles', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'failed',
    title: '我理解了，需要执行验证。<TOOL_STREAM><TOOL name="run_terminal">{"command":"npm test"}</TOOL></TOOL_STREAM>',
  });

  assert.equal(status.title, '任务未完成');
});

test('AgentDisplayPresenter: long details are kept bounded for the webview', () => {
  const status = presenter.presentStatus({
    type: 'agentStatus',
    phase: 'run',
    state: 'started',
    title: '运行程序',
    detail: 'x'.repeat(2000),
  });

  assert.equal(status.detail.length, 1800);
  assert.match(status.detail, /…$/);
});

test('AgentDisplayPresenter: emits a concise context summary from structured status facts', () => {
  const localPresenter = new AgentDisplayPresenter();
  const status = localPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'explore',
    taskDesc: '追踪 license 模块的独立线程、分片传输和主控接口',
    title: '分析 license',
  });

  assert.equal(status.progressStage, 'context');
  assert.equal(status.progressTitle, '正在调查：追踪 license 模块的独立线程、分片传输和主控接口');
  assert.match(status.progressDetail, /当前重点/);
  assert.match(status.progressDetail, /下一步：整理发现/);
});

test('AgentDisplayPresenter: user-facing progress focus is not hard-truncated before layout', () => {
  const localPresenter = new AgentDisplayPresenter();
  const focus = 'CLOSE02-20260713-manual-probe 请只在这个隔离路径创建一个最小 JavaScript probe 文件，返回 a+b，并报告最终状态';
  const status = localPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'explore',
    taskDesc: focus,
    title: 'CLOSE02 probe',
  });

  assert.equal(status.progressTitle, `正在调查：${focus}`);
  assert.match(status.progressDetail, /报告最终状态/);
  assert.doesNotMatch(status.progressTitle, /…$/);
});

test('AgentDisplayPresenter: structured status can override progress copy', () => {
  const localPresenter = new AgentDisplayPresenter();
  const status = localPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '计划',
    progressTitle: '正在确认文件写入要求',
    progressDetail: '正在确认目标文件、精确内容和读回验证方式。',
  });

  assert.equal(status.progressStage, 'planning');
  assert.equal(status.progressTitle, '正在确认文件写入要求');
  assert.equal(status.progressDetail, '正在确认目标文件、精确内容和读回验证方式。');
});

test('AgentDisplayPresenter: create actions use create language during implementation', () => {
  const localPresenter = new AgentDisplayPresenter();
  const status = localPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'create',
    taskDesc: 'docs/example.md',
    title: '创建 docs/example.md',
  });

  assert.equal(status.progressStage, 'implementation');
  assert.equal(status.progressTitle, '正在创建：docs/example.md');
  assert.match(status.progressDetail, /当前重点：docs\/example\.md/);
});

test('AgentDisplayPresenter: de-duplicates detail facts and changes stage by tool semantics', () => {
  const localPresenter = new AgentDisplayPresenter();
  localPresenter.presentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'explore',
    taskDesc: '核对项目通信链路',
    title: '项目调查',
  });

  const firstRead = localPresenter.presentToolActivity('read', '/repo/src/license_transport.cpp');
  const duplicateRead = localPresenter.presentToolActivity('read', '/repo/src/license_transport.cpp');
  const search = localPresenter.presentToolActivity('search', 'TunnelTransport');

  assert.equal(firstRead.progressStage, 'context');
  assert.equal(firstRead.activityTotal, 1);
  assert.equal(duplicateRead.activityTotal, 1);
  assert.equal(search.activityTotal, 1);
  assert.match(search.progressDetail, /读取 1 个文件/);
  assert.match(search.progressDetail, /搜索 1 次/);

  const write = localPresenter.presentToolActivity('write', '/repo/src/remote_controller.cpp');
  assert.equal(write.progressStage, 'implementation');
  assert.equal(write.progressTitle, '正在实现：核对项目通信链路');
  assert.match(write.progressDetail, /更新成果物 1 个/);
  assert.match(write.progressDetail, /下一步：运行编译、测试和交付检查/);
});

console.log('\nAgent display presenter tests passed.\n');
