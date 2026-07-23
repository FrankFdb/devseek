/**
 * Unit tests for diagnostics/run-log-replay.ts.
 *
 * Contract: real DevSeek run logs can be replayed into deterministic execution
 * facts, so screenshot-only regressions become testable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const p0aFixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-131537');
const bundlePath = path.join(tmpdir(), `devseek-run-log-replay-test-${process.pid}.cjs`);
const runContextBundlePath = path.join(tmpdir(), `devseek-run-context-replay-test-${process.pid}.cjs`);

execSync(
  `npx esbuild src/diagnostics/run-log-replay.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/run-context.ts --bundle ` +
  `--outfile=${runContextBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  replayRunLog,
  formatRunLogReplayReport,
} = req(bundlePath);
const { createDevSeekRunContext } = req(runContextBundlePath);

function writeLog(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-run-log-replay-'));
  const logPath = path.join(dir, 'run.log');
  writeFileSync(logPath, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return { dir, logPath };
}

function writeProductionRunLog({ prompt, statuses = [], traceEvents = [], completion }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-production-run-log-'));
  const runId = `production-replay-${process.pid}-${Date.now()}`;
  const context = createDevSeekRunContext({
    workspaceRoot: dir,
    source: 'vscode-extension.agent',
    runId,
    userPrompt: prompt,
    mode: 'agent',
    traceLevel: 'debug',
  });
  for (const event of traceEvents) {
    context.childTrace(event.source || 'vscode-extension').info(
      event.phase || 'execute',
      event.event,
      event.data,
    );
  }
  for (const status of statuses) context.recordAgentStatus(status);
  context.complete(completion.status, completion.data);
  return {
    dir,
    logPath: path.join(dir, '.devseek', 'runs', `${runId}.log`),
  };
}

function loadProductionRunEvents(logPath) {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

test('run log replay treats login-required provider event as a terminal request failure', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-22T02:00:00.000Z',
      level: 'info',
      source: 'bridge-client',
      phase: 'provider',
      event: 'chat-request-start',
      runId: 'login-required-terminal',
      data: { operationId: 'provider-login-required-1' },
    },
    {
      ts: '2026-07-22T02:00:00.100Z',
      level: 'info',
      source: 'bridge-server',
      phase: 'provider',
      event: 'chat-request-start',
      runId: 'login-required-terminal',
      data: { operationId: 'provider-login-required-1' },
    },
    {
      ts: '2026-07-22T02:00:01.000Z',
      level: 'info',
      source: 'bridge-server',
      phase: 'provider',
      event: 'chat-request-login-required',
      runId: 'login-required-terminal',
      data: {},
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.issues.some(issue => issue.kind === 'incomplete-provider-request'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts passed validation detail that quotes recovered provider failure text', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-22T02:00:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'passed-validation-quotes-provider-failure',
      data: {
        phase: 'validate',
        state: 'completed',
        title: '自动验证通过',
        detail: [
          '[verification_result: passed]',
          '[auto_validation: test -f docs/warranty-maintenance-advice-simulation.md]',
          'Provider 调用失败：LOGIN_REQUIRED，但本地 Markdown 文件已生成并通过验证。',
        ].join('\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.issues.some(issue => issue.kind === 'failure-status-reported-completed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts completion bound to automatic validation evidenceOperationId', () => {
  const verificationId = 'auto-validation-1-docs/report.md';
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-22T02:00:00.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-started',
      runId: 'automatic-validation-completion',
      data: { requiresSourceClaimArtifactVerification: false },
    },
    {
      ts: '2026-07-22T02:00:01.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'automatic-validation-completion',
      data: {
        phase: 'validate',
        state: 'completed',
        evidenceOperationId: verificationId,
        title: '自动验证通过',
        detail: '[verification_result: passed]',
      },
    },
    {
      ts: '2026-07-22T02:00:02.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'agent-status',
      event: 'agent-status',
      runId: 'automatic-validation-completion',
      data: {
        phase: 'quality',
        state: 'completed',
        evidenceOperationId: verificationId,
        title: '自动验证 QualityGate 通过',
      },
    },
    {
      ts: '2026-07-22T02:00:03.000Z',
      level: 'info',
      source: 'vscode-extension.agent',
      phase: 'run-context',
      event: 'agent-run-completed',
      runId: 'automatic-validation-completion',
      data: {
        status: 'completed',
        tasksApplied: 1,
        tasksFailed: 0,
        changedPaths: ['docs/report.md'],
        verificationIds: [verificationId],
        requiresSourceClaimArtifactVerification: false,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.issues.some(issue => /VerificationResult/.test(issue.message)), false);
    assert.equal(report.issues.some(issue => issue.kind === 'artifact-verification-completion-mismatch'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test('run log replay detects an executed-tool summary collapsed into a fake terminal command', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-10T23:45:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'nested-history-summary',
      data: {
        name: 'extension.request.prompt',
        content: [
          '[DevSeek 已执行工具请求摘要]',
          '意图：工具调用：19 个；真实执行结果见后续工具结果。',
          '工具调用：1 个；真实执行结果、文件写入和验证证据见后续 [工具结果 Round]。',
          '- run_terminal command=工具调用：19 个；真实执行结果、文件写入和验证证据见后续',
        ].join('\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const issue = report.issues.find(item => item.kind === 'nested-tool-history-summary');

    assert.equal(issue?.severity, 'error');
    assert.match(issue?.message ?? '', /再次当成终端工具解析/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay detects a restarted response with duplicate full-file writes', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T00:34:50.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'restarted-provider-response',
      data: {
        name: 'extension.response.raw',
        content: [
          '开始创建文档。create_file({"path":"/tmp/design.md","content":"# Design\\npartial WARRANTY_EL',
          '',
          '开始创建文档。create_file({"path":"/tmp/design.md","content":"# Design\\ncomplete\\nend"})',
        ].join('\n'),
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const issue = report.issues.find(item => item.kind === 'duplicate-full-file-write');

    assert.equal(issue?.severity, 'error');
    assert.equal(issue?.evidence, '/tmp/design.md');
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

test('run log replay accepts the real Chinese malformed search recovery sequence', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-10T23:54:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'deepseek-malformed-search-recovery',
      data: {
        name: 'extension.response.raw',
        content: '让我搜索 mc_log.h：[调用 grep_search] {"pattern": "mc_log\\.h", "path": "/tmp/project", "isRegexp": false, "maxResults": 10}',
      },
    },
    {
      ts: '2026-07-10T23:54:00.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-start',
      runId: 'deepseek-malformed-search-recovery',
      data: { toolCount: 1, tools: ['grep_search'] },
    },
    {
      ts: '2026-07-10T23:54:00.200Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'deepseek-malformed-search-recovery',
      data: { toolCallsMade: true, workToolCallsMade: true, readFileCount: 1 },
    },
    {
      ts: '2026-07-10T23:54:01.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'deepseek-malformed-search-recovery',
      data: {
        name: 'extension.response.raw',
        content: '让我搜索文件：[调用 run_terminal] {"command": "find /tmp/project -name "mc_log.h" | head -5", "isBackground": false}',
      },
    },
    {
      ts: '2026-07-10T23:54:01.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-start',
      runId: 'deepseek-malformed-search-recovery',
      data: { toolCount: 1, tools: ['run_terminal'] },
    },
    {
      ts: '2026-07-10T23:54:01.200Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'deepseek-malformed-search-recovery',
      data: { toolCallsMade: true, workToolCallsMade: true, terminalCommandCount: 1 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.providerResponses, 2);
    assert.equal(report.toolExecutions, 2);
    assert.equal(kinds.has('provider-truncated-response'), false);
    assert.equal(kinds.has('malformed-tool-block'), false);
    assert.equal(kinds.has('provider-tool-request-not-executed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts full long R3 DeepSeek create_file response without truncation issues', () => {
  const content = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE Audit Report',
    '',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
    'A'.repeat(8200),
  ].join('\n');
  const providerResponse = [
    '[TOOL:manage_todo_list] {"todoList":"[{"id":"1","title":"读取源文档","status":"completed"}]"}',
    `[TOOL:create_file] {"path":"/tmp/devseek-real-plugin-deepseek/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(`<content><![CDATA[${content}]]></content>`)}}`,
  ].join('');
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-23T07:13:00.000Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'r3-long-create-file',
      data: {
        name: 'extension.response.raw',
        length: providerResponse.length,
        content: providerResponse,
      },
    },
    {
      ts: '2026-07-23T07:13:00.100Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-start',
      runId: 'r3-long-create-file',
      data: { toolCount: 2, tools: ['manage_todo_list', 'create_file'] },
    },
    {
      ts: '2026-07-23T07:13:00.200Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'r3-long-create-file',
      data: { toolCallsMade: true, workToolCallsMade: true },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const kinds = new Set(report.issues.map(issue => issue.kind));

    assert.equal(report.providerResponses, 1);
    assert.equal(report.toolExecutions, 1);
    assert.equal(kinds.has('provider-truncated-response'), false);
    assert.equal(kinds.has('malformed-tool-block'), false);
    assert.equal(kinds.has('provider-tool-request-not-executed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay accepts the real quote-damaged replace_in_file response as executable', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-10T23:21:26.160Z',
      level: 'debug',
      source: 'vscode-extension',
      phase: 'payload',
      event: 'payload-recorded',
      runId: 'malformed-replace-recovery',
      data: {
        name: 'extension.response.raw',
        content: String.raw`我立即修复头文件。
<TOOL_CALL>[TOOL:replace_in_file] {"path":"/tmp/project/warranty_core_worker.hpp","old_str":"#include <string>\n\n#include "warranty_types.hpp"","new_str":"#include <string>\n#include <unordered_map>\n#include <cstdint>\n\n#include "warranty_types.hpp""}</TOOL_CALL>`,
      },
    },
    {
      ts: '2026-07-10T23:21:26.200Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-start',
      runId: 'malformed-replace-recovery',
      data: { toolCount: 1, tools: ['replace_in_file'] },
    },
    {
      ts: '2026-07-10T23:21:26.250Z',
      level: 'debug',
      source: 'vscode-extension.tool-loop',
      phase: 'tool-loop',
      event: 'execute-complete',
      runId: 'malformed-replace-recovery',
      data: { toolCallsMade: true, workToolCallsMade: true, writtenFileCount: 1 },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.issues.some(issue => issue.kind === 'malformed-tool-block'), false);
    assert.equal(report.issues.some(issue => issue.kind === 'unexecuted-tool-intent'), false);
    assert.equal(report.toolExecutions, 1);
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

test('run log replay rejects completed terminal when the latest artifact verification failed', () => {
  const report = replayRunLog(path.join(
    p0aFixtureDir,
    'artifact-verification-wrong-completed.jsonl',
  ));

  assert.equal(report.artifactVerifications, 1);
  assert.deepEqual(report.latestArtifactVerifications.map(verification => ({
    line: verification.line,
    verificationId: verification.verificationId,
    artifactHash: verification.artifactHash,
    ok: verification.ok,
    failedClaims: verification.failedClaims,
  })), [{
    line: 3,
    verificationId: 'vr-wrong-3d12adbfeecb',
    artifactHash: '3d12adbfeecb4bde72036f743a4a9dfd1cdf61afa80cc90b0bbb9e1679d214f2',
    ok: false,
    failedClaims: [
      'kTopicLicenseState',
      'kTopicLicenseTunnelRx',
      'kMavTunnelCmdLicense',
      'kTunnelMaxTotalLen',
      'kTunnelSessionTimeoutMs',
    ],
  }]);
  assert.deepEqual(report.issues.map(issue => ({
    kind: issue.kind,
    severity: issue.severity,
    line: issue.line,
    message: issue.message,
  })), [{
    kind: 'completed-with-failed-artifact-verification',
    severity: 'error',
    line: 4,
    message: '最新交付物核验仍未通过，但 agent-run-completed 报告了 completed。',
  }]);
  assert.match(report.issues[0].evidence ?? '', /failedClaims=kTopicLicenseState/);
});

test('run log replay accepts completion after a new artifact hash passes verification', () => {
  const report = replayRunLog(path.join(
    p0aFixtureDir,
    'artifact-verification-repaired-completed.jsonl',
  ));

  assert.equal(report.artifactVerifications, 2);
  assert.deepEqual(report.latestArtifactVerifications.map(verification => ({
    line: verification.line,
    verificationId: verification.verificationId,
    artifactHash: verification.artifactHash,
    ok: verification.ok,
    failedClaims: verification.failedClaims,
  })), [{
    line: 4,
    verificationId: 'vr-repaired-a4a54c8f90e1',
    artifactHash: 'a4a54c8f90e1d6acc41ad39978ad96b472a19f020ddf5907864cbe2e33494f23',
    ok: true,
    failedClaims: [],
  }]);
  assert.deepEqual(report.issues, []);
});

test('run log replay keeps failed verification sticky when a pass reuses hash or id', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T05:17:00.000Z',
      event: 'agent-run-started',
      data: {},
    },
    {
      ts: '2026-07-11T05:17:01.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-failed',
        artifactEvidenceId: 'ev-artifact-failed',
        artifactPath: 'docs/facts.md',
        artifactHash: 'same-hash',
        ok: false,
        claims: [{ symbol: 'kValue', status: 'mismatch' }],
        differences: ['kValue mismatch'],
      },
    },
    {
      ts: '2026-07-11T05:17:02.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-failed-relabelled',
        artifactEvidenceId: 'ev-artifact-failed-reread',
        artifactPath: 'docs/facts.md',
        artifactHash: 'same-hash',
        ok: true,
        claims: [{ symbol: 'kValue', status: 'verified' }],
        differences: [],
        sourceReadbackEvidenceIds: ['ev-source-readback-2'],
      },
    },
    {
      ts: '2026-07-11T05:17:03.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-failed',
        artifactEvidenceId: 'ev-artifact-repaired',
        artifactPath: 'docs/facts.md',
        artifactHash: 'new-hash-with-reused-id',
        ok: true,
        claims: [{ symbol: 'kValue', status: 'verified' }],
        differences: [],
        sourceReadbackEvidenceIds: ['ev-source-readback-3'],
      },
    },
    {
      ts: '2026-07-11T05:17:04.000Z',
      event: 'agent-run-completed',
      data: {
        status: 'completed',
        verificationIds: ['vr-failed'],
        artifactVerificationOk: true,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.deepEqual(report.issues.map(issue => ({
      kind: issue.kind,
      line: issue.line,
    })), [
      { kind: 'non-append-only-artifact-verification', line: 3 },
      { kind: 'non-append-only-artifact-verification', line: 4 },
      { kind: 'completed-with-failed-artifact-verification', line: 5 },
    ]);
    assert.equal(report.latestArtifactVerifications[0].ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay rejects a failed verification appended after completed', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T05:18:00.000Z',
      event: 'agent-run-started',
      data: {},
    },
    {
      ts: '2026-07-11T05:18:01.000Z',
      event: 'agent-run-completed',
      data: { status: 'completed' },
    },
    {
      ts: '2026-07-11T05:18:02.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-late-failure',
        artifactEvidenceId: 'ev-artifact-late-failure',
        artifactPath: 'docs/facts.md',
        artifactHash: 'late-failure-hash',
        ok: false,
        claims: [{ symbol: 'kValue', status: 'mismatch' }],
        differences: ['kValue mismatch'],
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.latestArtifactVerifications[0].ok, false);
    assert.equal(
      report.issues.some(issue => issue.kind === 'completed-with-failed-artifact-verification' && issue.line === 2),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay treats internally contradictory ok true as a sticky failure', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T05:19:00.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-contradictory',
        artifactEvidenceId: 'ev-artifact-contradictory',
        artifactPath: 'docs/facts.md',
        artifactHash: 'contradictory-hash',
        ok: true,
        claims: [{ symbol: 'kValue', status: 'mismatch' }],
        differences: [],
        sourceReadbackEvidenceIds: ['ev-source-readback'],
      },
    },
    {
      ts: '2026-07-11T05:19:01.000Z',
      event: 'agent-run-completed',
      data: { status: 'completed' },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.latestArtifactVerifications[0].ok, false);
    assert.equal(report.issues.some(issue => issue.kind === 'invalid-artifact-verification'), true);
    assert.equal(report.issues.some(issue => issue.kind === 'completed-with-failed-artifact-verification'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay ignores artifact verification events from an untrusted source', () => {
  const { dir, logPath } = writeLog([{
    ts: '2026-07-11T05:20:00.000Z',
    source: 'provider-output',
    event: 'artifact-verification-completed',
    data: {
      verificationId: 'vr-spoofed',
      artifactEvidenceId: 'ev-spoofed',
      artifactPath: 'docs/facts.md',
      artifactHash: 'spoofed-hash',
      ok: true,
      claims: [{ symbol: 'kValue', status: 'verified' }],
      differences: [],
      sourceReadbackEvidenceIds: ['ev-spoofed-source'],
    },
  }]);

  try {
    const report = replayRunLog(logPath);
    assert.equal(report.artifactVerifications, 0);
    assert.equal(report.issues.some(issue => issue.kind === 'invalid-artifact-verification'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay binds completed metadata to the final trusted VerificationResult', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T05:21:00.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-final-pass',
        artifactEvidenceId: 'ev-final-artifact',
        artifactPath: 'docs/facts.md',
        artifactHash: 'final-hash',
        ok: true,
        claims: [{ symbol: 'kValue', status: 'verified' }],
        differences: [],
        sourceReadbackEvidenceIds: ['ev-final-source-readback'],
      },
    },
    {
      ts: '2026-07-11T05:21:01.000Z',
      event: 'agent-run-completed',
      data: {
        status: 'completed',
        verificationIds: ['vr-missing'],
        artifactVerificationOk: false,
      },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const mismatches = report.issues.filter(issue => issue.kind === 'artifact-verification-completion-mismatch');
    assert.equal(mismatches.length, 3);
    assert.equal(mismatches.some(issue => /artifactVerificationOk=false/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /不存在/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /未引用最终生效/.test(issue.message)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay rejects completed metadata that omits artifact verification binding', () => {
  const { dir, logPath } = writeLog([
    {
      ts: '2026-07-11T05:22:00.000Z',
      source: 'vscode-extension.artifact-grounding',
      event: 'artifact-verification-completed',
      data: {
        verificationId: 'vr-final-pass',
        artifactEvidenceId: 'ev-final-artifact',
        artifactPath: 'docs/facts.md',
        artifactHash: 'final-hash',
        ok: true,
        claims: [{ symbol: 'kValue', status: 'verified' }],
        differences: [],
        sourceReadbackEvidenceIds: ['ev-final-source-readback'],
      },
    },
    {
      ts: '2026-07-11T05:22:01.000Z',
      event: 'agent-run-completed',
      data: { status: 'completed' },
    },
  ]);

  try {
    const report = replayRunLog(logPath);
    const mismatches = report.issues.filter(issue => issue.kind === 'artifact-verification-completion-mismatch');
    assert.equal(mismatches.some(issue => /artifactVerificationOk=true/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /verificationIds/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /未引用最终生效/.test(issue.message)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay rejects a completed source-claim report with no grounding event', () => {
  const prompt = '读取 /repo/source.hpp，提取 kAlpha、kBeta 的真实值，创建 Markdown 报告 /repo/facts.md。';
  const { dir, logPath } = writeProductionRunLog({
    prompt,
    statuses: [{
      type: 'agentStatus',
      phase: 'apply',
      state: 'completed',
      taskAction: 'create',
      taskFile: '/repo/facts.md',
      taskDesc: '创建源码事实 Markdown 报告',
      title: 'Markdown 文档已写入',
      detail: '/repo/facts.md',
    }],
    completion: {
      status: 'completed',
      data: {
        changedPaths: ['/repo/facts.md'],
        tasksApplied: 0,
      },
    },
  });

  try {
    const events = loadProductionRunEvents(logPath);
    const started = events.find(entry => entry.event === 'agent-run-started');
    const completed = events.find(entry => entry.event === 'agent-run-completed');
    assert.equal(started.data.requiresSourceClaimArtifactVerification, true);
    assert.equal(typeof started.data.prompt, 'object');
    assert.equal(JSON.stringify(started.data).includes(prompt), false);
    assert.equal(completed.data.taskContractFingerprint, started.data.taskContractFingerprint);
    const report = replayRunLog(logPath);
    assert.equal(report.artifactVerifications, 0);
    const mismatches = report.issues.filter(issue => issue.kind === 'artifact-verification-completion-mismatch');
    assert.equal(mismatches.some(issue => /缺少可信的 VerificationResult/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /artifactVerificationOk=true/.test(issue.message)), true);
    assert.equal(mismatches.some(issue => /verificationIds/.test(issue.message)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run log replay does not require artifact verification for a read-only source-fact answer', () => {
  const prompt = [
    '只分析 /repo/source.hpp，提取 kAlpha、kBeta 的真实值并在回复中说明。',
    '不要创建报告，不要修改或写入任何文件。',
  ].join('\n');
  const { dir, logPath } = writeProductionRunLog({
    prompt,
    traceEvents: [{
      phase: 'payload',
      event: 'payload-recorded',
      data: {
        name: 'extension.response.raw',
        content: [
          '# 源码事实问答',
          '## 结论',
          'kAlpha 的真实值为 1，kBeta 的真实值为 2。',
          '## 依据',
          '两个值均来自 source.hpp 的常量定义，本次没有创建或修改文件。',
        ].join('\n'),
      },
    }],
    statuses: [{
      type: 'agentStatus',
      phase: 'execute',
      state: 'completed',
      taskAction: 'analyze',
      taskFile: '/repo/source.hpp',
      taskDesc: '只读源码事实说明',
      title: '源码事实问答已完成',
    }],
    completion: {
      status: 'completed',
      data: { changedPaths: [], tasksApplied: 0 },
    },
  });

  try {
    const events = loadProductionRunEvents(logPath);
    const started = events.find(entry => entry.event === 'agent-run-started');
    const completed = events.find(entry => entry.event === 'agent-run-completed');
    assert.equal(started.data.requiresSourceClaimArtifactVerification, false);
    assert.equal(completed.data.requiresSourceClaimArtifactVerification, false);
    assert.equal(completed.data.taskContractFingerprint, started.data.taskContractFingerprint);
    const report = replayRunLog(logPath);
    assert.equal(
      report.issues.some(issue => issue.kind === 'artifact-verification-completion-mismatch'),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-A runtime replay manifest binds exact evidence and six claim outcomes', () => {
  const manifest = JSON.parse(readFileSync(path.join(p0aFixtureDir, 'fixture.json'), 'utf8'));
  const oracle = JSON.parse(readFileSync(path.join(p0aFixtureDir, 'oracle.json'), 'utf8'));

  for (const [relativePath, expectedHash] of Object.entries(manifest.fixtureFiles)) {
    assert.equal(
      sha256File(path.join(p0aFixtureDir, relativePath)),
      expectedHash,
      `${relativePath} must remain byte-identical to the manifest`,
    );
  }
  assert.equal(manifest.source.sha256, manifest.fixtureFiles['license_types.hpp']);
  assert.equal(
    manifest.observedArtifact.sha256,
    manifest.fixtureFiles['license-transport-facts.wrong.md'],
  );
  assert.deepEqual(oracle.claimResults, [
    {
      symbol: 'kTopicLicenseState',
      expected: '/uav/license/state',
      observed: '/uav/dt/license/state',
      validator: 'exact',
      status: 'mismatch',
    },
    {
      symbol: 'kTopicLicenseTunnelRx',
      expected: '/uav/license/tunnel/rx',
      observed: '/uav/dt/license/tunnel/rx',
      validator: 'exact',
      status: 'mismatch',
    },
    {
      symbol: 'kMavTunnelCmdLicense',
      expected: 33007,
      observed: 300,
      validator: 'numeric',
      status: 'mismatch',
    },
    {
      symbol: 'kTunnelVersion',
      expected: 1,
      observed: 1,
      validator: 'numeric',
      status: 'verified',
    },
    {
      symbol: 'kTunnelMaxTotalLen',
      expected: 65536,
      observed: 81920,
      validator: 'numeric',
      status: 'mismatch',
    },
    {
      symbol: 'kTunnelSessionTimeoutMs',
      expected: 5000,
      observed: 30000,
      validator: 'numeric',
      status: 'mismatch',
    },
  ]);
  assert.equal(
    oracle.claimResults.filter(claim => claim.status !== 'verified').length,
    oracle.wrongArtifactExpectedFailures,
  );
});
