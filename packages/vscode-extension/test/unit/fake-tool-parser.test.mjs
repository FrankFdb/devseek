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

test('FakeToolParser: strips displayed shell calling transcript blocks', () => {
  const text = [
    '我先找到这个文件：',
    'Calling: bash',
    '```bash',
    'find packages -name "workflow-service.ts" -type f',
    '```',
    '然后继续分析。',
  ].join('\n');

  assert.equal(stripToolCallBlocks(text), '我先找到这个文件：\n然后继续分析。');
});

test('FakeToolParser: strips inline shell transcript blocks with CODE fences', () => {
  const text = [
    '我需要先查看 workflow-service.ts 文件的内容，然后找出明显的问题。 Calling: bash',
    '```CODE',
    'cat packages/vscode-extension/src/app/workflow-service.ts 2>/dev/null || echo "File not found"',
    '```',
    '接着分析。',
  ].join('\n');

  assert.equal(
    stripToolCallBlocks(text),
    '我需要先查看 workflow-service.ts 文件的内容，然后找出明显的问题。\n接着分析。',
  );
});

test('FakeToolParser: parses shell cat transcript as read_file', () => {
  const text = [
    '我先读取这个文件： Calling: bash',
    '```CODE',
    'cat packages/vscode-extension/src/app/workflow-service.ts 2>/dev/null || echo "File not found"',
    '```',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.deepEqual(tools[0].input, { path: 'packages/vscode-extension/src/app/workflow-service.ts' });
});

test('FakeToolParser: parses shell find transcript as file_search', () => {
  const text = [
    'Calling: bash',
    '```CODE',
    'find packages/vscode-extension/src/app -name "workflow-service.ts" -type f 2>/dev/null',
    '```',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'file_search');
  assert.deepEqual(tools[0].input, { glob: 'packages/vscode-extension/src/app/**/workflow-service.ts' });
});

test('FakeToolParser: parses nameless Calling shell fence as read_file', () => {
  const text = [
    '好的，我先查看文件。 Calling:',
    '```bash',
    'cat packages/vscode-extension/src/agent/tool-executor.ts 2>/dev/null',
    '```',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.deepEqual(tools[0].input, { path: 'packages/vscode-extension/src/agent/tool-executor.ts' });
  assert.equal(stripToolCallBlocks(text), '好的，我先查看文件。');
});

test('FakeToolParser: keeps ordinary nameless Calling prose', () => {
  const text = [
    'Calling:',
    '这不是命令，只是一段普通说明。',
  ].join('\n');

  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(findFirstToolCallStart(text), -1);
  assert.equal(stripToolCallBlocks(text), text);
});

test('FakeToolParser: detects the first tool call start for streaming UI', () => {
  const text = '先说明一下\n{"tool":"write_file","path":"code/hello.cpp","content":"int main(){}"}';
  assert.equal(findFirstToolCallStart(text), text.indexOf('{'));
});

test('FakeToolParser: detects shell transcript start for streaming UI', () => {
  const text = '我先查看文件： Calling: bash\n```CODE\ncat package.json\n```';
  assert.equal(findFirstToolCallStart(text), text.indexOf('Calling'));
});

console.log('\nFake tool parser tests passed.\n');
