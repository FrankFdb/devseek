import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-failure-progress-'));
const bundlePath = path.join(tempRoot, 'terminal-failure-progress.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/terminal-failure-progress.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const {
  TerminalFailureProgressLedger,
  makeTerminalFailureFingerprint,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function ximageFailure(detail = 'Cannot create XImage: depth=24 bitmapPad=32 bytesPerLine=2400') {
  return {
    command: 'make -C build -j4 && ./build/math_visual_lab --smoke-frames 3',
    workdir: '/workspace',
    kind: 'compile-run',
    ok: false,
    exitCode: 1,
    detail,
  };
}

function tool(name, purpose) {
  return { name, purpose };
}

test('unchanged diagnostics across two accepted repair cohorts require investigation', () => {
  const ledger = new TerminalFailureProgressLedger();

  assert.equal(ledger.observe(ximageFailure(), 0, true).unchangedRepairCohorts, 0);
  assert.equal(ledger.observe(ximageFailure(), 1, true).unchangedRepairCohorts, 1);
  const repeated = ledger.observe(ximageFailure(), 2, true);

  assert.equal(repeated.unchangedRepairCohorts, 2);
  assert.equal(repeated.newlyRequiresInvestigation, true);
  assert.equal(repeated.investigationRequired, true);
  assert.match(repeated.feedback, /修复策略已被公开验证证伪/u);
  assert.match(repeated.feedback, /系统头文件\/文档/u);
});

test('pending investigation blocks effects but admits observations', () => {
  const ledger = new TerminalFailureProgressLedger({ investigateAfterUnchangedRepairs: 1 });
  ledger.observe(ximageFailure(), 0, true);
  ledger.observe(ximageFailure(), 1, true);

  const screened = ledger.screen([
    tool('replace_in_file', 'workspace-mutation'),
    tool('read_file', 'observe'),
    tool('run_terminal', 'verify'),
    tool('grep_search', 'observe'),
    tool('delete_file', 'external-effect'),
  ]);

  assert.deepEqual([...screened.blockedToolIndexes], [0, 2, 4]);
  assert.deepEqual(
    screened.suppressedTools.map(item => item.reason),
    Array(3).fill('terminal-failure-investigation-required'),
  );
  assert.match(screened.warnings[0], /只允许新的只读取证/u);
});

test('only new observation evidence releases a pending repair', () => {
  const ledger = new TerminalFailureProgressLedger({ investigateAfterUnchangedRepairs: 1 });
  ledger.observe(ximageFailure(), 0, true);
  ledger.observe(ximageFailure(), 1, true);

  assert.equal(ledger.recordInvestigationEvidence(false), undefined);
  assert.equal(ledger.requiresInvestigation(), true);
  assert.match(ledger.recordInvestigationEvidence(true), /取得新的根因取证结果/u);
  assert.equal(ledger.requiresInvestigation(), false);
  assert.equal(ledger.screen([tool('replace_in_file', 'workspace-mutation')]).blockedToolIndexes.size, 0);
});

test('a changed diagnostic or cleared failure starts a fresh causal state', () => {
  const ledger = new TerminalFailureProgressLedger({ investigateAfterUnchangedRepairs: 1 });
  ledger.observe(ximageFailure(), 0, true);
  ledger.observe(ximageFailure(), 1, true);

  const changed = ledger.observe(ximageFailure('XImage stride mismatch: expected=3200 actual=2400'), 2, true);
  assert.equal(changed.unchangedRepairCohorts, 0);
  assert.equal(changed.investigationRequired, false);

  ledger.observe(ximageFailure('XImage stride mismatch: expected=3200 actual=2400'), 3, true);
  assert.equal(ledger.requiresInvestigation(), true);
  ledger.observe(undefined, 3, false);
  assert.equal(ledger.requiresInvestigation(), false);
});

test('diagnostic fingerprint ignores volatile timestamp prefixes', () => {
  const first = ximageFailure('[23:38:01 pid=101] Cannot create XImage: depth=24 bitmapPad=32 bytesPerLine=2400');
  const second = ximageFailure('[23:39:44 pid=292] Cannot create XImage: depth=24 bitmapPad=32 bytesPerLine=2400');

  assert.equal(makeTerminalFailureFingerprint(first), makeTerminalFailureFingerprint(second));
});

console.log('\nTerminal failure progress tests passed.\n');
