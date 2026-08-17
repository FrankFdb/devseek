import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/session-service.bundle.cjs');

execSync(
  `npx esbuild src/app/session-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { SessionService } = req(bundlePath);

function createStore() {
  const data = new Map();
  return {
    data,
    get(key, defaultValue) {
      return data.has(key) ? data.get(key) : defaultValue;
    },
    update(key, value) {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
  };
}

function createDeferredStore() {
  const data = new Map();
  const pending = [];
  return {
    data,
    pending,
    get(key, defaultValue) {
      return data.has(key) ? data.get(key) : defaultValue;
    },
    update(key, value) {
      pending.push(() => {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      });
      return Promise.resolve();
    },
    flush() {
      for (const apply of pending.splice(0)) apply();
    },
  };
}

test('SessionService: saves newest session meta first and caps length', () => {
  const store = createStore();
  const service = new SessionService(store, 2);
  service.saveSessionMeta({ id: 'a', title: 'A', createdAt: 1 });
  service.saveSessionMeta({ id: 'b', title: 'B', createdAt: 2 });
  service.saveSessionMeta({ id: 'c', title: 'C', createdAt: 3 });
  assert.deepEqual(service.getSessions().map(s => s.id), ['c', 'b']);
});

test('SessionService: updates active session id', () => {
  const service = new SessionService(createStore());
  service.setActiveSessionId('abc');
  assert.equal(service.getActiveSessionId(), 'abc');
});

test('SessionService: patches existing metadata', () => {
  const service = new SessionService(createStore());
  service.saveSessionMeta({ id: 'a', title: 'A', createdAt: 1 });
  service.updateSessionMeta('a', { digest: 'done', messageCount: 3 });
  assert.equal(service.getSessions()[0].digest, 'done');
  assert.equal(service.getSessions()[0].messageCount, 3);
});

test('SessionService: round-trips isolated persisted state', () => {
  const store = createStore();
  const service = new SessionService(store);
  const history = [
    { role: 'user', content: 'continue the refactor' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'inspect this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ],
    },
  ];
  const files = { service: '/workspace/src/service.ts' };
  const agentState = { changedPaths: ['src/service.ts'], completed: false };

  service.saveSessionHistory('a', history);
  service.saveSessionFiles('a', files);
  service.saveSessionSummary('a', 'Refactor is in progress.');
  service.saveSessionAnalysisText('a', 'One owner remains.');
  service.saveSessionAgentState('a', agentState);

  history[0].content = 'mutated after save';
  history[1].content[1].image_url.url = 'mutated';
  files.service = '/wrong/path.ts';
  agentState.changedPaths.push('wrong.ts');

  const loaded = service.loadSessionState('a');
  assert.equal(loaded.history[0].content, 'continue the refactor');
  assert.equal(loaded.history[1].content[1].image_url.url, 'data:image/png;base64,abc');
  assert.deepEqual(loaded.files, { service: '/workspace/src/service.ts' });
  assert.equal(loaded.summary, 'Refactor is in progress.');
  assert.equal(loaded.analysisText, 'One owner remains.');
  assert.deepEqual(loaded.agentState, { changedPaths: ['src/service.ts'], completed: false });

  loaded.history[0].content = 'mutated after load';
  loaded.files.service = '/another/wrong/path.ts';
  loaded.agentState.changedPaths.push('another-wrong.ts');
  assert.equal(service.loadSessionState('a').history[0].content, 'continue the refactor');
  assert.deepEqual(service.loadSessionState('a').files, { service: '/workspace/src/service.ts' });
  assert.deepEqual(service.getSessionAgentState('a'), { changedPaths: ['src/service.ts'], completed: false });
});

test('SessionService: agent state has read-your-writes semantics before async persistence', async () => {
  const store = createDeferredStore();
  const service = new SessionService(store);
  const agentState = {
    semanticContract: { goal: 'implement the approved plan', mode: 'code' },
    changedPaths: ['src/service.ts'],
  };

  service.saveSessionAgentState('a', agentState);
  agentState.semanticContract.goal = 'mutated after save';

  assert.equal(store.data.has('deepseek.session.a.agentState'), false);
  assert.deepEqual(service.getSessionAgentState('a'), {
    semanticContract: { goal: 'implement the approved plan', mode: 'code' },
    changedPaths: ['src/service.ts'],
  });
  assert.deepEqual(service.loadSessionState('a').agentState, {
    semanticContract: { goal: 'implement the approved plan', mode: 'code' },
    changedPaths: ['src/service.ts'],
  });

  const loaded = service.getSessionAgentState('a');
  loaded.changedPaths.push('wrong.ts');
  assert.deepEqual(service.getSessionAgentState('a').changedPaths, ['src/service.ts']);

  await Promise.resolve();
  store.flush();
  await service.flush();
  assert.deepEqual(store.data.get('deepseek.session.a.agentState'), {
    semanticContract: { goal: 'implement the approved plan', mode: 'code' },
    changedPaths: ['src/service.ts'],
  });
});

test('SessionService: clearing agent state is immediately visible before persistence', () => {
  const store = createDeferredStore();
  store.data.set('deepseek.session.a.agentState', { completed: true });
  const service = new SessionService(store);

  service.saveSessionAgentState('a', null);

  assert.equal(service.getSessionAgentState('a'), undefined);
  assert.equal(service.loadSessionState('a').agentState, undefined);
  assert.deepEqual(store.data.get('deepseek.session.a.agentState'), { completed: true });
});

test('SessionService: keeps state isolated between sessions', () => {
  const service = new SessionService(createStore());
  service.saveSessionHistory('a', [{ role: 'user', content: 'session a' }]);
  service.saveSessionHistory('b', [{ role: 'user', content: 'session b' }]);
  service.saveSessionFiles('a', { a: '/workspace/a.ts' });
  service.saveSessionFiles('b', { b: '/workspace/b.ts' });

  assert.deepEqual(service.loadSessionState('a').history, [{ role: 'user', content: 'session a' }]);
  assert.deepEqual(service.loadSessionState('a').files, { a: '/workspace/a.ts' });
  assert.deepEqual(service.loadSessionState('b').history, [{ role: 'user', content: 'session b' }]);
  assert.deepEqual(service.loadSessionState('b').files, { b: '/workspace/b.ts' });
});

test('SessionService: delete removes meta and every persisted state field', async () => {
  const store = createStore();
  const service = new SessionService(store);
  service.saveSessionMeta({ id: 'a', title: 'A', createdAt: 1 });
  service.saveSessionHistory('a', [{ role: 'user', content: 'x' }]);
  service.saveSessionFiles('a', { x: '/workspace/x.ts' });
  service.saveSessionSummary('a', 'summary');
  service.saveSessionAnalysisText('a', 'analysis');
  service.saveSessionAgentState('a', { completed: true });
  service.deleteSession('a');
  await service.flush();
  assert.deepEqual(service.getSessions(), []);
  for (const suffix of ['history', 'files', 'summary', 'analysisText', 'agentState']) {
    assert.equal(store.data.has(`deepseek.session.a.${suffix}`), false, `${suffix} must be removed`);
  }
});

test('T5 SessionService: flush preserves ordered state for a restarted service', async () => {
  const store = createStore();
  const running = new SessionService(store);

  running.setActiveSessionId('restart-session');
  running.saveSessionMeta({ id: 'restart-session', title: 'Bridge repair', createdAt: 10 });
  running.saveSessionHistory('restart-session', [{ role: 'user', content: '继续修复 bridge' }]);
  running.saveSessionAgentState('restart-session', {
    taskId: 'task-bridge',
    status: 'paused',
    pendingTodos: ['重新运行验证'],
  });
  await running.flush();

  const restarted = new SessionService(store);
  assert.equal(restarted.getActiveSessionId(), 'restart-session');
  assert.deepEqual(restarted.getSessions().map(session => session.id), ['restart-session']);
  assert.deepEqual(restarted.loadSessionState('restart-session').agentState, {
    taskId: 'task-bridge',
    status: 'paused',
    pendingTodos: ['重新运行验证'],
  });
});

test('SessionService: ignores empty session ids', () => {
  const store = createStore();
  const service = new SessionService(store);
  service.saveSessionHistory('', [{ role: 'user', content: 'x' }]);
  service.saveSessionFiles('', { x: '/workspace/x.ts' });
  service.saveSessionSummary('', 'summary');
  service.saveSessionAnalysisText('', 'analysis');
  service.saveSessionAgentState('', { completed: true });
  service.deleteSession('');

  assert.deepEqual([...store.data.keys()], []);
  assert.deepEqual(service.loadSessionState(''), {
    history: [],
    files: {},
    summary: '',
    analysisText: '',
  });
  assert.equal(service.getSessionSummary(''), '');
  assert.equal(service.getSessionAgentState(''), undefined);
});

console.log('\nSession service tests passed.\n');
