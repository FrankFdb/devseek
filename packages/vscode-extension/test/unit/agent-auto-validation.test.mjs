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
