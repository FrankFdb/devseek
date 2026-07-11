/**
 * Unit tests for AgentFileWritePolicy.
 *
 * Claude Code/Codex-style contract: user-requested document artifacts are
 * runtime deliverables with write/read-back evidence, while normal source edits
 * remain blocked in plan mode and protected paths still hard-block.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-file-write-policy.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-file-write-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideAgentFileWrite, detectIsolatedArtifactWriteScope } = req(bundlePath);

const planPolicy = {
  mode: 'plan',
  allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'plan', 'memory'],
  requireConfirmationKinds: [],
  deniedToolKinds: ['edit', 'terminal', 'vscode', 'vscode-command', 'mcp'],
  requireUserConfirmation: false,
};

test('AgentFileWritePolicy: plan mode blocks ordinary workspace edits', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/src/main.cpp',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'workspace-edit', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: plan mode hard-blocks even explicit Markdown deliverable artifacts', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      taskAction: 'create',
      displayName: 'docs/warranty-maintenance-advice.md',
    },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: a misleading mode label cannot bypass a deny-list', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: {
      ...planPolicy,
      mode: 'fast',
    },
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      taskAction: 'create',
      displayName: 'docs/warranty-maintenance-advice.md',
    },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /tool-kind-denied:edit/);
});

test('AgentFileWritePolicy: Markdown deliverable cannot escape workspace', () => {
  const decision = decideAgentFileWrite({
    absPath: '/tmp/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'target-outside-workspace');
});

test('AgentFileWritePolicy: workspace symlinks cannot redirect deliverables outside the workspace', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-write-containment-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  mkdirSync(workspaceRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked'));
  try {
    const decision = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'linked', 'report.md'),
      workspaceRoot,
      toolPolicy: planPolicy,
      context: { purpose: 'markdown-deliverable', userRequested: true },
    });
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'target-outside-workspace');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: protected files hard-block even explicit deliverables', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    protectedPath: true,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'protected-files-match');
});

test('AgentFileWritePolicy: explicit deliverable exception is limited to Markdown files', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.txt',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: detects isolated artifact output roots from Chinese project prompts', () => {
  const prompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101807',
    '- 设计/实施 Markdown 文档放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src',
    '不要修改正式源码目录里的既有文件；如需改原项目关联代码，请写入原有代码修改清单。',
    '必须创建主设计 Markdown 文档：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
  ].join('\n');

  const scope = detectIsolatedArtifactWriteScope(prompt, '/workspace');

  assert.equal(scope.required, true);
  assert.equal(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807'), false);
  assert.ok(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs'));
  assert.ok(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src'));
});

test('AgentFileWritePolicy: isolated artifact scope blocks writes to formal source directories', () => {
  const requestPrompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101807',
    '- 设计/实施 Markdown 文档放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src',
    '不要修改正式源码目录里的既有文件；如需改原项目关联代码，请写入原有代码修改清单。',
  ].join('\n');

  const denied = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/license/proc_license_main.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/license/proc_license_main.cpp',
      requestPrompt,
    },
  });

  assert.equal(denied.action, 'deny');
  assert.equal(denied.reason, 'isolated-artifact-scope');

  const deniedContainerRootArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/warranty_types.hpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/warranty_types.hpp',
      requestPrompt,
    },
  });

  assert.equal(deniedContainerRootArtifact.action, 'deny');
  assert.equal(deniedContainerRootArtifact.reason, 'isolated-artifact-scope');

  const allowedSourceArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src/warranty_manager.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/src/warranty_manager.cpp',
      requestPrompt,
    },
  });

  assert.equal(allowedSourceArtifact.action, 'allow');

  const allowedDocArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
      requestPrompt,
    },
  });

  assert.equal(allowedDocArtifact.action, 'allow');
});

test('AgentFileWritePolicy: isolated artifact symlinks cannot redirect writes into another workspace directory', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-isolated-containment-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const allowedRoot = path.join(workspaceRoot, 'isolated', 'docs');
  const formalRoot = path.join(workspaceRoot, 'src');
  mkdirSync(allowedRoot, { recursive: true });
  mkdirSync(formalRoot, { recursive: true });
  symlinkSync(formalRoot, path.join(allowedRoot, 'linked'));
  const requestPrompt = [
    `本次测试所有新增设计文档必须放在：${allowedRoot}`,
    `- 设计文档放入：${allowedRoot}`,
    '不要修改正式源码目录里的既有文件。',
  ].join('\n');
  try {
    const decision = decideAgentFileWrite({
      absPath: path.join(allowedRoot, 'linked', 'report.md'),
      workspaceRoot,
      context: {
        purpose: 'markdown-deliverable',
        userRequested: true,
        requestPrompt,
      },
    });
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'isolated-artifact-scope');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: ordinary prompts keep normal workspace write behavior', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/src/main.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'workspace-edit',
      userRequested: true,
      requestPrompt: '请修复 src/main.cpp 的编译错误。',
    },
  });

  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'workspace-write-allowed');
});

console.log('\nAgent file write policy tests passed.\n');
