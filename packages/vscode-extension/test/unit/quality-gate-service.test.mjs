/**
 * Unit tests for app/quality-gate-service.ts.
 *
 * Claude Code/Codex-style contract: a task is not "done" just because files
 * changed. Completion must bind to validation evidence or an explicit blocked
 * risk record.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/quality-gate-service.bundle.cjs');

execSync(
  `npx esbuild src/app/quality-gate-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { QualityGateService } = req(bundlePath);

test('QualityGateService: failed validation fails the gate and keeps evidence refs', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['packages/vscode-extension/src/app/workflow-service.ts'],
    validation: {
      ran: true,
      ok: false,
      status: 'failed',
      command: 'npm run compile',
      exitCode: 2,
      output: 'workflow-service.ts: error TS2322',
      cwd: '/repo/packages/vscode-extension',
      mode: 'compile-only',
      reason: 'extension-change',
      risks: [],
      alternativeChecks: [],
    },
  });

  assert.equal(decision.status, 'fail');
  assert.match(decision.summary, /QualityGate 未通过/);
  assert.deepEqual(decision.evidenceRefs, ['validation:failed:npm run compile']);
  assert.match(decision.requiredActions.join('\n'), /修复自动验证失败/);
});

test('QualityGateService: missing validation blocks completion with alternatives and risks', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['docs/readme.md'],
    validation: null,
  });

  assert.equal(decision.status, 'blocked');
  assert.match(decision.summary, /QualityGate 阻塞/);
  assert.ok(decision.risks.some((risk) => /没有自动验证证据/.test(risk)));
  assert.ok(decision.alternativeChecks.some((check) => /人工/.test(check)));
});

test('QualityGateService: blocked validation records accepted risk source', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['docs/readme.md'],
    validation: {
      ran: false,
      ok: false,
      status: 'blocked',
      command: '',
      exitCode: null,
      output: '未识别到自动验证目标',
      cwd: '/repo',
      mode: 'not-available',
      reason: 'no-auto-validation-target',
      risks: ['无法证明运行时行为正确。'],
      alternativeChecks: ['人工检查生成文件内容。'],
    },
    acceptedRisk: {
      source: 'user',
      note: '文档修改，接受无自动测试风险',
      acceptedAt: 123,
    },
  });

  assert.equal(decision.status, 'blocked');
  assert.deepEqual(decision.acceptedRisk, {
    source: 'user',
    note: '文档修改，接受无自动测试风险',
    acceptedAt: 123,
  });
});

console.log('\nQuality gate service tests passed.\n');
