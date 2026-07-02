/**
 * Unit tests for diagnostics/run-log-replay.ts.
 *
 * Contract: real DevSeek run logs can be replayed into deterministic execution
 * facts, so screenshot-only regressions become testable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-run-log-replay-test-${process.pid}.cjs`);

execSync(
  `npx esbuild src/diagnostics/run-log-replay.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  replayRunLog,
  formatRunLogReplayReport,
} = req(bundlePath);

function writeLog(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-run-log-replay-'));
  const logPath = path.join(dir, 'run.log');
  writeFileSync(logPath, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return { dir, logPath };
}

test('run log replay detects path drift, legacy build dirs, protocol contamination and missing convergence', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T05:06:00.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'trace',
      event: 'run-started',
      runId: '20260702-130600',
      data: { appVersion: '1.0.0-debug.test', gitCommit: 'abc123' },
    },
    {
      ts: '2026-07-02T05:06:01.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-130600',
      data: {
        name: 'extension.request.prompt',
        content: '请重新编译执行确认',
      },
    },
    {
      ts: '2026-07-02T05:06:05.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-130600',
      data: {
        name: 'extension.response.raw',
        content: [
          '我将清理后重新编译。',
          '[TOOL:run_terminal] {"command":"rm -rf /tmp/ws/code/shape_manager/.devseek-build /tmp/ws/code/shape_manager/build && cmake -S /tmp/ws/code/shape_manager -B /tmp/ws/code/shape_manager/.devseek-build","workdir":"/tmp/ws/code/shape_manager"}',
          '[工具返回][toolu_1] {"content":"fake result from provider"}',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-02T05:07:15.000Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-start',
      runId: '20260702-130600',
      data: {
        toolCount: 1,
        tools: ['run_terminal'],
        defaultWorkdir: '/tmp/ws/code/shape_manager/build/bin',
      },
    },
    {
      ts: '2026-07-02T05:07:16.000Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: '20260702-130600',
      data: {
        taskComplete: false,
        terminalCommandCount: 1,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.runId, '20260702-130600');
    assert.equal(report.providerRequests, 1);
    assert.equal(report.providerResponses, 1);
    assert.equal(report.toolExecutions, 1);
    assert.equal(kinds.has('legacy-build-path'), true);
    assert.equal(kinds.has('destructive-model-command'), true);
    assert.equal(kinds.has('provider-authored-tool-result'), true);
    assert.equal(kinds.has('build-artifact-workdir'), true);
    assert.equal(kinds.has('long-running-run'), true);
    assert.equal(kinds.has('missing-final-convergence'), true);

    const formatted = formatRunLogReplayReport(report);
    assert.match(formatted, /20260702-130600/);
    assert.match(formatted, /build-artifact-workdir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects malformed bracket tool blocks', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T05:06:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'bad-tool-json',
      data: {
        name: 'extension.response.raw',
        content: '[TOOL:run_terminal] {"command": "test -f /tmp/app && echo "EXISTS" || echo "NOT_FOUND""}',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.issues.some(issue => issue.kind === 'malformed-tool-block'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects planner execution task with internal context but no execution evidence', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T05:44:56.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'trace',
      event: 'run-started',
      runId: '20260702-134456',
      data: { appVersion: '1.0.0-debug.test', gitCommit: 'abc123' },
    },
    {
      ts: '2026-07-02T05:44:57.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-134456',
      data: {
        name: 'extension.request.prompt',
        content: [
          '你是一个顶级编程智能体的任务规划器。',
          '【当前活跃编辑器文件（项目上下文）】',
          '/workspace/.devseek/runs/20260702-111529.log',
          '用户需求：title乱码问题好像修正了，请重新编译执行确认',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-02T05:45:08.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-134456',
      data: {
        name: 'extension.response.raw',
        content: '分析思路：执行验证。\n\n{"tasks":[{"id":"t1","file":"code/shape_manager","action":"analyze","desc":"编译并运行shape_manager项目，确认title显示正常无乱码"}]}',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.plannedExecutionTasks, 1);
    assert.equal(kinds.has('internal-context-anchor'), true);
    assert.equal(kinds.has('planned-execution-without-tool-evidence'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects terminal command failures even when execution evidence exists', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T06:11:16.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'trace',
      event: 'run-started',
      runId: '20260702-141116',
      data: { appVersion: '1.0.0-debug.test', gitCommit: 'abc123' },
    },
    {
      ts: '2026-07-02T06:11:17.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-141116',
      data: {
        name: 'extension.response.raw',
        content: '{"tasks":[{"id":"t1","file":"code/shape_manager","action":"analyze","desc":"编译并运行 shape_manager 项目"}]}',
      },
    },
    {
      ts: '2026-07-02T06:11:18.000Z',
      level: 'info',
      source: 'vscode-extension.terminal',
      phase: 'terminal',
      event: 'command-requested',
      runId: '20260702-141116',
      data: { command: { length: 24, sha256: 'x' }, workdir: '/tmp/ws/code/shape_manager' },
    },
    {
      ts: '2026-07-02T06:11:19.000Z',
      level: 'info',
      source: 'vscode-extension.terminal',
      phase: 'terminal',
      event: 'command-complete',
      runId: '20260702-141116',
      data: { command: { length: 24, sha256: 'x' }, workdir: '/tmp/ws/code/shape_manager', exitCode: 2 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.terminalCommands, 1);
    assert.equal(kinds.has('terminal-command-failed'), true);
    assert.equal(kinds.has('planned-execution-without-tool-evidence'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
