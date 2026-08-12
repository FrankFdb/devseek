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
  assert.match(first, /run_terminal\/cat 输出、写入工具读回和公开测试日志都不能替代 read_file/);
  assert.match(first, /临时 probe 或项目验证命令辅助修复/);
  assert.match(first, /read_file/);
  assert.match(ledger.beforeNoToolCompletion(), /不能跳过需求覆盖复核/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: firstWrites,
    roundReadFiles: ['include/cache.hpp'],
  }), /run_terminal\/cat 输出不计入/);

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
  assert.equal(ledger.completionBlocker(), undefined);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);
});

test('host final-source evidence can trigger isolated review without provider read_file loops', () => {
  const ledger = new RequirementReviewLedger();
  const writes = [sourceWrite('src/order_book.cpp'), sourceWrite('include/order_book.hpp')];
  const feedback = ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: writes,
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  });

  assert.match(feedback, /宿主侧写入读回和验证流程绑定最终源码证据/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['src/order_book.cpp', 'include/order_book.hpp'],
  });
  assert.match(ledger.beforeNoToolCompletion(), /不能跳过独立需求审查/);
  assert.match(ledger.settleIndependentReview({
    status: 'passed',
    explanation: 'Host-captured final source satisfies the user requirements.',
    findings: [],
  }), /独立需求审查：通过/);
  assert.equal(ledger.completionBlocker(), undefined);
});

test('host final-source evidence never bypasses failed validation', () => {
  const ledger = new RequirementReviewLedger();
  const feedback = ledger.request({
    sourceChangeRequested: true,
    qualityGate: { status: 'fail', summary: 'compile failed' },
    writtenFiles: [sourceWrite('src/order_book.cpp')],
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  });

  assert.match(feedback, /暂停独立需求审查/);
  assert.match(feedback, /compile failed/);
  assert.equal(ledger.takeIndependentReviewCandidate(), undefined);
});

test('host final-source evidence downgrades repeated reviewer unavailability after bounded retry', () => {
  const ledger = new RequirementReviewLedger();
  const writes = [sourceWrite('src/order_book.cpp')];
  ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: writes,
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  });
  ledger.takeIndependentReviewCandidate();

  const firstIndeterminate = ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查未逐条覆盖需求清单，或需求引用不是原文。',
    findings: [],
  });
  assert.match(firstIndeterminate, /只允许用 read_file 重新读取最终源码以重试审查/);

  const retry = ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: writes,
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  });
  assert.match(retry, /自动重试独立需求审查/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['src/order_book.cpp'],
  });

  const accepted = ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查输出不是严格 JSON。',
    findings: [],
  });
  assert.equal(accepted, undefined);
  assert.equal(ledger.completionBlocker(), undefined);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);
});

test('host final-source evidence clears provider-transcript-polluted review after local source fallback', () => {
  const ledger = new RequirementReviewLedger();
  const writes = [sourceWrite('include/order_book.hpp'), sourceWrite('src/order_book.cpp')];
  ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: writes,
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  });
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['include/order_book.hpp', 'src/order_book.cpp'],
  });

  const accepted = ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查输出不是严格 JSON。',
    findings: [],
    hostClearable: true,
  });

  assert.equal(accepted, undefined);
  assert.equal(ledger.completionBlocker(), undefined);
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
  assert.match(failed, /counterexample 转成最小本地 probe/);
  assert.match(failed, /定点修复协议：可区分的无效 submit 拒绝/);
  assert.match(failed, /有效订单 id A 后再次提交 A 必须抛 std::invalid_argument/);
  assert.match(failed, /有效但不成交的订单仍可返回空 trades/);
  assert.match(failed, /submit 入口不能继续用 `return \{\}` 或空 trades 表示 invalid\/duplicate/);
  assert.match(failed, /std::invalid_argument/);
  assert.match(failed, /不能继续返回空 vector/);
  assert.match(failed, /针对性验证通过后，再运行项目既有验证作为大 case 回归/);
  assert.match(ledger.beforeNoToolCompletion(), /必须根据上述独立结论修复生产源码/);
  assert.match(ledger.completionBlocker(), /独立需求审查未通过：A used identity can be submitted again/);

  const repairedWrite = sourceWrite('src/order_book.cpp');
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [firstWrite, repairedWrite],
    roundReadFiles: [],
  }), /完成前需求覆盖复核/);
});

test('failed independent review emits a targeted remaining-quantity repair protocol', () => {
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
    explanation: 'remaining quantity is initialized from an invalid source.',
    findings: [{
      requirementId: 'R4',
      requirement: 'Unmatched active orders preserve remaining quantity.',
      title: 'Initialize remaining quantity from the incoming order',
      observedBehavior: 'The node reads node.order.quantity while node is being initialized.',
      expectedBehavior: 'The book stores the incoming order quantity as remaining quantity.',
      counterexample: 'Submit an unmatched buy with quantity 5; active remaining is not 5.',
      priority: 1,
      confidence: 0.98,
      path: 'src/order_book.cpp',
      line: 29,
    }],
  });

  assert.match(failed, /定点修复协议：remaining 初始化来源/);
  assert.match(failed, /提交一个合法且不成交的数量 5 订单/);
  assert.match(failed, /禁止 `OrderNode node\{\.\.\., node\.order\.quantity\}` 这类初始化期间自读/);
  assert.match(failed, /已校验的 incoming order quantity 保存局部值/);
  assert.match(failed, /针对性验证通过后，再运行项目既有验证作为大 case 回归/);
});

test('indeterminate independent review retries through final-source evidence instead of blind source edits', () => {
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

  const firstIndeterminate = ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查未逐条覆盖需求清单，或需求引用不是原文。',
    findings: [],
  });
  assert.match(firstIndeterminate, /不是可执行源码缺陷/);
  assert.match(firstIndeterminate, /只允许用 read_file 重新读取最终源码以重试审查/);
  assert.doesNotMatch(firstIndeterminate, /修复生产源码/);
  assert.doesNotMatch(ledger.beforeNoToolCompletion(), /修复生产源码/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: [firstWrite],
    roundReadFiles: [],
  }), /重新读取最终源码以重试审查/);
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: [firstWrite],
    roundReadFiles: ['src/order_book.cpp'],
  }), /重新触发独立需求审查/);
  assert.deepEqual(ledger.takeIndependentReviewCandidate(), {
    sourcePaths: ['src/order_book.cpp'],
  });

  const secondIndeterminate = ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查输出不是严格 JSON。',
    findings: [],
  });
  assert.match(secondIndeterminate, /审查器阻塞/);
  assert.match(secondIndeterminate, /不要继续盲目修改生产源码/);
  assert.doesNotMatch(secondIndeterminate, /必须根据上述独立结论修复生产源码/);
  assert.match(ledger.completionBlocker(), /独立需求审查证据不足：隔离审查输出不是严格 JSON/);
});

test('new failing source cohort pauses stale requirement review until validation passes again', () => {
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
  ledger.settleIndependentReview({
    status: 'indeterminate',
    explanation: '隔离审查输出不是严格 JSON。',
    findings: [],
  });

  const badFragmentWrite = sourceWrite('src/order_book.cpp');
  const pause = ledger.request({
    sourceChangeRequested: true,
    qualityGate: { status: 'fail', summary: 'QualityGate 未通过：自动验证失败（exitCode=2）。' },
    writtenFiles: [firstWrite, badFragmentWrite],
    roundReadFiles: ['src/order_book.cpp'],
  });
  assert.match(pause, /暂停独立需求审查/);
  assert.match(pause, /尚未通过自动验证/);
  assert.match(pause, /不要继续只读需求审查或反复 read_file 同一坏源码/);
  assert.match(pause, /expected unqualified-id/);
  assert.equal(ledger.takeIndependentReviewCandidate(), undefined);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);

  const readOnlyRetry = ledger.request({
    sourceChangeRequested: true,
    qualityGate: undefined,
    writtenFiles: [firstWrite, badFragmentWrite],
    roundReadFiles: ['src/order_book.cpp'],
  });
  assert.match(readOnlyRetry, /尚未取得通过的自动验证证据/);
  assert.doesNotMatch(readOnlyRetry, /【系统反馈：重新触发独立需求审查】/);

  const repairedWrite = sourceWrite('src/order_book.cpp');
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: [firstWrite, badFragmentWrite, repairedWrite],
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
    reason: '独立需求审查连续 3 轮未推进，但模型没有执行任何工具调用。',
  });
});

test('requirement review pauses unverified source work and ignores non-source/non-code work', () => {
  const ledger = new RequirementReviewLedger();
  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: { status: 'fail', summary: 'tests failed' },
    writtenFiles: [sourceWrite('src/cache.cpp')],
    roundReadFiles: [],
  }), /暂停独立需求审查/);
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
