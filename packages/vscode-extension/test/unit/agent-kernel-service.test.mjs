import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-kernel-service.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-kernel-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { AgentKernelService } = req(bundlePath);
const unusedExecution = {
  async execute() {
    throw new Error('unexpected kernel execution in settlement-only test');
  },
};

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

test('AgentKernelService: headless create run owns TaskContract, run context, and settlement', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agent-kernel-dg01-'));
  const terminalPermissions = {
    calls: [],
    completeRunContext(runContext, requestedStatus, data) {
      this.calls.push({ runId: runContext.runId, requestedStatus, data });
      return runContext.complete(requestedStatus, data);
    },
  };

  try {
    const kernel = new AgentKernelService(terminalPermissions, unusedExecution);
    const kernelRun = kernel.startRun({
      workspaceRoot,
      source: 'unit.agent-kernel',
      runId: 'kernel-dg01-headless-create',
      userPrompt: '创建 dg01.txt，内容为 DG01_OK。',
      sessionId: 'session-kernel',
      mode: 'agent',
      traceLevel: 'debug',
      contextRefs: [{ kind: 'file', uri: 'dg01.txt', label: 'target artifact' }],
    });

    assert.equal(kernelRun.runContext.runId, 'kernel-dg01-headless-create');
    assert.equal(kernelRun.runContext.workspaceRoot, workspaceRoot);
    assert.deepEqual(kernelRun.contextRefs, [{ kind: 'file', uri: 'dg01.txt', label: 'target artifact' }]);
    assert.equal(typeof kernelRun.taskContract, 'object');
    assert.equal(typeof kernelRun.taskContract.verificationContract, 'object');

    const settlement = kernelRun.settleAgentLoopResult({
      tasksTotal: 1,
      tasksApplied: 1,
      tasksFailed: 0,
      changedPaths: ['dg01.txt'],
    });

    assert.equal(settlement.completed, true);
    assert.equal(settlement.status, 'completed');
    assert.equal(terminalPermissions.calls.length, 1);
    assert.deepEqual(terminalPermissions.calls[0].data.changedPaths, ['dg01.txt']);

    const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', 'kernel-dg01-headless-create.log'));
    const started = entries.find(entry => entry.event === 'agent-run-started');
    const completed = entries.find(entry => entry.event === 'agent-run-completed');
    assert.match(started.data.taskContractFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(completed.data.status, 'completed');
    assert.equal(completed.data.tasksApplied, 1);
    assert.equal(completed.data.taskContractFingerprint, started.data.taskContractFingerprint);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentKernelService: failed settlement stays behind the kernel run boundary', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agent-kernel-fail-'));
  const terminalPermissions = {
    completeRunContext(runContext, requestedStatus, data) {
      assert.equal(requestedStatus, 'failed');
      assert.equal(data.reason, 'plan-generation-failed');
      return runContext.complete(requestedStatus, data);
    },
  };

  try {
    const kernelRun = new AgentKernelService(terminalPermissions, unusedExecution).startRun({
      workspaceRoot,
      runId: 'kernel-failed-run',
      userPrompt: '无法解析的任务',
      traceLevel: 'debug',
    });

    assert.equal(kernelRun.failRun({ reason: 'plan-generation-failed' }), 'failed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('R3-01 AgentKernelService: cancelRun routes through the terminal settlement boundary', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agent-kernel-cancel-'));
  const calls = [];
  const terminalPermissions = {
    completeRunContext(runContext, requestedStatus, data) {
      calls.push({ runId: runContext.runId, requestedStatus, data });
      assert.equal(requestedStatus, 'cancelled');
      return runContext.cancel(data);
    },
  };

  try {
    const kernelRun = new AgentKernelService(terminalPermissions, unusedExecution).startRun({
      workspaceRoot,
      runId: 'kernel-cancel-run',
      userPrompt: '修改 src/main.ts',
      traceLevel: 'debug',
    });
    kernelRun.runContext.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'started',
      taskId: 'write-main',
      taskFile: 'main.ts',
      taskAction: 'modify',
      title: '修改 main.ts',
    });

    assert.equal(kernelRun.cancelRun({ reason: 'user-cancelled', source: 'unit-kernel' }), 'cancelled');

    const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', 'kernel-cancel-run.log'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data.reason, 'user-cancelled');
    assert.equal(entries.some(entry => entry.event === 'cancel-requested'), true);
    assert.equal(entries.find(entry => entry.event === 'agent-run-completed').data.status, 'cancelled');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentKernelService: named request contracts enforce the kernel route', async () => {
  const requests = [];
  const execution = {
    async execute(request) {
      requests.push(request);
      return {
        tasksTotal: 0,
        tasksApplied: 0,
        tasksFailed: 0,
        changedPaths: [],
      };
    },
  };
  const kernel = new AgentKernelService({ completeRunContext() {} }, execution);

  await kernel.executeCanonicalTask({
    route: 'legacy-bypass-attempt',
    userPrompt: 'inspect',
    contextFiles: [],
    workspaceRoot: '/repo',
    mode: 'fast',
    callbacks: {},
    workflowMode: 'inspect',
  });
  await kernel.executeCanonicalTask({
    route: 'legacy-bypass-attempt',
    userPrompt: 'edit',
    contextFiles: [],
    mode: 'fast',
    workspaceRoot: '/repo',
    callbacks: {},
    workflowMode: 'edit',
    recovery: {
      version: 'devseek.coding-kernel-recovery/v1',
      kind: 'checkpoint-resume',
      tasks: [{ id: 'resume', file: 'src/main.ts', action: 'modify', desc: 'resume edit' }],
      startFromIndex: 0,
    },
  });

  assert.deepEqual(requests.map(request => request.route), ['canonical', 'canonical']);
  assert.deepEqual(
    requests.map(request => request.semanticContract?.version),
    ['devseek.task-semantic-contract/v3', 'devseek.task-semantic-contract/v3'],
  );
});

test('AgentKernelService: extension Surface does not own agent completion decisions', () => {
  const extension = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const localExecutionRunner = readFileSync(path.join(rootDir, 'src/local-execution-chat-runner.ts'), 'utf8');
  const kernelService = readFileSync(path.join(rootDir, 'src/app/agent-kernel-service.ts'), 'utf8');
  const activeRunCoordinator = readFileSync(path.join(rootDir, 'src/app/active-chat-run-coordinator.ts'), 'utf8');
  const productExecutor = readFileSync(path.join(rootDir, 'src/product-coding-kernel-executor.ts'), 'utf8');

  assert.match(extension, /new AgentKernelService\([\s\S]*productCodingKernelExecutor/);
  assert.match(extension, /agentKernelService\.startRun\(/);
  assert.match(extension, /agentKernelService\.decideExecutionRoute\(/);
  assert.match(extension, /agentKernelService\.executeCanonicalTask\(/);
  assert.doesNotMatch(extension, /executeLegacyPlannedTask|legacyReason|legacy-planned/);
  assert.doesNotMatch(extension, /hasCodeFiles|AGENT_CODE_FILE_RE/);
  assert.match(extension, /agentKernelRun\.settleAgentLoopResult/);
  assert.match(extension, /agentKernelRun\.failRun/);
  assert.match(extension, /activeChatRunCoordinator\.cancelActiveRun/);
  assert.match(activeRunCoordinator, /state\.agentKernelRun\?\.cancelRun\(data\)/);
  assert.equal(importsKernelLoop(extension), false);
  assert.doesNotMatch(extension, /await\s+runAgent(?:ic)?Loop\s*\(/u);
  assert.match(localExecutionRunner, /input\.agentKernelService\.executeCanonicalTask\(\{[\s\S]*createLocalValidationKernelRecovery\(\{/);
  assert.equal(importsKernelLoop(localExecutionRunner), false);
  assert.doesNotMatch(localExecutionRunner, /await\s+runAgent(?:ic)?Loop\s*\(/u);
  assert.doesNotMatch(extension, /from '\.\/app\/agent-run-settlement'/);
  assert.doesNotMatch(extension, /terminalPermissionCoordinator\.completeRunContext\(agentRunContext/);
  assert.match(kernelService, /resolveSemanticExecutionContext\(\{/);
  assert.match(kernelService, /input\.taskContract \?\? semanticContract\.taskContract/);
  assert.doesNotMatch(kernelService, /buildTaskContract\(/);
  assert.match(kernelService, /createDevSeekRunContext\(\{[\s\S]*taskContract/);
  assert.match(kernelService, /semanticContract: request\.semanticContract \?\? resolveTaskSemanticContract\(request\.userPrompt\)/);
  assert.match(kernelService, /this\.execution\.execute\(\{/);
  assert.match(kernelService, /decideExecutionRoute\([\s\S]*decideCodingKernelRoute\(input\)/);
  assert.match(kernelService, /executeCanonicalTask\([\s\S]*route: 'canonical'/);
  assert.doesNotMatch(kernelService, /executeLegacyPlannedTask|legacy-planned/);
  assert.match(kernelService, /private execute\(request: CanonicalKernelExecutionRequest\)/);
  assert.match(kernelService, /settleAgentLoopResult\(this\.terminalPermissions, this\.runContext/);
  assert.match(productExecutor, /runCanonical: request => runAgenticLoop/);
  assert.match(productExecutor, /new CanonicalCodingKernel\(runtime\)/);
  assert.doesNotMatch(productExecutor, /runLegacyPlanned|runAgentLoop/);

  const directImportOwners = listTypeScriptFiles(path.join(rootDir, 'src'))
    .filter(filePath => importsKernelLoop(readFileSync(filePath, 'utf8')))
    .map(filePath => path.relative(path.join(rootDir, 'src'), filePath).replace(/\\/g, '/'));
  assert.deepEqual(directImportOwners, ['product-coding-kernel-executor.ts']);
});

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(filePath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : [];
  });
}

function importsKernelLoop(source) {
  return [...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/gu)]
    .some(match => /\brunAgent(?:ic)?Loop\b/u.test(match[1]));
}
