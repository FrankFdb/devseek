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
  const profile = buildAgentRunDisplayProfile('分析 docs 目录里的发布说明，找出需要补充的验证证据。');

  assert.equal(profile.kind, 'model-led');
  assert.equal(profile.planStartedTitle, '正在理解当前请求');
  assert.equal(profile.planCompletedTitle, '已确认当前任务边界');
  assert.doesNotMatch(profile.planCompletedDetail, /通信链路|接口证据|生成必要成果物|运行验证/);
  assert.equal(profile.initialTaskAction, 'explore');
  assert.equal(profile.emitPlanningStatus, true);
  assert.equal(profile.suppressToolPlanning, false);
});

test('agent run display: direct concept answers do not project a fake engineering plan', () => {
  for (const prompt of [
    '解释gpu cpu',
    '讲下 gpu 和 cpu 有啥取别，短点说',
    "What's the CPU vs GPU difference? Keep it short.",
    'CPUとGPUの違いを短く説明して',
  ]) {
    const profile = buildAgentRunDisplayProfile(prompt);
    assert.equal(profile.kind, 'direct-response', prompt);
    assert.equal(profile.initialTaskAction, 'respond', prompt);
    assert.equal(profile.initialTaskLabel, undefined, prompt);
    assert.equal(profile.emitPlanningStatus, false, prompt);
  }
});

test('agent run display: screenshot wording stays a direct response without a synthetic task label', () => {
  const profile = buildAgentRunDisplayProfile('说明gpu cpu');

  assert.equal(profile.kind, 'direct-response');
  assert.equal(profile.initialTaskAction, 'respond');
  assert.equal(profile.initialTaskLabel, undefined);
  assert.equal(profile.emitPlanningStatus, false);
});

test('agent run display: simple file requests use direct write and readback copy', () => {
  const profile = buildAgentRunDisplayProfile('创建 docs/example.md，内容为 hello，并验证文件内容。');

  assert.equal(profile.kind, 'simple-file');
  assert.equal(profile.planStartedTitle, '正在确认文件写入要求');
  assert.equal(profile.planCompletedTitle, '已确定直接写入与读回验证');
  assert.match(profile.planStartedDetail, /目标文件、精确内容和读回验证方式/);
  assert.match(profile.planCompletedDetail, /写入用户指定文件：docs\/example\.md/);
  assert.match(profile.planCompletedDetail, /读回确认文件存在、内容正确、大小正常/);
  assert.doesNotMatch(profile.planCompletedDetail, /通信链路|接口证据|原项目代码/);
  assert.equal(profile.initialTaskAction, 'create');
  assert.equal(profile.initialTaskLabel, 'docs/example.md');
  assert.equal(profile.suppressToolPlanning, false);
});

test('agent run display: marked create-file requests do not use formal project copy', () => {
  const profile = buildAgentRunDisplayProfile(
    'INTENT-SIM-SIMPLE-intent-simple-20260715-172137-35d024 请在当前工作区创建文件 intent-simple-20260715-172137-35d024.txt。文件内容必须精确为一行 INTENT_SIM_SIMPLE_OK_intent-simple-20260715-172137-35d024。完成写入后读取该文件验证内容精确匹配，然后结束任务。不要创建目录，不要修改其他用户文件，不要访问网络。',
  );

  assert.equal(profile.kind, 'simple-file');
  assert.equal(profile.planStartedTitle, '正在确认文件写入要求');
  assert.match(profile.planCompletedDetail, /intent-simple-20260715-172137-35d024\.txt/);
  assert.doesNotMatch(profile.planCompletedDetail, /通信链路|接口证据|原项目代码/);
});

test('agent run display: simple standalone programs use lightweight programming copy', () => {
  const profile = buildAgentRunDisplayProfile('编写C++程序，打印helloworld,编译执行');

  assert.equal(profile.kind, 'workspace-explore');
  assert.equal(profile.planStartedTitle, '正在理解独立编程任务');
  assert.equal(profile.planCompletedTitle, '已确定轻量编程路线');
  assert.match(profile.planCompletedDetail, /创建或更新最小源码文件/);
  assert.match(profile.planCompletedDetail, /编译\/运行并核对输出/);
  assert.doesNotMatch(profile.planCompletedDetail, /通信链路|接口证据|原项目代码/);
  assert.equal(profile.initialTaskAction, 'explore');
  assert.equal(profile.suppressToolPlanning, false);
});
