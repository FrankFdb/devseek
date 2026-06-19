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
const {
  allHunksResolved,
  computePendingHunks,
  PendingEditService,
  renderPendingContentFromHunks,
} = req(bundlePath);

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

test('PendingEditService: computes disjoint pending hunks deterministically', () => {
  const hunks = computePendingHunks('r1', 'a\nb\nc\nd\ne', 'A\nb\nc\nd\nE');

  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks.map(h => h.id), ['r1-h1', 'r1-h2']);
  assert.deepEqual(hunks.map(h => h.oldLines), [['a'], ['e']]);
  assert.deepEqual(hunks.map(h => h.newLines), [['A'], ['E']]);
  assert.ok(hunks.every(h => h.resolution === 'pending'));
});

test('PendingEditService: renders kept and undone hunk resolutions in order', () => {
  const hunks = computePendingHunks('r2', 'a\nb\nc\nd', 'A\nb\nC\nd');
  hunks[0].resolution = 'kept';
  hunks[1].resolution = 'undone';

  const result = renderPendingContentFromHunks({ oldContent: 'a\nb\nc\nd', hunks });

  assert.equal(result, 'A\nb\nc\nd');
  assert.equal(allHunksResolved({ hunks }), true);
});

test('PendingEditService: pending hunk keeps record unresolved', () => {
  const hunks = computePendingHunks('r3', 'a\nb', 'A\nB');
  hunks[0].resolution = 'kept';

  assert.equal(allHunksResolved({ hunks }), true);
  hunks[0].resolution = 'pending';
  assert.equal(allHunksResolved({ hunks }), false);
});

console.log('\nPending edit service tests passed.\n');
