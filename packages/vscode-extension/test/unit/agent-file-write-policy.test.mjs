import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-file-write-policy-'));
const bundlePath = path.join(bundleRoot, 'agent-file-write-policy.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/agent-file-write-policy.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { decideAgentFileWrite, projectAgentFileWriteConstraint } = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

const modelLedPolicy = {
  mode: 'model-led',
  allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory', 'edit', 'terminal', 'vscode', 'vscode-command', 'mcp'],
  requireConfirmationKinds: [],
  deniedToolKinds: [],
  requireUserConfirmation: false,
};

const planPolicy = {
  ...modelLedPolicy,
  mode: 'plan',
  allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'control', 'plan', 'memory'],
  deniedToolKinds: ['edit', 'terminal', 'vscode', 'vscode-command', 'mcp'],
};

function decide(absPath, overrides = {}) {
  return decideAgentFileWrite({
    absPath,
    workspaceRoot: '/workspace',
    toolPolicy: modelLedPolicy,
    context: { purpose: 'tool-write', taskAction: 'write_file', toolRisk: 'medium' },
    ...overrides,
  });
}

test('write authority fails closed on malformed or missing structural context', () => {
  assert.equal(decideAgentFileWrite({ absPath: '', workspaceRoot: '/workspace', toolPolicy: modelLedPolicy }).reason, 'invalid-target-path');
  assert.equal(decideAgentFileWrite({ absPath: 'src/main.ts', workspaceRoot: '/workspace', toolPolicy: modelLedPolicy }).reason, 'invalid-target-path');
  assert.equal(decideAgentFileWrite({ absPath: '/workspace/src/main.ts', toolPolicy: modelLedPolicy }).reason, 'missing-workspace-root');
  assert.equal(decideAgentFileWrite({ absPath: '/workspace/src/main.ts', workspaceRoot: '/workspace' }).reason, 'missing-tool-policy');
});

test('write authority contains paths canonically inside the workspace', () => {
  assert.equal(decide('/outside/main.ts').reason, 'target-outside-workspace');

  const root = mkdtempSync(path.join(tmpdir(), 'devseek-write-boundary-'));
  const workspaceRoot = path.join(root, 'workspace');
  const outsideRoot = path.join(root, 'outside');
  mkdirSync(workspaceRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked'));
  try {
    const result = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'linked', 'report.md'),
      workspaceRoot,
      toolPolicy: modelLedPolicy,
      context: { purpose: 'tool-write', toolRisk: 'medium' },
    });
    assert.equal(result.reason, 'target-outside-workspace');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('protected paths and policy denies remain deterministic local vetoes', () => {
  assert.equal(decide('/workspace/src/main.ts', { protectedPath: true }).reason, 'protected-files-match');
  const denied = decide('/workspace/src/main.ts', { toolPolicy: planPolicy });
  assert.equal(denied.action, 'deny');
  assert.match(denied.reason, /tool-kind-(?:denied|not-allowed)/);
});

test('model-led proposals still pass through risk and sensitive-file approvals', () => {
  assert.deepEqual(
    { action: decide('/workspace/src/main.ts').action, reason: decide('/workspace/src/main.ts').reason },
    { action: 'allow', reason: 'workspace-write-allowed' },
  );
  assert.equal(decide('/workspace/src/main.ts', {
    context: { purpose: 'tool-write', taskAction: 'write_file', toolRisk: 'high' },
  }).action, 'requireConfirm');
  assert.equal(decide('/workspace/.env.local').reason, 'sensitive-file-requires-confirmation');
  assert.equal(decide('/workspace/AGENTS.md').reason, 'project-instruction-file-requires-confirmation');
});

test('natural-language spelling and language never alter concrete write arbitration', () => {
  const prompts = [
    '写如 src/main.ts',
    'write src/main.ts',
    'src/main.ts を更新して',
    '不要执行，只解释 write_file 的格式',
  ];
  const decisions = prompts.map(requestPrompt => decideAgentFileWrite({
    absPath: '/workspace/src/main.ts',
    workspaceRoot: '/workspace',
    toolPolicy: modelLedPolicy,
    context: {
      purpose: 'tool-write',
      taskAction: 'write_file',
      toolRisk: 'medium',
      requestPrompt,
    },
  }));
  assert.ok(decisions.every(result => result.action === 'allow'));
});

test('surface projection requires real confirmation evidence before canonical authority can settle', () => {
  const decision = decide('/workspace/src/main.ts', {
    context: { purpose: 'tool-write', taskAction: 'write_file', toolRisk: 'high' },
  });
  assert.equal(projectAgentFileWriteConstraint(decision).decision, 'require-confirmation');
  const settled = projectAgentFileWriteConstraint(decision, 'confirm:simulation');
  assert.equal(settled.decision, 'require-confirmation');
  assert.equal(settled.confirmationRef, 'confirm:simulation');
});
