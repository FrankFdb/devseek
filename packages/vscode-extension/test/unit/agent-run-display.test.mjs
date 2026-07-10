import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-run-display.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-run-display.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildAgentRunDisplayProfile, isLiteralToolProtocolPrompt } = req(bundlePath);

test('agent run display: literal tool protocol samples use safe response copy', () => {
  const prompt = '请原样输出以下不完整工具调用，不要补全，不要解释：\n[TOOL:write_file {"path":"docs/manual-phase7-corrupt.md","content":"phase7 corrupt';
  const profile = buildAgentRunDisplayProfile(prompt);

  assert.equal(isLiteralToolProtocolPrompt(prompt), true);
  assert.equal(profile.kind, 'safe-response');
  assert.equal(profile.planStartedTitle, '检查响应安全性');
  assert.equal(profile.planCompletedTitle, '已确定执行方式：安全响应');
  assert.equal(profile.initialTaskAction, 'respond');
  assert.equal(profile.initialTaskLabel, '安全响应');
  assert.equal(profile.suppressToolPlanning, true);
  assert.doesNotMatch(profile.planStartedDetail, /读取相关文件|搜索|写入/);
  assert.doesNotMatch(profile.planCompletedDetail, /探索工作区|创建或修改文件/);
});

test('agent run display: ordinary workspace requests keep explore copy', () => {
  const profile = buildAgentRunDisplayProfile('创建 docs/example.md，内容为 hello，并验证文件内容。');

  assert.equal(profile.kind, 'workspace-explore');
  assert.equal(profile.planStartedTitle, '正在理解任务和项目边界');
  assert.equal(profile.planCompletedTitle, '已确定软件工程执行路线');
  assert.match(profile.planStartedDetail, /任务类型、输出要求和需要优先验证的项目锚点/);
  assert.match(profile.planCompletedDetail, /收集原项目代码、通信链路和接口证据/);
  assert.match(profile.planCompletedDetail, /基于证据设计并生成必要成果物/);
  assert.match(profile.planCompletedDetail, /运行验证并汇总交付结果/);
  assert.equal(profile.initialTaskAction, 'explore');
  assert.equal(profile.suppressToolPlanning, false);
});
