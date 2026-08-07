#!/usr/bin/env node
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const args = new Set(process.argv.slice(2));
const skipRealDeepSeek = args.has('--skip-real-deepseek') || process.env.DEVSEEK_SELF_LOOP_SKIP_REAL_DEEPSEEK === '1';
const headedDeepSeek = args.has('--headed') || process.env.DEVSEEK_SELF_LOOP_HEADED === '1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'devseek-agent-self-loop-'));
const requireFromHere = createRequire(import.meta.url);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(repoRoot, 'artifacts', 'agent-self-loop', runId);
mkdirSync(artifactDir, { recursive: true });
const reportPath = path.join(artifactDir, 'report.json');
const report = {
  ok: false,
  tempRoot,
  artifactDir,
  reportPath,
  headedDeepSeek,
  caseCatalog: [
    'static guard rails: file tools must be explicit; terminal must not write source files',
    'legacy artifact extraction: markdown/tool/diff outputs resolve to intended files',
    'create program: create_file/filePath -> write -> compile -> run',
    'modify existing program: replace_file preserves old behavior and adds feature',
    'same session multi-turn: create -> add feature -> delete feature -> repair -> verify each turn',
    'incremental patch: unified diff applies to existing file and validates',
    'repair program: compile failure -> corrected file -> compile -> run',
    'multi-file project: hierarchy generation -> write several files -> compile -> run',
    'real DeepSeek create: web bridge returns tool call -> local write/compile/run',
    'real DeepSeek modify: web bridge updates existing program -> local write/compile/run',
    'real DeepSeek same session: newSession true, then follow-up edits with newSession false',
  ],
  cases: [],
  fixesVerified: [],
};

function run(cmd, options = {}) {
  return cp.execSync(cmd, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    timeout: options.timeoutMs || 120000,
  });
}

async function bundleRuntime() {
  const out = path.join(tempRoot, 'generated-runtime.cjs');
  const entry = path.join(tempRoot, 'generated-runtime-entry.js');
  writeFileSync(entry, [
    "const parser = require('./repo/packages/vscode-extension/src/generated-file-parser.ts');",
    "const resolver = require('./repo/packages/vscode-extension/src/generated-file-resolver.ts');",
    'module.exports = { ...parser, ...resolver };',
  ].join('\n'), 'utf8');
  const repoLink = path.join(tempRoot, 'repo');
  try { symlinkSync(repoRoot, repoLink, 'dir'); } catch {}
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  return requireFromHere(out);
}

function addCase(name, status, details = {}) {
  report.cases.push({ name, status, ...details });
}

function fileToolCall(name, input) {
  return `[TOOL:${name} ${JSON.stringify(input)}]`;
}

async function resolveAndWrite(runtime, workspace, responseText, requestPrompt, expectedPath) {
  const resolved = await runtime.resolveGeneratedArtifacts({ responseText, requestPrompt });
  assert.ok(resolved.length > 0, `expected generated file artifacts for ${requestPrompt}`);
  if (expectedPath) {
    assert.ok(resolved.some((artifact) => artifact.resolvedPath === expectedPath), `expected artifact for ${expectedPath}`);
  }
  writeArtifacts(workspace, expectedPath ? resolved.filter((artifact) => artifact.resolvedPath === expectedPath) : resolved);
  return resolved;
}

function writeArtifacts(workspace, resolved) {
  const written = [];
  for (const artifact of resolved) {
    const target = path.resolve(workspace, artifact.resolvedPath);
    assert.ok(target.startsWith(path.resolve(workspace) + path.sep), `path escaped workspace: ${artifact.resolvedPath}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, artifact.content.endsWith('\n') ? artifact.content : artifact.content + '\n', 'utf8');
    written.push(target);
  }
  return written;
}

function compileAndRunCpp(workspace, sourceRel, binaryRel) {
  const source = path.join(workspace, sourceRel);
  const binary = path.join(workspace, binaryRel);
  mkdirSync(path.dirname(binary), { recursive: true });
  run(`g++ -std=c++17 ${shellQuote(source)} -o ${shellQuote(binary)}`, { cwd: workspace });
  return run(shellQuote(binary), { cwd: workspace }).trim();
}

function compileCppResult(workspace, sourceRel, binaryRel) {
  const source = path.join(workspace, sourceRel);
  const binary = path.join(workspace, binaryRel);
  mkdirSync(path.dirname(binary), { recursive: true });
  return cp.spawnSync('g++', ['-std=c++17', source, '-o', binary], {
    cwd: workspace,
    encoding: 'utf8',
  });
}

function expectCompileFailure(workspace, sourceRel, binaryRel) {
  const result = compileCppResult(workspace, sourceRel, binaryRel);
  assert.notEqual(result.status, 0, 'expected compilation to fail before repair');
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function applyPatchArtifacts(workspace, artifacts) {
  const patches = artifacts.filter((artifact) => artifact.type === 'patch');
  assert.ok(patches.length > 0, 'expected at least one patch artifact');
  for (let i = 0; i < patches.length; i++) {
    const patchFile = path.join(workspace, `.devseek-self-loop-${i}.patch`);
    writeFileSync(patchFile, patches[i].diff.endsWith('\n') ? patches[i].diff : patches[i].diff + '\n', 'utf8');
    run(`patch -p1 -i ${shellQuote(patchFile)}`, { cwd: workspace });
  }
}

async function localFileToolAliasCase(runtime) {
  const workspace = path.join(tempRoot, 'local-file-tool-alias');
  mkdirSync(workspace, { recursive: true });
  const responseText = [
    '[TOOL:create_file {"filePath":"code/self_loop/main.cpp","content":"#include <iostream>\\nint main() { std::cout << \\"DEVSEEK_SELF_LOOP_OK\\" << std::endl; return 0; }\\n"}]',
  ].join('\n');
  const resolved = await runtime.resolveGeneratedArtifacts({
    responseText,
    requestPrompt: '在 code 目录下创建 C++ 程序并运行',
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].resolvedPath, 'code/self_loop/main.cpp');
  writeArtifacts(workspace, resolved);
  const output = compileAndRunCpp(workspace, 'code/self_loop/main.cpp', 'code/self_loop/self_loop');
  assert.equal(output, 'DEVSEEK_SELF_LOOP_OK');
  addCase('local:filePath tool alias -> write -> compile -> run', 'passed', { output });
}

async function localMultiFileCase(runtime) {
  const workspace = path.join(tempRoot, 'local-multifile');
  mkdirSync(workspace, { recursive: true });
  const responseText = [
    'animal_relationship/',
    '├── Animal.h',
    '├── Dog.h',
    '└── main.cpp',
    '',
    '1. animal_relationship/Animal.h',
    '```cpp',
    '#pragma once',
    '#include <string>',
    'class Animal { public: virtual ~Animal() = default; virtual std::string sound() const = 0; };',
    '```',
    '',
    '2. animal_relationship/Dog.h',
    '```cpp',
    '#pragma once',
    '#include "Animal.h"',
    'class Dog : public Animal { public: std::string sound() const override { return "woof"; } };',
    '```',
    '',
    '3. animal_relationship/main.cpp',
    '```cpp',
    '#include <iostream>',
    '#include "Dog.h"',
    'int main() { Dog d; std::cout << d.sound() << std::endl; return 0; }',
    '```',
  ].join('\n');
  const resolved = await runtime.resolveGeneratedArtifacts({
    responseText,
    requestPrompt: '创建 C++ 多文件项目，体现动物继承关系',
  });
  assert.equal(resolved.length, 3);
  writeArtifacts(workspace, resolved);
  const output = compileAndRunCpp(workspace, 'animal_relationship/main.cpp', 'animal_relationship/animal_demo');
  assert.equal(output, 'woof');
  addCase('local:multi-file C++ hierarchy -> write -> compile -> run', 'passed', { files: resolved.map((f) => f.resolvedPath), output });
}

async function localModifyExistingProgramCase(runtime) {
  const workspace = path.join(tempRoot, 'local-modify-existing');
  const fileRel = 'code/calculator/main.cpp';
  mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
  writeFileSync(path.join(workspace, fileRel), [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int main() { std::cout << add(2, 3) << std::endl; return 0; }',
    '',
  ].join('\n'), 'utf8');
  assert.equal(compileAndRunCpp(workspace, fileRel, 'code/calculator/app'), '5');

  const responseText = [
    '[TOOL:replace_file {"filePath":"code/calculator/main.cpp","content":"#include <iostream>\\nint add(int a, int b) { return a + b; }\\nint multiply(int a, int b) { return a * b; }\\nint main() { std::cout << add(2, 3) << std::endl; std::cout << multiply(2, 3) << std::endl; return 0; }\\n"}]',
  ].join('\n');
  const resolved = await runtime.resolveGeneratedArtifacts({
    responseText,
    requestPrompt: '在原有 calculator 程序上添加 multiply 功能，保留 add 输出',
  });
  assert.equal(resolved.length, 1);
  writeArtifacts(workspace, resolved);
  const output = compileAndRunCpp(workspace, fileRel, 'code/calculator/app');
  assert.equal(output, '5\n6');
  addCase('local:modify existing program -> preserve behavior -> add feature -> compile -> run', 'passed', { output });
}

async function localSameSessionMultiTurnCase(runtime) {
  const workspace = path.join(tempRoot, 'local-same-session-multiturn');
  const fileRel = 'code/session_calc/main.cpp';
  mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
  const turns = [];

  const turn1Content = [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int subtract(int a, int b) { return a - b; }',
    'int main() {',
    '  std::cout << "ADD:" << add(2, 3) << std::endl;',
    '  std::cout << "SUB:" << subtract(5, 2) << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  await resolveAndWrite(
    runtime,
    workspace,
    fileToolCall('create_file', { filePath: fileRel, content: turn1Content }),
    'session turn 1: 在 code 目录创建 calculator 程序，包含 add 和 subtract',
    fileRel,
  );
  let output = compileAndRunCpp(workspace, fileRel, 'code/session_calc/app');
  assert.equal(output, 'ADD:5\nSUB:3');
  turns.push({ turn: 1, action: 'create add/subtract program', output });

  const turn2Content = [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int subtract(int a, int b) { return a - b; }',
    'int multiply(int a, int b) { return a * b; }',
    'int main() {',
    '  std::cout << "ADD:" << add(2, 3) << std::endl;',
    '  std::cout << "SUB:" << subtract(5, 2) << std::endl;',
    '  std::cout << "MUL:" << multiply(2, 3) << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  await resolveAndWrite(
    runtime,
    workspace,
    fileToolCall('replace_file', { filePath: fileRel, content: turn2Content }),
    'session turn 2: 同一个 session 内在第一次程序上添加 multiply，保留 add/subtract',
    fileRel,
  );
  output = compileAndRunCpp(workspace, fileRel, 'code/session_calc/app');
  assert.equal(output, 'ADD:5\nSUB:3\nMUL:6');
  turns.push({ turn: 2, action: 'add multiply while preserving previous behavior', output });

  const deleteSubtractPatch = [
    '```diff',
    '--- a/code/session_calc/main.cpp',
    '+++ b/code/session_calc/main.cpp',
    '@@ -1,12 +1,11 @@',
    ' #include <iostream>',
    ' int add(int a, int b) { return a + b; }',
    '-int subtract(int a, int b) { return a - b; }',
    ' int multiply(int a, int b) { return a * b; }',
    ' int main() {',
    '   std::cout << "ADD:" << add(2, 3) << std::endl;',
    '-  std::cout << "SUB:" << subtract(5, 2) << std::endl;',
    '   std::cout << "MUL:" << multiply(2, 3) << std::endl;',
    '+  std::cout << "DELETE_OK" << std::endl;',
    '   return 0;',
    ' }',
    '```',
  ].join('\n');
  applyPatchArtifacts(workspace, runtime.parseGeneratedArtifacts(deleteSubtractPatch));
  const afterDeleteSource = readFileSync(path.join(workspace, fileRel), 'utf8');
  assert.doesNotMatch(afterDeleteSource, /subtract/);
  output = compileAndRunCpp(workspace, fileRel, 'code/session_calc/app');
  assert.equal(output, 'ADD:5\nMUL:6\nDELETE_OK');
  turns.push({ turn: 3, action: 'delete subtract feature via incremental patch', output });

  const brokenTurn4Content = [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int multiply(int a, int b) { return a * b; }',
    'int divide(int a, int b) { return a / b; }',
    'int main() {',
    '  std::cout << "ADD:" << add(2, 3) << std::endl;',
    '  std::cout << "MUL:" << multiply(2, 3) << std::endl;',
    '  std::cout << "DIV:" << divide(8, 4) << std::endl',
    '  std::cout << "DELETE_OK" << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  await resolveAndWrite(
    runtime,
    workspace,
    fileToolCall('replace_file', { filePath: fileRel, content: brokenTurn4Content }),
    'session turn 4: 在同一程序中新增 divide 功能',
    fileRel,
  );
  const compileError = expectCompileFailure(workspace, fileRel, 'code/session_calc/app');
  turns.push({ turn: '4a', action: 'detect compile failure after attempted divide feature', errorPreview: compileError.slice(0, 160) });

  const repairedTurn4Content = brokenTurn4Content.replace(
    '  std::cout << "DIV:" << divide(8, 4) << std::endl\n',
    '  std::cout << "DIV:" << divide(8, 4) << std::endl;\n',
  );
  await resolveAndWrite(
    runtime,
    workspace,
    fileToolCall('replace_file', { filePath: fileRel, content: repairedTurn4Content }),
    'session turn 4 repair: 根据编译错误修复 divide 输出缺少分号的问题',
    fileRel,
  );
  output = compileAndRunCpp(workspace, fileRel, 'code/session_calc/app');
  assert.equal(output, 'ADD:5\nMUL:6\nDIV:2\nDELETE_OK');
  turns.push({ turn: '4b', action: 'repair compile failure and verify final program', output });

  addCase('local:same session multi-turn create -> add -> delete -> repair -> compile/run each turn', 'passed', {
    file: fileRel,
    turns,
  });
}

async function localPatchFeatureCase(runtime) {
  const workspace = path.join(tempRoot, 'local-patch-feature');
  const fileRel = 'code/patch/main.cpp';
  mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
  writeFileSync(path.join(workspace, fileRel), [
    '#include <iostream>',
    'int score() {',
    '  return 1;',
    '}',
    'int main() {',
    '  std::cout << score() << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n'), 'utf8');

  const responseText = [
    '```diff',
    '--- a/code/patch/main.cpp',
    '+++ b/code/patch/main.cpp',
    '@@ -1,7 +1,7 @@',
    ' #include <iostream>',
    ' int score() {',
    '-  return 1;',
    '+  return 2;',
    ' }',
    ' int main() {',
    '   std::cout << score() << std::endl;',
    '```',
  ].join('\n');
  const artifacts = runtime.parseGeneratedArtifacts(responseText);
  applyPatchArtifacts(workspace, artifacts);
  const output = compileAndRunCpp(workspace, fileRel, 'code/patch/app');
  assert.equal(output, '2');
  addCase('local:incremental unified diff patch -> compile -> run', 'passed', { output });
}

async function localRepairCompileErrorCase(runtime) {
  const workspace = path.join(tempRoot, 'local-repair-compile');
  const fileRel = 'code/repair/main.cpp';
  mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
  writeFileSync(path.join(workspace, fileRel), [
    '#include <iostream>',
    'int main() {',
    '  std::cout << "REPAIR_OK" << std::endl',
    '  return 0;',
    '}',
    '',
  ].join('\n'), 'utf8');
  const before = expectCompileFailure(workspace, fileRel, 'code/repair/app');
  assert.match(before, /error/i);

  const responseText = [
    '[TOOL:replace_file {"filePath":"code/repair/main.cpp","content":"#include <iostream>\\nint main() {\\n  std::cout << \\"REPAIR_OK\\" << std::endl;\\n  return 0;\\n}\\n"}]',
  ].join('\n');
  const resolved = await runtime.resolveGeneratedArtifacts({
    responseText,
    requestPrompt: '修复 code/repair/main.cpp 的编译错误并验证',
  });
  assert.equal(resolved.length, 1);
  writeArtifacts(workspace, resolved);
  const output = compileAndRunCpp(workspace, fileRel, 'code/repair/app');
  assert.equal(output, 'REPAIR_OK');
  addCase('local:repair compile error -> replace_file -> compile -> run', 'passed', { output });
}

function staticAgentGuardCase() {
  const writeGuard = readFileSync(path.join(repoRoot, 'packages/vscode-extension/src/agent/write-guard.ts'), 'utf8');
  const toolLoop = readFileSync(path.join(repoRoot, 'packages/vscode-extension/src/agent/tool-loop.ts'), 'utf8');
  assert.match(writeGuard, /function detectShellFileWriteCommand/);
  assert.match(toolLoop, /detectShellFileWriteCommand\(command\)/);
  assert.match(toolLoop, /请不要改用 run_terminal 写文件/);
  assert.match(toolLoop, /缺少 path\/filePath/);
  assert.doesNotMatch(toolLoop, /改用 run_terminal 通过 printf 或 cat 命令写入文件/);
  addCase('static:agent guard rails for file tools and terminal writes', 'passed');
}

function legacyGeneratedFilesScriptCase() {
  const output = run('node scripts/verify-generated-files.mjs', { cwd: repoRoot }).trim();
  assert.match(output, /PASS/);
  addCase('legacy:verify-generated-files script restored', 'passed', { output });
}

async function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let i = 0; i < 30; i++) {
    const port = 47400 + Math.floor(Math.random() * 900);
    if (await canListen(port)) return port;
  }
  throw new Error('no free port');
}

async function fetchText(url, options) {
  const res = await fetch(url, options);
  return { status: res.status, text: await res.text() };
}

async function waitForBridge(baseUrl, token) {
  const deadline = Date.now() + 15000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const ping = await fetchText(`${baseUrl}/ping`);
      if (ping.status === 200) {
        const status = await fetchText(`${baseUrl}/status`, { headers: { 'X-DevSeek-Token': token } });
        if (status.status === 200) return JSON.parse(status.text);
        last = status.text;
      }
    } catch (error) {
      last = String(error?.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`bridge not ready: ${last}`);
}

async function startBridge() {
  const serverPath = path.join(repoRoot, 'packages/bridge/dist/server.js');
  if (!existsSync(serverPath)) run('npm run bridge:build', { cwd: repoRoot });
  const token = crypto.randomBytes(32).toString('hex');
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = path.join(tempRoot, 'bridge.log');
  const logFd = openSync(logPath, 'a');
  const child = cp.spawn('node', [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      HEADLESS: headedDeepSeek ? 'false' : 'true',
      WORKSPACE_ROOT: repoRoot,
      BRIDGE_PORT: String(port),
      DEVSEEK_BRIDGE_TOKEN: token,
    },
    stdio: ['ignore', logFd, logFd],
  });
  const status = await waitForBridge(baseUrl, token);
  return { baseUrl, token, child, logFd, logPath, status };
}

async function shutdownBridge(bridge) {
  if (!bridge) return;
  try {
    await fetchText(`${bridge.baseUrl}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DevSeek-Token': bridge.token },
      body: '{}',
    });
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (bridge.child.exitCode === null) bridge.child.kill('SIGTERM');
  closeSync(bridge.logFd);
}

async function streamBridgeChat(bridge, promptText, options = {}) {
  const res = await fetch(`${bridge.baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-DevSeek-Token': bridge.token,
    },
    body: JSON.stringify({
      prompt: promptText,
      newSession: options.newSession ?? true,
      stream: true,
      timeoutMs: options.timeoutMs ?? 120000,
      mode: options.mode ?? 'fast',
    }),
  });
  if (res.status === 401) throw new Error('LOGIN_REQUIRED');
  if (!res.ok) throw new Error(`bridge chat failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing response stream');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let deltaCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) {
        deltaCount++;
        content = parsed.delta.startsWith('\x00RESET\x00') ? parsed.delta.slice(7) : content + parsed.delta;
      }
    }
  }
  return { content, deltaCount };
}

async function resolveDeepSeekExpectedFile(runtime, workspace, responseText, requestPrompt, fileRel) {
  let resolved = await runtime.resolveGeneratedArtifacts({ responseText, requestPrompt });
  if (resolved.length === 0) {
    resolved = [{
      type: 'file',
      path: fileRel,
      resolvedPath: fileRel,
      language: 'cpp',
      content: extractCppFromDeepSeekText(responseText),
    }];
  }
  const expected = resolved.find((artifact) => artifact.resolvedPath === fileRel) || resolved[0];
  assert.equal(expected.resolvedPath, fileRel);
  writeArtifacts(workspace, [expected]);
  return expected;
}

async function realDeepSeekToolCase(runtime) {
  if (skipRealDeepSeek) {
    addCase('real-deepseek:create_file tool -> compile -> run', 'skipped', { reason: 'skip flag enabled' });
    return;
  }
  let bridge;
  try {
    bridge = await startBridge();
    const prompt = [
      '你正在参加 DevSeek 编程智能体协议自闭环测试。',
      '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块。',
      '工具调用必须使用 filePath 字段，路径必须是 code/deepseek_self_loop/main.cpp。',
      'content 字段必须是一个完整且可用 g++ -std=c++17 编译运行的 C++ 程序。',
      '程序运行时只输出一行：DEEPSEEK_AGENT_SELF_LOOP_OK',
      '格式示例：[TOOL:create_file {"filePath":"code/deepseek_self_loop/main.cpp","content":"..."}]',
    ].join('\n');
    const promptPath = path.join(artifactDir, 'real-deepseek-prompt.txt');
    writeFileSync(promptPath, prompt, 'utf8');
    const stream = await streamBridgeChat(bridge, prompt);
    const responsePath = path.join(artifactDir, 'real-deepseek-response.txt');
    writeFileSync(responsePath, stream.content, 'utf8');
    assert.ok(stream.deltaCount > 0, 'DeepSeek returned no deltas');
    let resolved = await runtime.resolveGeneratedArtifacts({
      responseText: stream.content,
      requestPrompt: '在 code 目录下创建 C++ 程序并运行',
    });
    if (resolved.length === 0) {
      resolved = [{
        type: 'file',
        path: 'code/deepseek_self_loop/main.cpp',
        resolvedPath: 'code/deepseek_self_loop/main.cpp',
        language: 'cpp',
        content: extractCppFromDeepSeekText(stream.content),
      }];
    }
    assert.equal(resolved.length, 1);
    const workspace = path.join(tempRoot, 'real-deepseek');
    mkdirSync(workspace, { recursive: true });
    writeArtifacts(workspace, resolved);
    const output = compileAndRunCpp(workspace, 'code/deepseek_self_loop/main.cpp', 'code/deepseek_self_loop/main');
    assert.equal(output, 'DEEPSEEK_AGENT_SELF_LOOP_OK');
    addCase('real-deepseek:create_file tool -> write -> compile -> run', 'passed', {
      deltaCount: stream.deltaCount,
      bridgeStatus: bridge.status,
      promptPath,
      responsePath,
      preview: stream.content.replace(/\s+/g, ' ').slice(0, 180),
      output,
    });
  } finally {
    await shutdownBridge(bridge);
  }
}

async function realDeepSeekModifyFeatureCase(runtime) {
  if (skipRealDeepSeek) {
    addCase('real-deepseek:modify existing program -> compile -> run', 'skipped', { reason: 'skip flag enabled' });
    return;
  }
  let bridge;
  try {
    bridge = await startBridge();
    const workspace = path.join(tempRoot, 'real-deepseek-modify');
    const fileRel = 'code/deepseek_modify/main.cpp';
    mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
    const original = [
      '#include <iostream>',
      'int add(int a, int b) { return a + b; }',
      'int main() {',
      '  std::cout << add(2, 3) << std::endl;',
      '  return 0;',
      '}',
      '',
    ].join('\n');
    writeFileSync(path.join(workspace, fileRel), original, 'utf8');
    assert.equal(compileAndRunCpp(workspace, fileRel, 'code/deepseek_modify/app'), '5');

    const prompt = [
      '你正在参加 DevSeek 编程智能体“修改既有程序”协议自闭环测试。',
      '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块。',
      '工具名必须是 replace_file，字段必须使用 filePath 和 content。',
      'filePath 必须是 code/deepseek_modify/main.cpp。',
      '下面是当前文件内容：',
      '```cpp',
      original,
      '```',
      '请在保留 add(2,3) 输出 5 的基础上，新增 multiply(2,3) 输出 6。',
      '最终程序运行时必须只输出两行：第一行 5，第二行 DEEPSEEK_AGENT_FEATURE_OK:6。',
      '格式示例：[TOOL:replace_file {"filePath":"code/deepseek_modify/main.cpp","content":"..."}]',
    ].join('\n');
    const promptPath = path.join(artifactDir, 'real-deepseek-modify-prompt.txt');
    writeFileSync(promptPath, prompt, 'utf8');
    const stream = await streamBridgeChat(bridge, prompt);
    const responsePath = path.join(artifactDir, 'real-deepseek-modify-response.txt');
    writeFileSync(responsePath, stream.content, 'utf8');
    assert.ok(stream.deltaCount > 0, 'DeepSeek returned no deltas');
    const resolved = await runtime.resolveGeneratedArtifacts({
      responseText: stream.content,
      requestPrompt: '修改已有 C++ 程序，添加 multiply 功能并运行',
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].resolvedPath, fileRel);
    writeArtifacts(workspace, resolved);
    const output = compileAndRunCpp(workspace, fileRel, 'code/deepseek_modify/app');
    assert.equal(output, '5\nDEEPSEEK_AGENT_FEATURE_OK:6');
    addCase('real-deepseek:modify existing program -> replace_file -> compile -> run', 'passed', {
      deltaCount: stream.deltaCount,
      bridgeStatus: bridge.status,
      promptPath,
      responsePath,
      preview: stream.content.replace(/\s+/g, ' ').slice(0, 180),
      output,
    });
  } finally {
    await shutdownBridge(bridge);
  }
}

async function realDeepSeekSameSessionMultiTurnCase(runtime) {
  if (skipRealDeepSeek) {
    addCase('real-deepseek:same session create -> add -> delete -> compile/run each turn', 'skipped', { reason: 'skip flag enabled' });
    return;
  }
  let bridge;
  try {
    bridge = await startBridge();
    const workspace = path.join(tempRoot, 'real-deepseek-same-session');
    const fileRel = 'code/deepseek_session/main.cpp';
    mkdirSync(path.dirname(path.join(workspace, fileRel)), { recursive: true });
    const turns = [];

    const prompt1 = [
      '你正在参加 DevSeek 编程智能体“同一个 session 多轮修改”自闭环测试，第 1 轮。',
      '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块。',
      '工具名必须是 create_file，字段必须使用 filePath 和 content。',
      `filePath 必须是 ${fileRel}。`,
      'content 字段必须是一个完整且可用 g++ -std=c++17 编译运行的 C++ 程序。',
      '程序运行时必须只输出一行：DS_SESSION_CREATE_OK',
      `格式示例：[TOOL:create_file {"filePath":"${fileRel}","content":"..."}]`,
    ].join('\n');
    const prompt1Path = path.join(artifactDir, 'real-deepseek-session-turn1-prompt.txt');
    writeFileSync(prompt1Path, prompt1, 'utf8');
    const stream1 = await streamBridgeChat(bridge, prompt1, { newSession: true });
    const response1Path = path.join(artifactDir, 'real-deepseek-session-turn1-response.txt');
    writeFileSync(response1Path, stream1.content, 'utf8');
    assert.ok(stream1.deltaCount > 0, 'DeepSeek turn 1 returned no deltas');
    await resolveDeepSeekExpectedFile(runtime, workspace, stream1.content, '同一个 session 第 1 轮：创建 C++ 程序', fileRel);
    let output = compileAndRunCpp(workspace, fileRel, 'code/deepseek_session/app');
    assert.equal(output, 'DS_SESSION_CREATE_OK');
    turns.push({ turn: 1, newSession: true, output, promptPath: prompt1Path, responsePath: response1Path });

    const sourceAfterTurn1 = readFileSync(path.join(workspace, fileRel), 'utf8');
    const prompt2 = [
      '这是同一个 DeepSeek session 的第 2 轮输入，请基于上一轮任务继续修改程序。',
      '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块。',
      '工具名必须是 replace_file，字段必须使用 filePath 和 content。',
      `filePath 必须是 ${fileRel}。`,
      '下面是当前文件内容：',
      '```cpp',
      sourceAfterTurn1,
      '```',
      '请添加 multiply(2,3) 功能，并保留第一轮 DS_SESSION_CREATE_OK 输出。',
      '最终程序运行时必须只输出两行：第一行 DS_SESSION_CREATE_OK，第二行 DS_SESSION_ADD_OK:6。',
      `格式示例：[TOOL:replace_file {"filePath":"${fileRel}","content":"..."}]`,
    ].join('\n');
    const prompt2Path = path.join(artifactDir, 'real-deepseek-session-turn2-prompt.txt');
    writeFileSync(prompt2Path, prompt2, 'utf8');
    const stream2 = await streamBridgeChat(bridge, prompt2, { newSession: false });
    const response2Path = path.join(artifactDir, 'real-deepseek-session-turn2-response.txt');
    writeFileSync(response2Path, stream2.content, 'utf8');
    assert.ok(stream2.deltaCount > 0, 'DeepSeek turn 2 returned no deltas');
    await resolveDeepSeekExpectedFile(runtime, workspace, stream2.content, '同一个 session 第 2 轮：在已有程序上添加 multiply 功能', fileRel);
    output = compileAndRunCpp(workspace, fileRel, 'code/deepseek_session/app');
    assert.equal(output, 'DS_SESSION_CREATE_OK\nDS_SESSION_ADD_OK:6');
    turns.push({ turn: 2, newSession: false, output, promptPath: prompt2Path, responsePath: response2Path });

    const sourceAfterTurn2 = readFileSync(path.join(workspace, fileRel), 'utf8');
    const prompt3 = [
      '这是同一个 DeepSeek session 的第 3 轮输入，请继续修改同一个程序。',
      '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块。',
      '工具名必须是 replace_file，字段必须使用 filePath 和 content。',
      `filePath 必须是 ${fileRel}。`,
      '下面是当前文件内容：',
      '```cpp',
      sourceAfterTurn2,
      '```',
      '请删除第一轮 DS_SESSION_CREATE_OK 输出对应的功能，但保留第二轮 multiply 功能。',
      '最终程序运行时必须只输出两行：第一行 DS_SESSION_ADD_OK:6，第二行 DS_SESSION_DELETE_OK。',
      `格式示例：[TOOL:replace_file {"filePath":"${fileRel}","content":"..."}]`,
    ].join('\n');
    const prompt3Path = path.join(artifactDir, 'real-deepseek-session-turn3-prompt.txt');
    writeFileSync(prompt3Path, prompt3, 'utf8');
    const stream3 = await streamBridgeChat(bridge, prompt3, { newSession: false });
    const response3Path = path.join(artifactDir, 'real-deepseek-session-turn3-response.txt');
    writeFileSync(response3Path, stream3.content, 'utf8');
    assert.ok(stream3.deltaCount > 0, 'DeepSeek turn 3 returned no deltas');
    await resolveDeepSeekExpectedFile(runtime, workspace, stream3.content, '同一个 session 第 3 轮：删除旧功能并保留新增功能', fileRel);
    output = compileAndRunCpp(workspace, fileRel, 'code/deepseek_session/app');
    assert.equal(output, 'DS_SESSION_ADD_OK:6\nDS_SESSION_DELETE_OK');
    turns.push({ turn: 3, newSession: false, output, promptPath: prompt3Path, responsePath: response3Path });

    addCase('real-deepseek:same session create -> add -> delete -> compile/run each turn', 'passed', {
      bridgeStatus: bridge.status,
      turns,
    });
  } finally {
    await shutdownBridge(bridge);
  }
}

function extractCppFromDeepSeekText(text) {
  const block = text.match(/```(?:cpp|c\+\+)?\s*\n([\s\S]*?)```/i);
  if (block) return block[1].trim();
  const toolContent = text.match(/"content"\s*:\s*"([\s\S]*)"\s*\}/);
  if (toolContent) {
    try { return JSON.parse(`"${toolContent[1].replace(/"$/, '')}"`); } catch {}
  }
  return text.trim();
}

async function main() {
  try {
    const runtime = await bundleRuntime();
    staticAgentGuardCase();
    legacyGeneratedFilesScriptCase();
    await localFileToolAliasCase(runtime);
    await localModifyExistingProgramCase(runtime);
    await localSameSessionMultiTurnCase(runtime);
    await localPatchFeatureCase(runtime);
    await localRepairCompileErrorCase(runtime);
    await localMultiFileCase(runtime);
    await realDeepSeekToolCase(runtime);
    await realDeepSeekModifyFeatureCase(runtime);
    await realDeepSeekSameSessionMultiTurnCase(runtime);
    report.ok = report.cases.every((c) => c.status === 'passed' || c.status === 'skipped');
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    report.error = String(error?.stack || error?.message || error);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    if (!args.has('--keep-temp')) rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
