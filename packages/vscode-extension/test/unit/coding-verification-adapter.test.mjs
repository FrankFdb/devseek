import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-verification-adapter.bundle.cjs');

execSync(
  `npx esbuild src/app/coding-verification-adapter.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  VsCodeVerificationAdapter,
  createStandaloneVsCodeVerificationPorts,
} = require(bundlePath);

const acceptance = [{ id: 'validated', statement: 'Applicable validation passes.' }];

function candidate(overrides = {}) {
  return {
    id: 'vscode-project-test',
    source: 'package.json#scripts.test',
    verifierIds: ['project-verification'],
    strength: 'test',
    priority: 10,
    scopePaths: ['workspace'],
    workspaceAccess: 'read-only',
    steps: [{
      id: 'vscode-project-test:run',
      role: 'test',
      invocation: { kind: 'process', command: 'npm', args: ['test', '--silent'] },
      cwd: '/workspace',
      timeoutMs: 30_000,
      outputPolicy: 'ephemeral',
      evidenceRefs: ['manifest:package.json#scripts.test'],
    }],
    evidenceRefs: ['config:package.json'],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    runId: 'run-vscode-verification',
    sequence: 1,
    actionId: 'verify-1',
    workspaceRoot: '/workspace',
    scopePaths: ['src/main.ts'],
    acceptance,
    evidenceRefs: ['mutation:commit-1'],
    ...overrides,
  };
}

function ports() {
  return createStandaloneVsCodeVerificationPorts({
    runId: 'run-vscode-verification',
    workspaceRoot: '/workspace',
    scopePaths: ['src/main.ts'],
    acceptance,
  });
}

function host(overrides = {}) {
  return {
    discover: () => [candidate()],
    async execute(step) {
      return {
        stepId: step.id,
        status: 'passed',
        summary: 'Project test passed.',
        exitCode: 0,
        workspaceMutationPaths: [],
        evidenceRefs: ['run-evidence:verify-1'],
      };
    },
    ...overrides,
  };
}

test('VS Code adapter composes discovery, shared selection, orchestration, and acceptance settlement', async () => {
  const execution = await new VsCodeVerificationAdapter(host()).verify(input(), ports());

  assert.equal(execution.selection.status, 'selected');
  assert.equal(execution.orchestration.status, 'passed');
  assert.equal(execution.outcome.receipt.status, 'passed');
  assert.deepEqual(execution.outcome.receipt.acceptance, [{
    criterionId: 'validated',
    status: 'passed',
    evidenceRefs: ['run-evidence:verify-1'],
  }]);
});

test('VS Code adapter keeps missing capabilities unverified without executing a host step', async () => {
  let executions = 0;
  const execution = await new VsCodeVerificationAdapter(host({
    discover: () => [],
    async execute() { executions += 1; throw new Error('must not execute'); },
  })).verify(input(), ports());

  assert.equal(executions, 0);
  assert.equal(execution.selection.status, 'unavailable');
  assert.equal(execution.outcome.receipt.status, 'unverified');
});

test('VS Code adapter cannot turn a source-mutating verifier into a pass', async () => {
  const execution = await new VsCodeVerificationAdapter(host({
    async execute(step) {
      return {
        stepId: step.id,
        status: 'passed',
        summary: 'Exited zero after rewriting source.',
        exitCode: 0,
        workspaceMutationPaths: ['src/main.ts'],
        evidenceRefs: ['run-evidence:exit-0'],
      };
    },
  })).verify(input(), ports());

  assert.equal(execution.orchestration.status, 'indeterminate');
  assert.equal(execution.orchestration.errorCode, 'verification-mutated-user-workspace');
  assert.equal(execution.outcome.receipt.status, 'indeterminate');
});

test('VS Code adapter replays one action identity without re-executing the host', async () => {
  let executions = 0;
  const sharedHost = host({
    async execute(step) {
      executions += 1;
      return {
        stepId: step.id,
        status: 'failed',
        summary: 'Tests failed.',
        exitCode: 1,
        workspaceMutationPaths: [],
        evidenceRefs: ['run-evidence:verify-1'],
      };
    },
  });
  const adapter = new VsCodeVerificationAdapter(sharedHost);
  const sharedPorts = ports();
  const first = await adapter.verify(input(), sharedPorts);
  const replay = await adapter.verify(input(), sharedPorts);

  assert.equal(first.outcome.receipt.status, 'failed');
  assert.equal(replay.outcome.replayed, true);
  assert.equal(executions, 1);
});

test('VS Code adapter appends explicit in-process policy checks to the selected candidate', async () => {
  const seen = [];
  const execution = await new VsCodeVerificationAdapter(host({
    async execute(step) {
      seen.push(step.invocation.kind);
      return {
        stepId: step.id,
        status: step.invocation.kind === 'host-check' ? 'failed' : 'passed',
        summary: step.invocation.kind === 'host-check' ? 'Policy failed.' : 'Tests passed.',
        ...(step.invocation.kind === 'process' ? { exitCode: 0 } : {}),
        workspaceMutationPaths: [],
        evidenceRefs: [`evidence:${step.invocation.kind}`],
      };
    },
  })).verify(input({
    hostChecks: [{ id: 'formal-source-quality', evidenceRefs: ['policy:formal-source'] }],
  }), ports());

  assert.deepEqual(seen, ['process', 'host-check']);
  assert.equal(execution.outcome.receipt.status, 'failed');
});

test('terminal verification requires an action-owned settled tool receipt', () => {
  const settlement = execSync('cat src/agent/terminal-evidence-settlement.ts', {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const adapter = execSync('cat src/agent/terminal-verification-adapter.ts', {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.doesNotMatch(settlement, /recordPassedTerminalVerification|VsCodeVerificationAdapter/);
  assert.match(settlement, /classifyAgenticManualReviewEvidence/);
  assert.match(adapter, /toolReceipt\.status === 'completed'/);
  assert.match(adapter, /action\?\.actionId === toolReceipt\.actionId/);
  assert.doesNotMatch(adapter, /prior terminal|uniqueEvidenceOwner|candidates\.length === 1/);
});
