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

test('run log replay accepts deterministically recoverable terminal tool blocks', () => {
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
    assert.equal(report.terminalCommands, 1);
    assert.equal(report.issues.some(issue => issue.kind === 'malformed-tool-block'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects an unexecuted DeepSeek nameless artifact array', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T06:40:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'nameless-artifact-not-executed',
      data: {
        name: 'extension.response.raw',
        content: [
          '现在创建核心代码文件。',
          '```',
          '[',
          '  {"path":"/tmp/app/worker.hpp","content":"#pragma once\\n"},',
          '  {"path":"/tmp/app/worker.cpp","content":"#include \\"worker.hpp\\"\\n"}',
          ']',
          '```',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-11T06:40:01.000Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'nameless-artifact-not-executed',
      data: {
        taskComplete: false,
        toolCallsMade: false,
        feedbackLength: 0,
        readFileCount: 0,
        terminalCommandCount: 0,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const issue = report.issues.find(item => item.kind === 'provider-tool-request-not-executed');

    assert.equal(report.providerResponses, 1);
    assert.equal(issue?.severity, 'error');
    assert.match(issue?.message ?? '', /2 个可解析工具调用/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects unrecoverable bracket tool blocks', () => {
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
        content: '[TOOL:run_terminal] {"command":}',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.terminalCommands, 0);
    assert.equal(report.issues.some(issue => issue.kind === 'malformed-tool-block'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay isolates tool requests before provider-authored tool results', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T05:06:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'provider-result-isolation',
      data: {
        name: 'extension.response.raw',
        content: [
          '我先读取目标文件。',
          '[TOOL:read_file {"path":"/tmp/app/main.cpp"}]',
          '',
          '[工具执行结果]文件内容：',
          '```',
          '[TOOL:run_terminal {"command":"cmake -S /tmp/app -B /tmp/app/.devseek-build"}]',
          '```',
        ].join('\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.terminalCommands, 0);
    assert.equal(kinds.has('provider-authored-tool-result'), true);
    assert.equal(kinds.has('malformed-tool-block'), false);
    assert.equal(kinds.has('legacy-build-path'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects empty provider responses and missing run completion', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-02T09:12:58.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: '20260702-171258',
      data: { appVersion: '1.0.0-debug.test', gitCommit: 'abc123' },
    },
    {
      ts: '2026-07-02T09:12:59.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'bridge-client',
      event: 'chat-request-start',
      runId: '20260702-171258',
      data: { stream: true },
    },
    {
      ts: '2026-07-02T09:15:07.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: '20260702-171258',
      data: {
        name: 'extension.response.raw',
        content: '',
      },
    },
    {
      ts: '2026-07-02T09:15:07.001Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'bridge-client',
      event: 'chat-request-complete',
      runId: '20260702-171258',
      data: { response: { length: 0 } },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.providerResponses, 1);
    assert.equal(kinds.has('empty-provider-response'), true);
    assert.equal(kinds.has('missing-agent-run-completion'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects oversized provider prompts that can freeze the bridge', () => {
  const latestFailureSizedPrompt = [
    '你是一个顶级编程智能体的任务规划器（Architect 角色）。',
    '【当前活跃编辑器文件（项目上下文）】',
    '/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    '【项目指令：AGENTS.md】',
    'Do not run broad searches over the whole workspace without excludes.',
    '【文件预览】',
    'x'.repeat(51_200),
  ].join('\n');
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-07T04:58:10.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'oversized-provider-prompt',
      data: {
        name: 'extension.request.prompt',
        content: latestFailureSizedPrompt,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const issue = report.issues.find(item => item.kind === 'provider-prompt-too-large');

    assert.equal(Boolean(issue), true);
    assert.match(issue.message, /Provider 请求 prompt 长度/);
    assert.ok(latestFailureSizedPrompt.length > 51_000 && latestFailureSizedPrompt.length < 52_000);
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

test('run log replay detects source code response without application evidence', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-03T01:49:12.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'source-no-apply',
      data: {
        name: 'extension.request.prompt',
        content: '/home/ff/work/devseek_netai/code/shape_manager 请通过代码实现，编译验证',
      },
    },
    {
      ts: '2026-07-03T01:50:37.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'source-no-apply',
      data: {
        name: 'extension.response.raw',
        content: [
          '这是修改后的完整文件：',
          '```cpp',
          '#include <GL/glut.h>',
          '#include <vector>',
          'struct Shape { float x; float y; float z; };',
          'void drawShape(int index) {',
          '  for (int i = 0; i < 80; ++i) {',
          '    glPushMatrix();',
          '    glTranslatef(index * 1.0f, 0.0f, 0.0f);',
          '    glutSolidSphere(1.0, 24, 24);',
          '    glPopMatrix();',
          '  }',
          '}',
          'int main(int argc, char** argv) {',
          '  glutInit(&argc, argv);',
          '  glutCreateWindow("Shape Manager");',
          '  return 0;',
          '}',
          '```',
          '然后运行 cmake 编译验证。',
        ].join('\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.providerRequests, 1);
    assert.equal(report.providerResponses, 1);
    assert.equal(report.toolExecutions, 0);
    assert.equal(report.terminalCommands, 0);
    assert.equal(kinds.has('source-output-without-application'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts source-like Markdown response when runtime applied artifact evidence exists', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-09T03:53:19.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'md-source-with-apply',
      data: {
        name: 'extension.request.prompt',
        content: '/workspace/src/oam/src/lifting/maintenance 请分析并通过 md 文档提供实现建议',
      },
    },
    {
      ts: '2026-07-09T03:54:19.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'md-source-with-apply',
      data: {
        name: 'extension.response.raw',
        content: [
          '# 维保提醒实现建议',
          '',
          '```text',
          '┌────────────────────────────────────────────────────────┐',
          '│ 新维保提醒系统架构                                    │',
          '├────────────────────────────────────────────────────────┤',
          '│ DataCollector -> ThresholdEngine -> Publisher          │',
          '│ Persistence -> ResetHandler -> StateMachine            │',
          '│ MainController consumes UAV_EVENT_1022                 │',
          '│ MainController owns tick orchestration                 │',
          '│ Each module keeps isolated responsibility              │',
          '│ Verification covers reboot persistence and reset flow   │',
          '│ This block intentionally exceeds replay source length   │',
          '│ so source-like Markdown reports do not become false     │',
          '│ positives after runtime write evidence is present.      │',
          '└────────────────────────────────────────────────────────┘',
          '```',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-09T03:54:19.100Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'md-source-with-apply',
      data: {
        phase: 'execute',
        state: 'completed',
        taskAction: 'create',
        taskFile: 'warranty-maintenance-advice.md',
        title: '创建 Markdown 建议文档',
        detail: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md · 已写入并读回验证。',
        linesAdded: 145,
        linesRemoved: 0,
      },
    },
    {
      ts: '2026-07-09T03:54:19.200Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'md-source-with-apply',
      data: {
        status: 'completed',
        tasksTotal: 1,
        tasksApplied: 1,
        tasksFailed: 0,
        changedPaths: ['src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md'],
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.workspaceApplications > 0, true);
    assert.equal(kinds.has('source-output-without-application'), false);
    assert.equal(kinds.has('markdown-deliverable-completed-without-file-evidence'), false);
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

test('run log replay does not let stale GUI timeout evidence override final completion', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-03T05:03:47.000Z',
      level: 'info',
      source: 'vscode-extension.terminal',
      phase: 'terminal',
      event: 'command-requested',
      runId: 'gui-timeout-cleared',
      data: { command: { length: 27, sha256: 'cmd1' }, workdir: '/tmp/ws/code/shape_manager' },
    },
    {
      ts: '2026-07-03T05:25:48.000Z',
      level: 'info',
      source: 'vscode-extension.terminal',
      phase: 'terminal',
      event: 'command-complete',
      runId: 'gui-timeout-cleared',
      data: {
        command: { length: 27, sha256: 'cmd1' },
        workdir: '/tmp/ws/code/shape_manager',
        exitCode: 124,
        output: { length: 300, sha256: 'out-gui' },
      },
    },
    {
      ts: '2026-07-03T05:25:48.001Z',
      level: 'debug',
      source: 'vscode-extension.terminal',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'gui-timeout-cleared',
      data: {
        name: 'terminal.output',
        sha256: 'out-gui',
        content: [
          '3D Shape Viewer - Mouse Selection Mode',
          'All shapes displayed simultaneously:',
          'Controls:',
          '  Left click      - Start dragging shape',
          '  ESC / Q         - Exit',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-03T05:25:49.000Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'gui-timeout-cleared',
      data: { taskComplete: false, terminalCommandCount: 1 },
    },
    {
      ts: '2026-07-03T05:25:50.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'gui-timeout-cleared',
      data: { status: 'completed', tasksTotal: 1, tasksApplied: 1, tasksFailed: 0 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('terminal-command-failed'), false);
    assert.equal(kinds.has('missing-final-convergence'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects read-only false completion when provider tools were not executed', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T03:03:23.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'readonly-false-complete',
      data: {},
    },
    {
      ts: '2026-07-06T03:03:24.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-false-complete',
      data: {
        phase: 'execute',
        state: 'started',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'huida_uav',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T03:03:25.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'readonly-false-complete',
      data: {
        name: 'extension.response.raw',
        content: [
          '我来分析新旧需求差异，并给出实现对策建议。首先让我查看相关文件。',
          '',
          '**Tool: read_file**',
          '```',
          '{"path": "/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md"}',
          '```',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-06T03:03:25.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'readonly-false-complete',
      data: {
        taskComplete: false,
        toolCallsMade: false,
        feedbackLength: 0,
        readFileCount: 0,
        terminalCommandCount: 0,
      },
    },
    {
      ts: '2026-07-06T03:03:26.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-false-complete',
      data: {
        phase: 'execute',
        state: 'completed',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'huida_uav',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T03:03:27.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'readonly-false-complete',
      data: { status: 'completed', tasksTotal: 1, tasksApplied: 0, tasksFailed: 0 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('provider-tool-request-not-executed'), true);
    assert.equal(kinds.has('read-only-completed-without-answer-evidence'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects no-tool read-only intent after tool results and optimistic completion', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T05:14:35.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-short-intent',
      data: {
        phase: 'execute',
        state: 'started',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'docs',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T05:14:36.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'readonly-short-intent',
      data: {
        name: 'extension.response.raw',
        content: '[调用 read_file] {"path": "/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance/maintenance_types.hpp"}',
      },
    },
    {
      ts: '2026-07-06T05:14:37.000Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'readonly-short-intent',
      data: {
        taskComplete: false,
        toolCallsMade: true,
        feedbackLength: 1200,
        readFileCount: 1,
        terminalCommandCount: 0,
      },
    },
    {
      ts: '2026-07-06T05:15:36.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'readonly-short-intent',
      data: {
        name: 'extension.response.raw',
        content: '现在让我再查看几个关键文件来完整了解原实现的设计。',
      },
    },
    {
      ts: '2026-07-06T05:15:36.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'readonly-short-intent',
      data: {
        taskComplete: false,
        toolCallsMade: false,
        feedbackLength: 0,
        readFileCount: 0,
        terminalCommandCount: 0,
      },
    },
    {
      ts: '2026-07-06T05:15:36.200Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-short-intent',
      data: {
        phase: 'execute',
        state: 'completed',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'docs',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T05:15:36.300Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-short-intent',
      data: {
        phase: 'execute',
        state: 'failed',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'docs',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责',
        detail: '任务缺少必要完成证据：分析结论。',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('provider-short-intent'), true);
    assert.equal(kinds.has('read-only-no-tool-intent-after-tools'), true);
    assert.equal(kinds.has('optimistic-completion-before-failure'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts full markdown read-only answer after tool evidence', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T05:20:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'readonly-md-delivered',
      data: { mode: 'agent' },
    },
    {
      ts: '2026-07-06T05:20:01.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-md-delivered',
      data: {
        phase: 'execute',
        state: 'started',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'docs',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T05:20:02.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'readonly-md-delivered',
      data: {
        name: 'extension.response.raw',
        content: [
          '我先读取需求文档和旧实现。',
          '[TOOL:read_file] {"path":"/workspace/docs/uav-warranty-reminder-plan_v1.7.md"}',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-06T05:20:02.500Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'readonly-md-delivered',
      data: {
        taskComplete: false,
        toolCallsMade: true,
        feedbackLength: 4000,
        readFileCount: 1,
        terminalCommandCount: 0,
      },
    },
    {
      ts: '2026-07-06T05:20:05.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'readonly-md-delivered',
      data: {
        name: 'extension.response.raw',
        content: [
          '# 无人机过保提醒功能 - 新需求实现对策建议与主控任务清单',
          '',
          '## 结论',
          '本次需求需要把旧实现从单一阈值提醒升级为多维状态机、协议同步和复位流程。',
          '',
          '## 依据',
          '已读取需求文档和旧实现代码，差异集中在数据采集、阈值计算、持久化和MAVLink事件。',
          '',
          '## 对策建议',
          '优先重构数据模型和阈值引擎，再接入状态持久化、复位流程和协议字段。',
          '',
          '## 任务拆解',
          '1. 扩展 MaintenanceStat 结构。\\n2. 重构阈值计算引擎。\\n3. 增加状态同步和测试。',
        ].join('\n'),
      },
    },
    {
      ts: '2026-07-06T05:20:05.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'readonly-md-delivered',
      data: {
        taskComplete: false,
        toolCallsMade: false,
        feedbackLength: 0,
        readFileCount: 0,
        terminalCommandCount: 0,
      },
    },
    {
      ts: '2026-07-06T05:20:05.200Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'readonly-md-delivered',
      data: {
        phase: 'execute',
        state: 'completed',
        taskId: 't1',
        taskAction: 'analyze',
        taskFile: 'docs',
        taskDesc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
        title: '分析需求、现有实现和主控职责，输出对策检讨与任务建议',
      },
    },
    {
      ts: '2026-07-06T05:20:05.300Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'readonly-md-delivered',
      data: { status: 'completed', tasksTotal: 1, tasksApplied: 0, tasksFailed: 0 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('read-only-no-tool-intent-after-tools'), false);
    assert.equal(kinds.has('read-only-completed-without-answer-evidence'), false);
    assert.equal(kinds.has('optimistic-completion-before-failure'), false);
    assert.equal(kinds.has('provider-tool-request-not-executed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay requires file evidence for completed Markdown deliverables', () => {
  const failed = writeLog([
    {
      ts: '2026-07-09T02:30:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'md-deliverable-no-file',
      data: { mode: 'agent' },
    },
    {
      ts: '2026-07-09T02:30:01.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'md-deliverable-no-file',
      data: {
        phase: 'execute',
        state: 'completed',
        taskId: 't1',
        taskAction: 'create',
        taskFile: 'warranty-maintenance-advice.md',
        taskDesc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
        title: '创建 Markdown 建议文档',
        detail: '模型已完成分析。',
      },
    },
    {
      ts: '2026-07-09T02:30:02.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'md-deliverable-no-file',
      data: { status: 'completed', tasksTotal: 1, tasksApplied: 0, tasksFailed: 0, changedPaths: [] },
    },
  ]);
  const passed = writeLog([
    {
      ts: '2026-07-09T02:31:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'md-deliverable-with-file',
      data: { mode: 'agent' },
    },
    {
      ts: '2026-07-09T02:31:01.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'md-deliverable-with-file',
      data: {
        phase: 'execute',
        state: 'completed',
        taskId: 't1',
        taskAction: 'create',
        taskFile: 'warranty-maintenance-advice.md',
        taskDesc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
        title: '创建 Markdown 建议文档',
        detail: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md · 已写入并读回验证。',
      },
    },
    {
      ts: '2026-07-09T02:31:02.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'md-deliverable-with-file',
      data: {
        status: 'completed',
        tasksTotal: 1,
        tasksApplied: 1,
        tasksFailed: 0,
        changedPaths: ['src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md'],
      },
    },
  ]);

  try {
    const failedKinds = new Set(replayRunLog(failed.logPath).issues.map(issue => issue.kind));
    const passedKinds = new Set(replayRunLog(passed.logPath).issues.map(issue => issue.kind));

    assert.equal(failedKinds.has('markdown-deliverable-completed-without-file-evidence'), true);
    assert.equal(passedKinds.has('markdown-deliverable-completed-without-file-evidence'), false);
  } finally {
    rmSync(failed.dir, { recursive: true, force: true });
    rmSync(passed.dir, { recursive: true, force: true });
  }
});

test('run log replay treats failed completion as failure even if stale changedPaths are present', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-09T05:08:39.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'failed-with-stale-paths',
      data: { mode: 'fast' },
    },
    {
      ts: '2026-07-09T05:10:13.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'failed-with-stale-paths',
      data: {
        status: 'failed',
        tasksTotal: 1,
        tasksApplied: 0,
        tasksFailed: 1,
        changedPaths: ['docs/analysis/uav_warranty_reminder_analysis_v1.7.md'],
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.workspaceApplications, 0);
    assert.equal(kinds.has('agent-run-failed'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects plan failure statuses reported as completed', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T03:02:24.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'plan-failure-completed',
      data: {
        phase: 'plan',
        state: 'completed',
        title: '任务计划生成失败',
        detail: 'HTTP 503: {"error":"Agent init failed"}',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('failure-status-reported-completed'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay rejects completed run after uncleared auto validation failure', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T03:05:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'validation-failed-completed',
      data: {
        phase: 'validate',
        state: 'failed',
        title: '自动验证失败',
        detail: 'g++ test_selfloop_codex.cpp exitCode=1',
      },
    },
    {
      ts: '2026-07-06T03:05:01.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'validation-failed-completed',
      data: {
        status: 'completed',
        tasksTotal: 1,
        tasksApplied: 1,
        tasksFailed: 0,
        changedPaths: ['src/oam/src/lifting/zc_maintenance/test_selfloop_codex.cpp'],
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const issue = report.issues.find(item => item.kind === 'failure-status-reported-completed');

    assert.ok(issue);
    assert.match(issue.message, /自动验证失败/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay classifies provider integrity failures and old bridge runtime', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T06:00:00.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'bridge-client',
      event: 'bridge-status-check',
      runId: 'provider-integrity',
      data: {
        bridgeOnline: true,
        buildMatches: false,
        expected: { appVersion: '1.0.0-debug.new', buildId: 'new-build' },
        actual: { appVersion: '1.0.0-debug.old', buildId: 'old-build' },
      },
    },
    {
      ts: '2026-07-06T06:00:01.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'provider-integrity',
      data: {
        name: 'extension.response.raw',
        content: 'RESPONSE_CORRUPTED: stream closed before completion',
      },
    },
    {
      ts: '2026-07-06T06:00:02.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'provider-integrity',
      data: {
        name: 'extension.response.raw',
        content: '<html><body>502 Bad Gateway</body></html>',
      },
    },
    {
      ts: '2026-07-06T06:00:03.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'provider-integrity',
      data: {
        name: 'extension.response.raw',
        content: '<html><title>Login</title>请先登录后继续</html>',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('old-bridge-runtime'), true);
    assert.equal(kinds.has('provider-truncated-response'), true);
    assert.equal(kinds.has('provider-error-page'), true);
    assert.equal(kinds.has('provider-login-required'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay treats offline bridge startup and successful restart as current runtime', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T06:00:00.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'bridge-client',
      event: 'bridge-status-check',
      runId: 'bridge-restarted',
      data: {
        bridgeOnline: false,
        buildMatches: false,
        expected: { appVersion: '1.0.0-debug.new', buildId: 'new-build' },
      },
    },
    {
      ts: '2026-07-06T06:00:01.000Z',
      level: 'info',
      source: 'vscode-extension',
      phase: 'bridge-client',
      event: 'bridge-status-ready',
      runId: 'bridge-restarted',
      data: {
        reason: 'started-runtime',
        buildMatches: true,
        expected: { appVersion: '1.0.0-debug.new', buildId: 'new-build' },
        actual: { appVersion: '1.0.0-debug.new', buildId: 'new-build' },
      },
    },
    {
      ts: '2026-07-06T06:00:02.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'bridge-restarted',
      data: {
        name: 'extension.response.raw',
        content: '# 完整分析\n\n结论：bridge 已绑定当前运行时，后续请求由当前版本处理。',
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('old-bridge-runtime'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay does not classify business verification-code analysis as provider login', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-06T06:10:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'business-verification-code',
      data: {
        name: 'extension.response.raw',
        content: [
          '我已完整分析了相关文件。现在整理分析报告。',
          '# 吊运维保功能重做分析报告',
          '结论：当前实现需要重构维保码流程，新增伙伴后台生成验证码、管理后台校验验证码的闭环。',
          '依据：旧实现只保留阈值统计，没有覆盖新增的作业状态和维保码校验职责。',
          '建议：先统一状态机，再拆分数据结构，最后补充验证用例。',
        ].join('\n\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(kinds.has('provider-login-required'), false);
    assert.equal(kinds.has('provider-error-page'), false);
    assert.equal(kinds.has('provider-incomplete-answer'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
