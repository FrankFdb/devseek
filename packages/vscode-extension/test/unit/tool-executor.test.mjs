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
const {
  CanonicalToolDispatchService,
  CanonicalToolAuthorityService,
  resolveCodingKernelTaskContract,
} = req(path.join(rootDir, '../shared/dist/index.js'));

function issueAuthorization(plan, scope, surfaceConstraint) {
  const taskContract = resolveCodingKernelTaskContract({
    prompt: 'Exercise the VS Code canonical tool executor.',
    surface: 'vscode',
    modeHint: 'change',
  });
  const session = new CanonicalToolAuthorityService().bind({
    runId: scope.runId,
    surface: 'vscode',
    workspaceRoot: '/workspace',
    taskContract,
  });
  const receipt = session.authorize({
    actionId: scope.actionId,
    tool: plan.tool.name,
    purpose: plan.purpose,
    effects: plan.effects,
    input: plan.call.input,
    risk: plan.risk,
    surfaceConstraint,
  }).receipt;
  return { receipt, session };
}

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

test('AgentToolExecutor: keeps validation risk classifier-owned while Surface policy may narrow it', () => {
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
  assert.equal(plan.risk, 'medium');
  assert.equal(plan.registered, true);
  assert.equal(plan.activity.kind, 'terminal');
  assert.equal(plan.permission.action, 'requireConfirm');
  assert.deepEqual(plan.plannedRefs, [{ kind: 'terminal', label: 'npm test' }]);
});

test('AgentToolExecutor: maps control tools to non-execution plan refs', () => {
  const executor = new AgentToolExecutor();
  const todoPlan = executor.plan({
    name: 'manage_todo_list',
    input: { todoList: [{ id: 'task-1', status: 'in-progress', title: 'Fix contract' }] },
  });
  const completionPlan = executor.plan({
    name: 'task_complete',
    input: { summary: 'Contract fixed and verified.' },
  });

  assert.equal(todoPlan.kind, 'control');
  assert.deepEqual(todoPlan.plannedRefs, [{ kind: 'plan', label: 'manage_todo_list' }]);
  assert.equal(completionPlan.kind, 'control');
  assert.deepEqual(completionPlan.plannedRefs, [{ kind: 'plan', label: 'task_complete' }]);
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
  assert.equal(plan.permission.reason, 'tool-call-rejected:unknown-tool');
});

test('AgentToolExecutor: consumes shared dispatch rejection before permission and effects', () => {
  const executor = new AgentToolExecutor();
  const envelope = new CanonicalToolDispatchService().dispatch({
    function: {
      name: 'write_file',
      arguments: '{"path":',
    },
  }, { source: 'native' });
  const plan = executor.plan(
    envelope.call,
    {
      mode: 'edit',
      allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'plan', 'memory', 'edit', 'terminal'],
      requireConfirmationKinds: [],
      deniedToolKinds: [],
      requireUserConfirmation: false,
    },
  );
  const validation = executor.validateInput(plan);
  const result = executor.toResult(plan, { output: 'should-not-surface', evidence: [{ kind: 'edit', label: 'x', evidenceId: 'ev-x' }] });

  assert.equal(plan.registered, true);
  assert.equal(plan.call.executable, false);
  assert.equal(plan.permission.action, 'deny');
  assert.equal(plan.permission.reason, 'tool-call-rejected:malformed-tool-arguments');
  assert.equal(validation.ok, false);
  assert.match(validation.error, /malformed-tool-arguments/);
  assert.equal(result.ok, false);
  assert.equal(result.toolName, 'write_file');
  assert.equal(result.error, 'malformed-tool-arguments');
  assert.equal(result.output, undefined);
  assert.deepEqual(result.evidence, []);
});

test('AgentToolExecutor: validates required schema fields', () => {
  const executor = new AgentToolExecutor();
  const invalid = executor.plan({ name: 'read_file', input: {} });
  const valid = executor.plan({ name: 'read_file', input: { path: 'src/index.ts' } });

  assert.equal(executor.validateInput(invalid).ok, false);
  assert.match(executor.validateInput(invalid).error, /缺少必填参数: path/);
  assert.equal(executor.validateInput(valid).ok, true);
});

test('AgentToolExecutor: only successful host results can emit evidence refs', () => {
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
  const hostEvidence = { kind: 'network', label: 'https://example.com', evidenceId: 'ev-host' };
  const result = executor.toResult(plan, { output: 'ok', evidence: [hostEvidence] });

  assert.equal(plan.kind, 'network');
  assert.deepEqual(plan.plannedRefs, [{ kind: 'network', label: 'https://example.com' }]);
  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'fetch_webpage');
  assert.equal(result.output, 'ok');
  assert.deepEqual(result.evidence, [hostEvidence]);
  assert.deepEqual(executor.toResult(plan, { error: 'network failed', evidence: [hostEvidence] }).evidence, []);
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
  assert.deepEqual(plan.plannedRefs, [{ kind: 'edit', label: 'src/obsolete.cpp' }]);
});

test('AgentToolExecutor: delegates terminal settlement to the shared canonical owner', async () => {
  let calls = 0;
  const executor = new AgentToolExecutor();
  const toolPolicy = {
    mode: 'edit',
    allowedToolKinds: ['terminal'],
    requireConfirmationKinds: ['terminal'],
    deniedToolKinds: [],
    requireUserConfirmation: false,
  };
  const plan = executor.plan(
    { name: 'run_terminal', input: { command: 'npm test' } },
    toolPolicy,
  );
  const deniedScope = {
    runId: 'vscode-run-1',
    sequence: 1,
    actionId: 'terminal-1',
  };
  const deniedAuthorization = issueAuthorization(plan, deniedScope, {
    decision: 'require-confirmation',
    reason: 'terminal-confirmation-missing',
    evidenceRefs: ['vscode-authority:terminal-1:confirmation-missing'],
  });
  const denied = await executor.executeCanonical(plan, {
    ...deniedScope,
    authority: deniedAuthorization.receipt,
    authoritySession: deniedAuthorization.session,
    host: {
      async execute() {
        calls++;
        return { status: 'completed', result: 'unexpected', evidenceRefs: ['unexpected'] };
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(denied.receipt.status, 'denied');
  assert.equal(denied.receipt.permission.decision, 'require-confirmation');
  assert.deepEqual(denied.receipt.effects, ['process']);

  const authorizedScope = {
    runId: 'vscode-run-1',
    sequence: 2,
    actionId: 'terminal-2',
  };
  const authorizedAuthority = issueAuthorization(plan, authorizedScope, {
    decision: 'require-confirmation',
    reason: 'terminal-confirmed',
    confirmationRef: 'vscode-confirmation:terminal-2',
    evidenceRefs: ['vscode-authority:terminal-2:confirmed'],
  });
  const authorized = await executor.executeCanonical(plan, {
    ...authorizedScope,
    authority: authorizedAuthority.receipt,
    authoritySession: authorizedAuthority.session,
    host: {
      async execute() {
        calls++;
        return { status: 'completed', result: 'tests passed', evidenceRefs: ['terminal:npm-test:passed'] };
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(authorized.receipt.status, 'completed');
  assert.equal(authorized.receipt.result, 'tests passed');
  assert.equal(authorized.receipt.permission.confirmationRef, 'vscode-confirmation:terminal-2');

  const installPlan = executor.plan(
    { name: 'run_terminal', input: { command: 'npm install left-pad' } },
    toolPolicy,
  );
  const installScope = {
    runId: 'vscode-run-1',
    sequence: 3,
    actionId: 'terminal-install',
  };
  const installAuthorization = issueAuthorization(installPlan, installScope, {
    decision: 'require-confirmation',
    reason: 'terminal-install-confirmation-missing',
    evidenceRefs: ['vscode-authority:terminal-install:confirmation-missing'],
  });
  const installDenied = await executor.executeCanonical(installPlan, {
    ...installScope,
    authority: installAuthorization.receipt,
    authoritySession: installAuthorization.session,
    host: { async execute() { throw new Error('denied install must not execute'); } },
  });
  assert.deepEqual(installDenied.receipt.effects, ['process', 'network', 'workspace-mutation']);
});

console.log('\nTool executor tests passed.\n');
