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
const { decideAgentFileWrite } = req(bundlePath);

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

test('AgentFileWritePolicy: plan mode allows explicit Markdown deliverable artifacts', () => {
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

  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'explicit-markdown-deliverable');
});

test('AgentFileWritePolicy: explicit Markdown deliverables are not tied to provider speed mode names', () => {
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

  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'explicit-markdown-deliverable');
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

console.log('\nAgent file write policy tests passed.\n');
