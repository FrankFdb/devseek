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

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
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
    context.complete('failed', { reason: 'first' });
    context.complete('completed', { reason: 'second' });

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

console.log('\nRun context tests passed.\n');
