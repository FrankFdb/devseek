import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-semantic-contract.bundle.cjs');

execSync(
  `npx esbuild src/task-semantic-contract.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildTaskSemanticContract,
  requiresFormalProjectQuality,
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
} = createRequire(import.meta.url)(bundlePath);

test('TaskSemanticContract: standalone C++ print task is not formal-project quality work', () => {
  const contract = buildTaskSemanticContract('编写一个 C++ 程序，打印下午好');

  assert.equal(contract.version, 'devseek.task-semantic-contract/v2');
  assert.equal(contract.intent.version, 'devseek.local-intent-contract/v1');
  assert.equal(contract.intent.taskKind, 'standalone-program');
  assert.equal(contract.intent.mode, 'edit');
  assert.equal(contract.kind, 'standalone-code');
  assert.equal(contract.scope, 'standalone');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.quality.formalProjectRequired, false);
  assert.equal(requiresFormalProjectQuality(contract), false);
  assert.equal(shouldRunCppValidationForContract(contract), true);
  assert.ok(contract.signals.includes('standalone-code'));
  assert.ok(contract.signals.includes('stdout-requested'));
});

test('TaskSemanticContract: scoped other-file prohibition does not erase explicit artifact write', () => {
  const contract = buildTaskSemanticContract(
    '请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务，不要修改其他用户文件。',
  );

  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.prohibited, false);
  assert.equal(contract.mutation.fileArtifact, true);
  assert.deepEqual(contract.mutation.targets, ['controlled-sim.txt']);
  assert.equal(shouldValidateNonCodeFilesForContract(contract), true);
  assert.ok(contract.signals.includes('scoped-other-file-prohibition'));
  assert.ok(contract.signals.includes('file-check-requested'));
});

test('TaskSemanticContract: R3 login-ready audit style guidance is not formal-project quality', () => {
  const contract = buildTaskSemanticContract([
    '请基于 /tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md 和 /tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts 创建 Markdown 审计报告。',
    '请把报告保存到 /tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md。',
    '报告主题是 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE plugin-opened DeepSeek login readiness audit。',
    '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
    '报告正文请使用与本测试 case 相同的中文撰写；技术标识符、协议名、文件路径和验收锚点保持原文。',
  ].join('\n'));

  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.mutation.fileArtifact, true);
  assert.equal(contract.mutation.sourceChange, false);
  assert.equal(contract.validation.runRequested, false);
  assert.equal(contract.validation.testRequested, false);
  assert.equal(contract.quality.formalProjectRequired, false);
  assert.equal(requiresFormalProjectQuality(contract), false);
  assert.ok(contract.signals.includes('scoped-formal-source-prohibition'));
  assert.ok(!contract.signals.includes('formal-project-quality-required'));
});

test('TaskSemanticContract: formal project implementation still activates project quality gate', () => {
  const contract = buildTaskSemanticContract([
    '参考 /repo/src/oam/src/license 模块的通讯方式',
    '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/需求.md',
    '进行遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现，创建于 /repo/src/oam/src/lifting/zc_maintenance 目录下',
  ].join('\n'));

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.quality.formalProjectRequired, true);
  assert.equal(requiresFormalProjectQuality(contract), true);
  assert.ok(contract.signals.includes('formal-project-quality-required'));
});

test('TaskSemanticContract: test requests require runtime validation unless prohibited', () => {
  const contract = buildTaskSemanticContract('请修改 /tmp/project/code/shape_manager，然后编译和测试，看结果');
  const noRunContract = buildTaskSemanticContract('请修改 /tmp/project/code/shape_manager，然后编译和测试，但不要运行或测试');

  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.validation.testRequested, true);
  assert.equal(shouldRunCppValidationForContract(contract), true);
  assert.ok(contract.signals.includes('run-requested'));
  assert.ok(contract.signals.includes('test-requested'));
  assert.equal(noRunContract.validation.runProhibited, true);
  assert.equal(noRunContract.validation.runRequested, false);
  assert.equal(noRunContract.validation.testRequested, false);
  assert.equal(shouldRunCppValidationForContract(noRunContract), false);
});

test('TaskSemanticContract: file content wording does not become stdout runtime intent', () => {
  const outputFileContract = buildTaskSemanticContract('请生成结果。必须创建输出文件：/tmp/result.txt');
  const contentLineContract = buildTaskSemanticContract(
    '创建 .devseek-close02-probe/probe.js 文件。最后一行打印：CLOSE02-20260713-manual-probe: 2+3=5。不运行网络，不安装依赖。',
  );

  assert.equal(outputFileContract.validation.stdoutRequested, false);
  assert.equal(outputFileContract.validation.runRequested, false);
  assert.equal(contentLineContract.validation.stdoutRequested, false);
  assert.equal(contentLineContract.validation.runRequested, false);
});

test('TaskSemanticContract: read-only path tokens do not become runtime validation intent', () => {
  const contract = buildTaskSemanticContract(
    '解释 packages/vscode-extension/src/app/run-context.ts 做了什么，不要修改代码',
  );

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.validation.requested, false);
  assert.equal(contract.validation.runRequested, false);
  assert.equal(shouldRunCppValidationForContract(contract), false);
});

test('TaskSemanticContract: negated external effects stay outside release routing', () => {
  const contract = buildTaskSemanticContract('不要推送当前分支，只检查并说明当前状态');

  assert.equal(contract.intent.context.externalEffect, 'none');
  assert.notEqual(contract.intent.taskKind, 'external-effect');
  assert.equal(contract.intent.requiresConfirmation, false);
});

console.log('\nTask-semantic-contract tests passed.\n');
