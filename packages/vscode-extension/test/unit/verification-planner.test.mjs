/**
 * Unit tests for app/verification-planner.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/verification-planner.bundle.cjs');

execSync(
  `npx esbuild src/app/verification-planner.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
  VerificationPlanner,
} = req(bundlePath);

test('VerificationPlanner: extension TypeScript entry changes plan semantic check plus compile', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/extension.ts'],
  });

  assert.equal(plan.kind, 'command');
  assert.match(plan.command, /npx tsc --noEmit/);
  assert.match(plan.command, /src\/extension\.ts/);
  assert.match(plan.command, /&& npm run compile/);
  assert.equal(plan.cwd, path.join('/repo', 'packages', 'vscode-extension'));
  assert.equal(plan.timeoutMs, PROJECT_BUILD_VALIDATION_TIMEOUT_MS);
  assert.equal(plan.reason, 'extension-ts-semantic-check');
});

test('VerificationPlanner: extension TypeScript files get targeted semantic check before bundle compile', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts'],
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.cwd, path.join('/repo', 'packages', 'vscode-extension'));
  assert.equal(plan.reason, 'extension-ts-semantic-check');
  assert.match(plan.command, /npx tsc --noEmit/);
  assert.match(plan.command, /src\/workspace\/manual-phase6-quality-gate\.ts/);
  assert.match(plan.command, /&& npm run compile/);
});

test('VerificationPlanner: requested markdown validation uses file checks, not compilers', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/manual-phase6-quality.md'],
    requestPrompt: '创建 docs/manual-phase6-quality.md，内容为 smoke，然后验证文件创建成功。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /test -f/);
  assert.match(plan.command, /manual-phase6-quality\.md/);
  assert.doesNotMatch(plan.command, /\bgcc\b|\bg\+\+\b|\bclang\b|\bnode\b|\bnpm\b/);
});

test('VerificationPlanner: explicit unknown text file writes use file checks, not blocked QualityGate', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['assets/manual-phase6.unknown'],
    requestPrompt: '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target，并验证文件创建成功。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /test -f/);
  assert.match(plan.command, /manual-phase6\.unknown/);
  assert.doesNotMatch(plan.command, /\bgcc\b|\bg\+\+\b|\bclang\b|\bnode\b|\bnpm\b/);
});

test('VerificationPlanner: mixed file facts and unplanned code targets stay blocked', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/readme.md', 'scripts/tool.py'],
    requestPrompt: '更新 docs/readme.md 和 scripts/tool.py，并验证文件创建成功。',
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'no-auto-validation-target');
});

test('VerificationPlanner: unknown targets without file-fact intent produce blocked plan with alternatives', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/readme.md'],
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'no-auto-validation-target');
  assert.ok(plan.risks.some((risk) => /无法证明/.test(risk)));
  assert.ok(plan.alternativeChecks.some((check) => /人工/.test(check)));
});

console.log('\nVerification planner tests passed.\n');
