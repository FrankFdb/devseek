import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
  assert.deepEqual(statuses.map(status => status.state), ['started', 'completed']);
  assert.deepEqual(activities, [{ kind: 'terminal', label: '自动验证: npm run compile' }]);
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
  ]);
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
