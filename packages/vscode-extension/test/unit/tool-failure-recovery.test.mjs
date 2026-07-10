import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/tool-failure-recovery.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-failure-recovery.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ToolFailureRecoveryLedger } = req(bundlePath);

const staleReplaceFailure = {
  tool: 'replace_in_file',
  kind: 'replace',
  path: '/repo/src/verify.sh',
  reason: 'old_str 未在当前文件中找到。请重新 read_file 读取最新内容后再精确替换。',
};

test('ToolFailureRecoveryLedger: duplicate failures in one provider response count as one round', () => {
  const ledger = new ToolFailureRecoveryLedger();
  const result = ledger.recordRound([
    staleReplaceFailure,
    staleReplaceFailure,
    staleReplaceFailure,
    staleReplaceFailure,
  ]);

  assert.equal(result.stopReason, undefined);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /本轮同类失败调用 4 次/);
  assert.match(result.warnings[0], /连续失败 1 轮/);
});

test('ToolFailureRecoveryLedger: stops only after the same strategy fails across four rounds', () => {
  const ledger = new ToolFailureRecoveryLedger();
  ledger.recordRound([staleReplaceFailure]);
  ledger.recordRound([staleReplaceFailure]);
  ledger.recordRound([staleReplaceFailure]);
  const result = ledger.recordRound([staleReplaceFailure]);

  assert.match(result.stopReason, /连续 4 轮失败/);
});

test('ToolFailureRecoveryLedger: a successful write clears stale failure history for that path', () => {
  const ledger = new ToolFailureRecoveryLedger({ stopAfterRounds: 2 });
  ledger.recordRound([staleReplaceFailure]);
  ledger.clearForWrittenPaths(['/repo/src/verify.sh']);
  const result = ledger.recordRound([staleReplaceFailure]);

  assert.equal(result.stopReason, undefined);
});

console.log('\nTool failure recovery tests passed.\n');
