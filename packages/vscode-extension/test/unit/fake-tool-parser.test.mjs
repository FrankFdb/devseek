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
  containsFakeToolCallProtocol,
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

test('FakeToolParser: parses Markdown-bold Calling transcript with fenced JSON payload', () => {
  const text = [
    '我先核查一下当前代码状态。',
    '**Calling:** `read_file`',
    '```json',
    '{"path": "/home/ff/work/devseek_netai/code/shape_manager/main.cpp"}',
    '```',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.equal(tools[0].input.path, '/home/ff/work/devseek_netai/code/shape_manager/main.cpp');
  assert.equal(findFirstToolCallStart(text), text.indexOf('**Calling'));
  assert.equal(stripToolCallBlocks(text), '我先核查一下当前代码状态。');
});

test('FakeToolParser: parses DeepSeek Tool/Arguments transcript format', () => {
  const text = [
    '让我先查看当前代码结构和已有实现。',
    'Tool: list_dirArguments: {"path":"/home/ff/work/devseek_netai/code/shape_manager"}',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'list_dir');
  assert.deepEqual(tools[0].input, { path: '/home/ff/work/devseek_netai/code/shape_manager' });
  assert.equal(findFirstToolCallStart(text), text.indexOf('Tool:'));
  assert.equal(stripToolCallBlocks(text), '让我先查看当前代码结构和已有实现。');
});

test('FakeToolParser: parses and strips DeepSeek DSML tool transcript format', () => {
  const text = [
    '好的，我先查看当前代码。',
    '< | DSML | tool_calls< | DSML | invoke name="read_file"< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.deepEqual(tools[0].input, { filePath: '/home/kaka/code/shape_manager/main.cpp', path: '/home/kaka/code/shape_manager/main.cpp' });
  assert.equal(findFirstToolCallStart(text), text.indexOf('< | DSML | tool_calls'));
  assert.equal(stripToolCallBlocks(text), '好的，我先查看当前代码。');
});

test('FakeToolParser: parses escaped DeepSeek DSML tool transcript format', () => {
  const text = [
    '我先看看当前代码结构，然后给你实现。',
    '&lt; | DSML | tool_calls&lt; | DSML | invoke name="read_file"&lt; | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp&lt;/ | DSML | parameter>&lt;/ | DSML | invoke>&lt;/ | DSML | tool_calls>',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(containsFakeToolCallProtocol(text), true);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.equal(tools[0].input.path, '/home/kaka/code/shape_manager/main.cpp');
  assert.equal(stripToolCallBlocks(text), '我先看看当前代码结构，然后给你实现。');
});

test('FakeToolParser: parses and strips fullwidth double-bar DSML transcript format', () => {
  const text = [
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
  const tools = parseFakeToolCalls(text);

  assert.equal(containsFakeToolCallProtocol(text), true);
  assert.deepEqual(tools.map((tool) => tool.name), ['read_file', 'list_dir']);
  assert.deepEqual(tools[0].input, { filePath: 'code/shape_manager/main.cpp', path: 'code/shape_manager/main.cpp' });
  assert.deepEqual(tools[1].input, { path: 'code/shape_manager' });
  assert.equal(findFirstToolCallStart(text), text.indexOf('<｜｜DSML｜｜tool_calls>'));
  assert.equal(stripToolCallBlocks(text), '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。');
});

test('FakeToolParser: strips incomplete DSML streaming tail', () => {
  const text = '我先读文件。< | DSML | tool_calls< | DSML | invoke name="read_file"';
  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(findFirstToolCallStart(text), text.indexOf('< | DSML | tool_calls'));
  assert.equal(stripToolCallBlocks(text), '我先读文件。');
});

test('FakeToolParser: strips escaped incomplete DSML streaming tail', () => {
  const text = '我先读文件。&lt; | DSML | tool_calls&lt; | DSML | invoke name="read_file"';
  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(containsFakeToolCallProtocol(text), true);
  assert.equal(stripToolCallBlocks(text), '我先读文件。');
});

test('FakeToolParser: strips incomplete fullwidth DSML streaming tail', () => {
  const text = '我先读文件。<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"';
  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(containsFakeToolCallProtocol(text), true);
  assert.equal(stripToolCallBlocks(text), '我先读文件。');
});

test('FakeToolParser: strips spaced Tool/Arguments terminal transcript', () => {
  const text = '好的，现在执行编译和运行。 Tool: run_terminal Arguments:{"command":"cmake -S . -B build && cmake --build build","is_background":false}';
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'run_terminal');
  assert.equal(tools[0].input.command, 'cmake -S . -B build && cmake --build build');
  assert.equal(stripToolCallBlocks(text), '好的，现在执行编译和运行。');
});

test('FakeToolParser: parses bash Calling JSON command payload as shell command', () => {
  const text = [
    '我先查找这个文件。',
    'Calling: bash',
    '{"command":"find /home/ff/work/devseek_netai/packages/vscode-extension/src/app -name \\"*.ts\\" 2>/dev/null | head -1"}',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'file_search');
  assert.deepEqual(tools[0].input, {
    glob: '/home/ff/work/devseek_netai/packages/vscode-extension/src/app/**/*.ts',
  });
});

test('FakeToolParser: parses DeepSeek search_file alias and strips it from visible prose', () => {
  const text = [
    '让我先搜索相关源文件。',
    'Calling: search_file',
    '{"target_directory":"/home/coder/project/shape_manager","pattern":"*.cpp","recursive":true}',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'search_file');
  assert.equal(tools[0].input.target_directory, '/home/coder/project/shape_manager');
  assert.equal(tools[0].input.pattern, '*.cpp');
  assert.equal(stripToolCallBlocks(text), '让我先搜索相关源文件。');
});

test('FakeToolParser: normalizes DeepSeek search_content alias to grep_search', () => {
  const text = [
    '我先查找鼠标回调。',
    'search_content({"pattern":"glutMouseFunc|mouse|keyboard","directory":"/home/ff/work/devseek_netai/code/shape_manager","fileTypes":"*.cpp,h"})',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'grep_search');
  assert.equal(tools[0].input.pattern, 'glutMouseFunc|mouse|keyboard');
  assert.equal(tools[0].input.path, '/home/ff/work/devseek_netai/code/shape_manager');
  assert.equal(stripToolCallBlocks(text), '我先查找鼠标回调。');
});

test('FakeToolParser: parses bracketed Chinese tool calls and normalizes every result', () => {
  const text = [
    '让我先查看当前`shape_manager`项目的实现，了解图形选择机制和鼠标交互逻辑，然后进行修改。',
    '[调用 read_file] {"filePath":"/home/ff/work/devseek_netai/code/shape_manager/main.cpp", "offset": 0, "limit": 150}',
    '[调用 search_content] {"pattern": "glutKeyboardFunc|keyboard|数字", "directory": "/home/ff/work/devseek_netai/code/shape_manager", "fileTypes": ".cpp,.h"}',
    '[调用 search_content] {"pattern": "glutMouseFunc|mouse|click", "directory": "/home/ff/work/devseek_netai/code/shape_manager", "fileTypes": ".cpp,.h"}',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 3);
  assert.equal(tools[0].name, 'read_file');
  assert.equal(tools[0].input.path, '/home/ff/work/devseek_netai/code/shape_manager/main.cpp');
  assert.equal(tools[0].input.startLine, 1);
  assert.equal(tools[0].input.endLine, 150);
  assert.equal(tools[1].name, 'grep_search');
  assert.equal(tools[1].input.path, '/home/ff/work/devseek_netai/code/shape_manager');
  assert.equal(tools[1].input.includePattern, '.cpp,.h');
  assert.equal(tools[2].name, 'grep_search');
  assert.equal(stripToolCallBlocks(text), '让我先查看当前`shape_manager`项目的实现，了解图形选择机制和鼠标交互逻辑，然后进行修改。');
});

test('FakeToolParser: parses XML self-closing tool tags and normalizes aliases', () => {
  const text = [
    '让我先查看一下当前 `shape_manager` 项目的实现情况。',
    '<read_file path="/home/ff/work/devseek_netai/code/shape_manager/main.cpp" startLine="0" endLine="200"/>',
    '<grep_search pattern="glutMouseFunc|mouse|选择|select|keyboard|数字" directory="/home/ff/work/devseek_netai/code/shape_manager" fileTypes=".cpp,.h"/>',
    '<list_dir path="/home/ff/work/devseek_netai/code/shape_manager"/>',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.deepEqual(tools.map(tool => tool.name), ['read_file', 'grep_search', 'list_dir']);
  assert.deepEqual(tools[0].input, {
    path: '/home/ff/work/devseek_netai/code/shape_manager/main.cpp',
    startLine: 1,
    endLine: 200,
  });
  assert.equal(tools[1].input.path, '/home/ff/work/devseek_netai/code/shape_manager');
  assert.equal(tools[1].input.includePattern, '.cpp,.h');
  assert.equal(findFirstToolCallStart(text), text.indexOf('<read_file'));
  assert.equal(stripToolCallBlocks(text), '让我先查看一下当前 `shape_manager` 项目的实现情况。');
  assert.equal(containsFakeToolCallProtocol(text), true);
});

test('FakeToolParser: parses escaped XML self-closing tool tags and hides streaming tail', () => {
  const complete = '我先读取文件。&lt;read_file path=&quot;code/shape_manager/main.cpp&quot; startLine=&quot;0&quot; endLine=&quot;20&quot;/&gt;';
  const tools = parseFakeToolCalls(complete);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
  assert.deepEqual(tools[0].input, {
    path: 'code/shape_manager/main.cpp',
    startLine: 1,
    endLine: 20,
  });
  assert.equal(stripToolCallBlocks(complete), '我先读取文件。');

  const partial = '我先读取文件。&lt;read_file path=&quot;code/shape_manager/main.cpp&quot;';
  assert.equal(findFirstToolCallStart(partial), partial.indexOf('&lt;read_file'));
  assert.equal(stripToolCallBlocks(partial), '我先读取文件。');
});

test('FakeToolParser: parses paired XML tool tags with JSON bodies', () => {
  const text = [
    '现在开始实现：',
    '<manage_todo_list>{"todoList":[{"id":1,"title":"实现鼠标点击选择","status":"in-progress"}]}</manage_todo_list>',
    '<create_file>{"path":"/tmp/shape_manager/main.cpp","content":"int main(){return 0;}\\n"}</create_file>',
    '<run_terminal>',
    '{"command":"cd /tmp/shape_manager && cmake -S . -B build && cmake --build build"}',
    '</run_terminal>',
  ].join('\n');
  const tools = parseFakeToolCalls(text);

  assert.deepEqual(tools.map(tool => tool.name), ['manage_todo_list', 'create_file', 'run_terminal']);
  assert.equal(tools[0].input.todoList[0].status, 'in-progress');
  assert.equal(tools[1].input.path, '/tmp/shape_manager/main.cpp');
  assert.equal(tools[1].input.content, 'int main(){return 0;}\n');
  assert.equal(tools[2].input.command, 'cd /tmp/shape_manager && cmake -S . -B build && cmake --build build');
  assert.equal(findFirstToolCallStart(text), text.indexOf('<manage_todo_list>'));
  assert.equal(stripToolCallBlocks(text), '现在开始实现：');
});

test('FakeToolParser: hides incomplete paired XML tool tag while streaming', () => {
  const partial = [
    '现在编译测试：',
    '<run_terminal>',
    '{"command":"cd /home/ff/work/devseek_netai/code/shape_manager && cmake -S . -B build',
  ].join('\n');

  assert.equal(findFirstToolCallStart(partial), partial.indexOf('<run_terminal>'));
  assert.equal(stripToolCallBlocks(partial), '现在编译测试：');
});

test('FakeToolParser: does not execute task summary JSON as a bash command', () => {
  const text = [
    'Calling: bash',
    '{"summary":"修复完成。修改文件 packages/vscode-extension/src/app/workflow-service.ts 第 175-176 行；const hasConcreteWorkspaceTarget = true;"}',
  ].join('\n');

  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(findFirstToolCallStart(text), -1);
  assert.equal(stripToolCallBlocks(text), text);
});

test('FakeToolParser: does not execute prose or source comments as shell transcript commands', () => {
  const text = [
    'Calling: bash',
    "// cannot observe local workspace state, while inspect/edit/run workflows can. return ['inspect', 'plan'];",
  ].join('\n');

  assert.equal(parseFakeToolCalls(text).length, 0);
  assert.equal(findFirstToolCallStart(text), -1);
  assert.equal(stripToolCallBlocks(text), text);
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

test('FakeToolParser: parses DeepSeek raw JSON array with type fields', () => {
  const text = [
    '让我先查看当前的代码结构：',
    '[',
    '  {"path":"/home/ff/work/devseek_netai/code/shape_manager","type":"list_dir"},',
    '  {"path":"/home/ff/work/devseek_netai/code/shape_manager/Shape.h","type":"read_file"},',
    '  {"path":"/home/ff/work/devseek_netai/code/shape_manager/Renderer.h","type":"read_file"},',
    '  {"path":"/home/ff/work/devseek_netai/code/shape_manager/main.cpp","type":"read_file"}',
    ']',
  ].join('\n');

  const tools = parseFakeToolCalls(text);

  assert.deepEqual(tools.map(tool => tool.name), ['list_dir', 'read_file', 'read_file', 'read_file']);
  assert.deepEqual(tools[0].input, { path: '/home/ff/work/devseek_netai/code/shape_manager' });
  assert.deepEqual(tools[3].input, { path: '/home/ff/work/devseek_netai/code/shape_manager/main.cpp' });
  assert.equal(findFirstToolCallStart(text), text.indexOf('['));
  assert.equal(stripToolCallBlocks(text), '让我先查看当前的代码结构：');
});

test('FakeToolParser: recovers malformed DeepSeek file tools with unescaped code quotes', () => {
  const text = [
    '现在创建 C++ 文件：',
    '[TOOL:create_file {"path":"/tmp/shape_manager/Sphere.h","content":"#ifndef SPHERE_H\\n#define SPHERE_H\\n#include "Shape.h"\\n#endif\\n"}]',
    '[TOOL:create_file {"path":"/tmp/shape_manager/Sphere.cpp","content":"#include "Sphere.h"\\n#include <iostream>\\nstd::string name() { return "Sphere"; }\\n"}]',
  ].join('\n');

  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, 'create_file');
  assert.equal(tools[0].input.path, '/tmp/shape_manager/Sphere.h');
  assert.equal(tools[0].input.content, '#ifndef SPHERE_H\n#define SPHERE_H\n#include "Shape.h"\n#endif\n');
  assert.equal(tools[1].input.path, '/tmp/shape_manager/Sphere.cpp');
  assert.match(tools[1].input.content, /#include "Sphere\.h"/);
  assert.match(tools[1].input.content, /return "Sphere";/);
  assert.equal(stripToolCallBlocks(text), '现在创建 C++ 文件：');
});

test('FakeToolParser: recovers bracket-closed malformed CMake file tools with braces', () => {
  const text = String.raw`好的，我需要修改CMakeLists.txt来同时编译二维和三维程序。
[TOOL:create_file] {"path":"/tmp/shape_manager/CMakeLists.txt","content":"cmake_minimum_required(VERSION 3.10)\nproject(ShapeManager)\nset(CMAKE_CXX_FLAGS "{CMAKE_CXX_FLAGS} -Wall -Wextra\")\nadd_executable(shape_manager_2d {SOURCES_2D} {HEADERS_2D})\nset_target_properties(shape_manager_2d shape_manager_3d PROPERTIES\n RUNTIME_OUTPUT_DIRECTORY \"{CMAKE_BINARY_DIR}/bin"\n)\nmessage(STATUS "构建二维图形程序: shape_manager_2d (使用 X11)")\n"}`;

  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'create_file');
  assert.equal(tools[0].input.path, '/tmp/shape_manager/CMakeLists.txt');
  assert.match(tools[0].input.content, /set\(CMAKE_CXX_FLAGS "\{CMAKE_CXX_FLAGS\} -Wall -Wextra"\)/);
  assert.match(tools[0].input.content, /RUNTIME_OUTPUT_DIRECTORY "\{CMAKE_BINARY_DIR\}\/bin"/);
  assert.match(tools[0].input.content, /message\(STATUS "构建二维图形程序/);
});

test('FakeToolParser: parses raw JSON file tool arrays with content aliases', () => {
  const text = [
    '```json',
    '[',
    '  {"type":"create_file","path":"/tmp/shape_manager/Sphere.h","fileContent":"class Sphere {};"}',
    ']',
    '```',
  ].join('\n');

  const tools = parseFakeToolCalls(text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'create_file');
  assert.equal(tools[0].input.path, '/tmp/shape_manager/Sphere.h');
  assert.equal(tools[0].input.fileContent, 'class Sphere {};');
});

test('FakeToolParser: strips fenced DeepSeek JSON tool arrays from visible text', () => {
  const text = [
    '让我先查看当前的代码结构：',
    '```json',
    '[',
    '  {"type":"list_dir","path":"/tmp/project"},',
    '  {"type":"read_file","path":"/tmp/project/main.cpp"}',
    ']',
    '```',
  ].join('\n');

  const tools = parseFakeToolCalls(text);

  assert.deepEqual(tools.map(tool => tool.name), ['list_dir', 'read_file']);
  assert.equal(stripToolCallBlocks(text), '让我先查看当前的代码结构：');
});

test('FakeToolParser: parses and strips function-style pseudo tool calls', () => {
  const text = [
    '让我先定位项目文件并查看当前实现：',
    'read_file({"filePath":"/home/ff/work/devseek_netai/code/shape_manager/src/main.cpp"})',
    'list_dir({"path":"/home/ff/work/devseek_netai/code/shape_manager"})',
    'search_file({"glob":"**/*.{cpp,hpp,h,c}","path":"/home/ff/work/devseek_netai/code/shape_manager"})',
  ].join('');

  const tools = parseFakeToolCalls(text);

  assert.deepEqual(tools.map(tool => tool.name), ['read_file', 'list_dir', 'search_file']);
  assert.equal(tools[0].input.path, '/home/ff/work/devseek_netai/code/shape_manager/src/main.cpp');
  assert.equal(findFirstToolCallStart(text), text.indexOf('read_file'));
  assert.equal(stripToolCallBlocks(text), '让我先定位项目文件并查看当前实现：');
  assert.equal(containsFakeToolCallProtocol(text), true);
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
