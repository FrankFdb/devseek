import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/requirement-review-ledger.bundle.cjs');

execSync(
  `npx esbuild src/agent/requirement-review-ledger.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { RequirementReviewLedger } = createRequire(import.meta.url)(bundlePath);
const passedGate = { status: 'pass', summary: 'project tests passed' };
const sourceWrite = path => ({ path, basename: path, linesAdded: 1, linesRemoved: 0, action: 'edit' });

test('requirement review is scheduled once for each newly validated source mutation cohort', () => {
  const ledger = new RequirementReviewLedger();
  const firstWrites = [sourceWrite('include/cache.hpp'), sourceWrite('src/cache.cpp')];
  const first = ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: firstWrites,
    roundReadFiles: [],
  });
  assert.match(first, /通过可见测试只证明已覆盖行为/);
  assert.match(first, /时间回拨、状态迁移、重入、顺序、容量、边界值和异常路径/);
  assert.match(first, /调用方可观察且不与正常成功重叠的失败通道/);
  assert.match(first, /完成或取消后的再次使用/);
  assert.match(first, /数据结构和复杂度/);
  assert.match(first, /全新隔离上下文中的只读审查者/);
  assert.match(first, /不要自行创建临时 probe/);
  assert.match(first, /read_file/);
  assert.match(ledger.beforeNoToolCompletion(), /不能跳过需求覆盖复核/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: firstWrites,
    roundReadFiles: ['include/cache.hpp'],
  }), /src\/cache\.cpp/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: firstWrites,
    roundReadFiles: ['/workspace/include/cache.hpp', '/workspace/src/cache.cpp'],
  }), /最终源码已重新读取/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['include/cache.hpp', 'src/cache.cpp'],
  });
  assert.match(ledger.beforeNoToolCompletion(), /不能跳过独立需求审查/);
  assert.match(ledger.settleIndependentReview({
    status: 'passed',
    explanation: 'All stated requirements map to the final source.',
    findings: [],
  }), /独立需求审查：通过/);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);
  assert.equal(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: firstWrites,
    roundReadFiles: [],
  }), undefined);

  const repaired = ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [...firstWrites, sourceWrite('src/cache.cpp')],
    roundReadFiles: [],
  });
  assert.match(repaired, /src\/cache\.cpp/);
  assert.match(repaired, /全部已修改源码：include\/cache\.hpp、src\/cache\.cpp/);
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: [...firstWrites, sourceWrite('src/cache.cpp')],
    roundReadFiles: ['src/cache.cpp'],
  }), /最终源码已重新读取/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['include/cache.hpp', 'src/cache.cpp'],
  });
});

test('pending requirement review survives read-only rounds without a new quality gate', () => {
  const ledger = new RequirementReviewLedger();
  const writes = [sourceWrite('src/order_book.cpp')];
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: writes,
    roundReadFiles: [],
  }), /完成前需求覆盖复核/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: writes,
    roundReadFiles: ['src/order_book.cpp'],
  }), /最终源码已重新读取/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['src/order_book.cpp'],
  });
  assert.match(ledger.settleIndependentReview({
    status: 'passed',
    explanation: 'The implementation satisfies the contract.',
    findings: [],
  }), /独立需求审查：通过/);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);
});

test('failed independent review blocks completion until repaired source is revalidated', () => {
  const ledger = new RequirementReviewLedger();
  const firstWrite = sourceWrite('src/order_book.cpp');
  ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [firstWrite],
    roundReadFiles: [],
  });
  ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: [firstWrite],
    roundReadFiles: ['src/order_book.cpp'],
  });
  ledger.takeIndependentReviewCandidate();
  const failed = ledger.settleIndependentReview({
    status: 'failed',
    explanation: 'A used identity can be submitted again.',
    findings: [{
      requirementId: 'R2',
      requirement: 'Reject duplicate or already-used ids.',
      title: 'Preserve used order identifiers',
      observedBehavior: 'Completed identifiers are erased and accepted again.',
      expectedBehavior: 'Already-used identifiers must remain rejected.',
      counterexample: 'Complete id A and submit A again; the second submission is accepted.',
      priority: 1,
      confidence: 0.99,
      path: 'src/order_book.cpp',
      line: 42,
    }],
  });
  assert.match(failed, /Preserve used order identifiers/);
  assert.match(failed, /需求 R2：Reject duplicate or already-used ids/);
  assert.match(failed, /可复现反例/);
  assert.match(ledger.beforeNoToolCompletion(), /必须根据上述独立结论修复生产源码/);

  const repairedWrite = sourceWrite('src/order_book.cpp');
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [firstWrite, repairedWrite],
    roundReadFiles: [],
  }), /完成前需求覆盖复核/);
});

test('pending review escalates repeated no-tool completion attempts and then stops', () => {
  const ledger = new RequirementReviewLedger();
  ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [sourceWrite('src/order_book.cpp')],
    roundReadFiles: [],
  });

  const first = ledger.recoverNoToolCompletion(1);
  assert.equal(first.kind, 'retry');
  assert.match(first.feedback, /不能跳过需求覆盖复核/);
  assert.doesNotMatch(first.feedback, /只输出真实工具调用/);

  const second = ledger.recoverNoToolCompletion(2);
  assert.equal(second.kind, 'retry');
  assert.match(second.feedback, /不能把行动承诺当作执行结果/);
  assert.match(second.feedback, /只输出真实工具调用/);

  assert.deepEqual(ledger.recoverNoToolCompletion(3), {
    kind: 'stop',
    reason: '独立需求审查连续 3 轮要求修复，但模型没有执行任何工具调用。',
  });
});

test('requirement review ignores unverified, non-source, and non-code work', () => {
  const ledger = new RequirementReviewLedger();
  assert.equal(ledger.request({
    sourceChangeRequested: true,
    qualityGate: { status: 'fail', summary: 'tests failed' },
    writtenFiles: [sourceWrite('src/cache.cpp')],
    roundReadFiles: [],
  }), undefined);
  assert.equal(ledger.request({
    sourceChangeRequested: false,
    qualityGate: passedGate,
    writtenFiles: [sourceWrite('src/cache.cpp')],
    roundReadFiles: [],
  }), undefined);
  assert.equal(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [sourceWrite('docs/report.md')],
    roundReadFiles: [],
  }), undefined);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);
});
