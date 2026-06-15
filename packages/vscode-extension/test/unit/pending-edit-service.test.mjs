import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/pending-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/app/pending-edit-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { PendingEditService } = req(bundlePath);

test('PendingEditService: stores and removes records by id', () => {
  const service = new PendingEditService();
  service.set('1', { id: '1', path: 'src/a.ts', createdAt: 1 });
  assert.equal(service.has('1'), true);
  assert.equal(service.get('1').path, 'src/a.ts');
  service.delete('1');
  assert.equal(service.has('1'), false);
});

test('PendingEditService: finds latest record by normalized path', () => {
  const service = new PendingEditService();
  service.set('1', { id: '1', path: './src/a.ts', createdAt: 1 });
  service.set('2', { id: '2', path: 'src/a.ts', createdAt: 2 });
  const found = service.findLatestByPath('src/a.ts', p => p.replace(/^\.\//, ''));
  assert.equal(found.id, '2');
});

test('PendingEditService: clear removes all records', () => {
  const service = new PendingEditService();
  service.set('1', { id: '1', path: 'a', createdAt: 1 });
  service.set('2', { id: '2', path: 'b', createdAt: 2 });
  service.clear();
  assert.equal(Array.from(service.values()).length, 0);
});

console.log('\nPending edit service tests passed.\n');
