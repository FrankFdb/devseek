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
  CanonicalEngineeringOrientationService,
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
const { runAgentAutoValidationForWrites } = require(bundlePath);

let runCounter = 0;

function verificationContext(root, scopePaths, statuses = [], activities = [], commandRunner) {
  runCounter += 1;
  const runId = `auto-validation-test-${runCounter}`;
  const acceptance = [{ id: 'verified', statement: 'Applicable project verification passes.' }];
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Apply and verify the requested workspace change',
    mode: 'change',
    include: scopePaths,
    deliverables: scopePaths.map((file, index) => ({
      id: `source-${index + 1}`,
      kind: 'source-change',
      path: file,
    })),
    acceptance: [{
      ...acceptance[0],
      deliverableIds: scopePaths.map((_, index) => `source-${index + 1}`),
      oracle: {
        kind: 'verification',
        verifier: 'project-verification',
        scope: scopePaths,
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
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
      canonicalVerification: new CanonicalVerificationService().bind({ runId, acceptance }),
      canonicalVerificationAcceptance: acceptance,
    },
  };
}

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
    assert.equal(result.evidence.exitCode, 2);
    assert.match(result.feedbackForAI, /SyntaxError/);
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

test('Agent auto validation appends artifact quality as a shared host check', async () => {
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

    assert.equal(result.qualityGate.status, 'fail');
    assert.equal(result.verificationReceipt.status, 'failed');
    assert.match(result.feedbackForAI, /artifact_quality:missing-literal-anchor/);
    assert.match(result.feedbackForAI, /login-state-not-send-button/);
    assert.equal(statuses.some(status => status.title === '生成文件质量门禁未通过'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation rejects weak formal project Markdown despite successful readback', async () => {
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

    assert.equal(result.qualityGate.status, 'fail');
    assert.equal(result.verificationReceipt.status, 'failed');
    assert.match(result.feedbackForAI, /formal_project_markdown_quality/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation rejects standalone sample main for a formal integration task', async () => {
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

    assert.equal(result.qualityGate.status, 'fail');
    assert.equal(result.verificationReceipt.status, 'failed');
    assert.match(result.feedbackForAI, /formal_project_source_quality/);
    assert.match(result.feedbackForAI, /孤岛 main|样例入口/);
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
