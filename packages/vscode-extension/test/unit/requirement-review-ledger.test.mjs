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
  assert.match(first, /read_file/);
  assert.match(ledger.beforeNoToolCompletion(), /不能跳过需求覆盖复核/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: firstWrites,
    roundReadFiles: ['include/cache.hpp'],
  }), /src\/cache\.cpp/);

  assert.match(ledger.request({
    sourceChangeRequested: true,
    qualityGate: passedGate,
    writtenFiles: firstWrites,
    roundReadFiles: ['/workspace/include/cache.hpp', '/workspace/src/cache.cpp'],
  }), /最终源码已重新读取/);
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
