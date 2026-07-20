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

test('QualityGateService: failed validation includes minimal EvidenceRef failure diagnosis', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['packages/vscode-extension/src/app/workflow-service.ts'],
    validation: {
      ran: true,
      ok: false,
      status: 'failed',
      command: 'npm run compile',
      exitCode: 2,
      output: 'packages/vscode-extension/src/app/workflow-service.ts:17:5 - error TS2322: Type string is not assignable.',
      cwd: '/repo',
      mode: 'compile-only',
      reason: 'extension-change',
      risks: [],
      alternativeChecks: [],
    },
  });

  assert.equal(decision.status, 'fail');
  assert.equal(decision.failureDiagnosis?.kind, 'validation-command-failed');
  assert.equal(decision.failureDiagnosis?.rootCauseStatus, 'known');
  assert.equal(decision.failureDiagnosis?.sticky, true);
  assert.deepEqual(decision.failureDiagnosis?.evidenceRefs, ['validation:failed:npm run compile']);
  assert.deepEqual(decision.failureDiagnosis?.relatedPaths, ['packages/vscode-extension/src/app/workflow-service.ts']);
  assert.match(decision.failureDiagnosis?.summary || '', /workflow-service\.ts/);
});

test('QualityGateService: unrelated validation failure is diagnosed as unknown', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['packages/vscode-extension/src/app/workflow-service.ts'],
    validation: {
      ran: true,
      ok: false,
      status: 'failed',
      command: 'npm run compile',
      exitCode: 2,
      output: 'Error: build worker exited unexpectedly',
      cwd: '/repo',
      mode: 'compile-only',
      reason: 'extension-change',
      risks: [],
      alternativeChecks: [],
    },
  });

  assert.equal(decision.status, 'fail');
  assert.equal(decision.failureDiagnosis?.kind, 'unknown');
  assert.equal(decision.failureDiagnosis?.rootCauseStatus, 'unknown');
  assert.deepEqual(decision.failureDiagnosis?.evidenceRefs, ['validation:failed:npm run compile']);
  assert.deepEqual(decision.failureDiagnosis?.relatedPaths, []);
  assert.match(decision.failureDiagnosis?.summary || '', /相关性不足|unknown/i);
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

test('QualityGateService: weak or pending contract acceptance vetoes a passing verifier', () => {
  const service = new QualityGateService();
  const passingValidation = {
    ran: true,
    ok: true,
    status: 'passed',
    command: 'test -f report.md',
    exitCode: 0,
    output: 'ok',
    cwd: '/repo',
    mode: 'file-check',
    reason: 'non-code-file-validation',
    risks: [],
    alternativeChecks: [],
  };

  const weak = service.evaluate({
    changedPaths: ['report.md'],
    validation: passingValidation,
    contractAcceptance: {
      status: 'weak-oracle',
      reason: 'acceptance-not-bound-to-request',
      evidenceRefs: ['contract:acceptance:not-bound'],
    },
  });
  const pending = service.evaluate({
    changedPaths: ['report.md'],
    validation: passingValidation,
    contractAcceptance: {
      status: 'pending',
      reason: 'acceptance-review-not-finished',
    },
  });

  assert.equal(weak.status, 'blocked');
  assert.equal(weak.contractAcceptanceStatus, 'weak-oracle');
  assert.deepEqual(weak.evidenceRefs, ['contract:acceptance:not-bound']);
  assert.equal(pending.status, 'blocked');
  assert.equal(pending.contractAcceptanceStatus, 'pending');
});

test('QualityGateService: adverse evidence and model completion text cannot vote the gate pass', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['src/app.ts'],
    validation: {
      ran: true,
      ok: true,
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      output: 'ok',
      cwd: '/repo',
      mode: 'test',
      reason: 'extension-change',
      risks: [],
      alternativeChecks: [],
    },
    contractAcceptance: { status: 'accepted' },
    adverseEvidenceCount: 1,
    modelCompletionText: '我已经完成，测试全部通过。',
  });

  assert.equal(decision.status, 'fail');
  assert.equal(decision.authority, 'QualityGateService');
  assert.deepEqual(decision.evidenceRefs, ['run-context:adverse-evidence']);
  assert.doesNotMatch(decision.summary, /我已经完成/);
});

test('QualityGateService: manual, not-run and flaky verification outcomes are explicit vetoes', () => {
  const service = new QualityGateService();
  const manual = service.evaluate({
    changedPaths: ['docs/ui.md'],
    validation: {
      ran: false,
      ok: false,
      status: 'failed',
      command: 'python visual_check.py',
      exitCode: null,
      output: 'manual observation required',
      cwd: '/repo',
      reason: 'manual-observation-required',
      risks: [],
      alternativeChecks: ['请人工确认 UI 输出。'],
    },
  });
  const notRun = service.evaluate({
    changedPaths: ['src/app.ts'],
    validation: {
      ran: false,
      ok: false,
      status: 'failed',
      command: 'npm test',
      exitCode: null,
      output: '未配置验证命令授权边界，命令未执行。',
      cwd: '/repo',
      risks: [],
      alternativeChecks: [],
    },
  });
  const flaky = service.evaluate({
    changedPaths: ['src/app.ts'],
    validation: {
      ran: true,
      ok: false,
      status: 'failed',
      command: 'npm test',
      exitCode: 124,
      output: 'test timed out; possible flaky timeout',
      cwd: '/repo',
      reason: 'timeout',
      risks: [],
      alternativeChecks: [],
    },
  });

  assert.equal(manual.status, 'blocked');
  assert.equal(manual.verificationStatus, 'manual-required');
  assert.match(manual.evidenceRefs[0], /^validation:blocked:manual-observation-required/);
  assert.equal(notRun.status, 'blocked');
  assert.equal(notRun.verificationStatus, 'not-run');
  assert.equal(flaky.status, 'blocked');
  assert.equal(flaky.verificationStatus, 'flaky');
});

test('QualityGateService: current passing validation cannot settle unresolved flaky or manual history', () => {
  const service = new QualityGateService();
  const decision = service.evaluate({
    changedPaths: ['src/app.ts'],
    validation: {
      ran: true,
      ok: true,
      status: 'passed',
      command: 'npm test',
      exitCode: 0,
      output: 'ok',
      cwd: '/repo',
      mode: 'test',
      reason: 'rerun-after-failure',
      risks: [],
      alternativeChecks: [],
    },
    validationHistory: [
      {
        ran: true,
        ok: false,
        status: 'failed',
        command: 'npm test',
        exitCode: 124,
        output: 'test timed out; possible flaky timeout',
        reason: 'timeout',
        evidenceRef: 'validation:flaky:npm test',
      },
      {
        ran: false,
        ok: false,
        status: 'failed',
        command: 'python visual_check.py',
        exitCode: null,
        output: 'manual observation required',
        reason: 'manual-observation-required',
        evidenceRef: 'validation:manual:visual-check',
      },
    ],
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.verificationStatus, 'flaky');
  assert.deepEqual(decision.evidenceRefs, ['validation:flaky:npm test']);
  assert.match(decision.summary, /历史验证/);
  assert.match(decision.requiredActions.join('\n'), /解除|验证历史/);
});

console.log('\nQuality gate service tests passed.\n');
