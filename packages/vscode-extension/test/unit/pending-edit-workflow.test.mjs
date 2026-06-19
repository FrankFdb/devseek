/**
 * Unit tests for pending-edit workflow pure logic.
 *
 * Phase 5 boundary: hunk computation/rendering lives in PendingEditService,
 * not in extension.ts or duplicated test mirrors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/pending-edit-workflow.bundle.cjs');

execSync(
  `npx esbuild src/app/pending-edit-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  allHunksResolved,
  computePendingHunks,
  renderPendingContentFromHunks,
} = req(bundlePath);

test('computePendingHunks: pure addition, deletion, and replacement', () => {
  const addition = computePendingHunks('add', 'line1\nline2', 'line1\nnew\nline2');
  assert.equal(addition.length, 1);
  assert.deepEqual(addition[0].oldLines, []);
  assert.deepEqual(addition[0].newLines, ['new']);

  const deletion = computePendingHunks('del', 'line1\nto-delete\nline2', 'line1\nline2');
  assert.equal(deletion.length, 1);
  assert.deepEqual(deletion[0].oldLines, ['to-delete']);
  assert.deepEqual(deletion[0].newLines, []);

  const replacement = computePendingHunks('rep', 'a\nb\nc', 'a\nX\nc');
  assert.equal(replacement.length, 1);
  assert.deepEqual(replacement[0].oldLines, ['b']);
  assert.deepEqual(replacement[0].newLines, ['X']);
});

test('computePendingHunks: multiple disjoint hunks are ordered and stable', () => {
  const hunks = computePendingHunks('multi', 'a\nb\nc\nd\ne', 'A\nb\nc\nd\nE');

  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks.map(h => h.id), ['multi-h1', 'multi-h2']);
  assert.deepEqual(hunks.map(h => h.index), [1, 2]);
  assert.deepEqual(hunks.map(h => h.title), ['修改点 1', '修改点 2']);
});

test('renderPendingContentFromHunks: pending and kept hunks render new content', () => {
  const hunks = computePendingHunks('render-keep', 'line1\nold\nline3', 'line1\nNEW\nline3');

  assert.equal(
    renderPendingContentFromHunks({ oldContent: 'line1\nold\nline3', hunks }),
    'line1\nNEW\nline3',
  );

  hunks[0].resolution = 'kept';
  assert.equal(
    renderPendingContentFromHunks({ oldContent: 'line1\nold\nline3', hunks }),
    'line1\nNEW\nline3',
  );
});

test('renderPendingContentFromHunks: undone hunks restore original content', () => {
  const hunks = computePendingHunks('render-undo', 'foo\nbar\nbaz', 'foo\nXXX\nbaz');
  hunks[0].resolution = 'undone';

  assert.equal(
    renderPendingContentFromHunks({ oldContent: 'foo\nbar\nbaz', hunks }),
    'foo\nbar\nbaz',
  );
  assert.equal(allHunksResolved({ hunks }), true);
});

test('renderPendingContentFromHunks: mixed hunk resolutions are applied in old-file order', () => {
  const hunks = computePendingHunks('mixed', 'a\nb\nc\nd', 'A\nb\nC\nd');
  hunks[0].resolution = 'kept';
  hunks[1].resolution = 'undone';

  assert.equal(
    renderPendingContentFromHunks({ oldContent: 'a\nb\nc\nd', hunks }),
    'A\nb\nc\nd',
  );
  assert.equal(allHunksResolved({ hunks }), true);
});

test('allHunksResolved: only all non-pending hunks resolve the record', () => {
  assert.equal(allHunksResolved({ hunks: [] }), false);
  assert.equal(allHunksResolved({ hunks: [{ resolution: 'pending' }] }), false);
  assert.equal(allHunksResolved({ hunks: [{ resolution: 'kept' }, { resolution: 'pending' }] }), false);
  assert.equal(allHunksResolved({ hunks: [{ resolution: 'kept' }, { resolution: 'undone' }] }), true);
});

console.log('\nPending edit workflow tests passed.\n');
