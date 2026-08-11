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

test('TaskSemanticContract: negated external effects stay outside release routing', () => {
  const contract = buildTaskSemanticContract('不要推送当前分支，只检查并说明当前状态');

  assert.equal(contract.intent.context.externalEffect, 'none');
  assert.notEqual(contract.intent.taskKind, 'external-effect');
  assert.equal(contract.intent.requiresConfirmation, false);
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
