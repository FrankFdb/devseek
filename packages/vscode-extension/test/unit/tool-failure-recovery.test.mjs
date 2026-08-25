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
  strategyFingerprint: 'same-concrete-replace-proposal',
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
  assert.match(result.warnings[0], /不能因参数传输或匹配失败升级为 write_file 整文件覆写/);
});

test('ToolFailureRecoveryLedger: stops only after the same strategy fails across four rounds', () => {
  const ledger = new ToolFailureRecoveryLedger();
  ledger.recordRound([staleReplaceFailure]);
  ledger.recordRound([staleReplaceFailure]);
  ledger.recordRound([staleReplaceFailure]);
  const result = ledger.recordRound([staleReplaceFailure]);

  assert.match(result.stopReason, /连续 4 轮失败/);
});

test('ToolFailureRecoveryLedger: changed mutation parameters are distinct recovery strategies', () => {
  const ledger = new ToolFailureRecoveryLedger();
  let result;
  for (const strategyFingerprint of ['proposal-a', 'proposal-b', 'proposal-c', 'proposal-d']) {
    result = ledger.recordRound([{ ...staleReplaceFailure, strategyFingerprint }]);
  }

  assert.equal(result.stopReason, undefined);
});

test('ToolFailureRecoveryLedger: a successful write clears stale failure history for that path', () => {
  const ledger = new ToolFailureRecoveryLedger({ stopAfterRounds: 2 });
  ledger.recordRound([staleReplaceFailure]);
  ledger.clearForWrittenPaths(['/repo/src/verify.sh']);
  const result = ledger.recordRound([staleReplaceFailure]);

  assert.equal(result.stopReason, undefined);
});

test('ToolFailureRecoveryLedger: failed mutation grants one context refresh for the exact path', () => {
  const ledger = new ToolFailureRecoveryLedger({ workspaceRoot: '/repo' });
  ledger.recordRound([{ ...staleReplaceFailure, path: 'src/verify.sh' }]);

  assert.equal(ledger.consumeContextRefresh('/repo/src/other.sh'), false);
  assert.equal(ledger.consumeContextRefresh('/repo/src/verify.sh'), true);
  assert.equal(ledger.consumeContextRefresh('/repo/src/verify.sh'), false);
});

test('ToolFailureRecoveryLedger: terminal failures do not grant file context refreshes', () => {
  const ledger = new ToolFailureRecoveryLedger();
  ledger.recordRound([{
    tool: 'run_terminal',
    kind: 'terminal-guard',
    path: '/repo/src/verify.sh',
    reason: 'terminal mutation blocked',
  }]);

  assert.equal(ledger.consumeContextRefresh('/repo/src/verify.sh'), false);
});

test('ToolFailureRecoveryLedger: successful write clears a pending context refresh', () => {
  const ledger = new ToolFailureRecoveryLedger();
  ledger.recordRound([staleReplaceFailure]);
  ledger.clearForWrittenPaths(['/repo/src/verify.sh']);

  assert.equal(ledger.consumeContextRefresh('/repo/src/verify.sh'), false);
});

test('ToolFailureRecoveryLedger: missing terminal capability requires an alternate runtime or authorization', () => {
  const ledger = new ToolFailureRecoveryLedger({ warnAfterRounds: 1 });
  const result = ledger.recordRound([{
    tool: 'run_terminal',
    kind: 'terminal-capability',
    path: 'python build.py',
    reason: '当前系统缺少 python 运行时。',
  }]);

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /探测已安装的等价能力/);
  assert.match(result.warnings[0], /请求用户授权/);
  assert.doesNotMatch(result.warnings[0], /缩小写入范围/);
});

console.log('\nTool failure recovery tests passed.\n');
