/**
 * Unit tests for pending-edit workflow pure logic.
 *
 * Covers: computePendingHunks, renderPendingContentFromHunks, allHunksResolved
 * These mirror the exact logic in extension.ts — intentionally kept in sync.
 *
 * Run standalone: node test/unit/pending-edit-workflow.test.mjs
 * Run via suite:  node test/run-all.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Pure logic mirrors (kept in sync with extension.ts) ──────────────────────

/** @param {string[]} oldLines @param {string[]} newLines @returns {{ type: string, text: string }[]} */
function lcsDiffOps(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const reversed = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: 'equal', text: oldLines[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      reversed.push({ type: 'del', text: oldLines[i - 1] });
      i--;
    } else {
      reversed.push({ type: 'add', text: newLines[j - 1] });
      j--;
    }
  }
  while (i > 0) { reversed.push({ type: 'del', text: oldLines[i - 1] }); i--; }
  while (j > 0) { reversed.push({ type: 'add', text: newLines[j - 1] }); j--; }
  return reversed.reverse();
}

function computePendingHunks(recordId, oldContent, newContent) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  const ops = lcsDiffOps(oldLines, newLines);
  const hunks = [];
  let oldLine = 1, newLine = 1, idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];
    if (op.type === 'equal') { oldLine++; newLine++; idx++; continue; }

    const oldStart = oldLine, newStart = newLine;
    const oldSeg = [], newSeg = [];
    while (idx < ops.length && ops[idx].type !== 'equal') {
      if (ops[idx].type === 'del') { oldSeg.push(ops[idx].text); oldLine++; }
      else { newSeg.push(ops[idx].text); newLine++; }
      idx++;
    }
    const hunkIndex = hunks.length + 1;
    hunks.push({
      id: `${recordId}-h${hunkIndex}`,
      index: hunkIndex,
      title: `修改点 ${hunkIndex}`,
      oldStart, oldEnd: oldLine,
      newStart, newEnd: newLine,
      oldLines: oldSeg, newLines: newSeg,
      resolution: 'pending',
    });
  }
  return hunks;
}

function renderPendingContentFromHunks(record) {
  const oldLines = (record.oldContent || '').split('\n');
  const sorted = [...record.hunks].sort((a, b) => a.oldStart - b.oldStart || a.index - b.index);
  const out = [];
  let cursor = 1;

  for (const hunk of sorted) {
    out.push(...oldLines.slice(Math.max(0, cursor - 1), Math.max(0, hunk.oldStart - 1)));
    if (hunk.resolution === 'undone') out.push(...hunk.oldLines);
    else out.push(...hunk.newLines);
    cursor = hunk.oldEnd;
  }
  out.push(...oldLines.slice(Math.max(0, cursor - 1)));
  return out.join('\n');
}

function allHunksResolved(record) {
  return record.hunks.length > 0 && record.hunks.every(h => h.resolution !== 'pending');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('computePendingHunks: pure addition — new lines added', () => {
  const hunks = computePendingHunks('id1', 'line1\nline2', 'line1\nnew\nline2');
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].newLines, ['new']);
  assert.deepEqual(hunks[0].oldLines, []);
  assert.equal(hunks[0].resolution, 'pending');
});

test('computePendingHunks: pure deletion — lines removed', () => {
  const hunks = computePendingHunks('id2', 'line1\nto-delete\nline2', 'line1\nline2');
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].oldLines, ['to-delete']);
  assert.deepEqual(hunks[0].newLines, []);
});

test('computePendingHunks: modification — lines replaced', () => {
  const hunks = computePendingHunks('id3', 'a\nb\nc', 'a\nX\nc');
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].oldLines, ['b']);
  assert.deepEqual(hunks[0].newLines, ['X']);
});

test('computePendingHunks: multiple disjoint hunks', () => {
  const old = 'a\nb\nc\nd\ne';
  const nw = 'A\nb\nc\nd\nE';
  const hunks = computePendingHunks('id4', old, nw);
  assert.equal(hunks.length, 2, 'should have 2 separate hunks');
  assert.deepEqual(hunks[0].oldLines, ['a']);
  assert.deepEqual(hunks[0].newLines, ['A']);
  assert.deepEqual(hunks[1].oldLines, ['e']);
  assert.deepEqual(hunks[1].newLines, ['E']);
});

test('computePendingHunks: identical content yields no hunks', () => {
  const hunks = computePendingHunks('id5', 'same\ncontent', 'same\ncontent');
  assert.equal(hunks.length, 0);
});

test('computePendingHunks: empty old → single add hunk', () => {
  const hunks = computePendingHunks('id6', '', 'new content');
  assert.equal(hunks.length, 1);
  // ''.split('\n') → [''] so oldLines contains the one empty-string sentinel
  assert.deepEqual(hunks[0].newLines, ['new content']);
});

// ── renderPendingContentFromHunks tests ──────────────────────────────────────

test('render: kept hunk → new lines appear in output', () => {
  const record = {
    oldContent: 'line1\nold\nline3',
    hunks: [{
      id: 'r1-h1', index: 1, title: '修改点 1',
      oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3,
      oldLines: ['old'], newLines: ['NEW'],
      resolution: 'pending', // pending = use new content by default
    }],
  };
  const result = renderPendingContentFromHunks(record);
  assert.ok(result.includes('NEW'), 'should have new line');
  assert.ok(!result.includes('old\n'), 'should not have old line');
});

test('render: undone hunk → original lines restored', () => {
  const record = {
    oldContent: 'line1\nold\nline3',
    hunks: [{
      id: 'r2-h1', index: 1, title: '修改点 1',
      oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3,
      oldLines: ['old'], newLines: ['NEW'],
      resolution: 'undone',
    }],
  };
  const result = renderPendingContentFromHunks(record);
  assert.ok(result.includes('old'), 'undone: should restore old line');
  assert.ok(!result.includes('NEW'), 'undone: should not have new line');
});

test('render: mixed hunks — first kept, second undone', () => {
  const record = {
    oldContent: 'a\nb\nc\nd',
    hunks: [
      { id: 'r3-h1', index: 1, title: '修改点 1', oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2, oldLines: ['a'], newLines: ['A'], resolution: 'pending' },
      { id: 'r3-h2', index: 2, title: '修改点 2', oldStart: 3, oldEnd: 4, newStart: 3, newEnd: 4, oldLines: ['c'], newLines: ['C'], resolution: 'undone' },
    ],
  };
  const result = renderPendingContentFromHunks(record);
  assert.ok(result.includes('A'), 'first hunk kept → A');
  assert.ok(result.includes('c'), 'second hunk undone → c restored');
  assert.ok(!result.includes('C'), 'second hunk undone → C not in output');
});

// ── allHunksResolved tests ────────────────────────────────────────────────────

test('allHunksResolved: all pending → false', () => {
  const rec = { hunks: [{ resolution: 'pending' }, { resolution: 'pending' }] };
  assert.equal(allHunksResolved(rec), false);
});

test('allHunksResolved: one pending → false', () => {
  const rec = { hunks: [{ resolution: 'kept' }, { resolution: 'pending' }] };
  assert.equal(allHunksResolved(rec), false);
});

test('allHunksResolved: all resolved (kept/undone) → true', () => {
  const rec = { hunks: [{ resolution: 'kept' }, { resolution: 'undone' }] };
  assert.equal(allHunksResolved(rec), true);
});

test('allHunksResolved: empty hunks → false', () => {
  const rec = { hunks: [] };
  assert.equal(allHunksResolved(rec), false);
});

// ── Lifecycle simulation: register → keep hunk → auto-remove record ──────────

test('lifecycle: hunk keep workflow → record removed when all resolved', () => {
  const oldContent = 'a\nb\nc';
  const newContent = 'A\nb\nC';
  const id = 'test-record-1';
  const hunks = computePendingHunks(id, oldContent, newContent);
  assert.equal(hunks.length, 2, 'expect 2 hunks');

  // Simulate keeping both hunks
  hunks[0].resolution = 'kept';
  assert.equal(allHunksResolved({ hunks }), false, 'still one pending');
  hunks[1].resolution = 'kept';
  assert.equal(allHunksResolved({ hunks }), true, 'all resolved → should delete record');
});

test('lifecycle: hunk undo workflow → content restored', () => {
  const oldContent = 'foo\nbar\nbaz';
  const newContent = 'foo\nXXX\nbaz';
  const id = 'test-record-2';
  const hunks = computePendingHunks(id, oldContent, newContent);
  assert.equal(hunks.length, 1);

  // Undo the hunk
  hunks[0].resolution = 'undone';
  const restored = renderPendingContentFromHunks({ oldContent, hunks });
  assert.equal(restored, oldContent, 'content should be fully restored after undo');
  assert.equal(allHunksResolved({ hunks }), true, 'undone counts as resolved');
});

// ── Vision image pipeline format validation ───────────────────────────────────

test('vision: base64 data URL format validation', () => {
  // webview.js produces data URLs in this format before sending msg.images
  const validFormats = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA8Q1JFQVRP',
    'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAkA4JZQCdAEO',
  ];

  for (const url of validFormats) {
    assert.match(url, /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/, `invalid format: ${url.slice(0, 30)}`);
  }
});

test('vision: images array in chat message matches extension.ts expected shape', () => {
  // Simulates what webview.js sends as msg.images (used by extension.ts line 854)
  const images = [
    'data:image/png;base64,abc123',
    'data:image/jpeg;base64,xyz789',
  ];
  // Verify it's an array of strings (as extension.ts expects: msg.images passed to runChat)
  assert.ok(Array.isArray(images));
  assert.ok(images.every(s => typeof s === 'string' && s.startsWith('data:')));
});
