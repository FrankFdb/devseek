/**
 * Unit tests for non-agent response guarding.
 *
 * When the provider emits internal fake-tool transcripts on a plain chat path,
 * DevSeek must not show a blank response or parse those transcripts as file
 * artifacts. Agent mode owns tool execution; non-agent mode must surface a
 * stable, honest notice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/non-agent-response-guard.bundle.cjs');

execSync(
  `npx esbuild src/app/non-agent-response-guard.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE,
  guardNonAgentResponse,
} = req(bundlePath);

test('NonAgentResponseGuard: keeps ordinary visible replies unchanged', () => {
  const guarded = guardNonAgentResponse('这里是普通回复。');

  assert.equal(guarded.visibleText, '这里是普通回复。');
  assert.equal(guarded.artifactText, '这里是普通回复。');
  assert.equal(guarded.containsInternalToolProtocol, false);
  assert.equal(guarded.usedProtocolNotice, false);
});

test('NonAgentResponseGuard: replaces tool-only DSML with a stable notice', () => {
  const raw = [
    '< | DSML | tool_calls',
    '< | DSML | invoke name="read_file">',
    '< | DSML | parameter name="filePath" string="true">code/shape_manager/main.cpp</ | DSML | parameter>',
    '</ | DSML | invoke></ | DSML | tool_calls>',
  ].join('');
  const guarded = guardNonAgentResponse(raw);

  assert.equal(guarded.visibleText, NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE);
  assert.equal(guarded.artifactText, NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE);
  assert.equal(guarded.containsInternalToolProtocol, true);
  assert.equal(guarded.usedProtocolNotice, true);
  assert.doesNotMatch(guarded.visibleText, /DSML|tool_calls|read_file|filePath/);
});

test('NonAgentResponseGuard: suppresses process-only prose around fullwidth DSML', () => {
  const raw = [
    '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。',
    '<｜｜DSML｜｜tool_calls>',
    '<｜｜DSML｜｜invoke name="read_file">',
    '<｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '<｜｜DSML｜｜invoke name="list_dir">',
    '<｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '</｜｜DSML｜｜tool_calls>',
  ].join('\n');
  const guarded = guardNonAgentResponse(raw);

  assert.equal(guarded.visibleText, NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE);
  assert.equal(guarded.artifactText, NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE);
  assert.equal(guarded.containsInternalToolProtocol, true);
  assert.equal(guarded.usedProtocolNotice, true);
  assert.doesNotMatch(guarded.visibleText, /DSML|tool_calls|read_file|list_dir|filePath/);
});

test('NonAgentResponseGuard: preserves meaningful prose but appends the protocol notice', () => {
  const raw = [
    '我可以解释这个项目的结构，但不能在当前对话路径执行工具。',
    '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="list_dir"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
  ].join('\n');
  const guarded = guardNonAgentResponse(raw);

  assert.match(guarded.visibleText, /我可以解释这个项目的结构/);
  assert.match(guarded.visibleText, /当前对话路径不会执行工具/);
  assert.equal(guarded.artifactText, guarded.visibleText);
  assert.doesNotMatch(guarded.visibleText, /DSML|tool_calls|list_dir/);
});

console.log('\nNon-agent response guard tests passed.\n');
