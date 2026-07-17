/**
 * Unit tests for app/run-context.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/run-context.bundle.cjs');

execSync(
  `npx esbuild src/app/run-context.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { createDevSeekRunContext } = req(bundlePath);
const {
  FileSystemRunEvidenceLedger,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  productRunEvidenceRoot,
} = req(path.join(rootDir, '../shared/dist/index.js'));

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

function readStartedContractFingerprint(workspaceRoot, runId) {
  const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', `${runId}.log`));
  return entries.find(entry => entry.event === 'agent-run-started').data.taskContractFingerprint;
}

function observed(status, payload = {}) {
  return { ...payload, status, trust: 'product-runtime-observation' };
}

test('RunContext: owns one run id and one chronological log file', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      source: 'unit.run-context',
      runId: 'run-context-1',
      userPrompt: '修复 shape_manager title',
      sessionId: 'session-1',
      mode: 'agent',
      traceLevel: 'debug',
      now: new Date('2026-07-02T10:00:00.000Z'),
    });

    const child = context.childTrace('unit.child');
    child.info('tool', 'tool-fact-recorded', { tool: 'read_file' });
    context.complete('completed', { tasksTotal: 1, tasksFailed: 0 });

    const logPath = path.join(workspaceRoot, '.devseek', 'runs', 'run-context-1.log');
    const entries = readJsonl(logPath);

    assert.equal(context.runId, 'run-context-1');
    assert.equal(entries[0].event, 'run-started');
    assert.equal(entries.every(entry => entry.runId === 'run-context-1'), true);
    const started = entries.find(entry => entry.event === 'agent-run-started');
    assert.equal(typeof started.data.prompt, 'object');
    assert.equal(started.data.prompt.length, '修复 shape_manager title'.length);
    assert.match(started.data.prompt.sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(started.data).includes('修复 shape_manager title'), false);
    assert.equal(started.data.requiresSourceClaimArtifactVerification, false);
    assert.match(started.data.taskContractFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(entries.some(entry => entry.event === 'tool-fact-recorded'), true);
    const completed = entries.find(entry => entry.event === 'agent-run-completed');
    assert.equal(completed.data.status, 'completed');
    assert.equal(completed.data.tasksFailed, 0);
    assert.equal(completed.data.requiresSourceClaimArtifactVerification, false);
    assert.equal(completed.data.taskContractFingerprint, started.data.taskContractFingerprint);
    assert.equal(entries.every((entry, index) => index === 0 || entry.seq >= entries[index - 1].seq), true);
    const evidence = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const evidenceEvents = evidence.read('run-context-1');
    assert.deepEqual(evidenceEvents.map(event => event.type), [
      'run.opened',
      'command.accepted',
      'run.settled',
    ]);
    assert.equal(evidence.verify('run-context-1').status, 'valid-sealed');
    assert.equal(evidenceEvents.every(event => event.qualification_eligible === false), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: records a non-sensitive source-claim artifact obligation at start and completion', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  const userPrompt = '读取 /repo/source.hpp，提取 kAlpha、kBeta 的真实值，创建 Markdown 报告 /repo/facts.md。';
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-source-claim-artifact',
      userPrompt,
      traceLevel: 'debug',
    });
    context.complete('completed', { changedPaths: ['/repo/facts.md'], tasksApplied: 1 });

    const entries = readJsonl(path.join(
      workspaceRoot,
      '.devseek',
      'runs',
      'run-context-source-claim-artifact.log',
    ));
    const started = entries.find(entry => entry.event === 'agent-run-started');
    const completed = entries.find(entry => entry.event === 'agent-run-completed');

    assert.equal(started.data.requiresSourceClaimArtifactVerification, true);
    assert.equal(completed.data.requiresSourceClaimArtifactVerification, true);
    assert.equal(completed.data.taskContractFingerprint, started.data.taskContractFingerprint);
    assert.equal(JSON.stringify(started.data).includes(userPrompt), false);
    assert.equal(JSON.stringify(completed.data).includes(userPrompt), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: exact artifact fingerprint is stable and changes with its executable contract', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-exact-contract-'));
  const strictPrompt = title => [
    '请读取 /repo/source.hpp，从源码提取 kAlpha 的真实定义和值。',
    '只创建 Markdown 报告 /repo/facts.md。',
    '报告必须严格满足以下结构：',
    `1. 标题必须逐字为：${title}`,
    '2. 紧接一行必须逐字为：源码路径：/repo/source.hpp',
    '3. 仅包含一个 Markdown 表格，表头必须是 Symbol 和 Value，数据行恰好一行。',
    '不得增加其他标题、表格数据行、代码块或说明段落。',
  ].join('\n');
  try {
    for (const [runId, prompt] of [
      ['exact-contract-a1', strictPrompt('# 源码事实报告 A')],
      ['exact-contract-a2', strictPrompt('# 源码事实报告 A')],
      ['exact-contract-b', strictPrompt('# 源码事实报告 B')],
    ]) {
      createDevSeekRunContext({ workspaceRoot, runId, userPrompt: prompt, traceLevel: 'debug' })
        .complete('completed');
    }

    const first = readStartedContractFingerprint(workspaceRoot, 'exact-contract-a1');
    const repeated = readStartedContractFingerprint(workspaceRoot, 'exact-contract-a2');
    const changed = readStartedContractFingerprint(workspaceRoot, 'exact-contract-b');
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(repeated, first, 'the same executable exact artifact contract must be stable');
    assert.notEqual(changed, first, 'changing an exact artifact literal must change the contract fingerprint');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: read-only source-fact answers do not acquire an artifact obligation', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  const userPrompt = [
    '只分析 /repo/source.hpp，提取 kAlpha、kBeta 的真实值并在回复中说明。',
    '不要创建报告，不要修改或写入任何文件。',
  ].join('\n');
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-read-only-source-claim',
      userPrompt,
      traceLevel: 'debug',
    });
    context.complete('completed', { changedPaths: [], tasksApplied: 0 });

    const entries = readJsonl(path.join(
      workspaceRoot,
      '.devseek',
      'runs',
      'run-context-read-only-source-claim.log',
    ));
    const started = entries.find(entry => entry.event === 'agent-run-started');
    const completed = entries.find(entry => entry.event === 'agent-run-completed');
    assert.equal(started.data.requiresSourceClaimArtifactVerification, false);
    assert.equal(completed.data.requiresSourceClaimArtifactVerification, false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: completion is idempotent', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-2',
      userPrompt: 'compile',
      traceLevel: 'debug',
    });
    const first = context.complete('failed', { reason: 'first' });
    const second = context.complete('completed', { reason: 'second' });

    assert.equal(first, 'failed');
    assert.equal(second, 'failed');

    const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', 'run-context-2.log'));
    const completions = entries.filter(entry => entry.event === 'agent-run-completed');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].data.status, 'failed');
    assert.equal(completions[0].data.reason, 'first');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: records agent status events for failure diagnosis', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-status',
      userPrompt: '基于需求文档修改正式项目',
      traceLevel: 'debug',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'failed',
      taskId: 't2',
      taskFile: 'maintenance_types.hpp',
      taskAction: 'modify',
      taskIndex: 2,
      taskTotal: 9,
      title: 'maintenance_types.hpp — 读取文件失败，跳过修改',
      detail: '路径 /project/src/maintenance_types.hpp 不存在或无法读取。',
    });
    context.complete('failed', { tasksTotal: 9, tasksFailed: 1 });

    const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', 'run-context-status.log'));
    const status = entries.find(entry => entry.event === 'agent-status');
    assert.equal(status.data.phase, 'execute');
    assert.equal(status.data.state, 'failed');
    assert.equal(status.data.taskFile, 'maintenance_types.hpp');
    assert.match(status.data.detail, /不存在或无法读取/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: projects mutation, verification, gate, tool and checkpoint facts into one sealed ledger', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-unified-evidence',
      userPrompt: '修改 src/main.ts 并运行测试',
      traceLevel: 'debug',
    });
    const task = {
      type: 'agentStatus',
      phase: 'execute',
      taskId: 'write-main',
      taskFile: 'main.ts',
      taskAction: 'modify',
      taskIndex: 1,
      taskTotal: 1,
      title: '修改 main.ts',
    };
    context.recordAgentStatus({ ...task, state: 'started' });
    context.recordToolActivity('file-write', 'main.ts');
    context.recordAgentStatus({ ...task, state: 'completed' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '运行测试', evidenceOperationId: 'verify-main' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'completed', title: '测试通过', evidenceOperationId: 'verify-main' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'started', title: '评估质量门禁', evidenceOperationId: 'verify-main' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'completed', title: '质量门禁通过', evidenceOperationId: 'verify-main' });
    context.recordCheckpoint(1, 1, 'progress');
    context.complete('completed', { changedPaths: ['src/main.ts'] });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-unified-evidence');
    for (const type of [
      'agent.status',
      'tool.activity',
      'side_effect.requested',
      'side_effect.authorized',
      'side_effect.started',
      'side_effect.committed',
      'verification.started',
      'verification.completed',
      'quality_gate.started',
      'quality_gate.passed',
      'checkpoint.created',
      'run.settled',
    ]) {
      assert.equal(events.some(event => event.type === type), true, `missing ${type}`);
    }
    assert.equal(ledger.head('run-context-unified-evidence').sealed, true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: sealed settlement binds run identity, contract and build version', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-seal-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-seal-binding',
      userPrompt: '创建 marker.txt，内容为：OK，并验证。',
      traceLevel: 'debug',
      appVersion: '1.0.0-test',
      buildChannel: 'debug',
      buildId: '20260716-test',
      gitCommit: 'abc1234',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'started',
      taskId: 'marker',
      taskFile: 'marker.txt',
      taskAction: 'create',
      title: '创建 marker.txt',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'completed',
      taskId: 'marker',
      taskFile: 'marker.txt',
      taskAction: 'create',
      title: '创建 marker.txt',
    });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '读取 marker.txt', evidenceOperationId: 'verify-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'completed', title: '验证通过', evidenceOperationId: 'verify-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'started', title: '评估质量门禁', evidenceOperationId: 'verify-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'completed', title: '质量门禁通过', evidenceOperationId: 'verify-marker' });
    context.complete('completed', { changedPaths: ['marker.txt'] });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-seal-binding');
    const opened = events.find(event => event.type === 'run.opened');
    const accepted = events.find(event => event.type === 'command.accepted');
    const settled = events.find(event => event.type === 'run.settled');
    const seal = ledger.getSeal('run-context-seal-binding');
    assert.equal(seal.final_event_sha256, settled.event_sha256);
    assert.deepEqual(settled.payload.details.settlement_binding, {
      protocol: 'devseek.settlement-seal-binding/v1',
      owner_surface: opened.payload.owner_surface,
      run_id: 'run-context-seal-binding',
      task_contract_fingerprint: accepted.payload.task_contract_fingerprint,
      requires_source_claim_artifact_verification: accepted.payload.requires_source_claim_artifact_verification,
      app_version: opened.payload.app_version,
      build_channel: opened.payload.build_channel,
      build_id: opened.payload.build_id,
      git_commit: opened.payload.git_commit,
    });

    const otherContext = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-seal-binding-other',
      userPrompt: '创建 other.txt',
      traceLevel: 'debug',
    });
    otherContext.complete('completed', { changedPaths: ['other.txt'] });
    const otherSeal = ledger.getSeal('run-context-seal-binding-other');
    assert.equal(ledger.verify('run-context-seal-binding', {
      eventCount: otherSeal.event_count,
      finalEventSha256: otherSeal.final_event_sha256,
      finalRecordSha256: otherSeal.final_record_sha256,
      sealSha256: otherSeal.seal_sha256,
    }).status, 'invalid');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: deterministic simple-file execution closes its side-effect before settlement', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-simple-file-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-simple-file-settlement',
      userPrompt: '创建 marker.txt，内容为：OK，并验证文件创建成功。',
      traceLevel: 'debug',
    });
    const task = {
      type: 'agentStatus',
      phase: 'execute',
      taskId: 'agentic',
      taskFile: 'marker.txt',
      taskAction: 'create',
      taskIndex: 1,
      taskTotal: 1,
      title: 'marker.txt',
    };
    context.recordAgentStatus({ ...task, state: 'started' });
    context.recordAgentStatus({ ...task, state: 'completed' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '读取 marker.txt', evidenceOperationId: 'simple-file-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'completed', title: '自动验证通过', evidenceOperationId: 'simple-file-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'started', title: '自动验证 QualityGate', evidenceOperationId: 'simple-file-marker' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'completed', title: '自动验证 QualityGate 通过', evidenceOperationId: 'simple-file-marker' });
    const settled = context.complete('completed', {
      changedPaths: ['marker.txt'],
      tasksTotal: 1,
      tasksApplied: 1,
      tasksFailed: 0,
    });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-simple-file-settlement');
    assert.equal(settled, 'completed');
    assert.equal(events.some(event => event.type === 'side_effect.committed'), true);
    assert.equal(events.some(event => event.type === 'side_effect.indeterminate'), false);
    assert.equal(events.some(event => event.type === 'evidence.degraded'), false);
    assert.equal(events.find(event => event.type === 'run.settled').payload.status, 'completed');
    assert.equal(ledger.verify('run-context-simple-file-settlement').status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: late task settlement failure after committed mutation is not a second side effect', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const runId = 'run-context-late-task-failure-after-terminal-proof';
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId,
      userPrompt: '修改 tools/log_summary.py 并用终端验证 JSON 输出。',
      traceLevel: 'debug',
    });
    const participant = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId,
      surface: 'run-context-terminal-quality-test',
      authority: { role: 'participant', token: context.evidenceParticipantToken },
    });
    const recordParticipantProof = (type, operationId, status) => participant.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`late-task-terminal-proof:${type}`, {
        runId,
        operationId,
      }),
      payload: {
        trust: 'product-runtime-observation',
        operation_id: operationId,
        status,
      },
    });
    const task = {
      type: 'agentStatus',
      phase: 'execute',
      taskId: 't1',
      taskFile: 'log_summary.py',
      taskAction: 'modify',
      taskIndex: 1,
      taskTotal: 1,
      title: '将日志统计工具改为 JSON 输出并自测',
    };
    context.recordAgentStatus({ ...task, state: 'started' });
    context.recordAgentStatus({ ...task, state: 'completed', linesAdded: 2, linesRemoved: 1 });

    const verificationOperationId = 'terminal-json-validation';
    recordParticipantProof('verification.started', verificationOperationId, 'started');
    recordParticipantProof('verification.completed', verificationOperationId, 'completed');
    recordParticipantProof('quality_gate.started', verificationOperationId, 'started');
    recordParticipantProof('quality_gate.passed', verificationOperationId, 'passed');

    context.recordAgentStatus({
      ...task,
      state: 'failed',
      detail: '验证命令失败，不能标记完成。\n命令: old failing command\nexitCode: 1',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      taskTotal: 1,
      title: '全部 1 个任务已完成',
      editedFiles: [{
        path: 'tools/log_summary.py',
        basename: 'log_summary.py',
        linesAdded: 2,
        linesRemoved: 1,
        action: 'modify',
      }],
    });

    assert.equal(context.complete('completed', {
      tasksTotal: 1,
      tasksApplied: 1,
      tasksFailed: 0,
      changedPaths: ['tools/log_summary.py'],
    }), 'completed');

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read(runId);
    assert.equal(events.some(event => event.type === 'agent.status' && event.payload.status === 'failed'), true);
    assert.equal(events.some(event => event.type === 'side_effect.failed'), false);
    assert.equal(events.some(event => event.type === 'quality_gate.passed'), true);
    assert.equal(events.find(event => event.type === 'run.settled')?.payload.status, 'completed');
    assert.equal(ledger.verify(runId).status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: repaired mutation uses a new attempt and resolves the failed side effect only after validation', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-mutation-recovery',
      userPrompt: '修改 src/main.ts 并修复失败',
      traceLevel: 'debug',
    });
    const task = {
      type: 'agentStatus',
      phase: 'execute',
      taskId: 'write-main',
      taskFile: 'main.ts',
      taskAction: 'modify',
      title: '修改 main.ts',
    };
    context.recordAgentStatus({ ...task, state: 'failed' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'repair', state: 'started', title: '开始修复' });
    context.recordAgentStatus({ ...task, state: 'started' });
    context.recordAgentStatus({ ...task, state: 'completed' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '重新验证', evidenceOperationId: 'verify-repair' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'completed', title: '重新验证通过', evidenceOperationId: 'verify-repair' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'started', title: '评估修复质量门禁', evidenceOperationId: 'verify-repair' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'completed', title: '修复质量门禁通过', evidenceOperationId: 'verify-repair' });
    context.complete('completed');

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-mutation-recovery');
    const sideEffectTerminals = events.filter(event => (
      event.type === 'side_effect.failed' || event.type === 'side_effect.committed'
    ));
    assert.equal(sideEffectTerminals.length, 2);
    assert.notEqual(sideEffectTerminals[0].payload.operation_id, sideEffectTerminals[1].payload.operation_id);
    const recovery = events.find(event => event.type === 'recovery.completed');
    assert.equal(recovery.payload.resolves_operation_ids.includes(sideEffectTerminals[0].payload.operation_id), true);
    assert.equal(recovery.payload.verification_operation_id, 'verify-repair');
    assert.equal(ledger.verify('run-context-mutation-recovery').status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: provider response recovery resolves participant provider failure after bounded retry validation', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-provider-recovery',
      userPrompt: '创建 controlled-sim.txt 并读回验证',
      traceLevel: 'debug',
    });
    const provider = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId: 'run-context-provider-recovery',
      surface: 'vscode-provider',
      authority: {
        role: 'participant',
        token: context.evidenceParticipantToken,
      },
    });
    for (const type of ['provider.requested', 'provider.failed']) {
      provider.record({
        type,
        idempotencyKey: productRunEvidenceIdempotencyKey(`provider-recovery:${type}`, {
          operationId: 'provider:truncated-response',
        }),
        payload: observed(type.slice('provider.'.length), {
          operation_id: 'provider:truncated-response',
          boundary: 'vscode-provider-client',
        }),
      });
    }

    context.recordAgentStatus({ type: 'agentStatus', phase: 'repair', state: 'started', title: 'Provider 响应被截断，正在安全续跑' });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'started',
      taskId: 'agentic',
      taskFile: 'controlled-sim.txt',
      taskAction: 'create',
      title: '创建 controlled-sim.txt',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'completed',
      taskId: 'agentic',
      taskFile: 'controlled-sim.txt',
      taskAction: 'create',
      title: '创建 controlled-sim.txt',
    });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'started', title: '自动验证写入结果', evidenceOperationId: 'verify-provider-recovery' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'validate', state: 'completed', title: '自动验证通过', evidenceOperationId: 'verify-provider-recovery' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'started', title: '评估自动验证 QualityGate', evidenceOperationId: 'verify-provider-recovery' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'quality', state: 'completed', title: '自动验证 QualityGate 通过', evidenceOperationId: 'verify-provider-recovery' });
    context.complete('completed');

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-provider-recovery');
    const recovery = events.find(event => event.type === 'recovery.completed');
    assert.equal(recovery.payload.resolves_operation_ids.includes('provider:truncated-response'), true);
    assert.equal(recovery.payload.verification_operation_id, 'verify-provider-recovery');
    assert.equal(ledger.verify('run-context-provider-recovery').status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: recovery without a correlated retry mutation fails closed', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-recovery-without-retry',
      userPrompt: '修复 src/main.ts',
      traceLevel: 'debug',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'execute', state: 'failed',
      taskId: 'write-main', taskFile: 'main.ts', taskAction: 'modify', title: '修改失败',
    });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'repair', state: 'started', title: '开始修复' });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'validate', state: 'started',
      title: '验证修复', evidenceOperationId: 'verify-without-retry',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'validate', state: 'completed',
      title: '验证通过', evidenceOperationId: 'verify-without-retry',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'quality', state: 'started',
      title: '评估门禁', evidenceOperationId: 'verify-without-retry',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'quality', state: 'completed',
      title: '门禁通过', evidenceOperationId: 'verify-without-retry',
    });

    assert.equal(context.complete('completed'), 'failed');
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-recovery-without-retry');
    assert.equal(events.some(event => event.type === 'recovery.completed'), false);
    assert.equal(events.some(event => event.type === 'evidence.degraded'), true);
    assert.equal(events.find(event => event.type === 'run.settled')?.payload.status, 'failed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: a pre-detection mutation cannot become repair proof by tagging only its commit', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-stale-mutation-recovery',
      userPrompt: '修复 src/main.ts',
      traceLevel: 'debug',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'execute', state: 'failed',
      taskId: 'failed-write', taskFile: 'main.ts', taskAction: 'modify', title: '原修改失败',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'execute', state: 'started',
      taskId: 'stale-write', taskFile: 'other.ts', taskAction: 'modify', title: '旧修改已开始',
    });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'repair', state: 'started', title: '开始修复' });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'execute', state: 'completed',
      taskId: 'stale-write', taskFile: 'other.ts', taskAction: 'modify', title: '旧修改结束',
    });
    for (const [phase, state, title] of [
      ['validate', 'started', '验证开始'],
      ['validate', 'completed', '验证通过'],
      ['quality', 'started', '门禁开始'],
      ['quality', 'completed', '门禁通过'],
    ]) {
      context.recordAgentStatus({
        type: 'agentStatus', phase, state, title, evidenceOperationId: 'verify-stale-write',
      });
    }

    assert.equal(context.complete('completed'), 'failed');
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-stale-mutation-recovery');
    const commit = events.find(event => event.type === 'side_effect.committed');
    const request = events.find(event => (
      event.type === 'side_effect.requested'
      && event.payload.operation_id === commit?.payload.operation_id
    ));
    const detected = events.find(event => event.type === 'recovery.detected');
    assert.ok(request.sequence < detected.sequence && detected.sequence < commit.sequence);
    assert.equal(request.payload.recovery_operation_id, undefined);
    assert.equal(typeof commit.payload.recovery_operation_id, 'string');
    assert.equal(events.some(event => event.type === 'recovery.completed'), false);
    assert.equal(events.find(event => event.type === 'run.settled')?.payload.status, 'failed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: an unbound quality gate cannot resolve a recovered mutation', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-unbound-recovery-gate',
      userPrompt: '修复 src/main.ts',
      traceLevel: 'debug',
    });
    const task = {
      type: 'agentStatus', taskId: 'write-main', taskFile: 'main.ts', taskAction: 'modify', title: '修改 main.ts',
    };
    context.recordAgentStatus({ ...task, phase: 'execute', state: 'failed' });
    context.recordAgentStatus({ type: 'agentStatus', phase: 'repair', state: 'started', title: '开始修复' });
    context.recordAgentStatus({ ...task, phase: 'execute', state: 'started' });
    context.recordAgentStatus({ ...task, phase: 'execute', state: 'completed' });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'validate', state: 'started',
      title: '验证开始', evidenceOperationId: 'verify-real',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'validate', state: 'completed',
      title: '验证通过', evidenceOperationId: 'verify-real',
    });
    context.recordAgentStatus({
      type: 'agentStatus', phase: 'quality', state: 'completed',
      title: '伪门禁通过', evidenceOperationId: 'verify-fake',
    });

    assert.equal(context.complete('completed'), 'failed');
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-unbound-recovery-gate');
    assert.equal(events.some(event => event.type === 'quality_gate.passed'), false);
    assert.equal(events.some(event => event.type === 'recovery.completed'), false);
    assert.equal(events.some(event => event.type === 'evidence.degraded'), true);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: failed settlement closes an in-flight mutation as indeterminate before sealing', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-abrupt-failure',
      userPrompt: '修改 src/main.ts',
      traceLevel: 'debug',
    });
    context.recordAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      state: 'started',
      taskId: 'write-main',
      taskFile: 'main.ts',
      taskAction: 'modify',
      title: '修改 main.ts',
    });
    context.complete('failed', { reason: 'process-aborted' });

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-abrupt-failure');
    assert.equal(events.some(event => event.type === 'side_effect.indeterminate'), true);
    assert.equal(events.find(event => event.type === 'run.settled').payload.status, 'failed');
    assert.equal(ledger.verify('run-context-abrupt-failure').status, 'valid-sealed');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('RunContext: evidence degradation converts completion into one durable failed seal', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-run-context-'));
  try {
    const context = createDevSeekRunContext({
      workspaceRoot,
      runId: 'run-context-degraded',
      userPrompt: '修改程序',
      traceLevel: 'debug',
    });
    context.markEvidenceDegraded(new Error('simulated append failure'));
    const first = context.complete('completed');
    const second = context.complete('completed');

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('run-context-degraded');
    assert.equal(first, 'failed');
    assert.equal(second, 'failed');
    assert.equal(events.some(event => event.type === 'evidence.degraded'), true);
    assert.equal(events.filter(event => event.type === 'run.settled').length, 1);
    assert.equal(events.find(event => event.type === 'run.settled').payload.status, 'failed');
    assert.equal(ledger.verify('run-context-degraded').status, 'valid-sealed');
    const entries = readJsonl(path.join(workspaceRoot, '.devseek', 'runs', 'run-context-degraded.log'));
    const completions = entries.filter(entry => entry.event === 'agent-run-completed');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].data.status, 'failed');
    assert.equal(completions[0].data.reason, 'evidence-degraded');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

console.log('\nRun context tests passed.\n');
