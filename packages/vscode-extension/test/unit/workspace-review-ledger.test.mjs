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
  ledger.recordQualityGate({
    status: 'fail',
    summary: 'QualityGate 未通过：自动验证失败。',
    evidenceRefs: ['validation:failed:npm test'],
    risks: ['编译失败，不能完成。'],
    requiredActions: ['修复 TypeScript 编译错误。'],
  });
  ledger.addUnfinishedItem('修复 TypeScript 编译错误');

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.files.changedPaths, ['src/app.ts']);
  assert.equal(snapshot.validation.ran, true);
  assert.equal(snapshot.validation.ok, false);
  assert.equal(snapshot.validation.command, 'npm test');
  assert.equal(snapshot.validation.exitCode, 1);
  assert.deepEqual(snapshot.validation.failureFiles, ['src/app.ts']);
  assert.equal(snapshot.qualityGate.status, 'fail');
  assert.deepEqual(snapshot.qualityGate.evidenceRefs, ['validation:failed:npm test']);
  assert.deepEqual(snapshot.unfinishedItems, ['修复 TypeScript 编译错误']);
});

test('ReviewLedger: skipped validation keeps explicit reason and blocked quality gate', () => {
  const ledger = new ReviewLedger();
  ledger.recordValidationSkipped('no-auto-target');

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.validation, {
    ran: false,
    ok: null,
    command: '',
    exitCode: null,
    cwd: '',
    reason: 'no-auto-target',
    summary: '未执行自动验证: no-auto-target',
    failureFiles: [],
  });
  assert.equal(snapshot.qualityGate.status, 'blocked');
  assert.match(snapshot.qualityGate.summary, /未评估/);
});

test('ReviewLedger: records accepted QualityGate risk source', () => {
  const ledger = new ReviewLedger();
  ledger.recordQualityGate({
    status: 'blocked',
    summary: 'QualityGate 阻塞：无自动验证目标。',
    evidenceRefs: ['validation:blocked:no-auto-validation-target'],
    risks: ['无法证明运行时行为正确。'],
    alternativeChecks: ['人工检查文档内容。'],
    requiredActions: ['用户确认风险后继续。'],
    acceptedRisk: { source: 'user', note: '仅文档变更', acceptedAt: 123 },
  });

  assert.deepEqual(ledger.snapshot().qualityGate.acceptedRisk, {
    source: 'user',
    note: '仅文档变更',
    acceptedAt: 123,
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
