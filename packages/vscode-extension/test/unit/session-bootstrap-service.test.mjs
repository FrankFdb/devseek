import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bootstrapBundlePath = path.join(rootDir, 'test/unit/session-bootstrap-service.bundle.cjs');
const serviceBundlePath = path.join(rootDir, 'test/unit/session-bootstrap-session-service.bundle.cjs');
const persistenceBundlePath = path.join(rootDir, 'test/unit/session-persistence-coordinator.bundle.cjs');

execSync(
  `npx esbuild src/app/session-bootstrap-service.ts --bundle ` +
  `--outfile=${bootstrapBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/session-service.ts --bundle ` +
  `--outfile=${serviceBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/session-persistence-coordinator.ts --bundle ` +
  `--outfile=${persistenceBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildSessionBootstrapState } = req(bootstrapBundlePath);
const { SessionService } = req(serviceBundlePath);
const { SessionPersistenceCoordinator } = req(persistenceBundlePath);

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

test('Session bootstrap: restores the valid active session after a simulated restart', async () => {
  const store = createStore();
  const beforeRestart = new SessionService(store);
  beforeRestart.saveSessionMeta({ id: 'session-a', title: 'Refactor', createdAt: 1 });
  beforeRestart.setActiveSessionId('session-a');
  beforeRestart.saveSessionHistory('session-a', [{ role: 'user', content: 'continue' }]);
  beforeRestart.saveSessionFiles('session-a', { service: '/workspace/src/service.ts' });
  beforeRestart.saveSessionAnalysisText('session-a', 'The service boundary is ready.');
  await beforeRestart.flush();

  const afterRestart = new SessionService(store);
  const bootstrap = buildSessionBootstrapState({ sessionService: afterRestart });

  assert.deepEqual(bootstrap, {
    activeSessionId: 'session-a',
    files: { service: '/workspace/src/service.ts' },
    history: [],
    analysisText: 'The service boundary is ready.',
    restoreAgentPathsForSessionId: 'session-a',
  });
  assert.deepEqual(afterRestart.loadSessionState('session-a').history, [
    { role: 'user', content: 'continue' },
  ]);
});

test('Session bootstrap: replaces a stale active id with an empty session', async () => {
  const store = createStore();
  const beforeRestart = new SessionService(store);
  beforeRestart.setActiveSessionId('deleted-session');
  beforeRestart.saveSessionFiles('deleted-session', { stale: '/workspace/stale.ts' });
  await beforeRestart.flush();

  const afterRestart = new SessionService(store);
  const bootstrap = buildSessionBootstrapState({ sessionService: afterRestart });

  assert.notEqual(bootstrap.activeSessionId, 'deleted-session');
  assert.equal(afterRestart.getActiveSessionId(), bootstrap.activeSessionId);
  assert.deepEqual(bootstrap.files, {});
  assert.deepEqual(bootstrap.history, []);
  assert.equal(bootstrap.analysisText, '');
  assert.equal(bootstrap.restoreAgentPathsForSessionId, undefined);
});

test('Session persistence: synthetic restart context is excluded from durable history and metadata', async () => {
  const store = createStore();
  const service = new SessionService(store);
  service.saveSessionMeta({ id: 'session-a', title: 'Continue', createdAt: 1 });
  const history = [
    { role: 'user', content: '[上次会话背景，请基于此继续工作]\nsummary' },
    { role: 'assistant', content: '好的，我已了解上次的工作进展，可以继续。' },
    ...Array.from({ length: 42 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    })),
  ];
  const files = new Map([['src/main.ts', '/workspace/src/main.ts']]);
  const persistence = new SessionPersistenceCoordinator({
    getSessionService: () => service,
    getActiveSessionId: () => 'session-a',
    getHistory: () => history,
    getRecentFiles: () => files,
    routeCompaction: async () => '',
  });

  persistence.saveCurrentSession();
  await service.flush();

  const persisted = service.loadSessionState('session-a');
  assert.equal(persisted.history.length, 40);
  assert.equal(persisted.history[0].content, 'message-2');
  assert.deepEqual(persisted.files, { 'src/main.ts': '/workspace/src/main.ts' });
  assert.equal(service.getSessions()[0].messageCount, 21);
});

test('Session persistence: only SessionService owns storage key construction', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const bootstrapSource = readFileSync(path.join(rootDir, 'src/app/session-bootstrap-service.ts'), 'utf8');
  const persistenceSource = readFileSync(path.join(rootDir, 'src/app/session-persistence-coordinator.ts'), 'utf8');
  const serviceSource = readFileSync(path.join(rootDir, 'src/app/session-service.ts'), 'utf8');

  assert.doesNotMatch(extensionSource, /deepseek\.session\./);
  assert.doesNotMatch(bootstrapSource, /deepseek\.session\./);
  assert.doesNotMatch(persistenceSource, /deepseek\.session\./);
  assert.match(serviceSource, /return `deepseek\.session\.\$\{id\}\.\$\{suffix\}`/);
  assert.match(extensionSource, /new SessionPersistenceCoordinator\(\{/);
  assert.match(persistenceSource, /const durableHistory = stripSessionContextPrefix\(history\)/);
  assert.match(persistenceSource, /saveSessionHistory\(sessionId, durableHistory\.slice\(-40\)\)/);
});

console.log('\nSession bootstrap service tests passed.\n');
