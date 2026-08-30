import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CanonicalBuildOrchestrationService,
  CanonicalDiagnosticService,
  CanonicalEngineeringOrientationService,
  CanonicalRegressionSelectionService,
  CanonicalVerificationService,
  CanonicalVerifierSelectionService,
  buildCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-auto-validation.bundle.cjs');

execSync(
  `npx esbuild src/agent/auto-validation.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  runAgentAutoValidationForWrites,
  selectReusableVerificationReceipt,
} = require(bundlePath);

let runCounter = 0;

function verificationContext(
  root,
  scopePaths,
  statuses = [],
  activities = [],
  commandRunner,
  acceptance = [{ id: 'verified', statement: 'Applicable project verification passes.' }],
) {
  runCounter += 1;
  const runId = `auto-validation-test-${runCounter}`;
  const taskAcceptance = acceptance.length > 0
    ? acceptance.map(criterion => ({
        ...criterion,
        deliverableIds: scopePaths.map((_, index) => `source-${index + 1}`),
        oracle: {
          kind: 'verification',
          verifier: 'project-verification',
          scope: scopePaths,
          evidenceKinds: ['verification-receipt'],
        },
        externalBoundaryRefs: [],
      }))
    : [{
        id: 'workspace-readback',
        statement: 'Committed source files remain readable.',
        deliverableIds: scopePaths.map((_, index) => `source-${index + 1}`),
        oracle: {
          kind: 'workspace-readback',
          verifier: 'workspace-readback',
          scope: scopePaths,
          evidenceKinds: ['workspace-readback'],
        },
        externalBoundaryRefs: [],
      }];
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Apply and verify the requested workspace change',
    mode: 'change',
    include: scopePaths,
    deliverables: scopePaths.map((file, index) => ({
      id: `source-${index + 1}`,
      kind: 'source-change',
      path: file,
    })),
    acceptance: taskAcceptance,
    provenanceRefs: ['test:user-request'],
  });
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: root,
    files: scopePaths.map(file => ({ path: file })),
  });
  return {
    acceptance,
    callbacks: {
      onAgentStatus: status => { statuses.push(status); },
      onToolActivity: (kind, label) => { activities.push({ kind, label }); },
      onValidationCommand: commandRunner ?? (async invocation => ({
        ran: true,
        ok: true,
        command: invocation.command,
        exitCode: 0,
        stdout: 'PASS\n',
        stderr: '',
        output: 'PASS\n',
        cwd: invocation.cwd,
      })),
      traceRunId: runId,
      canonicalVerifierSelection: new CanonicalVerifierSelectionService().bind({
        runId,
        workspaceRoot: root,
        taskContract,
        orientation,
      }),
      canonicalBuildOrchestration: new CanonicalBuildOrchestrationService().bind({ runId }),
      canonicalRegressionSelection: new CanonicalRegressionSelectionService().bind({ runId }),
      canonicalDiagnostics: new CanonicalDiagnosticService().bind({ runId }),
      canonicalVerification: new CanonicalVerificationService().bind({ runId, acceptance }),
      canonicalVerificationAcceptance: acceptance,
    },
  };
}

test('Agent auto validation preserves an explicitly empty canonical acceptance contract', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-empty-acceptance-'));
  try {
    seed(root, 'src/app.js', 'export const value = 1;\n');
    seed(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
    const context = verificationContext(root, ['src/app.js'], [], [], undefined, []);

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '修复 src/app.js 并运行项目测试',
      context.callbacks,
    );

    assert.equal(result.verificationReceipt.status, 'unverified');
    assert.deepEqual(result.verificationReceipt.acceptance, []);
    assert.equal(result.evidence, undefined);
    assert.doesNotMatch(result.feedbackForAI ?? '', /session-acceptance-mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function written(root, relativePath, action = 'modify') {
  return {
    path: path.join(root, relativePath),
    basename: path.basename(relativePath),
    linesAdded: 1,
    linesRemoved: action === 'modify' ? 1 : 0,
    action,
  };
}

function seed(root, relativePath, content) {
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function priorVerificationReceipt(overrides = {}) {
  return {
    version: 'devseek.coding-verification-receipt/v1',
    runId: 'reuse-run',
    sequence: 7,
    actionId: 'terminal-verify-7',
    idempotencyKey: 'reuse-run:terminal-verify-7',
    verifier: 'vscode-terminal-execution',
    status: 'passed',
    scopePaths: ['src/app.js'],
    checks: [{
      checkId: 'terminal-terminal-verify-7',
      status: 'passed',
      acceptanceIds: ['verified'],
      summary: 'Focused verification passed.',
      command: 'npm test',
      exitCode: 0,
      evidenceRefs: ['terminal:verify-7:exit-0'],
    }],
    acceptance: [{
      criterionId: 'verified',
      status: 'passed',
      evidenceRefs: ['terminal:verify-7:exit-0'],
    }],
    evidenceRefs: ['terminal:verify-7:exit-0'],
    ...overrides,
  };
}

function committedChangeReceipt(paths = ['src/app.js'], overrides = {}) {
  return {
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'reuse-run',
    sequence: 5,
    actionId: 'write-5',
    idempotencyKey: 'reuse-run:write-5',
    status: 'committed',
    paths,
    evidenceRefs: ['workspace-mutation:write-5:committed'],
    ...overrides,
  };
}

test('terminal verification reuse requires current run, full scope, current acceptance, and post-write order', () => {
  const base = {
    runId: 'reuse-run',
    changedPaths: ['src/app.js'],
    acceptance: [{ id: 'verified', statement: 'Applicable verification passes.' }],
    verificationReceipts: [priorVerificationReceipt()],
    changeReceipts: [committedChangeReceipt()],
  };

  assert.equal(selectReusableVerificationReceipt(base)?.actionId, 'terminal-verify-7');
  assert.equal(selectReusableVerificationReceipt({
    ...base,
    runId: 'another-run',
  }), undefined);
  assert.equal(selectReusableVerificationReceipt({
    ...base,
    changedPaths: ['src/app.js', 'src/other.js'],
  }), undefined);
  assert.equal(selectReusableVerificationReceipt({
    ...base,
    changeReceipts: [committedChangeReceipt(['src/app.js'], { sequence: 8 })],
  }), undefined);
  assert.equal(selectReusableVerificationReceipt({
    ...base,
    verificationReceipts: [priorVerificationReceipt({
      checks: [{
        ...priorVerificationReceipt().checks[0],
        command: './test.sh 2>&1 | head -50',
      }],
    })],
  }), undefined);
  assert.equal(selectReusableVerificationReceipt({
    ...base,
    verificationReceipts: [
      priorVerificationReceipt(),
      priorVerificationReceipt({
        sequence: 9,
        actionId: 'terminal-verify-9',
        status: 'failed',
        acceptance: [{
          criterionId: 'verified',
          status: 'failed',
          evidenceRefs: ['terminal:verify-9:exit-1'],
        }],
      }),
    ],
  }), undefined);
});

test('Agent auto validation reuses a later same-run terminal proof without rerunning the verifier', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-reuse-terminal-'));
  try {
    seed(root, 'src/app.js', 'export const value = 2;\n');
    seed(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
    const statuses = [];
    let commandRuns = 0;
    const context = verificationContext(
      root,
      ['src/app.js'],
      statuses,
      [],
      async () => {
        commandRuns += 1;
        throw new Error('a settled terminal proof must prevent duplicate validation');
      },
    );
    const prior = priorVerificationReceipt({ runId: context.callbacks.traceRunId });
    const change = committedChangeReceipt(['src/app.js'], {
      runId: context.callbacks.traceRunId,
    });

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '修复 src/app.js 并运行项目测试',
      context.callbacks,
      {
        verificationAcceptance: context.acceptance,
        priorVerificationReceipts: [prior],
        changeReceipts: [change],
      },
    );

    assert.equal(commandRuns, 0);
    assert.equal(result.verificationReceipt, undefined);
    assert.equal(result.qualityGate.status, 'pass');
    assert.match(result.qualityGate.summary, /当前写入批次之后/u);
    assert.match(result.qualityGate.summary, /command="npm test"/u);
    assert.match(result.qualityGate.summary, /exitCode=0/u);
    assert.match(result.qualityGate.summary, /Focused verification passed\./u);
    assert.match(result.feedbackForAI, /无需重复启动自动验证器/);
    assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
      'validate:started',
      'validate:completed',
      'quality:started',
      'quality:completed',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a diagnostic projection receipt cannot suppress canonical auto validation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-projection-proof-'));
  try {
    seed(root, 'src/app.js', 'export const value = 2;\n');
    seed(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
    let commandRuns = 0;
    const context = verificationContext(
      root,
      ['src/app.js'],
      [],
      [],
      async invocation => {
        commandRuns += 1;
        return {
          ran: true,
          ok: true,
          command: invocation.command,
          exitCode: 0,
          stdout: 'PASS\n',
          stderr: '',
          output: 'PASS\n',
          cwd: invocation.cwd,
        };
      },
    );
    const projection = priorVerificationReceipt({
      runId: context.callbacks.traceRunId,
      checks: [{
        ...priorVerificationReceipt().checks[0],
        command: './test.sh 2>&1 | head -50',
      }],
    });

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '修复 src/app.js 并运行项目测试',
      context.callbacks,
      {
        verificationAcceptance: context.acceptance,
        priorVerificationReceipts: [projection],
        changeReceipts: [committedChangeReceipt(['src/app.js'], {
          runId: context.callbacks.traceRunId,
        })],
      },
    );

    assert.equal(commandRuns, 1);
    assert.equal(result.verificationReceipt.status, 'passed');
    assert.doesNotMatch(result.feedbackForAI, /无需重复启动自动验证器/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation settles a selected project verifier as completion evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-pass-'));
  try {
    seed(root, 'src/app.js', 'export const value = 1;\n');
    seed(root, 'package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
    const statuses = [];
    const activities = [];
    const context = verificationContext(root, ['src/app.js'], statuses, activities);

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '修复 src/app.js 并运行项目测试',
      context.callbacks,
      { verificationAcceptance: context.acceptance },
    );

    assert.equal(result.verificationReceipt.status, 'passed');
    assert.equal(result.verificationReceipt.acceptance[0].criterionId, 'verified');
    assert.equal(result.evidence.ok, true);
    assert.equal(result.evidence.kind, 'test');
    assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
      'validate:started',
      'validate:completed',
      'quality:started',
      'quality:completed',
    ]);
    assert.match(activities[0].label, /npm test/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation selects and runs a discovered CMake project test script', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cmake-'));
  try {
    seed(root, 'src/scheduler.cpp', 'int scheduler() { return 1; }\n');
    seed(root, 'CMakeLists.txt', 'enable_testing()\nadd_test(NAME scheduler COMMAND scheduler)\n');
    seed(root, 'test.sh', '#!/usr/bin/env bash\ncmake -S . -B build && ctest --test-dir build\n');
    const invocations = [];
    const context = verificationContext(root, ['src/scheduler.cpp'], [], [], async invocation => {
      invocations.push(invocation);
      return {
        ran: true,
        ok: true,
        command: invocation.command,
        exitCode: 0,
        stdout: 'PASS\n',
        stderr: '',
        output: 'PASS\n',
        cwd: invocation.cwd,
      };
    });

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/scheduler.cpp')],
      root,
      '在既有正式项目的 CMake 接口中实现 C++ 调度器并运行项目测试',
      context.callbacks,
      { verificationAcceptance: context.acceptance },
    );

    assert.equal(result.verificationReceipt.status, 'passed');
    assert.equal(result.evidence.ok, true);
    assert.doesNotMatch(result.feedbackForAI, /formal_project_source_quality/);
    assert.deepEqual(invocations.map(invocation => invocation.command), ['bash test.sh']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation binds project retries to every accumulated changed path', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cmake-retry-'));
  try {
    seed(root, 'include/scheduler.hpp', 'int scheduler();\n');
    seed(root, 'src/scheduler.cpp', 'int scheduler() { return 1; }\n');
    seed(root, 'CMakeLists.txt', 'enable_testing()\nadd_test(NAME scheduler COMMAND scheduler)\n');
    seed(root, 'test.sh', '#!/usr/bin/env bash\ncmake -S . -B build && ctest --test-dir build\n');
    const scopePaths = ['include/scheduler.hpp', 'src/scheduler.cpp'];
    const statuses = [];
    const context = verificationContext(root, scopePaths, statuses);

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/scheduler.cpp')],
      root,
      '修复 include/ 和 src/ 中的 C++ 调度器并运行项目测试',
      context.callbacks,
      {
        verificationAcceptance: context.acceptance,
        verificationScopeWrittenFiles: scopePaths.map(file => written(root, file)),
      },
    );

    assert.equal(result.verificationReceipt.status, 'passed');
    assert.deepEqual(result.verificationReceipt.scopePaths, scopePaths);
    assert.equal(statuses.length, 4);
    assert.equal(statuses.every(status => (
      status.evidenceOperationId === result.evidenceOperationId
      && JSON.stringify(status.verificationScopePaths) === JSON.stringify(scopePaths)
    )), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation preserves a real failing process and blocks completion', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-fail-'));
  try {
    seed(root, 'src/app.js', 'export const value = 1;\n');
    const context = verificationContext(root, ['src/app.js'], [], [], async invocation => ({
      ran: true,
      ok: false,
      command: invocation.command,
      exitCode: 2,
      stdout: '',
      stderr: 'SyntaxError: bad token',
      output: 'SyntaxError: bad token',
      cwd: invocation.cwd,
    }));

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '修复 src/app.js',
      context.callbacks,
    );

    assert.equal(result.verificationReceipt.status, 'failed');
    assert.equal(result.evidence.ok, false);
    assert.equal(result.evidence.kind, 'compile');
    assert.match(result.evidence.command, /^node --check src\/app\.js$/);
    assert.equal(result.evidence.exitCode, 2);
    assert.match(result.feedbackForAI, /SyntaxError/);
    assert.match(result.feedbackForAI, /修复闭环要求/);
    assert.match(result.feedbackForAI, /read_file/);
    assert.match(result.feedbackForAI, /最小失败路径/);
    assert.match(result.feedbackForAI, /相同断言再次失败/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation gives structural C++ compile failures a recovery protocol', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cpp-structural-'));
  try {
    seed(root, 'src/order_book.cpp', [
      'if (order.id.empty()) {',
      '  return trades;',
      '}',
    ].join('\n'));
    const context = verificationContext(root, ['src/order_book.cpp'], [], [], async invocation => ({
      ran: true,
      ok: false,
      command: invocation.command,
      exitCode: 2,
      stdout: '',
      stderr: 'src/order_book.cpp:1:1: error: expected unqualified-id before \'if\'',
      output: 'src/order_book.cpp:1:1: error: expected unqualified-id before \'if\'',
      cwd: invocation.cwd,
    }));

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/order_book.cpp')],
      root,
      '修复订单簿实现',
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /结构性编译失败恢复要求/);
    assert.match(result.feedbackForAI, /不要进入独立需求审查/);
    assert.match(result.feedbackForAI, /replace_in_file/);
    assert.match(result.feedbackForAI, /小 case/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation directs C++ linker repair to the latest mutation caller', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cpp-linker-'));
  try {
    seed(root, 'src/lesson_controller.cpp', 'void run() { handleFractionClick(1, 2, 3, 4); }\n');
    const output = [
      '/usr/bin/ld: lesson_controller.cpp.o: in function `run()`:',
      "lesson_controller.cpp:(.text+0x2a): undefined reference to `LessonController::handleFractionClick(int, int, int, int)'",
      'collect2: error: ld returned 1 exit status',
    ].join('\n');
    const context = verificationContext(root, ['src/lesson_controller.cpp'], [], [], async invocation => ({
      ran: true,
      ok: false,
      command: invocation.command,
      exitCode: 2,
      stdout: '',
      stderr: output,
      output,
      cwd: invocation.cwd,
    }));

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/lesson_controller.cpp')],
      root,
      '修复课程交互并验证',
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /C\/C\+\+ 链接失败恢复要求/);
    assert.match(result.feedbackForAI, /最近变更批次：src\/lesson_controller\.cpp/);
    assert.match(result.feedbackForAI, /优先撤销错误调用或改接项目现有语义所有者/);
    assert.match(result.feedbackForAI, /单文件 apply_patch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation gives missing C++ standard headers a targeted recovery protocol', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cpp-header-'));
  try {
    seed(root, 'src/order_book.cpp', [
      '#include "order_book.hpp"',
      '',
      'std::vector<Trade> OrderBook::submit(Order order) {',
      '  if (order.id.empty()) throw std::invalid_argument("id");',
      '  return {};',
      '}',
    ].join('\n'));
    const output = [
      'src/order_book.cpp: In member function std::vector<Trade> OrderBook::submit(Order):',
      'src/order_book.cpp:4:35: error: ‘invalid_argument’ is not a member of ‘std’',
    ].join('\n');
    const context = verificationContext(root, ['src/order_book.cpp'], [], [], async invocation => ({
      ran: true,
      ok: false,
      command: invocation.command,
      exitCode: 2,
      stdout: '',
      stderr: output,
      output,
      cwd: invocation.cwd,
    }));

    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/order_book.cpp')],
      root,
      '修复订单簿实现',
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /C\+\+ 标准库头文件缺失恢复要求/);
    assert.match(result.feedbackForAI, /std::invalid_argument/);
    assert.match(result.feedbackForAI, /#include <stdexcept>/);
    assert.match(result.feedbackForAI, /只做最小 include 修复/);
    assert.doesNotMatch(result.feedbackForAI, /完整翻译单元被函数体片段覆盖/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation leaves unknown binary targets unverified', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-unavailable-'));
  try {
    seed(root, 'assets/model.bin', Buffer.from([0x00, 0xff, 0x01, 0x02]));
    const context = verificationContext(root, ['assets/model.bin']);
    const result = await runAgentAutoValidationForWrites(
      [written(root, 'assets/model.bin')],
      root,
      '更新二进制模型文件',
      context.callbacks,
    );

    assert.equal(result.verificationReceipt.status, 'unverified');
    assert.equal(result.evidence, undefined);
    assert.match(result.feedbackForAI ?? '', /No applicable|未识别|验证/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation does not derive literal acceptance from ordinary prompt text', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-anchor-'));
  try {
    const target = 'docs/audit.md';
    seed(root, target, '# Audit\n\nBridgeHealthCheck\n');
    const statuses = [];
    const context = verificationContext(root, [target], statuses);
    const prompt = [
      '请创建 Markdown 审计报告。',
      '报告必须逐字包含以下验收锚点：',
      '- BridgeHealthCheck',
      '- login-state-not-send-button',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [written(root, target, 'create')],
      root,
      prompt,
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'pass');
    assert.equal(result.verificationReceipt.status, 'passed');
    assert.doesNotMatch(result.feedbackForAI ?? '', /artifact_quality|login-state-not-send-button/);
    assert.equal(statuses.some(status => status.title === '生成文件质量门禁未通过'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation leaves semantic Markdown quality to the model and explicit acceptance contract', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-md-'));
  try {
    const target = 'docs/01-warranty-design.md';
    seed(root, target, [
      '# 维保提醒设计',
      '',
      '参考 license 模块通讯方式，后续实现遥控器和主控交互。',
      '',
      '`json',
      '{"type":"status"}',
      '`',
    ].join('\n'));
    const context = verificationContext(root, [target]);
    const prompt = [
      '参考 /repo/src/oam/src/license 模块的通讯方式。',
      '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 和平台接口文档，',
      '完成遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现和自闭环验证。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [written(root, target, 'create')],
      root,
      prompt,
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'pass');
    assert.equal(result.verificationReceipt.status, 'passed');
    assert.doesNotMatch(result.feedbackForAI ?? '', /formal_project_markdown_quality/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation does not infer integration architecture from prompt vocabulary', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-source-'));
  try {
    const target = 'src/oam/src/lifting/zc_maintenance/run/src/proc_warranty_main.cpp';
    seed(root, target, [
      '#include <iostream>',
      'int main() {',
      '  std::cout << "standalone";',
      '  return 0;',
      '}',
    ].join('\n'));
    const context = verificationContext(root, [target]);
    const prompt = [
      '在既有主控正式项目内实现吊运维保功能。',
      '参考 license 模块通讯方式，实现遥控器和主控交互并完成自闭环测试。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [written(root, target, 'create')],
      root,
      prompt,
      context.callbacks,
    );

    assert.equal(result.qualityGate.status, 'pass');
    assert.equal(result.verificationReceipt.status, 'passed');
    assert.doesNotMatch(result.feedbackForAI ?? '', /formal_project_source_quality|孤岛 main|样例入口/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation treats report-only Markdown without verifier ports as readback evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-md-readback-'));
  try {
    const target = 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md';
    seed(root, target, [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '',
      `源码证据：${target}`,
      '',
      'BridgeHealthCheck 与 devseek.deepseek-web-connector-health/v1 证明 bridge health 已记录。',
      'plugin-opened DeepSeek page、chatInput evidence 和 loggedInLikely 是本轮登录/ready 边界证据。',
      'deepseek-dom-send-button-missing 表示 send button selector drift is not LOGIN_REQUIRED。',
      'login-state-not-send-button 和 not fixed line-count smoke 已覆盖。',
    ].join('\n'));
    const statuses = [];
    let commandRuns = 0;
    const prompt = [
      '请创建 Markdown 审计报告。',
      '报告必须逐字包含以下验收锚点：',
      '- R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '- BridgeHealthCheck',
      '- devseek.deepseek-web-connector-health/v1',
      '- loggedInLikely',
      '- plugin-opened DeepSeek page',
      '- chatInput evidence',
      '- deepseek-dom-send-button-missing',
      '- login-state-not-send-button',
      '- send button selector drift is not LOGIN_REQUIRED',
      '- not fixed line-count smoke',
      '不要运行编译或测试命令。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [written(root, target, 'create')],
      root,
      prompt,
      {
        onAgentStatus: status => statuses.push(status),
        onValidationCommand: async () => {
          commandRuns += 1;
          throw new Error('report-only readback must not run terminal validation');
        },
      },
    );

    assert.equal(commandRuns, 0);
    assert.equal(result.verificationReceipt, undefined);
    assert.equal(result.evidence?.ok, true);
    assert.match(result.evidence?.command ?? '', /^file-readback /);
    assert.equal(result.qualityGate.status, 'pass');
    assert.doesNotMatch(result.feedbackForAI, /No applicable automatic verifier|Canonical verifier selection/);
    assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
      'validate:started',
      'validate:completed',
      'quality:started',
      'quality:completed',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation fails closed when shared verification ports are absent', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-no-ports-'));
  try {
    seed(root, 'src/app.js', 'export const value = 1;\n');
    const statuses = [];
    const result = await runAgentAutoValidationForWrites(
      [written(root, 'src/app.js')],
      root,
      '更新 src/app.js',
      {
        onAgentStatus: status => statuses.push(status),
        onValidationCommand: async () => { throw new Error('must not run'); },
      },
    );

    assert.equal(result.verificationReceipt, undefined);
    assert.match(result.feedbackForAI, /Canonical verifier selection/);
    assert.equal(statuses.at(-1).state, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
