import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-auto-validation.bundle.cjs');

execSync(
  `npx esbuild src/agent/auto-validation.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { runAgentAutoValidationForWrites } = req(bundlePath);

function makeCallbacks(statuses, activities) {
  return {
    onAgentStatus: (status) => { statuses.push(status); },
    onToolActivity: (kind, label) => { activities.push({ kind, label }); },
  };
}

test('Agent auto validation: successful project validation becomes completion evidence', async () => {
  const statuses = [];
  const activities = [];
  let inputSeen;
  const validationService = {
    validateWorkspaceChanges: async (input) => {
      inputSeen = input;
      return {
        ran: true,
        ok: true,
        command: 'npm run compile',
        exitCode: 0,
        output: 'compiled',
        cwd: '/repo/packages/vscode-extension',
      };
    },
  };

  const result = await runAgentAutoValidationForWrites(
    [{ path: '/repo/packages/vscode-extension/src/agent-loop.ts', basename: 'agent-loop.ts', linesAdded: 1, linesRemoved: 0, action: 'modify' }],
    '/repo',
    '修复 packages/vscode-extension/src/agent-loop.ts 中的问题',
    makeCallbacks(statuses, activities),
    'conservative',
    { validationService },
  );

  assert.deepEqual(inputSeen.changedPaths, ['packages/vscode-extension/src/agent-loop.ts']);
  assert.equal(result.evidence.ok, true);
  assert.equal(result.evidence.kind, 'compile');
  assert.match(result.feedbackForAI, /npm run compile/);
  assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
    'validate:started',
    'validate:completed',
    'quality:started',
    'quality:completed',
  ]);
  assert.equal(new Set(statuses.map(status => status.evidenceOperationId)).size, 1);
  assert.equal(result.evidenceOperationId, statuses[0].evidenceOperationId);
  assert.match(result.evidenceOperationId, /^auto-validation-\d+-packages\/vscode-extension\/src\/agent-loop\.ts$/);
  assert.equal(result.verificationReceipt.status, 'passed');
  assert.equal(result.verificationReceipt.acceptance[0].status, 'passed');
  assert.deepEqual(activities, [{ kind: 'terminal', label: '自动验证: npm run compile' }]);
});

test('Agent auto validation: passing verifier cannot settle a weak requirement oracle', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-weak-requirement-'));
  const target = path.join(root, 'report.md');
  try {
    writeFileSync(target, '# Report\n');
    const statuses = [];
    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: 'test -f report.md',
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'file-artifact-check',
        risks: [],
        alternativeChecks: [],
      }),
    };

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'report.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
      root,
      '生成一个看起来专业的报告。',
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'blocked');
    assert.equal(result.verificationReceipt.status, 'unverified');
    assert.match(result.qualityGate.summary, /acceptance-not-bound-to-executable-oracle/);
    assert.match(result.feedbackForAI, /requirement_contract/);
    assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
      'validate:started',
      'validate:skipped',
      'quality:started',
      'quality:skipped',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: scoped source-backed Markdown audit skips formal project gate', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-scoped-audit-'));
  try {
    const docsDir = path.join(root, 'docs/r3-iteration');
    const srcDir = path.join(root, 'src/deepseek-web-health');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const matrix = path.join(docsDir, 'deepseek-login-ready-state-matrix.md');
    const contract = path.join(srcDir, 'deepseek-login-ready-state-contract.ts');
    const target = path.join(docsDir, 'r3-live-deepseek-login-ready-state.md');
    writeFileSync(matrix, '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n');
    writeFileSync(contract, 'export const owner = "BridgeHealthCheck";\n');
    writeFileSync(target, [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
      '',
      '## 源项目事实矩阵',
      '',
      '| 事实项 | 证据来源 | 证据值 |',
      '|--------|----------|--------|',
      '| Leaf | `deepseek-login-ready-state-matrix.md:1` | `R3-LIVE-DEEPSEEK-LOGIN-READY-STATE` |',
      '| Owner | `deepseek-login-ready-state-contract.ts:1` | `BridgeHealthCheck` |',
      '',
      '## 验收锚点',
      '',
      '- `R3-LIVE-DEEPSEEK-LOGIN-READY-STATE`',
      '- `BridgeHealthCheck`',
      '- `plugin-opened DeepSeek page`',
    ].join('\n'));

    const statuses = [];
    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: "test -f 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md'",
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const prompt = [
      `请基于 ${matrix} 和 ${contract} 创建 Markdown 审计报告。`,
      `请把报告保存到 ${target}。`,
      '报告主题是 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE plugin-opened DeepSeek login readiness audit。',
      '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
      '报告必须包含以下验收锚点：',
      '- R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '- BridgeHealthCheck',
      '- plugin-opened DeepSeek page',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'r3-live-deepseek-login-ready-state.md', linesAdded: 14, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.doesNotMatch(result.feedbackForAI || '', /formal_project_markdown_quality|正式项目 Markdown 质量门禁/);
    assert.equal(
      statuses.some(status => status.state === 'failed' && /正式项目质量门禁未通过/.test(status.title)),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: failed validation blocks completion evidence', async () => {
  const validationService = {
    validateWorkspaceChanges: async () => ({
      ran: true,
      ok: false,
      command: 'npm run compile',
      exitCode: 2,
      output: 'TypeScript error',
      cwd: '/repo/packages/vscode-extension',
    }),
  };

  const result = await runAgentAutoValidationForWrites(
    [{ path: '/repo/packages/vscode-extension/src/app/workflow-service.ts', basename: 'workflow-service.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
    '/repo',
    '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    makeCallbacks([], []),
    'conservative',
    { validationService },
  );

  assert.equal(result.evidence.ok, false);
  assert.equal(result.evidence.exitCode, 2);
  assert.equal(result.verificationReceipt.status, 'failed');
  assert.match(result.feedbackForAI, /自动验证命令未通过，不能把编译\/运行\/测试标记为完成/);
  assert.match(result.feedbackForAI, /TypeScript error/);
});

test('Agent auto validation: explicit content validation failure blocks autonomous rewrite', async () => {
  const statuses = [];
  const validationService = {
    validateWorkspaceChanges: async () => ({
      ran: true,
      ok: false,
      status: 'failed',
      command: 'npx tsc src/workspace/manual-phase6-quality-gate.ts',
      exitCode: 2,
      output: "src/workspace/manual-phase6-quality-gate.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.",
      cwd: '/repo/packages/vscode-extension',
      mode: 'compile-only',
      reason: 'extension-ts-semantic-check',
    }),
  };

  const result = await runAgentAutoValidationForWrites(
    [{
      path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
      basename: 'manual-phase6-quality-gate.ts',
      linesAdded: 1,
      linesRemoved: 0,
      action: 'create',
    }],
    '/repo',
    '创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts，内容为：export const manualPhase6QualityGate: string = 1;',
    makeCallbacks(statuses, []),
    'conservative',
    { validationService },
  );

  assert.equal(result.evidence.ok, false);
  assert.match(result.feedbackForAI, /用户指定了精确文件内容/);
  assert.match(result.repairBlockedReason, /用户指定了精确文件内容/);
  assert.equal(
    statuses.some((status) => status.state === 'failed' && /自动验证失败/.test(status.title)),
    true,
  );
});

test('Agent auto validation: blocked validation is a QualityGate block, not failed repair evidence', async () => {
  const statuses = [];
  const activities = [];
  const validationService = {
    validateWorkspaceChanges: async () => ({
      ran: false,
      ok: false,
      status: 'blocked',
      command: '',
      exitCode: null,
      output: '未执行自动验证: no-auto-validation-target',
      cwd: '/repo',
      mode: 'not-available',
      reason: 'no-auto-validation-target',
      risks: ['未识别到可自动运行的编译、测试或文件检查目标。'],
      alternativeChecks: ['人工检查变更文件内容是否符合用户请求。'],
    }),
  };

  const result = await runAgentAutoValidationForWrites(
    [{ path: '/repo/assets/manual-phase6.unknown', basename: 'manual-phase6.unknown', linesAdded: 1, linesRemoved: 0, action: 'create' }],
    '/repo',
    '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target。',
    makeCallbacks(statuses, activities),
    'conservative',
    { validationService },
  );

  assert.equal(result.evidence, undefined);
  assert.equal(result.qualityGate.status, 'blocked');
  assert.match(result.qualityGate.requiredActions.join('\n'), /补充可运行验证/);
  assert.match(result.qualityGate.alternativeChecks.join('\n'), /人工检查/);
  assert.match(result.feedbackForAI, /QualityGate 阻塞/);
  assert.doesNotMatch(result.feedbackForAI, /自动验证命令未通过/);
  assert.deepEqual(statuses.map((status) => `${status.state}:${status.title}`), [
    'started:自动验证写入结果',
    'skipped:自动验证阻塞',
    'started:评估自动验证 QualityGate',
    'skipped:自动验证 QualityGate 阻塞',
  ]);
  assert.equal(new Set(statuses.map(status => status.evidenceOperationId)).size, 1);
  assert.deepEqual(activities, []);
});

test('Agent auto validation: manual not-run verification is normalized before QualityGate projection', async () => {
  const statuses = [];
  const activities = [];
  const validationService = {
    validateWorkspaceChanges: async () => ({
      ran: false,
      ok: false,
      status: 'failed',
      command: 'python visual_check.py',
      exitCode: null,
      output: 'manual observation required',
      cwd: '/repo',
      reason: 'manual-observation-required',
      risks: [],
      alternativeChecks: ['请人工确认 UI 输出。'],
    }),
  };

  const result = await runAgentAutoValidationForWrites(
    [{ path: '/repo/docs/manual.md', basename: 'manual.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
    '/repo',
    '创建 docs/manual.md，并让用户人工确认 UI 输出。',
    makeCallbacks(statuses, activities),
    'conservative',
    { validationService },
  );

  assert.equal(result.evidence, undefined);
  assert.equal(result.qualityGate.status, 'blocked');
  assert.match(result.feedbackForAI, /\[verification_result: manual-required\]/);
  assert.match(result.qualityGate.evidenceRefs[0], /^validation:manual-required:/);
  assert.deepEqual(activities, []);
});

test('Agent auto validation: markdown file checks become read/check evidence, not compile evidence', async () => {
  const validationService = {
    validateWorkspaceChanges: async () => ({
      ran: true,
      ok: true,
      command: "test -f 'docs/manual-phase5-summary.md' && wc -c 'docs/manual-phase5-summary.md'",
      exitCode: 0,
      output: '42 docs/manual-phase5-summary.md',
      cwd: '/repo',
      mode: 'file-check',
      reason: 'non-code-file-validation',
    }),
  };

  const result = await runAgentAutoValidationForWrites(
    [{ path: '/repo/docs/manual-phase5-summary.md', basename: 'manual-phase5-summary.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
    '/repo',
    '创建 docs/manual-phase5-summary.md 并验证文件创建成功',
    makeCallbacks([], []),
    'conservative',
    { validationService },
  );

  assert.equal(result.evidence.ok, true);
  assert.equal(result.evidence.kind, 'other');
  assert.match(result.feedbackForAI, /non-code-file-validation/);
});

test('Agent auto validation: Markdown literal acceptance anchors block completion when missing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-md-literal-anchors-'));
  try {
    const docsDir = path.join(root, 'docs/r3-iteration');
    mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'r3-live-deepseek-login-ready-state.md');
    writeFileSync(target, [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE Audit Report',
      '',
      'BridgeHealthCheck',
      'send button selector drift is not LOGIN_REQUIRED',
    ].join('\n'));
    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        command: "test -f 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md'",
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const statuses = [];
    const prompt = [
      '请创建 Markdown 审计报告。',
      '报告必须逐字包含以下验收锚点：',
      '- R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '- BridgeHealthCheck',
      '- login-state-not-send-button',
      '- send button selector drift is not LOGIN_REQUIRED',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'r3-live-deepseek-login-ready-state.md', linesAdded: 4, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:missing-literal-anchor/);
    assert.match(result.feedbackForAI, /login-state-not-send-button/);
    assert.equal(statuses.some(status => status.title === '生成文件质量门禁未通过' && status.state === 'failed'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: anchor style guidance does not make explanation bullets literal', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-md-anchor-guidance-'));
  try {
    const docsDir = path.join(root, 'docs/r3-iteration');
    mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, 'r3-live-deepseek-login-ready-state.md');
    writeFileSync(target, [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
      '',
      'BridgeHealthCheck',
      'devseek.deepseek-web-connector-health/v1',
      'loggedInLikely',
      'plugin-opened DeepSeek page',
      'chatInput evidence',
      'deepseek-dom-send-button-missing',
      'login-state-not-send-button',
      'send button selector drift is not LOGIN_REQUIRED',
      'not fixed line-count smoke',
      '',
      '本轮验收不能复用旧 Markdown、固定行数、R3-09B budget artifact 或仅凭窗口已打开判定。',
    ].join('\n'));
    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        command: "test -f 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md'",
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const statuses = [];
    const prompt = [
      '请创建 Markdown 审计报告。',
      '报告正文请使用与本测试 case 相同的中文撰写；技术标识符、协议名、文件路径和验收锚点保持原文。',
      '',
      '报告必须解释：',
      '- 为什么本轮验收不能复用旧 Markdown、固定行数、R3-09B budget artifact 或只看窗口已打开。',
      '',
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
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'r3-live-deepseek-login-ready-state.md', linesAdded: 13, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'pass');
    assert.doesNotMatch(result.feedbackForAI || '', /artifact_quality:missing-literal-anchor/);
    assert.equal(statuses.some(status => status.title === '生成文件质量门禁未通过' && status.state === 'failed'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: cumulative formal Markdown quality is not lost after later source writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-cumulative-formal-quality-'));
  try {
    const docsDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111230/docs');
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111230/src');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const doc = path.join(docsDir, 'warranty-maintenance-implementation.md');
    const source = path.join(srcDir, 'warranty_types.hpp');
    writeFileSync(doc, [
      '# 维保提醒设计',
      '',
      '参考 license 模块通讯方式，后续实现遥控器和主控交互。',
    ].join('\n'));
    writeFileSync(source, '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n');

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: false,
        ok: false,
        status: 'blocked',
        command: '',
        exitCode: null,
        output: '未执行自动验证: cpp-validation-plan-unavailable',
        cwd: root,
        mode: 'not-available',
        reason: 'cpp-validation-plan-unavailable',
        risks: ['未能识别可执行的 C/C++ 构建或编译入口。'],
        alternativeChecks: ['人工检查变更文件内容是否符合用户请求。'],
      }),
    };
    const prompt = [
      '正式项目内实现维保功能，参考 /repo/src/oam/src/license 模块通讯方式。',
      '需要遥控器和主控接口文档、代码实现和自闭环验证，产物隔离到时间戳 docs/src 目录。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: source, basename: 'warranty_types.hpp', linesAdded: 1, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      {
        validationService,
        qualityWrittenFiles: [
          { path: doc, basename: 'warranty-maintenance-implementation.md', linesAdded: 3, linesRemoved: 0, action: 'create' },
          { path: source, basename: 'warranty_types.hpp', linesAdded: 1, linesRemoved: 0, action: 'create' },
        ],
      },
    );

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_markdown_quality/);
    assert.match(result.feedbackForAI, /源项目事实矩阵/);
    assert.match(result.feedbackForAI, /payload_type/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: formal project Markdown quality fails even when file check passes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-md-quality-'));
  try {
    const docsDir = path.join(root, 'docs');
    mkdirSync(docsDir, { recursive: true });
    const target = path.join(docsDir, '01-warranty-design.md');
    const malformedMarkdown = [
      '# 维保提醒设计',
      '',
      '参考 license 模块通讯方式，后续实现遥控器和主控交互。',
      '',
      '`json',
      '{"type":"status"}',
      '`',
    ].join('\n');
    writeFileSync(target, malformedMarkdown);

    const statuses = [];
    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: "test -f 'docs/01-warranty-design.md' && wc -c 'docs/01-warranty-design.md'",
        exitCode: 0,
        output: '88 docs/01-warranty-design.md',
        cwd: root,
        mode: 'file-check',
        reason: 'non-code-file-validation',
        risks: [],
        alternativeChecks: [],
      }),
    };

    const prompt = [
      '参考 /repo/src/oam/src/license 模块的通讯方式。',
      '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 和平台接口文档，',
      '完成遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现和自闭环验证。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: '01-warranty-design.md', linesAdded: 7, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_markdown_quality/);
    assert.doesNotMatch(result.feedbackForAI, /formal_project_markdown_normalized/);
    assert.match(result.feedbackForAI, /JSON 示例必须使用标准 Markdown 三反引号代码块/);
    assert.equal(readFileSync(target, 'utf8'), malformedMarkdown, 'validation and quality evaluation must be pure reads');
    assert.equal(
      statuses.some(status => status.state === 'failed' && /正式项目质量门禁未通过/.test(status.title)),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: formal project source quality requires validation hook for self-loop tasks', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-source-validation-hook-'));
  try {
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111240/src');
    mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'warranty_types.hpp');
    writeFileSync(target, '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n');

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: "test -s 'src/oam/src/lifting/zc_maintenance/202607111240/src/warranty_types.hpp'",
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'cpp-static-artifact-audit',
        risks: ['静态审计不能证明运行时行为正确。'],
        alternativeChecks: ['接入正式工程后重新编译。'],
      }),
    };
    const prompt = [
      '正式项目内实现维保功能，参考 /repo/src/oam/src/license 模块通讯方式。',
      '需要代码实现和自闭环验证，产物隔离到时间戳 docs/src 目录。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'warranty_types.hpp', linesAdded: 1, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_source_quality/);
    assert.match(result.feedbackForAI, /验证钩子/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: Python validation artifact satisfies formal project validation hook', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-source-python-validation-hook-'));
  try {
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111245/src');
    mkdirSync(srcDir, { recursive: true });
    const header = path.join(srcDir, 'warranty_types.hpp');
    const testFile = path.join(srcDir, 'test_warranty.py');
    writeFileSync(header, '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n');
    writeFileSync(testFile, 'def test_validate_warranty_schema():\n    assert True\n');

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: 'python3 src/oam/src/lifting/zc_maintenance/202607111245/src/test_warranty.py',
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'cpp-static-artifact-audit',
        risks: ['静态审计不能证明运行时行为正确。'],
        alternativeChecks: ['接入正式工程后重新编译。'],
      }),
    };
    const prompt = [
      '正式项目内实现维保功能，参考 /repo/src/oam/src/license 模块通讯方式。',
      '需要代码实现和自闭环验证，产物隔离到时间戳 docs/src 目录。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [
        { path: header, basename: 'warranty_types.hpp', linesAdded: 1, linesRemoved: 0, action: 'create' },
        { path: testFile, basename: 'test_warranty.py', linesAdded: 2, linesRemoved: 0, action: 'create' },
      ],
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'pass');
    assert.doesNotMatch(result.feedbackForAI || '', /formal_project_source_quality/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: corrupted shell validation artifact fails formal project source quality', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-source-corrupt-shell-validation-'));
  try {
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607110235/src');
    mkdirSync(srcDir, { recursive: true });
    const header = path.join(srcDir, 'warranty_types.hpp');
    const script = path.join(srcDir, 'test_warranty_integration.sh');
    writeFileSync(header, '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n');
    writeFileSync(script, [
      '#!/bin/bash',
      'set -e',
      'SCRIPT_DIR=(dirname "0")" && pwd)',
      'HEADERS=("warranty_types.hpp")',
      'for f in "{HEADERS[@]}"; do',
      '  if [ -f "SCRIPT_DIR/f" ]; then echo "ok"; fi',
      'done',
    ].join('\n'));

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: 'bash -n test_warranty_integration.sh && static audit',
        exitCode: 0,
        output: 'ok',
        cwd: root,
        mode: 'file-check',
        reason: 'shell-syntax-and-cpp-static-artifact-audit',
        risks: ['静态审计不能证明运行时行为正确。'],
        alternativeChecks: ['接入正式工程后重新编译。'],
      }),
    };
    const prompt = [
      '正式项目内实现维保功能，参考 /repo/src/oam/src/license 模块通讯方式。',
      '需要代码实现和自闭环验证，产物隔离到时间戳 docs/src 目录。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [
        { path: header, basename: 'warranty_types.hpp', linesAdded: 1, linesRemoved: 0, action: 'create' },
        { path: script, basename: 'test_warranty_integration.sh', linesAdded: 7, linesRemoved: 0, action: 'create' },
      ],
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_source_quality/);
    assert.match(result.feedbackForAI, /验证脚本语法或变量引用明显损坏/);
    assert.match(result.feedbackForAI, /bash -n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: validation scripts cannot reference deleted run artifacts', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-missing-validation-artifact-'));
  try {
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111315/src');
    mkdirSync(srcDir, { recursive: true });
    const deletedHeader = path.join(srcDir, 'maintenance_validation.hpp');
    const script = path.join(srcDir, 'verify_warranty.sh');
    writeFileSync(script, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
      'test -s "$SCRIPT_DIR/maintenance_validation.hpp"',
    ].join('\n'));

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: 'bash verify_warranty.sh',
        exitCode: 0,
        output: 'ok',
        cwd: srcDir,
        mode: 'compile-run',
        reason: 'shell-validation-script-run',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const prompt = [
      '在既有主控正式项目中实现维修保养功能，参考 license 模块通信方式。',
      '代码隔离到时间戳目录，并完成编译、测试和自闭环验证。',
    ].join('\n');
    const writtenFiles = [
      { path: deletedHeader, basename: 'maintenance_validation.hpp', linesAdded: 0, linesRemoved: 20, action: 'delete' },
      { path: script, basename: 'verify_warranty.sh', linesAdded: 4, linesRemoved: 0, action: 'create' },
    ];

    const result = await runAgentAutoValidationForWrites(
      writtenFiles,
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      { validationService, qualityWrittenFiles: writtenFiles },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_source_quality/);
    assert.match(result.feedbackForAI, /验证脚本仍引用已删除或缺失的本轮产物/);
    assert.match(result.feedbackForAI, /maintenance_validation\.hpp/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: requested standalone C++ program passes after compile-run evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-standalone-cpp-run-'));
  try {
    const codeDir = path.join(root, 'code');
    mkdirSync(codeDir, { recursive: true });
    const target = path.join(codeDir, 'hello.cpp');
    writeFileSync(target, [
      '#include <iostream>',
      '',
      'int main() {',
      '  std::cout << "helloworld" << std::endl;',
      '  return 0;',
      '}',
    ].join('\n'));

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: "mkdir -p 'code/build/devseek' && g++ 'code/hello.cpp' -o 'code/build/devseek/deepseek_auto_exec' && 'code/build/devseek/deepseek_auto_exec'",
        exitCode: 0,
        output: 'helloworld\n',
        cwd: codeDir,
        mode: 'compile-run',
        reason: 'single-main-run-requested',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const statuses = [];
    const prompt = '编写C++程序，打印helloworld,编译执行';

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'hello.cpp', linesAdded: 6, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks(statuses, []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'pass');
    assert.doesNotMatch(result.feedbackForAI || '', /formal_project_source_quality|正式项目源码质量门禁/);
    assert.deepEqual(statuses.map(status => `${status.phase}:${status.state}`), [
      'validate:started',
      'validate:completed',
      'quality:started',
      'quality:completed',
    ]);
    assert.equal(statuses.find(status => status.phase === 'validate' && status.state === 'completed').title, '自动验证通过');
    assert.equal(statuses.at(-1).title, '自动验证 QualityGate 通过');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent auto validation: formal project source quality rejects standalone sample main', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-auto-formal-source-quality-'));
  try {
    const srcDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/202607111200/src');
    mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'proc_warranty_main.cpp');
    writeFileSync(target, [
      '#include <iostream>',
      'class ProcWarrantyApp {',
      'public:',
      '  static ProcWarrantyApp& instance();',
      '};',
      'int main(int argc, char** argv) {',
      '  (void)argc; (void)argv;',
      '  std::cout << "standalone";',
      '  return 0;',
      '}',
    ].join('\n'));

    const validationService = {
      validateWorkspaceChanges: async () => ({
        ran: true,
        ok: true,
        status: 'passed',
        command: 'g++ -fsyntax-only proc_warranty_main.cpp',
        exitCode: 0,
        output: 'ok',
        cwd: srcDir,
        mode: 'compile-only',
        reason: 'single-main-safe-compile-only',
        risks: [],
        alternativeChecks: [],
      }),
    };
    const prompt = [
      '原来实现的吊运维保功能：设计文档+代码。',
      '参考 /repo/src/oam/src/license 模块的通讯方式，在既有主控正式项目内实现遥控器和主控交互，',
      '需要分析原项目逻辑、设计、代码实现和自闭环测试。',
    ].join('\n');

    const result = await runAgentAutoValidationForWrites(
      [{ path: target, basename: 'proc_warranty_main.cpp', linesAdded: 10, linesRemoved: 0, action: 'create' }],
      root,
      prompt,
      makeCallbacks([], []),
      'conservative',
      { validationService },
    );

    assert.equal(result.evidence.ok, true);
    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /formal_project_source_quality/);
    assert.match(result.feedbackForAI, /孤岛 main|样例入口/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
