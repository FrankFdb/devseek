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
  assert.equal(classifyToolKind('delete_file'), 'edit');
  assert.equal(classifyToolKind('run_terminal'), 'terminal');
  assert.equal(classifyToolKind('read_file'), 'read');
  assert.equal(classifyToolKind('fetch_webpage'), 'network');
  assert.equal(classifyToolKind('memory_write'), 'memory');
  assert.equal(classifyToolKind('run_vscode_command'), 'vscode');
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
  assert.equal(plan.risk, 'high');
  assert.equal(plan.registered, true);
  assert.equal(plan.activity.kind, 'terminal');
  assert.equal(plan.permission.action, 'requireConfirm');
  assert.deepEqual(plan.evidence, [{ kind: 'terminal', label: 'npm test' }]);
});

test('AgentToolExecutor: rejects unregistered tools before execution', () => {
  const executor = new AgentToolExecutor();
  const plan = executor.plan(
    { name: 'unknown_magic', input: {} },
    {
      mode: 'edit',
      allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'plan', 'memory', 'edit', 'terminal'],
      requireConfirmationKinds: ['terminal'],
      deniedToolKinds: [],
      requireUserConfirmation: false,
    },
  );

  assert.equal(plan.registered, false);
  assert.equal(plan.permission.action, 'deny');
  assert.equal(plan.permission.reason, 'tool-not-registered:unknown_magic');
});

test('AgentToolExecutor: validates required schema fields', () => {
  const executor = new AgentToolExecutor();
  const invalid = executor.plan({ name: 'read_file', input: {} });
  const valid = executor.plan({ name: 'read_file', input: { path: 'src/index.ts' } });

  assert.equal(executor.validateInput(invalid).ok, false);
  assert.match(executor.validateInput(invalid).error, /缺少必填参数: path/);
  assert.equal(executor.validateInput(valid).ok, true);
});

test('AgentToolExecutor: emits unified tool results with evidence refs', () => {
  const executor = new AgentToolExecutor();
  const plan = executor.plan(
    { name: 'fetch_webpage', input: { url: 'https://example.com' } },
    {
      mode: 'inspect',
      allowedToolKinds: ['read', 'search', 'diagnostics', 'network'],
      requireConfirmationKinds: [],
      deniedToolKinds: [],
      requireUserConfirmation: false,
    },
  );
  const result = executor.toResult(plan, { output: 'ok' });

  assert.equal(plan.kind, 'network');
  assert.deepEqual(plan.evidence, [{ kind: 'network', label: 'https://example.com' }]);
  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'fetch_webpage');
  assert.equal(result.output, 'ok');
  assert.deepEqual(result.evidence, plan.evidence);
});

test('AgentToolExecutor: detects file write tools', () => {
  const executor = new AgentToolExecutor();
  assert.equal(executor.isFileWrite({ name: 'write_file', input: {} }), true);
  assert.equal(executor.isFileWrite({ name: 'read_file', input: {} }), false);
});

test('AgentToolExecutor: registers delete_file as an audited high-risk edit', () => {
  const executor = new AgentToolExecutor();
  const plan = executor.plan({ name: 'delete_file', input: { path: 'src/obsolete.cpp' } });

  assert.equal(plan.registered, true);
  assert.equal(plan.kind, 'edit');
  assert.equal(plan.risk, 'high');
  assert.deepEqual(plan.evidence, [{ kind: 'edit', label: 'src/obsolete.cpp' }]);
});

console.log('\nTool executor tests passed.\n');
