/**
 * Unit tests for agent/fake-tool-parser.ts.
 *
 * These protect the Phase 6 extraction boundary: fake tool parsing is a pure
 * Agent module, independent of VS Code and the larger agent-loop executor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/fake-tool-parser.bundle.cjs');

execSync(
  `npx esbuild src/agent/fake-tool-parser.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const {
  findFirstToolCallStart,
  parseFakeToolCalls,
  stripToolCallBlocks,
} = req(bundlePath);

test('FakeToolParser: parses bracket tool calls', () => {
  const tools = parseFakeToolCalls('[TOOL:read_file {"path":"src/index.ts"}]');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.deepEqual(tools[0].input, { path: 'src/index.ts' });
});

test('FakeToolParser: parses DeepSeek Calling transcript format', () => {
  const text = [
    '我先看一下文件。',
    'Calling `run_terminal`',
    '{"command":"npm test","workdir":"/tmp/project"}',
  ].join('\n');
  const tools = parseFakeToolCalls(text);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'run_terminal');
  assert.equal(tools[0].input.command, 'npm test');
});

test('FakeToolParser: strips raw tool transcripts from user-facing text', () => {
  const text = [
    '准备执行验证。',
    'Calling `manage_todo_list`',
    '{"todoList":[{"id":1,"title":"测试","status":"completed"}]}',
    '完成。',
  ].join('\n');
  assert.equal(stripToolCallBlocks(text), '准备执行验证。\n完成。');
});

test('FakeToolParser: detects the first tool call start for streaming UI', () => {
  const text = '先说明一下\n{"tool":"write_file","path":"code/hello.cpp","content":"int main(){}"}';
  assert.equal(findFirstToolCallStart(text), text.indexOf('{'));
});

console.log('\nFake tool parser tests passed.\n');
