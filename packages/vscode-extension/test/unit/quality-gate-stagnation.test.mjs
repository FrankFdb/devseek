import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/quality-gate-stagnation.bundle.cjs');

execSync(
  `npx esbuild src/agent/quality-gate-stagnation.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { QualityGateStagnationLedger } = req(bundlePath);

const isolatedSampleGate = {
  status: 'fail',
  summary: '正式项目源码质量门禁未通过：正式项目中禁止新建孤岛 main/样例入口。',
  risks: ['正式项目中禁止新建孤岛 main/样例入口'],
  evidenceRefs: ['file:src/warranty_demo.cpp'],
  requiredActions: ['删除孤岛入口并接入既有模块后重新验证。'],
};

test('QualityGateStagnationLedger: stops after the same complete failure repeats without progress', () => {
  const ledger = new QualityGateStagnationLedger();
  ledger.record(isolatedSampleGate, 7);
  const warning = ledger.record(isolatedSampleGate, 7);
  const stopped = ledger.record(isolatedSampleGate, 7);

  assert.match(warning.warning, /没有新增修改证据.*连续 2 次/);
  assert.match(stopped.stopReason, /连续 3 次未通过且没有新增修改证据/);
});

test('QualityGateStagnationLedger: persistent gate summary does not stop while files are changing', () => {
  const ledger = new QualityGateStagnationLedger();
  assert.equal(ledger.record(isolatedSampleGate, 1).repeatedWithoutProgress, 1);
  assert.equal(ledger.record(isolatedSampleGate, 2).repeatedWithoutProgress, 1);
  const result = ledger.record(isolatedSampleGate, 3);

  assert.equal(result.repeatedWithoutProgress, 1);
  assert.equal(result.warning, undefined);
  assert.equal(result.stopReason, undefined);
});

test('QualityGateStagnationLedger: detailed gate changes are separate repair states', () => {
  const ledger = new QualityGateStagnationLedger({ stopAfterObservations: 2 });
  ledger.record(isolatedSampleGate, 4);
  const result = ledger.record({
    ...isolatedSampleGate,
    risks: ['源码中仍有未落定项目事实'],
    requiredActions: ['补齐项目事实后重新验证。'],
  }, 4);

  assert.equal(result.repeatedWithoutProgress, 1);
  assert.equal(result.stopReason, undefined);
});

test('QualityGateStagnationLedger: a passing gate clears previous failure history', () => {
  const ledger = new QualityGateStagnationLedger({ stopAfterObservations: 2 });
  ledger.record(isolatedSampleGate, 5);
  ledger.record({ status: 'pass', summary: 'QualityGate 通过。' }, 5);
  const result = ledger.record(isolatedSampleGate, 5);

  assert.equal(result.repeatedWithoutProgress, 1);
  assert.equal(result.stopReason, undefined);
});

console.log('\nQualityGate stagnation tests passed.\n');
