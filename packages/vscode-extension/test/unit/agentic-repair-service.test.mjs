import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-repair-service.bundle.cjs');

execSync(
  `npx esbuild src/app/agentic-repair-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  AgenticRepairService,
  buildValidationFailureSignature,
  responseClaimsStatusOk,
  shouldRunClosedLoopRepair,
} = req(bundlePath);

function validation(overrides = {}) {
  return {
    ran: true,
    ok: false,
    status: 'failed',
    command: 'cmake --build build && ctest',
    exitCode: 2,
    output: 'Renderer.cpp:10: error: drawPixel was not declared\nld returned 1 exit status',
    cwd: '/repo/code/shape_manager',
    risks: ['自动验证命令失败，不能把 QualityGate 标记为通过。'],
    alternativeChecks: [],
    ...overrides,
  };
}

function applyResult(overrides = {}) {
  return {
    applied: true,
    changeCount: 1,
    changedPaths: ['code/shape_manager/Renderer.cpp'],
    validation: validation(),
    review: {
      files: {
        total: 1,
        creates: 0,
        overwrites: 0,
        patches: 1,
        changedPaths: ['code/shape_manager/Renderer.cpp'],
      },
      validation: {
        failureFiles: ['code/shape_manager/Renderer.cpp'],
      },
      unfinishedItems: [],
    },
    ...overrides,
  };
}

test('AgenticRepairService: repair prompt is evidence-first and forbids OK-only replies', () => {
  const service = new AgenticRepairService(applyResult());
  const prompt = service.buildRepairPrompt({
    originalPrompt: '编译测试，修正问题',
    changedPaths: ['code/shape_manager/Renderer.cpp'],
    validation: validation({ mode: 'cmake-project', reason: 'project-build' }),
    round: 2,
    priorRepairRejection: '上一轮修复没有改变验证错误。',
    failureFiles: ['code/shape_manager/Renderer.cpp'],
  });

  assert.match(prompt, /本地验证状态为 FAILED/);
  assert.match(prompt, /验证失败涉及文件/);
  assert.match(prompt, /code\/shape_manager\/Renderer\.cpp/);
  assert.match(prompt, /禁止只输出 STATUS: OK/);
  assert.match(prompt, /必须改变定位策略/);
  assert.match(prompt, /只由 DevSeek 下一轮本地命令决定/);
});

test('AgenticRepairService: repeated unchanged failures escalate once then stop', () => {
  const service = new AgenticRepairService(applyResult());
  const first = service.evaluateAppliedRepair(applyResult(), true);
  const second = service.evaluateAppliedRepair(applyResult(), true);

  assert.equal(first.kind, 'retry-with-root-cause');
  assert.match(first.rejection, /本地验证错误没有变化/);
  assert.match(first.rejection, /优先修复验证失败涉及文件/);
  assert.equal(second.kind, 'stop-no-progress');
  assert.match(second.detail, /已停止继续自动修复/);
});

test('AgenticRepairService: repair progress thresholds are delegated to bounded repair policy', () => {
  const source = readFileSync(path.join(rootDir, 'src/app/agentic-repair-service.ts'), 'utf8');

  assert.match(source, /decideBoundedRepairProgress/);
  assert.doesNotMatch(source, /stagnantFailureRounds\s*>=\s*2/);
  assert.doesNotMatch(source, /stagnantFailureRounds\s*>=\s*1\s*&&\s*repeatedRepairAttempt/);
});

test('AgenticRepairService: repeated same patch plus same failure stops immediately', () => {
  const service = new AgenticRepairService(applyResult());
  const distinctFailure = applyResult({
    changedPaths: ['code/shape_manager/Renderer.cpp'],
    validation: validation({
      output: 'Triangle.cpp:22: error: renderer was not declared',
    }),
    review: {
      files: {
        total: 1,
        creates: 0,
        overwrites: 0,
        patches: 1,
        changedPaths: ['code/shape_manager/Renderer.cpp'],
      },
      validation: {
        failureFiles: ['code/shape_manager/Triangle.cpp'],
      },
      unfinishedItems: [],
    },
  });

  assert.equal(service.evaluateAppliedRepair(distinctFailure, true).kind, 'progressing');
  const repeated = service.evaluateAppliedRepair(distinctFailure, true);
  assert.equal(repeated.kind, 'stop-no-progress');
  assert.equal(repeated.repeatedRepairAttempt, true);
});

test('AgenticRepairService: truncating overwrite rejection demands minimum diff', () => {
  const service = new AgenticRepairService(applyResult());
  const rejection = service.buildTruncatingOverwriteRepairRejection({
    applied: false,
    changeCount: 0,
    changedPaths: [],
    failureReason: 'truncating-overwrite',
    failureDetail: '原文件约 70 行，新提交约 14 行。',
    blockedChangePaths: ['code/shape_manager/CMakeLists.txt'],
  }, validation());

  assert.match(rejection, /疑似截断覆盖/);
  assert.match(rejection, /code\/shape_manager\/CMakeLists\.txt/);
  assert.match(rejection, /必须输出 unified diff/);
  assert.match(rejection, /保留现有未相关内容/);
});

test('AgenticRepairService: validation signatures include command, exit code and failure files', () => {
  const a = buildValidationFailureSignature(validation(), ['a.cpp']);
  const b = buildValidationFailureSignature(validation(), ['b.cpp']);
  const c = buildValidationFailureSignature(validation({ exitCode: 1 }), ['a.cpp']);

  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(responseClaimsStatusOk('\nSTATUS: OK\n'), true);
  assert.equal(responseClaimsStatusOk('STATUS: NG'), false);
});

test('AgenticRepairService: repair gate admits only failed runnable validation evidence', () => {
  assert.equal(shouldRunClosedLoopRepair(applyResult()), true);
  assert.equal(shouldRunClosedLoopRepair(applyResult({
    qualityGate: { status: 'blocked', summary: 'blocked', evidenceRefs: [], risks: [], alternativeChecks: [], requiredActions: [] },
  })), false);
  assert.equal(shouldRunClosedLoopRepair(applyResult({
    validation: validation({ ran: false, status: 'blocked', command: '' }),
  })), false);
  assert.equal(shouldRunClosedLoopRepair(applyResult({
    validation: validation({ ok: true, status: 'passed', exitCode: 0 }),
  })), false);
});
