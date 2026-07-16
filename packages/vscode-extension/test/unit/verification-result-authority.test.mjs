import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/verification-result-authority.bundle.cjs');

execSync(
  `npx esbuild src/app/verification-result-authority.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  normalizeVerificationResult,
  shouldEmitTerminalEvidenceForVerification,
} = req(bundlePath);

test('VerificationResultAuthority: missing and not-run results are explicit blocked verification facts', () => {
  assert.deepEqual(normalizeVerificationResult(undefined), {
    version: 'devseek.verification-result/v1',
    status: 'missing',
    ran: false,
    ok: false,
    command: '',
    exitCode: null,
    reason: 'missing-verification-result',
    mode: undefined,
    output: '',
    risks: ['缺少自动验证结果，不能证明变更后的行为正确。'],
    alternativeChecks: [],
    sourceCanWrite: false,
  });

  const notRun = normalizeVerificationResult({
    ran: false,
    ok: false,
    status: 'failed',
    command: 'npm test',
    exitCode: null,
    output: '未配置验证命令授权边界，命令未执行。',
    cwd: '/repo',
    risks: [],
    alternativeChecks: [],
  });

  assert.equal(notRun.status, 'not-run');
  assert.equal(notRun.sourceCanWrite, false);
  assert.equal(shouldEmitTerminalEvidenceForVerification(notRun), false);
});

test('VerificationResultAuthority: manual and flaky runner outcomes cannot masquerade as ordinary failures', () => {
  const manual = normalizeVerificationResult({
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
  });
  const flaky = normalizeVerificationResult({
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
  });

  assert.equal(manual.status, 'manual-required');
  assert.equal(flaky.status, 'flaky');
  assert.equal(shouldEmitTerminalEvidenceForVerification(manual), false);
  assert.equal(shouldEmitTerminalEvidenceForVerification(flaky), false);
});

test('VerificationResultAuthority: only passed and deterministic failed command results emit terminal evidence', () => {
  assert.equal(shouldEmitTerminalEvidenceForVerification(normalizeVerificationResult({
    ran: true,
    ok: true,
    status: 'passed',
    command: 'npm test',
    exitCode: 0,
    output: 'ok',
    cwd: '/repo',
    risks: [],
    alternativeChecks: [],
  })), true);

  assert.equal(shouldEmitTerminalEvidenceForVerification(normalizeVerificationResult({
    ran: true,
    ok: false,
    status: 'failed',
    command: 'npm test',
    exitCode: 1,
    output: 'src/app.ts:1: error: broken',
    cwd: '/repo',
    risks: [],
    alternativeChecks: [],
  })), true);
});
