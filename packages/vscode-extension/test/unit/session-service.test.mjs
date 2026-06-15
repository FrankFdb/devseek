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

test('SessionService: delete removes meta and per-session keys', () => {
  const store = createStore();
  const service = new SessionService(store);
  service.saveSessionMeta({ id: 'a', title: 'A', createdAt: 1 });
  store.update('deepseek.session.a.history', ['x']);
  service.deleteSession('a');
  assert.deepEqual(service.getSessions(), []);
  assert.equal(store.data.has('deepseek.session.a.history'), false);
});

console.log('\nSession service tests passed.\n');
