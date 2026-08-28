import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/single-file-patch.bundle.cjs');
execFileSync('npx', [
  'esbuild',
  'src/agent/single-file-patch.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const { applySingleFilePatch } = createRequire(import.meta.url)(bundlePath);

function patch(pathValue, body) {
  return [
    '*** Begin Patch',
    `*** Update File: ${pathValue}`,
    ...body,
    '*** End Patch',
  ].join('\n');
}

test('single-file patch applies a bounded replacement and insertion', () => {
  const original = [
    'void run() {',
    '  old_call();',
    '}',
    '',
    '} // namespace demo',
    '',
  ].join('\n');
  const result = applySingleFilePatch(original, patch('src/demo.cpp', [
    '@@',
    ' void run() {',
    '-  old_call();',
    '+  new_call();',
    ' }',
    '@@',
    ' }',
    ' ',
    '+void verify() {}',
    '+',
    ' } // namespace demo',
  ]), ['src/demo.cpp', '/workspace/src/demo.cpp']);

  assert.equal(result.content, [
    'void run() {',
    '  new_call();',
    '}',
    '',
    'void verify() {}',
    '',
    '} // namespace demo',
    '',
  ].join('\n'));
  assert.equal(result.addedLines, 3);
  assert.equal(result.removedLines, 1);
});

test('single-file patch preserves CRLF and accepts an exact absolute path alias', () => {
  const result = applySingleFilePatch(
    'first\r\nsecond\r\n',
    patch('/workspace/file.txt', ['@@ -1,2 +1,2 @@', ' first', '-second', '+changed']),
    ['/workspace/file.txt', 'file.txt'],
  );
  assert.equal(result.content, 'first\r\nchanged\r\n');
});

test('single-file patch preserves untouched mixed endings and separates EOF insertions', () => {
  const mixed = applySingleFilePatch(
    'first\r\nsecond\nthird',
    patch('file.txt', ['@@ -2,1 +2,1 @@', '-second', '+changed']),
    'file.txt',
  );
  assert.equal(mixed.content, 'first\r\nchanged\nthird');

  const eofInsertion = applySingleFilePatch(
    'first',
    patch('file.txt', ['@@', ' first', '+second']),
    'file.txt',
  );
  assert.equal(eofInsertion.content, 'first\nsecond');
});

test('single-file patch rejects ambiguous context and cross-file operations', () => {
  assert.throws(() => applySingleFilePatch(
    'same\nsame\n',
    patch('src/a.txt', ['@@', ' same', '+added']),
    'src/a.txt',
  ), /hunk-context-not-found-or-ambiguous/);

  assert.throws(() => applySingleFilePatch(
    'old\n',
    patch('src/b.txt', ['@@', '-old', '+new']),
    'src/a.txt',
  ), /patch-must-update-exactly-requested-file/);

  assert.throws(() => applySingleFilePatch(
    'old\n',
    [
      '*** Begin Patch',
      '*** Add File: src/a.txt',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n'),
    'src/a.txt',
  ), /patch-must-update-exactly-requested-file|unsupported-patch-operation/);

  assert.throws(() => applySingleFilePatch(
    'old',
    patch('src/a.txt', ['@@', '-old', '\\ No newline at end of file', '+new']),
    'src/a.txt',
  ), /unsupported-no-newline-marker/);
});
