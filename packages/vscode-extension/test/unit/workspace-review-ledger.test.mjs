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
  createChangeSetFromActions,
  extractFailureFilePaths,
  normalizeDeliveryManifest,
  normalizeIndependentReviewRecord,
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

test('R2-06A ChangeSet derives symbol intent from planned ChangeActions', () => {
  const oldContent = [
    'export function settleTask(state: string) {',
    '  return state;',
    '}',
    '',
  ].join('\n');
  const newContent = [
    'export function settleTask(state: string) {',
    "  return state === 'done' ? 'settled' : state;",
    '}',
    '',
  ].join('\n');

  const changeSet = createChangeSetFromActions([
    {
      action: {
        type: 'overwrite-file',
        path: 'src/app/task-settlement.ts',
        confidence: 'high',
        reason: 'changeplan-r2-06a',
        language: 'typescript',
        content: newContent,
      },
      existed: true,
      oldContent,
      newContent,
      evidenceIds: ['ev-changeplan-r2-06a'],
    },
  ], {
    revisionId: 'plan-r2-06a',
    paths: ['src/app/task-settlement.ts'],
    symbols: [{ path: 'src/app/task-settlement.ts', name: 'settleTask', kind: 'function' }],
  });

  assert.equal(changeSet.requiresPlanRevision(), false);
  assert.equal(changeSet.changes[0].scope, 'symbol');
  assert.deepEqual(changeSet.changes[0].plan, {
    revisionId: 'plan-r2-06a',
    actionType: 'overwrite-file',
    confidence: 'high',
    reason: 'changeplan-r2-06a',
    evidenceIds: ['ev-changeplan-r2-06a'],
    scopeStatus: 'in-plan',
    revisionRequired: false,
  });
  assert.deepEqual(changeSet.symbolSummary(), {
    total: 1,
    added: 0,
    modified: 1,
    removed: 0,
    changedSymbols: [{
      path: 'src/app/task-settlement.ts',
      name: 'settleTask',
      kind: 'function',
      changeType: 'modified',
      evidenceIds: ['ev-changeplan-r2-06a'],
    }],
    revisionRequiredPaths: [],
  });
});

test('R2-06A ChangeSet marks unplanned symbol changes as requiring a plan revision', () => {
  const oldContent = [
    'export function settleTask(state: string) {',
    '  return state;',
    '}',
    '',
  ].join('\n');
  const newContent = [
    'export function settleTask(state: string) {',
    "  return state === 'done' ? 'settled' : state;",
    '}',
    '',
    'export class ParallelSettlementOwner {}',
    '',
  ].join('\n');

  const changeSet = createChangeSetFromActions([
    {
      action: {
        type: 'overwrite-file',
        path: 'src/app/task-settlement.ts',
        confidence: 'high',
        reason: 'changeplan-r2-06a',
        language: 'typescript',
        content: newContent,
      },
      existed: true,
      oldContent,
      newContent,
      evidenceIds: ['ev-changeplan-r2-06a'],
    },
  ], {
    revisionId: 'plan-r2-06a',
    paths: ['src/app/task-settlement.ts'],
    symbols: [{ path: 'src/app/task-settlement.ts', name: 'settleTask', kind: 'function' }],
  });

  assert.equal(changeSet.requiresPlanRevision(), true);
  assert.equal(changeSet.changes[0].plan.scopeStatus, 'out-of-plan');
  assert.deepEqual(changeSet.symbolSummary().revisionRequiredPaths, ['src/app/task-settlement.ts']);
  assert.ok(changeSet.symbolSummary().changedSymbols.some(symbol => (
    symbol.name === 'ParallelSettlementOwner'
    && symbol.kind === 'class'
    && symbol.changeType === 'added'
  )));
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
  assert.equal(snapshot.symbols.total, 1);
  assert.equal(snapshot.symbols.modified, 1);
  assert.equal(snapshot.validation.ran, true);
  assert.equal(snapshot.validation.ok, false);
  assert.equal(snapshot.validation.command, 'npm test');
  assert.equal(snapshot.validation.exitCode, 1);
  assert.deepEqual(snapshot.validation.failureFiles, ['src/app.ts']);
  assert.equal(snapshot.qualityGate.status, 'fail');
  assert.deepEqual(snapshot.qualityGate.evidenceRefs, ['validation:failed:npm test']);
  assert.equal(snapshot.independentReview.status, 'blocked');
  assert.match(snapshot.independentReview.summary, /Independent review blocked/);
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

test('R2-09A ReviewLedger: independent review rejects writer or completion judge self-review', () => {
  const selfReview = normalizeIndependentReviewRecord({
    reviewerId: 'agent-writer',
    writerId: 'agent-writer',
    completionJudgeId: 'quality-gate',
    contextRefs: ['contract:task', 'diff:changeset', 'validation:npm test'],
    findings: [],
  });
  const judgeReview = normalizeIndependentReviewRecord({
    reviewerId: 'quality-gate',
    writerId: 'agent-writer',
    completionJudgeId: 'quality-gate',
    contextRefs: ['contract:task', 'diff:changeset', 'validation:npm test'],
    findings: [],
  });

  assert.equal(selfReview.status, 'blocked');
  assert.equal(judgeReview.status, 'blocked');
  assert.deepEqual(selfReview.independence.roles, {
    reviewerId: 'agent-writer',
    writerId: 'agent-writer',
    completionJudgeId: 'quality-gate',
  });
  assert.ok(selfReview.risks.some(risk => /reviewer.*writer/i.test(risk)));
  assert.ok(judgeReview.risks.some(risk => /completion judge/i.test(risk)));
});

test('R2-09A ReviewLedger: P0 or P1 findings block independent review completion', () => {
  const blocked = normalizeIndependentReviewRecord({
    reviewerId: 'agent-reviewer',
    writerId: 'agent-writer',
    completionJudgeId: 'quality-gate',
    contextRefs: ['contract:task', 'diff:changeset', 'validation:npm test', 'risk:manifest'],
    findings: [
      {
        id: 'finding-p1-missing-test',
        severity: 'P1',
        summary: 'Changed validation semantics without a targeted oracle.',
        evidenceRefs: ['diff:quality-gate-service', 'validation:npm test'],
      },
    ],
  });
  const passed = normalizeIndependentReviewRecord({
    reviewerId: 'agent-reviewer',
    writerId: 'agent-writer',
    completionJudgeId: 'quality-gate',
    contextRefs: ['contract:task', 'diff:changeset', 'validation:npm test', 'risk:manifest'],
    findings: [
      {
        id: 'finding-p2-follow-up',
        severity: 'P2',
        summary: 'Consider adding a broader smoke case later.',
        evidenceRefs: ['risk:manifest'],
      },
    ],
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.findingCounts.P0, 0);
  assert.equal(blocked.findingCounts.P1, 1);
  assert.match(blocked.summary, /P0=0\/P1=0/);
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.findingCounts, { P0: 0, P1: 0, P2: 1, P3: 0 });

  const ledger = new ReviewLedger();
  ledger.recordIndependentReview(passed);
  assert.equal(ledger.snapshot().independentReview.status, 'passed');
});

test('R2-09C ReviewLedger: delivery manifest blocks completion claims without acceptance evidence or refusal', () => {
  const manifest = normalizeDeliveryManifest({
    completionClaimed: true,
    changedPaths: ['src/app.ts'],
    verified: [{
      evidenceRef: 'validation:passed:npm test',
      command: 'npm test',
      status: 'passed',
    }],
    acceptances: [{
      id: 'acc-runtime',
      summary: 'Runtime behavior is validated.',
      status: 'satisfied',
    }],
  });

  assert.equal(manifest.version, 'devseek.delivery-manifest/v1');
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.falseCompletionRisk, true);
  assert.deepEqual(manifest.acceptances.map(acceptance => acceptance.id), ['acc-runtime']);
  assert.match(manifest.requiredActions.join('\n'), /evidence or refusal/i);

  const defaultLedger = new ReviewLedger();
  assert.equal(defaultLedger.snapshot().deliveryManifest.status, 'blocked');
});

test('R2-09C ReviewLedger: delivery manifest records changed, verified, not-run, risks and follow-ups', () => {
  const ledger = new ReviewLedger();
  ledger.recordDeliveryManifest({
    completionClaimed: true,
    changedPaths: ['src/app.ts', 'test/app.test.ts', 'src/app.ts'],
    verified: [{
      evidenceRef: 'validation:passed:npm test',
      command: 'npm test',
      status: 'passed',
    }],
    notRun: [{
      scope: 'controlled-vsix',
      reason: 'deterministic ledger-only change; release smoke covers VSIX later',
      evidenceRef: 'validation:not-run:controlled-vsix',
    }],
    risks: ['Manual UI behavior remains release-smoke only.'],
    followUps: ['R2-09D-GIT-CI-PR'],
    acceptances: [
      {
        id: 'acc-changed',
        summary: 'Changed files are listed.',
        status: 'satisfied',
        evidenceRefs: ['diff:src/app.ts', 'diff:test/app.test.ts'],
      },
      {
        id: 'acc-verified',
        summary: 'Focused and full tests passed.',
        status: 'satisfied',
        evidenceRefs: ['validation:passed:npm test'],
      },
    ],
  });

  const manifest = ledger.snapshot().deliveryManifest;
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.falseCompletionRisk, false);
  assert.deepEqual(manifest.changed.paths, ['src/app.ts', 'test/app.test.ts']);
  assert.deepEqual(manifest.verified.map(item => item.evidenceRef), ['validation:passed:npm test']);
  assert.deepEqual(manifest.notRun.map(item => item.evidenceRef), ['validation:not-run:controlled-vsix']);
  assert.deepEqual(manifest.risks, ['Manual UI behavior remains release-smoke only.']);
  assert.deepEqual(manifest.followUps, ['R2-09D-GIT-CI-PR']);
  assert.deepEqual(manifest.requiredActions, []);
});

console.log('\nWorkspace review ledger tests passed.\n');
