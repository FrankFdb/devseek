/**
 * Product run-evidence coverage for the terminal permission boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn as realSpawn } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/terminal-permission-evidence.bundle.cjs');

execSync(
  `npx esbuild src/app/terminal-permission-coordinator.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const fakeVscode = {
  workspace: {
    workspaceFolders: [],
    getConfiguration() {
      return { get(_key, fallback) { return fallback; } };
    },
  },
  window: {
    terminals: [],
    createTerminal(options) {
      const terminal = {
        name: options.name,
        options,
        shown: false,
        commands: [],
        show() { this.shown = true; },
        sendText(command) { this.commands.push(command); },
      };
      this.terminals.push(terminal);
      return terminal;
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithTerminalMocks(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  if (request === 'child_process') {
    return {
      spawn(command, args, options) {
        if (args?.some(arg => String(arg).includes('terminal-evidence-throw'))) {
          throw new Error('simulated terminal spawn failure');
        }
        return realSpawn(command, args, options);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { TerminalPermissionCoordinator } = req(bundlePath);
const {
  createProductRunEvidenceAuthorityToken,
  FileSystemRunEvidenceLedger,
  ProductRunEvidenceSession,
  productRunEvidenceRoot,
  productRunEvidenceIdempotencyKey,
} = req(path.join(rootDir, '../shared/dist/index.js'));

const denyTerminalPolicy = {
  mode: 'qa',
  allowedToolKinds: [],
  requireConfirmationKinds: [],
  deniedToolKinds: ['terminal'],
  requireUserConfirmation: false,
};

const allowTerminalPolicy = {
  mode: 'run',
  allowedToolKinds: ['terminal'],
  requireConfirmationKinds: [],
  deniedToolKinds: [],
  requireUserConfirmation: false,
};

function openRun(workspaceRoot, runId) {
  const ownerToken = createProductRunEvidenceAuthorityToken();
  const participantToken = createProductRunEvidenceAuthorityToken();
  const owner = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId,
    surface: 'terminal-evidence-test-owner',
    authority: { role: 'owner', token: ownerToken, participantToken },
    openIfMissing: true,
  });
  return { owner, participantToken };
}

function inputFor({
  workspaceRoot,
  runId,
  participantToken,
  command,
  policy,
  evidenceErrors,
  policyPreauthorized = false,
}) {
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
  return {
    webview: { postMessage() { return true; } },
    command,
    workdir: workspaceRoot,
    workspaceRoot,
    mode: policy.mode,
    toolPolicy: policy,
    traceRunId: runId,
    traceEvidenceParticipantToken: participantToken,
    onTraceEvidenceError: error => evidenceErrors.push(error),
    policyPreauthorized,
  };
}

function sideEffectEvents(owner) {
  return owner.readEvents().filter(event => event.type.startsWith('side_effect.'));
}

function assertOneExactLifecycle(events, expectedTypes) {
  assert.deepEqual(events.map(event => event.type), expectedTypes);
  assert.equal(new Set(events.map(event => event.payload.operation_id)).size, 1);
  for (const event of events) {
    assert.equal(event.payload.status, event.type.slice('side_effect.'.length));
    assert.equal(event.payload.trust, 'product-runtime-observation');
    assert.equal(event.payload.boundary, 'vscode-terminal-coordinator');
  }
}

function readTypeScriptSources(dir = path.join(rootDir, 'src'), relativeDir = 'src') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readTypeScriptSources(absolutePath, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ relativePath, source: readFileSync(absolutePath, 'utf8') });
    }
  }
  return files;
}

test('Terminal evidence: the canonical Agent entry point propagates participant authority and degradation', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const tracedTerminalCalls = [...extensionSource.matchAll(
    /terminalPermissionCoordinator\.prepareToolExecutionWithPermission\(\{([\s\S]*?)\n\s*\}\);/g,
  )]
    .map(match => match[1])
    .filter(block => block.includes('traceRunId: agentTraceRunId'));

  assert.equal(tracedTerminalCalls.length, 1);
  for (const call of tracedTerminalCalls) {
    assert.match(call, /traceEvidenceParticipantToken:\s*agentRunContext\.evidenceParticipantToken/);
    assert.match(call, /onTraceEvidenceError:\s*error\s*=>\s*agentRunContext\?\.markEvidenceDegraded\(error\)/);
  }
});

test('Terminal evidence: active UI command entry points cannot bypass the owned coordinator', () => {
  for (const relativePath of [
    'src/commands/index.ts',
    'src/ui/deepseek-view-provider.ts',
    'src/ui/extension-command-registration.ts',
  ]) {
    const source = readFileSync(path.join(rootDir, relativePath), 'utf8');
    assert.doesNotMatch(source, /\.sendText\s*\(/, `${relativePath} must not send ungoverned terminal text`);
    assert.doesNotMatch(source, /(?:await\s+)?runCommand\s*\(/, `${relativePath} must not call terminal tools directly`);
  }
  assert.doesNotMatch(
    readFileSync(path.join(rootDir, 'src/commands/index.ts'), 'utf8'),
    /runOwnedCommandWithPermission\s*\(/,
    'D2C command helpers must project AgentCommand instead of owning terminal effects',
  );
  assert.doesNotMatch(
    readFileSync(path.join(rootDir, 'src/ui/extension-command-registration.ts'), 'utf8'),
    /runOwnedCommandWithPermission\s*\(/,
    'D2C command registration must not own terminal effects',
  );
  assert.match(
    readFileSync(path.join(rootDir, 'src/ui/deepseek-view-provider.ts'), 'utf8'),
    /runOwnedCommandWithPermission\s*\(/,
    'visible webview terminal action must use the owned boundary',
  );

  const localRunner = readFileSync(path.join(rootDir, 'src/local-execution-chat-runner.ts'), 'utf8');
  const localRepair = readFileSync(path.join(rootDir, 'src/local-execution-repair.ts'), 'utf8');
  const extension = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const coordinator = readFileSync(path.join(rootDir, 'src/app/terminal-permission-coordinator.ts'), 'utf8');
  assert.doesNotMatch(localRunner, /runLocalExecution\s*\(\s*localPlan\s*\)/);
  assert.match(localRunner, /terminalPermissionCoordinator\.runCommandWithPermissionDetailed\s*\(/);
  assert.match(localRunner, /manageRecoveryExternally:\s*true/);
  assert.doesNotMatch(localRepair, /runAgentTerminalCommandForLocalRepair/);
  assert.match(localRepair, /terminalPermissionCoordinator\.prepareToolExecutionWithPermission\s*\(/);
  assert.doesNotMatch(
    extension,
    /if \(localExecutionResult\.handled\) \{\s*chatRunContext\.complete\('completed'/,
    'handled local execution must not unconditionally claim completed',
  );
  assert.doesNotMatch(extension, /(?:agentRunContext|chatRunContext)\??\.complete\s*\(/);
  assert.match(extension, /terminalPermissionCoordinator\.completeRunContext\s*\(/);
  assert.match(coordinator, /resolveCommandFailuresAfterQualityGate\s*\(/);
  assert.doesNotMatch(coordinator, /async runCommandWithPermission\s*\(/);
  assert.match(coordinator, /runContext\.complete\(status, completionData\)/);
});

test('Terminal evidence: validation execution has one injected authority and no mutable fallback', () => {
  const source = relativePath => readFileSync(path.join(rootDir, relativePath), 'utf8');
  const validationService = source('src/workspace/validation-service.ts');
  const coordinator = source('src/app/terminal-permission-coordinator.ts');
  const autoValidation = source('src/agent/auto-validation.ts');
  const workspaceApplier = source('src/workspace-applier.ts');
  const closedLoop = source('src/app/closed-loop-repair-runner.ts');
  const extension = source('src/extension.ts');
  const viewProvider = source('src/ui/deepseek-view-provider.ts');
  const generatedArtifacts = source('src/ui/generated-artifact-surface-controller.ts');
  const localRepair = source('src/local-execution-repair.ts');
  const agenticLoop = source('src/agent/agentic-loop.ts');
  const toolLoop = source('src/agent/tool-loop.ts');
  const executionPlanner = source('src/execution-planner.ts');
  const legacyExecution = source('src/local-execution.ts');

  assert.doesNotMatch(validationService, /child_process|\bexec\s*\(/);
  assert.match(validationService, /options\.commandRunner\s*\?\?\s*rejectMissingCommandAuthority/);
  assert.match(validationService, /未配置验证命令授权边界/);
  assert.match(coordinator, /createValidationCommandRunner\s*\(/);
  assert.match(coordinator, /executionProfile:\s*'validation'/);
  assert.match(coordinator, /stdout:\s*result\.stdout/);
  assert.match(coordinator, /stderr:\s*result\.stderr/);

  assert.match(autoValidation, /commandRunner:\s*callbacks\.onValidationCommand/);
  assert.match(workspaceApplier, /commandRunner:\s*validationCommandRunner/);
  assert.match(closedLoop, /validationCommandRunner:\s*input\.validationCommandRunner/);
  assert.equal((extension.match(/createValidationCommandRunner\s*\(\{/g) ?? []).length, 2);
  assert.doesNotMatch(viewProvider, /createValidationCommandRunner\s*\(\{/);
  assert.equal((generatedArtifacts.match(/createValidationCommandRunner\s*\(\{/g) ?? []).length, 2);
  assert.equal((localRepair.match(/createValidationCommandRunner\s*\(\{/g) ?? []).length, 1);

  assert.equal(
    existsSync(path.join(rootDir, 'src/agent/deterministic-analyze-execution.ts')),
    false,
    'retired deterministic executor must not restore a parallel terminal path',
  );
  assert.doesNotMatch(agenticLoop, /\brunLocalExecution\s*\(/);
  assert.match(agenticLoop, /executeFakeToolsForLoop\s*\(/);
  assert.match(toolLoop, /plannedTerminalValidation/);
  assert.doesNotMatch(toolLoop, /onTerminalCommand/);
  assert.doesNotMatch(executionPlanner, /child_process|\brunLocalExecution\s*\(/);
  assert.doesNotMatch(legacyExecution, /child_process|\brunLocalExecution\s*\(/);
});

test('Terminal evidence: static process guard allows only the coordinator and explicit read-only adapters', () => {
  const sources = readTypeScriptSources();
  const directTerminalImports = sources
    .filter(({ source }) => /(?:from\s+['"][^'"]*tools\/terminal|import\(['"][^'"]*tools\/terminal)/.test(source))
    .map(({ relativePath }) => relativePath)
    .sort();
  assert.deepEqual(directTerminalImports, [
    'src/app/terminal-permission-coordinator.ts',
    'src/extension.ts',
    'src/local-execution-repair.ts',
  ]);

  for (const relativePath of [
    'src/extension.ts',
    'src/local-execution-repair.ts',
  ]) {
    const source = sources.find(candidate => candidate.relativePath === relativePath)?.source ?? '';
    assert.match(source, /grep|git status|git diff/, `${relativePath} must remain an explicit read-only adapter`);
    assert.doesNotMatch(
      source,
      /runCommand\s*\(\s*\{\s*command:\s*[^\n]*(?:rm\s|mkdir\s|cmake\s|npm\s|g\+\+|gcc\s|clang\s)/,
      `${relativePath} must not gain a mutable direct terminal command`,
    );
  }

  const childProcessImports = sources
    .filter(({ source }) => /(?:from\s+['"]child_process['"]|require\(['"]child_process['"]\)|import\s+\*\s+as\s+\w+\s+from\s+['"]child_process['"])/.test(source))
    .map(({ relativePath }) => relativePath)
    .sort();
  assert.deepEqual(childProcessImports, [
    'src/bridge-client.ts',
    'src/execution-outcome-classifier.ts',
    'src/mcp/client.ts',
    'src/tools/terminal.ts',
  ]);
});

test('Terminal evidence: validation runner preserves stdout and stderr through committed evidence', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-validation-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'validation-streams';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const coordinator = new TerminalPermissionCoordinator();
  const runner = coordinator.createValidationCommandRunner({
    workspaceRoot,
    mode: 'run',
    toolPolicy: allowTerminalPolicy,
    traceRunId: runId,
    traceEvidenceParticipantToken: participantToken,
  });

  const result = await runner({
    command: `node -e "process.stdout.write('validation-out');process.stderr.write('validation-err')"`,
    cwd: workspaceRoot,
    timeoutMs: 5000,
  });

  assert.equal(result.ran, true);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'validation-out');
  assert.equal(result.stderr, 'validation-err');
  assert.match(result.output, /validation-out/);
  assert.match(result.output, /validation-err/);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.committed',
  ]);
  assert.equal(owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }).head.sealed, true);
});

test('Terminal evidence: validation runner preserves non-zero exit and timeout failure semantics', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-validation-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));

  const execute = async (runId, invocation) => {
    const { owner, participantToken } = openRun(workspaceRoot, runId);
    const coordinator = new TerminalPermissionCoordinator();
    const runner = coordinator.createValidationCommandRunner({
      workspaceRoot,
      mode: 'run',
      toolPolicy: allowTerminalPolicy,
      traceRunId: runId,
      traceEvidenceParticipantToken: participantToken,
    });
    return { owner, result: await runner(invocation) };
  };

  const failed = await execute('validation-exit', {
    command: `node -e "process.stdout.write('before-exit');process.stderr.write('compile-error');process.exit(7)"`,
    cwd: workspaceRoot,
    timeoutMs: 5000,
  });
  assert.equal(failed.result.ran, true);
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.exitCode, 7);
  assert.equal(failed.result.stdout, 'before-exit');
  assert.equal(failed.result.stderr, 'compile-error');
  assertOneExactLifecycle(sideEffectEvents(failed.owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.failed',
  ]);
  assert.equal(failed.owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);

  const timedOut = await execute('validation-timeout', {
    command: `node -e "setTimeout(() => {}, 1000)"`,
    cwd: workspaceRoot,
    timeoutMs: 50,
  });
  assert.equal(timedOut.result.ran, true);
  assert.equal(timedOut.result.ok, false);
  assert.equal(timedOut.result.exitCode, 124);
  assert.match(timedOut.result.output, /自动验证按失败处理/);
  assertOneExactLifecycle(sideEffectEvents(timedOut.owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.failed',
  ]);
  assert.equal(timedOut.owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);
});

test('Terminal evidence: a failed command is resolved only after an observable retry and quality gate', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-recovery-after-gate';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const coordinator = new TerminalPermissionCoordinator();
  const commonInput = {
    webview: { postMessage() { return true; } },
    workdir: workspaceRoot,
    workspaceRoot,
    mode: 'run',
    toolPolicy: allowTerminalPolicy,
    traceRunId: runId,
    traceEvidenceParticipantToken: participantToken,
    userConfirmed: true,
  };

  const failed = await coordinator.runCommandWithPermissionDetailed({
    ...commonInput,
    command: 'false',
  });
  assert.equal(failed.outcome, 'failed');
  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), false, 'a failed command alone cannot be resolved');
  const participant = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId,
    surface: 'terminal-evidence-test-validation',
    authority: { role: 'participant', token: participantToken },
  });
  const recordPassedGate = operationId => {
    for (const [type, status] of [
      ['verification.started', 'started'],
      ['verification.completed', 'completed'],
      ['quality_gate.started', 'started'],
      ['quality_gate.passed', 'passed'],
    ]) {
      participant.record({
        type,
        idempotencyKey: productRunEvidenceIdempotencyKey(`terminal-recovery-${type}`, { runId, operationId }),
        payload: {
          operation_id: operationId,
          status,
          trust: 'product-runtime-observation',
        },
      });
    }
  };
  recordPassedGate('terminal-recovery-premature-validation');
  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), false, 'a passed gate without an observable successful retry cannot resolve failure');

  const retried = await coordinator.runCommandWithPermissionDetailed({
    ...commonInput,
    command: 'echo recovered-after-validation',
  });
  assert.equal(retried.outcome, 'committed');
  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), false, 'a quality gate that predates the successful retry cannot resolve failure');

  recordPassedGate('terminal-recovery-post-retry-validation');
  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), true);

  const events = owner.readEvents();
  assert.ok(events.findIndex(event => event.type === 'quality_gate.passed')
    < events.findIndex(event => event.type === 'recovery.completed'));
  assert.equal(owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed, true);
});

test('Terminal evidence: automatic validation cannot claim an interactive verification recovery', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-recovery-during-validation';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const coordinator = new TerminalPermissionCoordinator();
  const commonInput = {
    webview: { postMessage() { return true; } },
    workdir: workspaceRoot,
    workspaceRoot,
    mode: 'run',
    toolPolicy: allowTerminalPolicy,
    traceRunId: runId,
    traceEvidenceParticipantToken: participantToken,
    userConfirmed: true,
  };
  const participant = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId,
    surface: 'terminal-evidence-test-validation',
    authority: { role: 'participant', token: participantToken },
  });
  const record = (type, operationId, status) => participant.record({
    type,
    idempotencyKey: productRunEvidenceIdempotencyKey(`terminal-validation-recovery-${type}`, { runId, operationId }),
    payload: {
      operation_id: operationId,
      status,
      trust: 'product-runtime-observation',
    },
  });

  const failed = await coordinator.runCommandWithPermissionDetailed({
    ...commonInput,
    command: 'false',
  });
  assert.equal(failed.outcome, 'failed');
  const validationOperationId = 'auto-validation-python';
  record('verification.started', validationOperationId, 'started');
  const validation = await coordinator.runCommandWithPermissionDetailed({
    ...commonInput,
    command: 'echo auto-validation-ok',
    policyPreauthorized: true,
    executionProfile: 'validation',
  });
  assert.equal(validation.outcome, 'committed');
  record('verification.completed', validationOperationId, 'completed');
  record('quality_gate.started', validationOperationId, 'started');
  record('quality_gate.passed', validationOperationId, 'passed');

  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), false, 'an internal validation command must not resolve an interactive verifier failure');

  const retried = await coordinator.runCommandWithPermissionDetailed({
    ...commonInput,
    command: 'echo interactive-verification-recovered',
  });
  assert.equal(retried.outcome, 'committed');
  const postRetryVerificationId = 'interactive-post-retry-validation';
  record('verification.started', postRetryVerificationId, 'started');
  record('verification.completed', postRetryVerificationId, 'completed');
  record('quality_gate.started', postRetryVerificationId, 'started');
  record('quality_gate.passed', postRetryVerificationId, 'passed');
  assert.equal(coordinator.resolveCommandFailuresAfterQualityGate({
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
  }), true);

  const events = owner.readEvents();
  const failedIndex = events.findIndex(event => event.type === 'side_effect.failed');
  const recoveryDetectedIndex = events.findIndex(event => event.type === 'recovery.detected');
  const validationCommand = events.find(event => (
    event.type === 'side_effect.committed'
    && event.payload.operation_id === validation.operationId
  ));
  const interactiveRetryIndex = events.findIndex(event => (
    event.type === 'side_effect.committed'
    && event.payload.recovery_operation_id
  ));
  const recoveryCompletedIndex = events.findIndex(event => event.type === 'recovery.completed');
  assert.ok(failedIndex >= 0 && recoveryDetectedIndex >= 0 && interactiveRetryIndex >= 0 && recoveryCompletedIndex >= 0);
  assert.equal(validationCommand?.payload.recovery_operation_id, undefined);
  assert.ok(failedIndex < recoveryDetectedIndex && recoveryDetectedIndex < interactiveRetryIndex);
  assert.ok(events.findIndex(event => event.type === 'quality_gate.passed') < recoveryCompletedIndex);
  assert.equal(events.find(event => event.type === 'recovery.detected')?.payload.recovery_lane, 'interactive');
  assert.equal(owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement' }).head.sealed, true);
});

test('Terminal evidence: tagging only a stale command commit cannot prove recovery', t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-stale-commit-recovery';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const participant = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot,
    runId,
    surface: 'terminal-evidence-stale-attack',
    authority: { role: 'participant', token: participantToken },
  });
  const record = (type, operationId, status, extra = {}) => participant.record({
    type,
    idempotencyKey: `${runId}:${type}:${operationId}`,
    payload: {
      operation_id: operationId,
      status,
      trust: 'product-runtime-observation',
      ...extra,
    },
  });
  record('side_effect.requested', 'failed-command:1', 'requested');
  record('side_effect.failed', 'failed-command:1', 'failed');
  record('side_effect.requested', 'stale-command:1', 'requested');
  record('side_effect.authorized', 'stale-command:1', 'authorized');
  record('side_effect.started', 'stale-command:1', 'started');

  const coordinator = new TerminalPermissionCoordinator();
  const recoveryInput = {
    workspaceRoot,
    runId,
    traceEvidenceParticipantToken: participantToken,
    targetOperationIds: ['failed-command:1'],
  };
  const recoveryOperationId = coordinator.beginCommandRecovery(recoveryInput);
  record('side_effect.committed', 'stale-command:1', 'committed', {
    recovery_operation_id: recoveryOperationId,
  });
  for (const [type, status] of [
    ['verification.started', 'started'],
    ['verification.completed', 'completed'],
    ['quality_gate.started', 'started'],
    ['quality_gate.passed', 'passed'],
  ]) {
    record(type, 'verify-stale-command', status);
  }

  assert.equal(coordinator.finishCommandRecovery({
    ...recoveryInput,
    recoveryOperationId,
    status: 'completed',
    verificationOperationId: 'verify-stale-command',
  }), false);
  assert.equal(owner.readEvents().some(event => event.type === 'recovery.completed'), false);
  assert.equal(coordinator.finishCommandRecovery({
    ...recoveryInput,
    recoveryOperationId,
    status: 'failed',
    reason: 'strict-chain-rejected',
  }), true);
  assert.equal(owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement' }).head.sealed, true);
});

test('Terminal evidence: visible terminal stays indeterminate and seals as cancelled, never completed', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];
  fakeVscode.window.terminals.length = 0;

  const result = await new TerminalPermissionCoordinator().runOwnedCommandWithPermission({
    command: 'echo visible-terminal-observation',
    workdir: workspaceRoot,
    workspaceRoot,
    mode: 'run',
    source: 'terminal-evidence-test-visible',
    userConfirmed: true,
    presentation: 'visible',
    terminalName: 'Visible Evidence Test',
    runId: 'terminal-visible-indeterminate',
  });

  assert.equal(result.outcome, 'indeterminate');
  assert.equal(result.settlementStatus, 'cancelled');
  assert.equal(fakeVscode.window.terminals.length, 1);
  assert.deepEqual(fakeVscode.window.terminals[0].commands, ['echo visible-terminal-observation']);
  const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
  const events = ledger.read(result.runId);
  const sideEffects = events.filter(event => event.type.startsWith('side_effect.'));
  assertOneExactLifecycle(sideEffects, [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.indeterminate',
  ]);
  assert.equal(events.some(event => event.type === 'side_effect.committed'), false);
  assert.equal(events.find(event => event.type === 'run.settled')?.payload.status, 'cancelled');
  assert.equal(ledger.verify(result.runId).status, 'valid-sealed');
});

test('Terminal evidence: a committed command exposes failed owner settlement instead of implying whole-run success', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-settlement-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  fakeVscode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];

  class EvidenceDegradingCoordinator extends TerminalPermissionCoordinator {
    completeRunContext(runContext, requestedStatus, data) {
      runContext.markEvidenceDegraded(new Error('simulated owner settlement degradation'));
      return super.completeRunContext(runContext, requestedStatus, data);
    }
  }

  const result = await new EvidenceDegradingCoordinator().runOwnedCommandWithPermission({
    command: `node -e "process.stdout.write('candidate-success')"`,
    workdir: workspaceRoot,
    workspaceRoot,
    mode: 'run',
    source: 'terminal-evidence-test-settlement-degraded',
    userConfirmed: true,
    presentation: 'captured',
    runId: 'terminal-committed-settlement-failed',
  });

  assert.equal(result.outcome, 'committed');
  assert.equal(result.settlementStatus, 'failed');
  assert.match(result.output, /candidate-success/);
  const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
  const events = ledger.read(result.runId);
  assert.equal(events.find(event => event.type === 'run.settled')?.payload.status, 'failed');
  assert.equal(ledger.verify(result.runId).status, 'valid-sealed');
});

test('Terminal evidence: policy deny closes the request as failed and vetoes completed settlement', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-policy-deny';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];

  const output = (await new TerminalPermissionCoordinator().runCommandWithPermissionDetailed(inputFor({
    workspaceRoot,
    runId,
    participantToken,
    command: 'echo must-not-run',
    policy: denyTerminalPolicy,
    evidenceErrors,
  }))).output;

  assert.match(output, /命令未执行/);
  assert.deepEqual(evidenceErrors, []);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.failed',
  ]);
  assert.throws(
    () => owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /completed run/.test(error.message),
  );
  assert.equal(owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);
});

test('Terminal evidence: prepared command cannot dispatch before canonical execution starts', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  fakeVscode.window.terminals.length = 0;
  const runId = 'terminal-prepared-authority-first';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];
  const coordinator = new TerminalPermissionCoordinator();

  const prepared = await coordinator.prepareCommandWithPermission({
    ...inputFor({
      workspaceRoot,
      runId,
      participantToken,
      command: 'pwd',
      policy: allowTerminalPolicy,
      evidenceErrors,
    }),
    presentation: 'visible',
  });

  assert.equal(prepared.constraint.decision, 'allow');
  assert.equal(fakeVscode.window.terminals.length, 0);
  assert.deepEqual(sideEffectEvents(owner).map(event => event.type), [
    'side_effect.requested',
    'side_effect.authorized',
  ]);

  const result = await prepared.execute();
  assert.equal(result.executed, true);
  assert.equal(result.outcome, 'indeterminate');
  assert.deepEqual(fakeVscode.window.terminals[0]?.commands, ['pwd']);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.indeterminate',
  ]);
  assert.deepEqual(evidenceErrors, []);
  assert.equal(owner.settleAndSeal({ status: 'cancelled', idempotencyKey: 'settlement:cancelled' }).head.sealed, true);
});

test('Terminal evidence: a nonzero tool command settles as failed instead of completed', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-tool-nonzero-failed';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];
  const coordinator = new TerminalPermissionCoordinator();

  const prepared = await coordinator.prepareToolExecutionWithPermission(inputFor({
    workspaceRoot,
    runId,
    participantToken,
    command: 'node -e "process.exit(7)"',
    policy: allowTerminalPolicy,
    evidenceErrors,
  }));
  const result = await prepared.execute();

  assert.equal(prepared.constraint.decision, 'allow');
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'terminal-command-failed');
  assert.ok(result.evidenceRefs.some(ref => ref.endsWith(':failed')));
  assert.deepEqual(evidenceErrors, []);
  assert.equal(owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);
});

test('Terminal evidence: denied prepared command never exposes a process effect', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  fakeVscode.window.terminals.length = 0;
  const runId = 'terminal-prepared-denied';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];

  const prepared = await new TerminalPermissionCoordinator().prepareCommandWithPermission({
    ...inputFor({
      workspaceRoot,
      runId,
      participantToken,
      command: 'echo must-not-run',
      policy: denyTerminalPolicy,
      evidenceErrors,
    }),
    presentation: 'visible',
  });
  const result = await prepared.execute();

  assert.equal(prepared.constraint.decision, 'deny');
  assert.equal(result.executed, false);
  assert.equal(fakeVscode.window.terminals.length, 0);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.failed',
  ]);
  assert.deepEqual(evidenceErrors, []);
  assert.equal(owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);
});

test('Terminal evidence: successful execution records authorized, started and committed', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-success';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];

  const output = (await new TerminalPermissionCoordinator().runCommandWithPermissionDetailed(inputFor({
    workspaceRoot,
    runId,
    participantToken,
    command: 'echo terminal-evidence-ok',
    policy: allowTerminalPolicy,
    evidenceErrors,
  }))).output;

  assert.match(output, /terminal-evidence-ok/);
  assert.deepEqual(evidenceErrors, []);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.committed',
  ]);
  assert.equal(owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }).head.sealed, true);
});

test('Terminal evidence: execution exception is indeterminate, preserves the exception and vetoes completion', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-evidence-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-execution-throw';
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];

  await assert.rejects(
    new TerminalPermissionCoordinator().runCommandWithPermissionDetailed(inputFor({
      workspaceRoot,
      runId,
      participantToken,
      command: 'echo terminal-evidence-throw',
      policy: allowTerminalPolicy,
      evidenceErrors,
    })),
    /simulated terminal spawn failure/,
  );

  assert.deepEqual(evidenceErrors, []);
  assertOneExactLifecycle(sideEffectEvents(owner), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.indeterminate',
  ]);
  assert.throws(
    () => owner.settleAndSeal({ status: 'completed', idempotencyKey: 'settlement:completed' }),
    error => error?.code === 'RUN_SEMANTIC_INVALID' && /completed run/.test(error.message),
  );
  assert.equal(owner.settleAndSeal({ status: 'failed', idempotencyKey: 'settlement:failed' }).head.sealed, true);
});

test('Terminal evidence: authorized append failure prevents process dispatch and preserves the durable prefix', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-append-failure-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-authorized-append-failure';
  const marker = path.join(workspaceRoot, 'must-not-exist.txt');
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];
  const nodeFs = req('node:fs');
  const originalWriteFileSync = nodeFs.writeFileSync;
  nodeFs.writeFileSync = function injectedWriteFailure(fd, data, ...rest) {
    if (String(data).includes('"type":"side_effect.authorized"')) {
      throw new Error('injected authorized evidence append failure');
    }
    return originalWriteFileSync.call(this, fd, data, ...rest);
  };
  try {
    await assert.rejects(
      new TerminalPermissionCoordinator().runCommandWithPermissionDetailed(inputFor({
        workspaceRoot,
        runId,
        participantToken,
        command: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'bad')"`,
        policy: allowTerminalPolicy,
        evidenceErrors,
        policyPreauthorized: true,
      })),
      /injected authorized evidence append failure/,
    );
  } finally {
    nodeFs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(existsSync(marker), false);
  assert.deepEqual(sideEffectEvents(owner).map(event => event.type), ['side_effect.requested']);
  assert.equal(evidenceErrors.length, 1);
});

test('Terminal evidence: committed append failure records indeterminate degradation, never a false commit', async t => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-append-failure-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const runId = 'terminal-committed-append-failure';
  const marker = path.join(workspaceRoot, 'did-run.txt');
  const { owner, participantToken } = openRun(workspaceRoot, runId);
  const evidenceErrors = [];
  const nodeFs = req('node:fs');
  const originalWriteFileSync = nodeFs.writeFileSync;
  nodeFs.writeFileSync = function injectedWriteFailure(fd, data, ...rest) {
    if (String(data).includes('"type":"side_effect.committed"')) {
      throw new Error('injected committed evidence append failure');
    }
    return originalWriteFileSync.call(this, fd, data, ...rest);
  };
  try {
    await assert.rejects(
      new TerminalPermissionCoordinator().runCommandWithPermissionDetailed(inputFor({
        workspaceRoot,
        runId,
        participantToken,
        command: `node -e "require('fs').writeFileSync('did-run.txt','ran')"`,
        policy: allowTerminalPolicy,
        evidenceErrors,
        policyPreauthorized: true,
      })),
      /injected committed evidence append failure/,
    );
  } finally {
    nodeFs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(existsSync(marker), true);
  assert.deepEqual(sideEffectEvents(owner).map(event => event.type), [
    'side_effect.requested',
    'side_effect.authorized',
    'side_effect.started',
    'side_effect.indeterminate',
  ]);
  assert.equal(evidenceErrors.length, 1);
});
