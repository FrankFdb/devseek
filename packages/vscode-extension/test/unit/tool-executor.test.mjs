/**
 * Unit tests for agent/tool-executor.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/tool-executor.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-executor.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { AgentToolExecutor, classifyToolKind } = req(bundlePath);

test('AgentToolExecutor: classifies mutating and terminal tools', () => {
  assert.equal(classifyToolKind('create_file'), 'edit');
  assert.equal(classifyToolKind('run_terminal'), 'terminal');
  assert.equal(classifyToolKind('read_file'), 'read');
  assert.equal(classifyToolKind('mcp__server__tool'), 'mcp');
});

test('AgentToolExecutor: plans activity and permission', () => {
  const executor = new AgentToolExecutor();
  const plan = executor.plan(
    { name: 'run_terminal', input: { command: 'npm test' } },
    {
      mode: 'edit',
      allowedToolKinds: ['read', 'search', 'diagnostics', 'plan', 'edit', 'terminal'],
      requireConfirmationKinds: ['terminal'],
      deniedToolKinds: [],
      requireUserConfirmation: false,
    },
  );

  assert.equal(plan.kind, 'terminal');
  assert.equal(plan.activity.kind, 'terminal');
  assert.equal(plan.permission.action, 'requireConfirm');
});

test('AgentToolExecutor: detects file write tools', () => {
  const executor = new AgentToolExecutor();
  assert.equal(executor.isFileWrite({ name: 'write_file', input: {} }), true);
  assert.equal(executor.isFileWrite({ name: 'read_file', input: {} }), false);
});

console.log('\nTool executor tests passed.\n');
