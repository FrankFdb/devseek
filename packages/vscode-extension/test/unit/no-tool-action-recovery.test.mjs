import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-no-tool-action-recovery-'));
const bundlePath = path.join(tempRoot, 'no-tool-action-recovery.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/no-tool-action-recovery.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const { resolveNoToolActionRecovery } = createRequire(import.meta.url)(bundlePath);
const textToolProtocol = {
  version: 'devseek.text-tools/v1',
  channelId: 'no-tool-action-recovery-test',
};

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('NoToolActionRecovery: retries an initial deferred action announcement', () => {
  const result = resolveNoToolActionRecovery({
    text: '我立即读取必要文件并执行修复。首先读取完整源码：',
    noToolRounds: 0,
    missingEvidenceCount: 0,
    promptRequiresTools: true,
    sawWorkTool: true,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.match(result.feedback, /立即调用对应工具/u);
});

test('NoToolActionRecovery: exhausted deferred actions stop instead of becoming completion', () => {
  const result = resolveNoToolActionRecovery({
    text: '我立即读取必要文件并执行修复。首先读取完整源码：',
    noToolRounds: 2,
    missingEvidenceCount: 0,
    promptRequiresTools: true,
    sawWorkTool: true,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'stop');
  assert.match(result.reason, /没有形成可执行工具调用/u);
});
