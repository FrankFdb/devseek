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

console.log('\nAgent display presenter tests passed.\n');
