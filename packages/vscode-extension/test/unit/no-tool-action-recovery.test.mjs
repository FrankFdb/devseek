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
  assert.equal(result.useFreshProviderSession, false);
  assert.match(result.feedback, /<devseek_tool_calls[^>]+channel="no-tool-action-recovery-test">/u);
  assert.match(result.feedback, /\[TOOL:read_file/u);
  assert.match(result.feedback, /必须把示例路径替换/u);
});

test('NoToolActionRecovery: a repeated announcement rebuilds Provider context with the current envelope', () => {
  const result = resolveNoToolActionRecovery({
    text: '我将立即读取关键文件来了解当前状态。',
    noToolRounds: 1,
    missingEvidenceCount: 0,
    promptRequiresTools: true,
    sawWorkTool: false,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.equal(result.useFreshProviderSession, true);
  assert.match(result.feedback, /原始任务、最新工具结果和验证事实重建会话/u);
  assert.match(result.feedback, /<\/devseek_tool_calls channel="no-tool-action-recovery-test">/u);
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
  assert.match(result.reason, /没有可执行工具调用/u);
});

test('NoToolActionRecovery: evidence-required planning prose uses the authenticated tool envelope', () => {
  const result = resolveNoToolActionRecovery({
    text: '需要先分析项目结构、确定修改范围，然后完成实现并运行测试。',
    noToolRounds: 0,
    missingEvidenceCount: 0,
    promptRequiresTools: true,
    sawWorkTool: false,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.equal(result.useFreshProviderSession, false);
  assert.match(result.feedback, /需要真实工作区证据/u);
  assert.match(result.feedback, /<devseek_tool_calls[^>]+channel="no-tool-action-recovery-test">/u);
});

test('NoToolActionRecovery: repeated unexecuted shell presentation rebuilds Provider context', () => {
  const result = resolveNoToolActionRecovery({
    text: '```bash\ncmake --build build\n```',
    noToolRounds: 1,
    missingEvidenceCount: 1,
    promptRequiresTools: true,
    sawWorkTool: true,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.equal(result.useFreshProviderSession, true);
  assert.match(result.feedback, /原始任务、最新工具结果和验证事实重建会话/u);
  assert.match(result.feedback, /<\/devseek_tool_calls channel="no-tool-action-recovery-test">/u);
});

test('NoToolActionRecovery: a displayed source repair requests one authenticated write action', () => {
  const result = resolveNoToolActionRecovery({
    text: [
      '失败原因已经定位，建议替换当前绘制函数：',
      '```',
      'void RasterCanvas::renderNumberLine() {',
      '  drawIntervalBands();',
      '}',
      '```',
      '现在执行修改并重新验证。',
    ].join('\n'),
    noToolRounds: 0,
    missingEvidenceCount: 1,
    promptRequiresTools: true,
    sawWorkTool: true,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.equal(result.recoveryClass, 'code-action');
  assert.equal(result.useFreshProviderSession, false);
  assert.match(result.feedback, /源码修改没有写入工作区/u);
  assert.match(result.feedback, /<apply_patch>/u);
  assert.match(result.feedback, /<devseek_tool_calls[^>]+channel="no-tool-action-recovery-test">/u);
  assert.doesNotMatch(result.feedback, /\[TOOL:read_file/u);
});

test('NoToolActionRecovery: investigation conclusions with a pending next action retry', () => {
  const result = resolveNoToolActionRecovery({
    text: [
      '## 失败分析',
      '',
      '基于已读取的证据，像素颜色不足，且非主色占比过低。',
      '',
      '## 具体修改',
      '',
      '我将读取完整的 `raster_canvas.cpp` 和状态输出相关代码后，提交精确的 `replace_in_file` 修复。',
    ].join('\n\n'),
    noToolRounds: 0,
    missingEvidenceCount: 0,
    promptRequiresTools: false,
    sawWorkTool: true,
    textToolProtocol,
  });

  assert.ok(result);
  assert.equal(result.kind, 'retry');
  assert.match(result.feedback, /只输出 1 个工具调用/u);
});
