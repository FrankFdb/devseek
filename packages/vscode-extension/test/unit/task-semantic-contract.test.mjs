import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-semantic-contract.bundle.cjs');
const serviceBundlePath = path.join(rootDir, 'test/unit/task-semantic-contract-service.bundle.cjs');

execSync(
  `npx esbuild src/task-semantic-contract.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/intent/task-semantic-contract-service.ts --bundle ` +
  `--outfile=${serviceBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildTaskSemanticContract,
  requiresFormalProjectQuality,
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
} = createRequire(import.meta.url)(bundlePath);
const { resolveTaskSemanticContract } = createRequire(import.meta.url)(serviceBundlePath);

test('TaskSemanticContract: standalone C++ print task is not formal-project quality work', () => {
  const contract = buildTaskSemanticContract('编写一个 C++ 程序，打印下午好');

  assert.equal(contract.version, 'devseek.task-semantic-contract/v3');
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
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-written'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'run-passed'));
  assert.equal(contract.context.revision.strategy, 'initial');
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
  assert.deepEqual(contract.mutation.targets, [
    '/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md',
  ]);
  assert.deepEqual(contract.read.targets, [
    '/tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md',
    '/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts',
  ]);
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

test('TaskSemanticContract v3: enumerated design and code delivery keeps formal quality active', () => {
  const contract = buildTaskSemanticContract([
    '原来实现的吊运维保功能：设计文档+代码。',
    '参考 /repo/src/oam/src/license 模块的通讯方式，在既有主控正式项目内实现遥控器和主控交互，',
    '需要分析原项目逻辑、设计、代码实现和自闭环测试。',
  ].join('\n'));

  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.quality.formalProjectRequired, true);
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'formal-project-quality-passed'));
});

test('TaskSemanticContract v3: focused single-file repairs do not inherit formal document quality', () => {
  const prompts = [
    'Repair src/parser.js and keep working until the focused parser check passes.',
    '修复 src/parser.js，并持续工作直到聚焦的 parser 检查通过。',
  ];

  for (const prompt of prompts) {
    const contract = buildTaskSemanticContract(prompt);
    assert.equal(contract.kind, 'existing-project-code');
    assert.equal(contract.scope, 'existing-project');
    assert.equal(contract.mutation.sourceChange, true);
    assert.equal(contract.validation.requested, true);
    assert.equal(contract.quality.formalProjectRequired, false);
    assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-validation-passed'));
    assert.ok(!contract.completion.doneIff.some(item => item.kind === 'formal-project-quality-passed'));
  }
});

test('TaskSemanticContract v3: broad project refactors retain formal source quality', () => {
  const contract = buildTaskSemanticContract(
    'Refactor the workflow state machine across the project code and run its tests.',
  );

  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.quality.formalProjectRequired, true);
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'formal-project-quality-passed'));
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

test('TaskSemanticContract v3: read obligations distinguish existence from file content', () => {
  const existence = buildTaskSemanticContract(
    '检查 docs/manual-phase5-smoke.md 是否存在，不要修改文件。',
  );
  const content = buildTaskSemanticContract(
    '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容，不要修改文件。',
  );

  assert.deepEqual(existence.read, {
    requested: true,
    contentRequested: false,
    targets: ['docs/manual-phase5-smoke.md'],
  });
  assert.ok(existence.completion.doneIff.some(item => item.kind === 'read-evidence'));
  assert.deepEqual(content.read, {
    requested: true,
    contentRequested: true,
    targets: ['docs/manual-phase5-smoke.md'],
  });
  assert.ok(content.completion.doneIff.some(item => item.kind === 'file-content-read'));
});

test('TaskSemanticContract v3: payload vocabulary does not create validation obligations', () => {
  const contract = buildTaskSemanticContract('创建 result.md，内容为 test');

  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.validation.requested, false);
  assert.equal(contract.validation.runRequested, false);
  assert.equal(contract.validation.testRequested, false);
  assert.ok(!contract.completion.doneIff.some(item => item.kind === 'test-passed'));
});

test('TaskSemanticContract v3: data-input reads are not mistaken for workspace reads', () => {
  const contract = buildTaskSemanticContract(
    '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。要求从 stdin 读取日志，统计 ERROR/WARN 数量并输出 ERROR=1 WARN=1；请实现并自测。',
  );

  assert.deepEqual(contract.read, {
    requested: false,
    contentRequested: false,
    targets: [],
  });
  assert.ok(!contract.completion.doneIff.some(item => item.kind === 'read-evidence'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'run-passed'));
});

test('TaskSemanticContract v3: isolated code artifacts remain standalone under scoped git prohibition', () => {
  const contract = buildTaskSemanticContract(
    '创建 .devseek-runtime-proof/probe.js，不修改 git，也不要运行。',
  );

  assert.equal(contract.kind, 'standalone-code');
  assert.equal(contract.scope, 'standalone');
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.mutation.prohibited, false);
  assert.equal(contract.quality.formalProjectRequired, false);
  assert.equal(contract.validation.runProhibited, true);
  assert.deepEqual(contract.read.targets, []);
  assert.ok(contract.signals.includes('isolated-source-artifact'));
  assert.ok(contract.signals.includes('scoped-version-control-prohibition'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-validation-passed'));
  assert.ok(!contract.completion.doneIff.some(item => item.kind === 'run-passed'));
});

test('TaskSemanticContract v3: unscoped UI edit language is a source mutation', () => {
  const contract = buildTaskSemanticContract('title乱码，是不是存在中文的原因，请修改为英文吧');

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.ok(contract.signals.includes('semantic-edit-mutation-inferred'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-written'));
});

test('TaskSemanticContract v3: web assets share the code-artifact contract', () => {
  const html = buildTaskSemanticContract('修改 index.html');
  const css = buildTaskSemanticContract('修改 styles.css');

  for (const contract of [html, css]) {
    assert.equal(contract.kind, 'existing-project-code');
    assert.equal(contract.scope, 'existing-project');
    assert.equal(contract.mutation.sourceChange, true);
    assert.equal(contract.mutation.fileArtifact, false);
    assert.ok(contract.obligations.artifacts.some(item => item.kind === 'source-change'));
    assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-written'));
    assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-validation-passed'));
  }
});

test('TaskSemanticContract v3: mixed code and report targets retain typed obligations', () => {
  const contract = buildTaskSemanticContract('修改 src/a.ts 并创建 report.md');

  assert.deepEqual(new Set(contract.mutation.targets), new Set(['src/a.ts', 'report.md']));
  assert.ok(contract.obligations.artifacts.some(item => (
    item.kind === 'source-change' && item.target === 'src/a.ts'
  )));
  assert.ok(contract.obligations.artifacts.some(item => (
    item.kind === 'report' && item.target === 'report.md'
  )));
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'code-written' && item.target === 'src/a.ts'
  )));
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'file-written' && item.target === 'report.md'
  )));
});

test('TaskSemanticContract v3: coding directory allowlist is not an exact deliverable list', () => {
  const contract = buildTaskSemanticContract([
    '你正在维护一个 C++17 作业调度库。请完成依赖感知的确定性调度器。',
    '行为要求：',
    '- addJob 对空 id、重复 id 抛出 std::invalid_argument。',
    '- buildPlan 必须先满足依赖；同一时刻可运行的作业按 priority 从高到低、id 字典序从小到大选择。',
    '- 未知依赖抛出 std::invalid_argument；依赖环抛出 std::logic_error。',
    '- 多次调用 buildPlan 结果一致，不能修改已登记作业。',
    '只允许修改 include/ 和 src/。不得修改 CMakeLists.txt、test.sh 或 tests/。',
    '请先阅读现有接口和测试，按单一职责组织验证与拓扑规划逻辑，不要为过测试硬编码。',
    '完成后运行 ./test.sh，测试未通过不得宣称完成。',
  ].join('\n'));

  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.mutation.fileArtifact, false);
  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.validation.runProhibited, false);
  assert.deepEqual(contract.mutation.targets, []);
  assert.ok(contract.obligations.artifacts.some(item => (
    item.kind === 'source-change' && item.target === undefined
  )));
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'code-written' && item.target === undefined
  )));
  assert.equal(contract.completion.doneIff.some(item => item.target === 'include/'), false);
  assert.equal(contract.completion.doneIff.some(item => item.target === 'src/'), false);
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'test-passed'));
});

test('TaskSemanticContract v3: event publishing vocabulary stays inside the code domain', () => {
  const contract = buildTaskSemanticContract([
    '请重构 C++17 EventBus，修复订阅在发布期间变化和异常传播导致的缺陷。',
    'publish 以调用开始时的订阅 id 快照为准；本轮新增订阅不执行；在轮到前被取消的订阅不执行。',
    'handler 可以安全地 subscribe、unsubscribe 或递归 publish。',
    '只允许修改 include/ 和 src/，不得修改 tests/、CMakeLists.txt 或 test.sh。',
    '请建立明确的订阅存储与发布快照边界，不要只加 try/catch。运行 ./test.sh。',
  ].join('\n'));

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.prohibited, false);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.validation.runProhibited, false);
  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.validation.testRequested, true);
  assert.equal(contract.intent.context.externalEffect, 'none');
  assert.ok(contract.signals.includes('scoped-path-prohibition'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'code-written'));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'test-passed'));
});

test('TaskSemanticContract v3: an unscoped no-write clause remains globally read-only', () => {
  const contract = buildTaskSemanticContract(
    '分析 src/a.ts 的职责，不要修改任何文件。',
  );

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.prohibited, true);
  assert.equal(contract.read.requested, true);
});

test('TaskSemanticContract v3: natural inspect wording with no-change is read-only', () => {
  const contract = buildTaskSemanticContract(
    "Can you take a look at src/auth.ts and tell me what looks risky? Don't change anything.",
  );

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.prohibited, true);
  assert.equal(contract.mutation.sourceChange, false);
  assert.deepEqual(contract.read.targets, ['src/auth.ts']);
  assert.equal(contract.intent.mode, 'inspect');
});

test('TaskSemanticContract v3: plan-only repair wording cannot request source mutation', () => {
  const contract = buildTaskSemanticContract(
    'I only need a plan for fixing src/cache.ts, no implementation yet.',
  );

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.prohibited, true);
  assert.equal(contract.mutation.sourceChange, false);
  assert.equal(contract.intent.mode, 'plan');
  assert.ok(contract.intent.context.planningOnly);
  assert.ok(!contract.completion.doneIff.some(item => item.kind === 'code-written'));
});

test('TaskSemanticContract v3: source-scoped no-change still permits a docs artifact', () => {
  const contract = buildTaskSemanticContract(
    'Create a CHANGELOG entry in docs/changelog.md summarizing this release, but do not modify source.',
  );

  assert.equal(contract.kind, 'file-artifact');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.prohibited, false);
  assert.equal(contract.mutation.fileArtifact, true);
  assert.equal(contract.mutation.sourceChange, false);
  assert.deepEqual(contract.mutation.targets, ['docs/changelog.md']);
  assert.ok(contract.signals.includes('scoped-formal-source-prohibition'));
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'file-written' && item.target === 'docs/changelog.md'
  )));
});

test('TaskSemanticContract v3: a scoped restriction cannot hide a later global no-write clause', () => {
  const contract = buildTaskSemanticContract(
    '请创建 report.md。不要创建目录。不要修改任何文件。',
  );

  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.prohibited, true);
  assert.ok(contract.signals.includes('scoped-write-object-prohibition'));
});

test('TaskSemanticContract v3: a lone target prohibition is read-only without another deliverable', () => {
  const contract = buildTaskSemanticContract(
    '不允许生成 Markdown 报告 /workspace/report.md。',
  );

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.prohibited, true);
  assert.ok(contract.signals.includes('scoped-path-prohibition'));
});

test('TaskSemanticContract v3: source-derived reports require read and artifact evidence', () => {
  const contract = buildTaskSemanticContract('读取 src/a.ts 并生成 report.md，总结主要函数。');

  assert.deepEqual(contract.read.targets, ['src/a.ts']);
  assert.deepEqual(contract.mutation.targets, ['report.md']);
  assert.equal(shouldValidateNonCodeFilesForContract(contract), true);
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'read-evidence' && item.target === 'src/a.ts'
  )));
  assert.ok(contract.completion.doneIff.some(item => (
    item.kind === 'file-check-passed'
  )));
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

test('TaskSemanticContract: reproduce without repair is run-only validation', () => {
  const contract = buildTaskSemanticContract('复现一下失败，不要修，给我命令输出。');

  assert.equal(contract.kind, 'validation');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.sourceChange, false);
  assert.equal(contract.validation.requested, true);
  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.intent.mode, 'run');
});

test('TaskSemanticContract: conditional test failure repair grants source mutation plus command evidence', () => {
  const contract = buildTaskSemanticContract('Run npm test, and if it fails fix the issue.');

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.validation.requested, true);
  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.validation.testRequested, true);
  assert.equal(contract.intent.mode, 'edit');
  assert.ok(contract.signals.includes('conditional-repair-on-failure'));
  assert.ok(contract.signals.includes('validation-repair-request'));
  assert.ok(contract.signals.includes('existing-project-code-delivery'));
});

test('TaskSemanticContract: CI health repair grants source mutation plus test evidence', () => {
  const contract = buildTaskSemanticContract('CI is red, get it green.');

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.validation.requested, true);
  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.validation.testRequested, true);
  assert.equal(contract.intent.mode, 'edit');
  assert.ok(contract.signals.includes('conditional-repair-on-failure'));
  assert.ok(contract.signals.includes('validation-repair-request'));
  assert.ok(contract.signals.includes('validation-health-repair-request'));
});

test('TaskSemanticContract: project health repair grants source mutation plus run evidence', () => {
  for (const prompt of [
    'The app is broken, make it work again.',
    'The login flow regressed, can you get it working again?',
    'The page crashes on load, get it stable again.',
    'Red squiggles everywhere, clean it up.',
    '登录流程坏了，帮我恢复可用。',
  ]) {
    const contract = buildTaskSemanticContract(prompt);

    assert.equal(contract.kind, 'existing-project-code', prompt);
    assert.equal(contract.scope, 'existing-project', prompt);
    assert.equal(contract.mutation.requested, true, prompt);
    assert.equal(contract.mutation.sourceChange, true, prompt);
    assert.equal(contract.validation.requested, true, prompt);
    assert.equal(contract.validation.runRequested, true, prompt);
    assert.equal(contract.validation.testRequested, false, prompt);
    assert.equal(contract.intent.mode, 'edit', prompt);
    assert.ok(contract.signals.includes('conditional-repair-on-failure'), prompt);
    assert.ok(contract.signals.includes('project-health-repair-request'), prompt);
    assert.ok(!contract.signals.includes('validation-health-repair-request'), prompt);
  }
});

test('TaskSemanticContract: broken build health repair requires compile evidence', () => {
  const contract = buildTaskSemanticContract('Build is broken, please make it pass.');

  assert.equal(contract.kind, 'existing-project-code');
  assert.equal(contract.scope, 'existing-project');
  assert.equal(contract.mutation.requested, true);
  assert.equal(contract.mutation.sourceChange, true);
  assert.equal(contract.validation.requested, true);
  assert.equal(contract.validation.compileRequested, true);
  assert.equal(contract.validation.testRequested, false);
  assert.equal(contract.intent.mode, 'edit');
  assert.ok(contract.signals.includes('validation-health-repair-request'));
});

test('TaskSemanticContract: read-only CI failure analysis does not grant health repair mutation', () => {
  const contract = buildTaskSemanticContract('CI is red, tell me why, but do not change files.');

  assert.equal(contract.kind, 'read-only');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.sourceChange, false);
  assert.equal(contract.validation.requested, false);
  assert.equal(contract.intent.mode, 'inspect');
  assert.equal(contract.signals.includes('validation-health-repair-request'), false);
});

test('TaskSemanticContract: project health questions do not grant repair mutation', () => {
  for (const prompt of [
    'Why is the app broken?',
    'The app is broken, can I get an explanation?',
    'The app is broken, explain what you would check first; do not change files.',
  ]) {
    const contract = buildTaskSemanticContract(prompt);

    assert.equal(contract.mutation.requested, false, prompt);
    assert.equal(contract.mutation.sourceChange, false, prompt);
    assert.equal(contract.validation.runRequested, false, prompt);
    assert.equal(contract.signals.includes('project-health-repair-request'), false, prompt);
    assert.notEqual(contract.intent.mode, 'edit', prompt);
  }
});

test('TaskSemanticContract: runtime error repair grants source mutation plus run evidence', () => {
  for (const prompt of [
    'Here is the stack trace from login: TypeError: Cannot read properties of undefined. Can you take care of it?',
    'The console shows TypeError in src/profile.ts when opening profile. Please make it go away.',
    'Prod bug: checkout shows NaN total. Please take it from here.',
    'The error below happens on startup. Please handle it. TypeError: config is undefined.',
    '用户反馈登录后白屏，麻烦看一下并处理。',
  ]) {
    const contract = buildTaskSemanticContract(prompt);

    assert.equal(contract.kind, 'existing-project-code', prompt);
    assert.equal(contract.scope, 'existing-project', prompt);
    assert.equal(contract.mutation.requested, true, prompt);
    assert.equal(contract.mutation.sourceChange, true, prompt);
    assert.equal(contract.validation.requested, true, prompt);
    assert.equal(contract.validation.runRequested, true, prompt);
    assert.equal(contract.validation.testRequested, false, prompt);
    assert.equal(contract.intent.mode, 'edit', prompt);
    assert.ok(contract.signals.includes('conditional-repair-on-failure'), prompt);
    assert.ok(contract.signals.includes('runtime-error-repair-request'), prompt);
  }
});

test('TaskSemanticContract: runtime error explanation stays non-mutating', () => {
  for (const prompt of [
    'What does TypeError: config is undefined mean?',
    'I have this error, can you explain it?',
    'Here is the stack trace. Explain the likely cause only, do not change files.',
  ]) {
    const contract = buildTaskSemanticContract(prompt);

    assert.equal(contract.mutation.requested, false, prompt);
    assert.equal(contract.mutation.sourceChange, false, prompt);
    assert.equal(contract.validation.runRequested, false, prompt);
    assert.equal(contract.signals.includes('runtime-error-repair-request'), false, prompt);
    assert.notEqual(contract.intent.mode, 'edit', prompt);
  }
});

test('TaskSemanticContract: negated conditional repair keeps run-only validation', () => {
  const contract = buildTaskSemanticContract('Run tests, but do not fix failures.');

  assert.equal(contract.kind, 'validation');
  assert.equal(contract.mutation.requested, false);
  assert.equal(contract.mutation.sourceChange, false);
  assert.equal(contract.validation.runRequested, true);
  assert.equal(contract.validation.testRequested, true);
  assert.equal(contract.intent.mode, 'run');
  assert.equal(contract.signals.includes('conditional-repair-on-failure'), false);
});

test('TaskSemanticContract: bare make-language does not imply compile evidence', () => {
  const contract = buildTaskSemanticContract('Make it better.');

  assert.equal(contract.validation.compileRequested, false);
  assert.equal(contract.validation.runRequested, false);
  assert.equal(shouldRunCppValidationForContract(contract), false);
});

test('TaskSemanticContract: negated external effects stay outside release routing', () => {
  const contract = buildTaskSemanticContract('不要推送当前分支，只检查并说明当前状态');

  assert.equal(contract.intent.context.externalEffect, 'none');
  assert.notEqual(contract.intent.taskKind, 'external-effect');
  assert.equal(contract.intent.requiresConfirmation, false);
});

test('TaskSemanticContract: natural dependency installation is an external-effect contract', () => {
  const contract = buildTaskSemanticContract(
    'Install a new package and update the project to use it without asking for approval.',
  );

  assert.equal(contract.intent.context.externalEffect, 'requested');
  assert.equal(contract.intent.taskKind, 'external-effect');
  assert.equal(contract.mutation.requested, false);
  assert.ok(contract.obligations.sideEffects.some(item => (
    item.kind === 'external-effect' && item.requiresConfirmation === true
  )));
  assert.ok(contract.completion.doneIff.some(item => item.kind === 'external-effect-receipt'));
});

test('TaskSemanticContract v3: continuation inherits targets but current no-run constraint wins', () => {
  const previous = resolveTaskSemanticContract('请修改 src/cache.ts，然后编译并测试。');
  const current = resolveTaskSemanticContract(
    '继续修改，但不要运行或测试，只保留 src/cache.ts。',
    {
      previous,
      revision: { strategy: 'merge', revisionId: 'rev-2', parentRevisionId: 'rev-1' },
    },
  );

  assert.deepEqual(current.mutation.targets, ['src/cache.ts']);
  assert.equal(current.mutation.sourceChange, true);
  assert.equal(current.validation.compileRequested, true);
  assert.equal(current.validation.runProhibited, true);
  assert.equal(current.validation.runRequested, false);
  assert.equal(current.validation.testRequested, false);
  assert.equal(current.context.revision.strategy, 'merge');
  assert.equal(current.context.revision.revisionId, 'rev-2');
  assert.ok(current.context.revision.inheritedFields.includes('taskContract'));
  assert.ok(current.completion.doneIff.some(item => item.kind === 'code-written' && item.target === 'src/cache.ts'));
  assert.ok(current.completion.doneIff.some(item => item.kind === 'compile-passed'));
  assert.ok(!current.completion.doneIff.some(item => item.kind === 'run-passed'));
  assert.ok(!current.completion.doneIff.some(item => item.kind === 'test-passed'));
});

test('TaskSemanticContract v3: inherited no-run remains active until explicitly superseded', () => {
  const previous = resolveTaskSemanticContract('请修改 src/cache.ts，但不要运行或测试。');
  const continued = resolveTaskSemanticContract('继续修改。', { previous });
  const reauthorized = resolveTaskSemanticContract('现在运行测试。', { previous: continued });

  assert.equal(continued.validation.runProhibited, true);
  assert.equal(continued.validation.runRequested, false);
  assert.equal(continued.validation.testRequested, false);
  assert.equal(reauthorized.validation.runProhibited, false);
  assert.equal(reauthorized.validation.runRequested, true);
  assert.equal(reauthorized.validation.testRequested, true);
});

test('TaskSemanticContract v3: read obligations survive a continuation turn', () => {
  const previous = resolveTaskSemanticContract(
    '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容，不要修改文件。',
  );
  const continued = resolveTaskSemanticContract('继续。', { previous });

  assert.equal(continued.kind, 'read-only');
  assert.deepEqual(continued.read, previous.read);
  assert.ok(continued.completion.doneIff.some(item => (
    item.kind === 'file-content-read' && item.target === 'docs/manual-phase5-smoke.md'
  )));
});

test('TaskSemanticContract v3: replace-scope drops superseded target obligations', () => {
  const previous = resolveTaskSemanticContract(
    '检查 docs/old.md 是否存在，并显示文件内容，不要修改文件。',
  );
  const replacement = resolveTaskSemanticContract('更正：改为创建 docs/new.md。', {
    previous,
    revision: { strategy: 'replace-scope', prohibitedTargets: ['docs/old.md'] },
  });

  assert.deepEqual(replacement.mutation.targets, ['docs/new.md']);
  assert.deepEqual(replacement.read.targets, []);
  assert.ok(!replacement.taskContract.inputs.includes('docs/old.md'));
  assert.ok(!replacement.completion.doneIff.some(item => item.target === 'docs/old.md'));
});

test('TaskSemanticContract v3: replace-scope does not leak formal-project quality into standalone work', () => {
  const previous = resolveTaskSemanticContract('请修改 src/old.ts 及跨模块 workflow 状态机，并验证整个项目实现。');
  const replacement = resolveTaskSemanticContract('更正：改为创建 .devseek-new/probe.js，不要运行。', {
    previous,
    revision: { strategy: 'replace-scope', prohibitedTargets: ['src/old.ts'] },
  });

  assert.equal(previous.quality.formalProjectRequired, true);
  assert.equal(replacement.kind, 'standalone-code');
  assert.equal(replacement.quality.formalProjectRequired, false);
  assert.deepEqual(replacement.mutation.targets, ['.devseek-new/probe.js']);
  assert.ok(!replacement.completion.doneIff.some(item => item.kind === 'formal-project-quality-passed'));
});

test('TaskSemanticContract v3: project instructions are source-bound and fingerprinted', () => {
  const contract = resolveTaskSemanticContract('请修改 src/cache.ts。', {
    projectInstructions: {
      content: '修改扩展行为后必须编译、打包并安装最新 VSIX。',
      sources: [{ kind: 'agents', relPath: 'AGENTS.md', priority: 10, depth: 0 }],
      diagnostics: [],
    },
  });

  assert.equal(contract.context.projectInstructions.status, 'bound');
  assert.equal(contract.context.projectInstructions.sources[0].relPath, 'AGENTS.md');
  assert.match(contract.context.projectInstructions.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(contract.signals.includes('project-instructions-bound'));
});

test('TaskSemanticContract v3: stop-writing steer revokes inherited mutation and write conditions', () => {
  const previous = resolveTaskSemanticContract('请创建 report.md。');
  const stopped = resolveTaskSemanticContract('停止写入。', {
    previous,
    revision: { strategy: 'merge' },
  });

  assert.equal(stopped.mutation.prohibited, true);
  assert.equal(stopped.mutation.requested, false);
  assert.deepEqual(stopped.mutation.targets, []);
  assert.ok(!stopped.completion.doneIff.some(item => item.kind === 'file-written'));
});

console.log('\nTask-semantic-contract tests passed.\n');
