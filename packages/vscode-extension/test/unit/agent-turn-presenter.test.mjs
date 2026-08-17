import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-turn-presenter.bundle.cjs');

execSync(
  `npx esbuild src/ui/agent-turn-presenter.ts --bundle --external:vscode `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { AgentTurnPresenter } = req(bundlePath);

function createPresenter() {
  const messages = [];
  const statuses = [];
  const activities = [];
  const reviewScopes = [];
  const webview = {
    postMessage(message) {
      messages.push(message);
      return Promise.resolve(true);
    },
  };
  const presenter = new AgentTurnPresenter(
    webview,
    { beginReviewScope(value) { reviewScopes.push(value); } },
    {
      recordAgentStatus(status) { statuses.push(status); },
      recordToolActivity(kind, label) { activities.push({ kind, label }); },
      recordWorkspaceMutation() {},
    },
  );
  return { presenter, messages, statuses, activities, reviewScopes };
}

test('AgentTurnPresenter: direct assistant messages bypass synthetic progress and internal notes but retain run evidence', () => {
  const fixture = createPresenter();
  fixture.presenter.beginResponse({
    prompt: '说明gpu cpu',
    presentation: 'direct-response',
    sessionContinuationNote: '内部会话续接说明',
    autoDiscoveredNote: '内部自动发现说明',
  });
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    taskAction: 'respond',
    title: '说明gpu cpu',
  });
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    title: 'CPU 和 GPU 的区别',
  });

  assert.deepEqual(fixture.messages, [{
    type: 'startResponse',
    prompt: '说明gpu cpu',
    expectGeneratedArtifacts: false,
    agentMode: true,
    agentPresentation: 'direct-response',
  }]);
  assert.equal(fixture.statuses.length, 2);
  assert.equal(fixture.reviewScopes.length, 1);
});

test('AgentTurnPresenter: a real tool call promotes direct delivery to visible progress', () => {
  const fixture = createPresenter();
  fixture.presenter.beginResponse({ prompt: '解释当前 README', presentation: 'direct-response' });
  fixture.presenter.postToolActivity('label', '准备读取上下文');
  assert.equal(fixture.messages.length, 1);

  fixture.presenter.postToolActivity('read', 'README.md');
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    taskAction: 'explore',
    title: '已读取 README.md',
  });

  assert.equal(fixture.activities.length, 2);
  assert.equal(fixture.messages[1].type, 'agentToolActivity');
  assert.equal(fixture.messages[1].activityKind, 'read');
  assert.equal(fixture.messages[2].type, 'agentStatus');
  assert.equal(fixture.messages[2].phase, 'done');
});

test('AgentTurnPresenter: model-led waits for concrete actions instead of local task-family progress', () => {
  const fixture = createPresenter();
  fixture.presenter.beginResponse({
    prompt: '把这句话总结成五个字：今天测试全部通过',
    presentation: 'model-led',
  });
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'plan',
    state: 'completed',
    taskAction: 'explore',
    title: '本地预测的工程任务',
  });
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'done',
    state: 'completed',
    taskAction: 'respond',
    title: '测试全部通过',
  });

  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].agentPresentation, 'model-led');
  assert.equal(fixture.messages[0].expectGeneratedArtifacts, false);
  assert.equal(fixture.statuses.length, 2);
});

test('AgentTurnPresenter: progress presentation remains visible before tools run', () => {
  const fixture = createPresenter();
  fixture.presenter.beginResponse({ prompt: '修复 src/main.ts', presentation: 'progress' });
  fixture.presenter.postStatus({
    type: 'agentStatus',
    phase: 'plan',
    state: 'started',
    title: '正在理解当前请求',
  });

  assert.equal(fixture.messages[0].agentPresentation, 'progress');
  assert.equal(fixture.messages[0].expectGeneratedArtifacts, true);
  assert.equal(fixture.messages[1].type, 'agentStatus');
});
