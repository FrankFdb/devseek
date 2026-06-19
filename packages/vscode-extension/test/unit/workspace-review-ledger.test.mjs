import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workspace-review-ledger.bundle.cjs');

execSync(
  `npx esbuild src/workspace/review-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  ReviewLedger,
  createChangeSet,
  extractFailureFilePaths,
  normalizeValidationRecord,
} = req(bundlePath);

test('ChangeSet: classifies creates, overwrites, and patches', () => {
  const changeSet = createChangeSet([
    { path: 'src/new.ts', existed: false, newContent: 'a\nb', actionType: 'create-file' },
    { path: 'src/existing.ts', existed: true, oldContent: 'old', newContent: 'new', actionType: 'overwrite-file' },
    { path: 'src/fix.ts', existed: true, oldContent: 'x', newContent: 'x\ny', actionType: 'patch-file' },
  ]);

  assert.deepEqual(changeSet.summary(), {
    total: 3,
    creates: 1,
    overwrites: 1,
    patches: 1,
    changedPaths: ['src/new.ts', 'src/existing.ts', 'src/fix.ts'],
  });
  assert.deepEqual(changeSet.changes.map(change => [change.path, change.kind]), [
    ['src/new.ts', 'create'],
    ['src/existing.ts', 'overwrite'],
    ['src/fix.ts', 'patch'],
  ]);
});

test('ReviewLedger: records files, validation evidence, and unfinished items', () => {
  const ledger = new ReviewLedger();
  const changeSet = createChangeSet([
    { path: 'src/app.ts', existed: true, oldContent: 'const a = 1;', newContent: 'const a = ;', actionType: 'overwrite-file' },
  ]);

  ledger.recordChangeSet(changeSet);
  ledger.recordValidation({
    ran: true,
    ok: false,
    command: 'npm test',
    exitCode: 1,
    output: 'src/app.ts:1:11 - error TS1109: Expression expected.',
    cwd: '/repo',
    mode: 'compile-only',
    reason: 'extension-change',
  });
  ledger.addUnfinishedItem('修复 TypeScript 编译错误');

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.files.changedPaths, ['src/app.ts']);
  assert.equal(snapshot.validation.ran, true);
  assert.equal(snapshot.validation.ok, false);
  assert.equal(snapshot.validation.command, 'npm test');
  assert.equal(snapshot.validation.exitCode, 1);
  assert.deepEqual(snapshot.validation.failureFiles, ['src/app.ts']);
  assert.deepEqual(snapshot.unfinishedItems, ['修复 TypeScript 编译错误']);
});

test('ReviewLedger: skipped validation keeps explicit reason', () => {
  const ledger = new ReviewLedger();
  ledger.recordValidationSkipped('no-auto-target');

  assert.deepEqual(ledger.snapshot().validation, {
    ran: false,
    ok: null,
    command: '',
    exitCode: null,
    cwd: '',
    reason: 'no-auto-target',
    summary: '未执行自动验证: no-auto-target',
    failureFiles: [],
  });
});

test('ReviewLedger: failure file extraction prefers changed paths', () => {
  assert.deepEqual(
    extractFailureFilePaths('/tmp/work/pkg/src/main.cpp:12: undefined reference', ['pkg/src/main.cpp']),
    ['pkg/src/main.cpp'],
  );
  assert.deepEqual(
    extractFailureFilePaths('pkg/src/main.cpp:12: undefined reference', ['', 'pkg/src/main.cpp']),
    ['pkg/src/main.cpp'],
  );
  assert.deepEqual(
    normalizeValidationRecord({
      ran: true,
      ok: true,
      command: 'npm run compile',
      exitCode: 0,
      output: '',
      cwd: '/repo',
    }, ['src/app.ts']).failureFiles,
    [],
  );
});

console.log('\nWorkspace review ledger tests passed.\n');
