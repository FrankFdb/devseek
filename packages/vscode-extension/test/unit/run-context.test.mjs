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
    assert.equal(entries.some(entry => entry.event === 'agent-run-started'), true);
    assert.equal(entries.some(entry => entry.event === 'tool-fact-recorded'), true);
    const completed = entries.find(entry => entry.event === 'agent-run-completed');
    assert.equal(completed.data.status, 'completed');
    assert.equal(completed.data.tasksFailed, 0);
    assert.equal(entries.every((entry, index) => index === 0 || entry.seq >= entries[index - 1].seq), true);
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
