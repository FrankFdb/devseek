#!/usr/bin/env node
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const codeRoot = path.join(repoRoot, 'code');
const benchmarkWorkspaceRoot = path.join(codeRoot, 'devseek-programming-agent-benchmark', runId);
const artifactDir = path.join(repoRoot, 'artifacts', 'programming-agent-benchmark', runId);
const testingReportRoot = path.join(repoRoot, 'docs', 'testing', 'programming-agent-benchmark-reports');
const testingReportDir = path.join(testingReportRoot, runId);
const reportPath = path.join(artifactDir, 'report.json');
const testingJsonReportPath = path.join(testingReportDir, 'report.json');
const testingMarkdownReportPath = path.join(testingReportDir, 'report.md');
const testingLatestReportPath = path.join(testingReportRoot, 'latest.md');
const caseCatalogPath = path.join(repoRoot, 'docs', 'testing', 'programming-agent-benchmark-cases.json');
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

fs.mkdirSync(artifactDir, { recursive: true });
fs.mkdirSync(testingReportDir, { recursive: true });
fs.mkdirSync(benchmarkWorkspaceRoot, { recursive: true });

const caseCatalog = JSON.parse(fs.readFileSync(caseCatalogPath, 'utf8'));
const report = {
  ok: false,
  runId,
  command: ['node', 'scripts/devseek-programming-agent-benchmark.mjs', ...process.argv.slice(2)].join(' '),
  codeRoot,
  benchmarkWorkspaceRoot,
  artifactDir,
  reportPath,
  testingReportDir,
  testingJsonReportPath,
  testingMarkdownReportPath,
  caseCatalogPath,
  target: 'Claude Code/Codex baseline coding-agent behavior',
  cases: [],
  findings: [],
  iterationDecision: [],
};

function toolCall(name, input) {
  return `[TOOL:${name} ${JSON.stringify(input)}]`;
}

async function runCase(id, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    report.cases.push({
      id,
      status: 'passed',
      durationMs: Date.now() - started,
      ...(details ?? {}),
    });
  } catch (error) {
    report.cases.push({
      id,
      status: 'failed',
      durationMs: Date.now() - started,
      error: String(error?.stack ?? error?.message ?? error),
    });
  }
}

async function cliJsonlSanityCase() {
  const workspace = makeWorkspace('pa0-jsonl-sanity');
  const result = await runCli(['exec', '--jsonl', '--mock', 'PA0 sanity'], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr);
  const events = parseJsonl(result.stdout);
  assert.deepEqual(events.map(event => event.type), ['chat.started', 'provider.selected', 'chat.completed']);
  return { eventTypes: events.map(event => event.type) };
}

async function createFileApplyCompileCase() {
  const workspace = makeWorkspace('pa1-create-file');
  const fileRel = 'src/main.cpp';
  const marker = 'PA1_CREATE_FILE_OK';
  const response = toolCall('create_file', {
    filePath: fileRel,
    content: cppProgram(marker),
  });

  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', 'Create src/main.cpp and make it print PA1_CREATE_FILE_OK. Apply the file edit.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
  });

  assert.ok(fs.existsSync(path.join(workspace, fileRel)), 'DevSeek did not create src/main.cpp in the workspace');
  const output = compileAndRun(workspace, fileRel, 'src/main');
  assert.equal(output, marker);
  return { file: fileRel, output };
}

async function modifyExistingPreserveBehaviorCase() {
  const workspace = makeWorkspace('pa2-modify-existing');
  const fileRel = 'src/calc.cpp';
  writeWorkspaceFile(workspace, fileRel, [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int main() { std::cout << "ADD:" << add(2, 3) << std::endl; return 0; }',
    '',
  ].join('\n'));
  assert.equal(compileAndRun(workspace, fileRel, 'src/calc'), 'ADD:5');

  const response = toolCall('replace_file', {
    filePath: fileRel,
    content: [
      '#include <iostream>',
      'int add(int a, int b) { return a + b; }',
      'int multiply(int a, int b) { return a * b; }',
      'int main() {',
      '  std::cout << "ADD:" << add(2, 3) << std::endl;',
      '  std::cout << "MUL:" << multiply(2, 3) << std::endl;',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  });

  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', 'Modify src/calc.cpp: preserve ADD:5 and add MUL:6. Apply the edit and verify.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
  });

  const source = fs.readFileSync(path.join(workspace, fileRel), 'utf8');
  assert.match(source, /multiply/, 'DevSeek did not apply the replace_file edit to the existing source file');
  const output = compileAndRun(workspace, fileRel, 'src/calc');
  assert.equal(output, 'ADD:5\nMUL:6');
  return { file: fileRel, output };
}

async function testRepairLoopCase() {
  const workspace = makeWorkspace('pa3-repair-loop');
  const fileRel = 'src/repair.cpp';
  let turn = 0;
  const broken = toolCall('create_file', {
    filePath: fileRel,
    content: [
      '#include <iostream>',
      'int main() {',
      '  std::cout << "PA3_REPAIR_OK" << std::endl',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  });
  const fixed = toolCall('replace_file', {
    filePath: fileRel,
    content: cppProgram('PA3_REPAIR_OK'),
  });

  await withFakeBridge(() => {
    turn++;
    return { content: turn === 1 ? broken : fixed };
  }, async ({ port, seenBodies }) => {
    const result = await runCli([
      'exec',
      'Create src/repair.cpp, compile it with g++ -std=c++17, and if compilation fails, send the error back and repair until it runs.',
    ], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(seenBodies.length >= 2, `expected a repair loop with at least 2 model turns, saw ${seenBodies.length}`);
  });

  const output = compileAndRun(workspace, fileRel, 'src/repair');
  assert.equal(output, 'PA3_REPAIR_OK');
  return { turns: turn, output };
}

async function agentEvidenceEventsCase() {
  const workspace = makeWorkspace('pa4-evidence-events');
  const response = toolCall('create_file', {
    filePath: 'src/evidence.cpp',
    content: cppProgram('PA4_EVIDENCE_OK'),
  });

  let events = [];
  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', '--jsonl', 'Create src/evidence.cpp, apply the edit, compile, run, and emit audit evidence.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
    events = parseJsonl(result.stdout);
  });

  const eventTypes = events.map(event => event.type);
  assert.ok(eventTypes.includes('fileChanges.proposed'), `missing fileChanges.proposed event; saw ${eventTypes.join(', ')}`);
  assert.ok(eventTypes.includes('validation.completed'), `missing validation.completed event; saw ${eventTypes.join(', ')}`);
  assert.ok(eventTypes.includes('qualityGate.completed'), `missing qualityGate.completed event; saw ${eventTypes.join(', ')}`);
  return { eventTypes };
}

async function unifiedDiffApplyCase() {
  const workspace = makeWorkspace('pa5-unified-diff');
  const fileRel = 'src/patch_calc.cpp';
  writeWorkspaceFile(workspace, fileRel, [
    '#include <iostream>',
    'int add(int a, int b) { return a + b; }',
    'int multiply(int a, int b) { return a * b; }',
    'int main() {',
    '  std::cout << "ADD:" << add(2, 3) << std::endl;',
    '  std::cout << "MUL:" << multiply(2, 3) << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n'));
  assert.equal(compileAndRun(workspace, fileRel, 'src/patch_calc'), 'ADD:5\nMUL:6');

  const diff = [
    '```diff',
    '--- a/src/patch_calc.cpp',
    '+++ b/src/patch_calc.cpp',
    '@@ -1,9 +1,11 @@',
    ' #include <iostream>',
    ' int add(int a, int b) { return a + b; }',
    ' int multiply(int a, int b) { return a * b; }',
    '+int divide(int a, int b) { return a / b; }',
    ' int main() {',
    '   std::cout << "ADD:" << add(2, 3) << std::endl;',
    '   std::cout << "MUL:" << multiply(2, 3) << std::endl;',
    '+  std::cout << "DIV:" << divide(8, 4) << std::endl;',
    '   return 0;',
    ' }',
    '```',
  ].join('\n');

  await withFakeBridge(() => ({ content: diff }), async ({ port }) => {
    const result = await runCli(['exec', 'Apply this unified diff to src/patch_calc.cpp and verify ADD/MUL/DIV outputs.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
  });

  const source = fs.readFileSync(path.join(workspace, fileRel), 'utf8');
  assert.match(source, /divide/, 'DevSeek did not apply the unified diff to the existing source file');
  const output = compileAndRun(workspace, fileRel, 'src/patch_calc');
  assert.equal(output, 'ADD:5\nMUL:6\nDIV:2');
  return { file: fileRel, output };
}

async function projectTestCommandCase() {
  const workspace = makeWorkspace('pa6-project-test-command');
  writeWorkspaceFile(workspace, 'package.json', JSON.stringify({
    scripts: {
      test: 'node test.mjs',
    },
  }, null, 2));
  writeWorkspaceFile(workspace, 'src/math.js', [
    'export function add(a, b) {',
    '  return a + b;',
    '}',
    '',
  ].join('\n'));
  writeWorkspaceFile(workspace, 'test.mjs', [
    'import assert from "node:assert/strict";',
    'import { add, multiply } from "./src/math.js";',
    'assert.equal(add(2, 3), 5);',
    'assert.equal(multiply(2, 3), 6);',
    'console.log("PA6_PROJECT_TEST_OK");',
    '',
  ].join('\n'));

  const response = toolCall('replace_file', {
    filePath: 'src/math.js',
    content: [
      'export function add(a, b) {',
      '  return a + b;',
      '}',
      '',
      'export function multiply(a, b) {',
      '  return a * b;',
      '}',
      '',
    ].join('\n'),
  });

  let events = [];
  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', '--jsonl', 'Modify src/math.js to add multiply, then run the project test command.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
    });
    assert.equal(result.status, 0, result.stderr);
    events = parseJsonl(result.stdout);
  });

  const testResult = cp.spawnSync('npm', ['test', '--silent'], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(testResult.status, 0, testResult.stderr || testResult.stdout);
  const validation = events.find(event => event.type === 'validation.completed');
  assert.ok(validation, 'missing validation.completed event');
  assert.ok(
    Array.isArray(validation.evidenceRefs) && validation.evidenceRefs.some(ref => String(ref).includes('npm test')),
    `validation evidence did not prove npm test ran: ${JSON.stringify(validation)}`,
  );
  return { output: (testResult.stdout ?? '').trim(), eventTypes: events.map(event => event.type) };
}

async function stagedIncrementalRequirementCase() {
  const workspace = makeWorkspace('pa7-staged-incremental-requirement');
  const fileRel = 'src/score.cpp';
  let turn = 0;
  let sawExistingFileContext = false;

  const initial = toolCall('create_file', {
    filePath: fileRel,
    content: [
      '#include <iostream>',
      'int score(int base) { return base; }',
      'int main() {',
      '  std::cout << "SCORE:" << score(10) << std::endl;',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  });
  const updated = toolCall('replace_file', {
    filePath: fileRel,
    content: [
      '#include <iostream>',
      'int score(int base) { return base; }',
      'int bonus(int base) { return base + 5; }',
      'int main() {',
      '  std::cout << "SCORE:" << score(10) << std::endl;',
      '  std::cout << "BONUS:" << bonus(10) << std::endl;',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  });

  await withFakeBridge((body) => {
    turn++;
    if (turn === 2) {
      sawExistingFileContext = Array.isArray(body.files) && body.files.includes(path.join(workspace, fileRel));
    }
    return { content: turn === 1 ? initial : updated };
  }, async ({ port }) => {
    const first = await runCli(['exec', 'Create src/score.cpp that prints SCORE:10 and verify it.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(compileAndRun(workspace, fileRel, 'src/score'), 'SCORE:10');

    const second = await runCli(['exec', 'New requirement: update src/score.cpp to preserve SCORE:10 and also print BONUS:15.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(second.status, 0, second.stderr);
  });

  assert.equal(sawExistingFileContext, true, 'DevSeek did not pass the existing source file as model context for the incremental requirement');
  const output = compileAndRun(workspace, fileRel, 'src/score');
  assert.equal(output, 'SCORE:10\nBONUS:15');
  return { turns: turn, file: fileRel, output };
}

async function interactiveVerifierCase() {
  const workspace = makeWorkspace('pa8-interactive-verifier');
  const fileRel = 'src/interactive.cpp';
  const response = [
    toolCall('create_file', {
      filePath: fileRel,
      content: [
        '#include <iostream>',
        '#include <string>',
        'int main() {',
        '  std::string name;',
        '  int a = 0;',
        '  int b = 0;',
        '  if (!(std::cin >> name >> a >> b)) { return 2; }',
        '  std::cout << "Hello " << name << std::endl;',
        '  std::cout << "SUM:" << (a + b) << std::endl;',
        '  return 0;',
        '}',
        '',
      ].join('\n'),
    }),
    toolCall('create_file', {
      filePath: 'devseek.verify.json',
      content: JSON.stringify({
        commands: [
          {
            cmd: 'g++',
            args: ['-std=c++17', fileRel, '-o', '.devseek/bin/interactive'],
          },
          {
            cmd: './.devseek/bin/interactive',
            stdin: 'Alice\n3\n4\n',
            expectStdoutIncludes: ['Hello Alice', 'SUM:7'],
          },
        ],
      }, null, 2),
    }),
  ].join('\n');

  let events = [];
  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', '--jsonl', 'Create an interactive C++ CLI, compile it, run it with stdin Alice/3/4, and verify output.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    events = parseJsonl(result.stdout);
  });

  const validation = events.find(event => event.type === 'validation.completed');
  assert.ok(validation, 'missing validation.completed event');
  assert.ok(
    Array.isArray(validation.evidenceRefs) && validation.evidenceRefs.some(ref => String(ref).includes('stdin') && String(ref).includes('SUM:7')),
    `validation evidence did not prove interactive stdin execution: ${JSON.stringify(validation)}`,
  );
  const output = compileAndRun(workspace, fileRel, 'src/interactive-check', { input: 'Alice\n3\n4\n' });
  assert.equal(output, 'Hello Alice\nSUM:7');
  return { output, eventTypes: events.map(event => event.type) };
}

async function multifileDevseekVerifierCase() {
  const workspace = makeWorkspace('pa9-multifile-devseek-verifier');
  const response = [
    toolCall('create_file', {
      filePath: 'include/math.hpp',
      content: [
        '#pragma once',
        'int answer();',
        '',
      ].join('\n'),
    }),
    toolCall('create_file', {
      filePath: 'src/math.cpp',
      content: [
        '#include "math.hpp"',
        'int answer() { return 42; }',
        '',
      ].join('\n'),
    }),
    toolCall('create_file', {
      filePath: 'src/main.cpp',
      content: [
        '#include <iostream>',
        '#include "math.hpp"',
        'int main() {',
        '  std::cout << "MULTI:" << answer() << std::endl;',
        '  return 0;',
        '}',
        '',
      ].join('\n'),
    }),
    toolCall('create_file', {
      filePath: 'devseek.verify.json',
      content: JSON.stringify({
        commands: [
          {
            cmd: 'g++',
            args: ['-std=c++17', '-Iinclude', 'src/main.cpp', 'src/math.cpp', '-o', '.devseek/bin/multifile'],
          },
          {
            cmd: './.devseek/bin/multifile',
            expectStdoutIncludes: 'MULTI:42',
          },
        ],
      }, null, 2),
    }),
  ].join('\n');

  let events = [];
  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', '--jsonl', 'Create a multi-file C++ project, compile linked sources, run it, and verify MULTI:42.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    events = parseJsonl(result.stdout);
  });

  const validation = events.find(event => event.type === 'validation.completed');
  assert.ok(validation, 'missing validation.completed event');
  assert.ok(
    Array.isArray(validation.evidenceRefs) && validation.evidenceRefs.some(ref => String(ref).includes('src/main.cpp') && String(ref).includes('src/math.cpp')),
    `validation evidence did not prove multi-file compile: ${JSON.stringify(validation)}`,
  );
  assert.ok(
    Array.isArray(validation.evidenceRefs) && validation.evidenceRefs.some(ref => String(ref).includes('MULTI:42')),
    `validation evidence did not prove binary execution: ${JSON.stringify(validation)}`,
  );
  return { output: 'MULTI:42', eventTypes: events.map(event => event.type) };
}

async function pythonVerifierCommandCase() {
  const workspace = makeWorkspace('pa10-python-verifier-command');
  const response = [
    toolCall('create_file', {
      filePath: 'src/word_stats.py',
      content: [
        'def count_words(text):',
        '    return len([part for part in text.split() if part])',
        '',
      ].join('\n'),
    }),
    toolCall('create_file', {
      filePath: 'devseek.verify.json',
      content: JSON.stringify({
        commands: [
          {
            cmd: 'python3',
            args: ['-c', 'from src.word_stats import count_words; print("PYWORDS:" + str(count_words("one two two")))'],
            expectStdoutIncludes: 'PYWORDS:3',
          },
        ],
      }, null, 2),
    }),
  ].join('\n');

  let events = [];
  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', '--jsonl', 'Create a Python word counter and verify it with python3.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    events = parseJsonl(result.stdout);
  });

  const validation = events.find(event => event.type === 'validation.completed');
  assert.ok(validation, 'missing validation.completed event');
  assert.ok(
    Array.isArray(validation.evidenceRefs) && validation.evidenceRefs.some(ref => String(ref).includes('python3') && String(ref).includes('PYWORDS:3')),
    `validation evidence did not prove Python verification: ${JSON.stringify(validation)}`,
  );
  return { output: 'PYWORDS:3', eventTypes: events.map(event => event.type) };
}

async function implicitProjectContextCase() {
  const workspace = makeWorkspace('pa11-implicit-project-context');
  writeWorkspaceFile(workspace, 'package.json', JSON.stringify({
    scripts: {
      test: 'node test.mjs',
    },
    type: 'module',
  }, null, 2));
  writeWorkspaceFile(workspace, 'src/app.js', [
    'export function greet(name) {',
    '  return `Hello ${name}`;',
    '}',
    '',
  ].join('\n'));
  writeWorkspaceFile(workspace, 'test.mjs', [
    'import assert from "node:assert/strict";',
    'import { greet, shout } from "./src/app.js";',
    'assert.equal(greet("Ada"), "Hello Ada");',
    'assert.equal(shout("Ada"), "HELLO ADA!");',
    'console.log("PA11_CONTEXT_OK");',
    '',
  ].join('\n'));

  let sawImplicitContext = false;
  const response = toolCall('replace_file', {
    filePath: 'src/app.js',
    content: [
      'export function greet(name) {',
      '  return `Hello ${name}`;',
      '}',
      '',
      'export function shout(name) {',
      '  return `${greet(name).toUpperCase()}!`;',
      '}',
      '',
    ].join('\n'),
  });

  await withFakeBridge((body) => {
    sawImplicitContext = Array.isArray(body.files)
      && body.files.includes(path.join(workspace, 'package.json'))
      && body.files.includes(path.join(workspace, 'src/app.js'))
      && body.files.includes(path.join(workspace, 'test.mjs'));
    return { content: response };
  }, async ({ port }) => {
    const result = await runCli(['exec', 'Add shout mode to this small project, preserve existing behavior, and run validation.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
  });

  assert.equal(sawImplicitContext, true, 'DevSeek did not attach implicit project files when the user omitted exact paths');
  const testResult = cp.spawnSync('npm', ['test', '--silent'], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(testResult.status, 0, testResult.stderr || testResult.stdout);
  return { output: (testResult.stdout ?? '').trim(), context: 'package.json,src/app.js,test.mjs' };
}

async function pathSafetyGuardCase() {
  const workspace = makeWorkspace('pa12-path-safety-guard');
  const outside = path.join(path.dirname(workspace), 'escaped.cpp');
  fs.rmSync(outside, { force: true });
  const response = toolCall('create_file', {
    filePath: '../escaped.cpp',
    content: cppProgram('PA12_SHOULD_NOT_WRITE'),
  });

  await withFakeBridge(() => ({ content: response }), async ({ port }) => {
    const result = await runCli(['exec', 'Create ../escaped.cpp for this task.'], {
      cwd: workspace,
      env: { DEVSEEK_BRIDGE_PORT: String(port) },
      timeoutMs: 10000,
    });
    assert.equal(result.status, 1, `unsafe write unexpectedly succeeded: stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /Refusing to write outside workspace/);
  });

  assert.equal(fs.existsSync(outside), false, 'DevSeek wrote outside the benchmark workspace');
  return { output: 'unsafe write refused' };
}

async function withFakeBridge(responder, fn) {
  const seenBodies = [];
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seenBodies.push(body);
      const response = responder(body);
      if (body.stream === false) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ content: response.content }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ delta: `\u0000RESET\u0000${response.content}`, done: false })}\n\n`);
      res.write(`data: ${JSON.stringify({ delta: '', done: true })}\n\n`);
      res.end();
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn({ port: server.address().port, seenBodies });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function runCli(cliArgs, options) {
  assert.ok(fs.existsSync(cliBin), `CLI bundle missing at ${cliBin}; run npm run cli:build first`);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [cliBin, ...cliArgs], {
      cwd: options.cwd,
      env: {
        ...process.env,
        DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
        ...(options.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out after ${options.timeoutMs ?? 10000}ms. stdout=${stdout.slice(0, 1000)} stderr=${stderr.slice(0, 1000)}`));
    }, options.timeoutMs ?? 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function parseJsonl(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function cppProgram(marker) {
  return [
    '#include <iostream>',
    'int main() {',
    `  std::cout << "${marker}" << std::endl;`,
    '  return 0;',
    '}',
    '',
  ].join('\n');
}

function compileAndRun(workspace, sourceRel, outRel, options = {}) {
  const compile = cp.spawnSync('g++', ['-std=c++17', sourceRel, '-o', outRel], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const run = cp.spawnSync(path.join(workspace, outRel), [], {
    cwd: workspace,
    encoding: 'utf8',
    input: options.input,
    timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return (run.stdout ?? '').trim();
}

function makeWorkspace(name) {
  const workspace = path.join(benchmarkWorkspaceRoot, name);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function writeWorkspaceFile(workspace, fileRel, content) {
  const target = path.join(workspace, fileRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function analyzeReport() {
  const findings = [];
  for (const testCase of report.cases) {
    if (testCase.status !== 'failed') continue;
    const category = classifyFailure(testCase);
    findings.push({
      id: `F${findings.length + 1}`,
      caseId: testCase.id,
      severity: category === 'test-case-design-gap' ? 'medium' : 'high',
      category,
      diagnosis: diagnosisFor(category),
      evidence: summarizeEvidence(testCase.error),
      nextAction: nextActionFor(category),
    });
  }

  const iterationDecision = [];
  if (findings.length === 0) {
    iterationDecision.push('Benchmark did not expose a coding-agent gap. Add harder project-edit, verifier, and repair cases before claiming parity.');
  }
  if (findings.some(finding => finding.category === 'missing-tool-execution')) {
    iterationDecision.push('Implement a real workspace tool executor for create_file/replace_file before treating DevSeek as a coding agent.');
  }
  if (findings.some(finding => finding.category === 'missing-repair-loop')) {
    iterationDecision.push('Add verifier execution and model feedback loops so DevSeek can repair failed builds/tests.');
  }
  if (findings.some(finding => finding.category === 'missing-evidence-events')) {
    iterationDecision.push('Emit fileChanges, validation, and qualityGate events for every applied coding run.');
  }
  if (findings.some(finding => finding.category === 'missing-patch-application')) {
    iterationDecision.push('Add unified diff patch application for existing files so DevSeek can handle reviewable incremental edits.');
  }
  if (findings.some(finding => finding.category === 'missing-project-verifier')) {
    iterationDecision.push('Discover and run project-specific test commands, then include the command evidence in validation events.');
  }
  if (findings.some(finding => finding.category === 'missing-workspace-context')) {
    iterationDecision.push('Attach relevant existing workspace files to follow-up requests so incremental requirements have real code context.');
  }
  if (findings.some(finding => finding.category === 'missing-interactive-verifier')) {
    iterationDecision.push('Add a safe verifier config for compile/run commands with stdin expectations, then rerun interactive cases.');
  }
  if (findings.some(finding => finding.category === 'missing-multifile-verifier')) {
    iterationDecision.push('Support explicit multi-file verifier commands so realistic linked projects can be validated.');
  }
  if (findings.some(finding => finding.category === 'missing-python-verifier')) {
    iterationDecision.push('Allow safe Python verifier commands from devseek.verify.json, then rerun PA10.');
  }
  if (findings.some(finding => finding.category === 'missing-implicit-project-context')) {
    iterationDecision.push('Discover and attach small relevant project files when coding prompts omit exact file names, then rerun PA11.');
  }
  if (findings.some(finding => finding.category === 'workspace-boundary-regression')) {
    iterationDecision.push('Stop autonomous file edits until workspace boundary checks are restored and PA12 passes.');
  }
  if (findings.some(finding => finding.category === 'test-case-design-gap')) {
    iterationDecision.push('Fix the benchmark oracle before using that case as product evidence.');
  }

  report.findings = findings;
  report.iterationDecision = iterationDecision;
  report.ok = report.cases.every(testCase => testCase.status === 'passed');
}

function classifyFailure(testCase) {
  const text = testCase.error ?? '';
  if (testCase.id === 'PA1-create-file-apply-compile' || testCase.id === 'PA2-modify-existing-preserve-behavior') {
    return 'missing-tool-execution';
  }
  if (testCase.id === 'PA3-test-repair-loop') {
    return /expected a repair loop/i.test(text) ? 'missing-repair-loop' : 'missing-tool-execution';
  }
  if (testCase.id === 'PA4-agent-evidence-events') {
    return 'missing-evidence-events';
  }
  if (testCase.id === 'PA5-unified-diff-apply') {
    return 'missing-patch-application';
  }
  if (testCase.id === 'PA6-project-test-command') {
    return 'missing-project-verifier';
  }
  if (testCase.id === 'PA7-staged-incremental-requirement') {
    return /existing source file as model context/i.test(text) ? 'missing-workspace-context' : 'missing-tool-execution';
  }
  if (testCase.id === 'PA8-interactive-stdin-verifier') {
    return 'missing-interactive-verifier';
  }
  if (testCase.id === 'PA9-multifile-devseek-verifier') {
    return 'missing-multifile-verifier';
  }
  if (testCase.id === 'PA10-python-verifier-command') {
    return 'missing-python-verifier';
  }
  if (testCase.id === 'PA11-implicit-project-context') {
    return /implicit project files|omitted exact paths/i.test(text) ? 'missing-implicit-project-context' : 'missing-project-verifier';
  }
  if (testCase.id === 'PA12-path-safety-guard') {
    return 'workspace-boundary-regression';
  }
  if (/g\+\+|No such file|ENOENT/i.test(text)) {
    return 'missing-tool-execution';
  }
  return 'test-case-design-gap';
}

function diagnosisFor(category) {
  const diagnoses = {
    'missing-tool-execution': 'DevSeek returned or received a structured coding artifact but did not apply it to the workspace and verify the result.',
    'missing-repair-loop': 'DevSeek did not run the verifier, feed failure evidence back to the model, and apply a repaired edit.',
    'missing-evidence-events': 'DevSeek did not expose auditable file-change, validation, and quality-gate events for automation/review.',
    'missing-patch-application': 'DevSeek did not apply a unified diff patch to the existing workspace file.',
    'missing-project-verifier': 'DevSeek did not discover/run the project test command or include that evidence in validation events.',
    'missing-workspace-context': 'DevSeek did not pass relevant existing workspace files to the model when the user added an incremental requirement.',
    'missing-interactive-verifier': 'DevSeek did not run a generated program with stdin and assert the interactive output as part of validation.',
    'missing-multifile-verifier': 'DevSeek did not validate a realistic multi-file project with an explicit verifier command.',
    'missing-python-verifier': 'DevSeek did not allow or execute Python-based verifier commands from devseek.verify.json.',
    'missing-implicit-project-context': 'DevSeek did not attach relevant project files when the user made a coding request without naming exact paths.',
    'workspace-boundary-regression': 'DevSeek allowed or failed to clearly reject a model-requested write outside the workspace boundary.',
    'test-case-design-gap': 'The case failed in a way that does not yet isolate a DevSeek product capability.',
  };
  return diagnoses[category] ?? diagnoses['test-case-design-gap'];
}

function nextActionFor(category) {
  const actions = {
    'missing-tool-execution': 'Add an agent tool execution layer with safe file write semantics, then rerun PA1 and PA2.',
    'missing-repair-loop': 'Add verifier command execution and a bounded repair loop, then rerun PA3.',
    'missing-evidence-events': 'Emit structured AgentEvent evidence after tool execution and verification, then rerun PA4.',
    'missing-patch-application': 'Add safe unified diff parsing/application for workspace files, then rerun PA5.',
    'missing-project-verifier': 'Run npm test when a package.json test script exists and project files changed, then rerun PA6.',
    'missing-workspace-context': 'Attach relevant existing workspace files to follow-up CLI requests, then rerun PA7.',
    'missing-interactive-verifier': 'Add a safe verifier config that can compile and run programs with stdin expectations, then rerun PA8.',
    'missing-multifile-verifier': 'Honor explicit multi-file verifier commands and include compile/run evidence, then rerun PA9.',
    'missing-python-verifier': 'Allow python3/python verifier commands in the safe verifier allowlist, then rerun PA10.',
    'missing-implicit-project-context': 'Add bounded project context discovery for coding prompts that omit file paths, then rerun PA11.',
    'workspace-boundary-regression': 'Restore safe workspace path checks for all file tools and diff application, then rerun PA12.',
    'test-case-design-gap': 'Rewrite the oracle so it distinguishes benchmark defects from product defects.',
  };
  return actions[category] ?? actions['test-case-design-gap'];
}

function summarizeEvidence(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'No evidence text captured.';
}

function writeReports() {
  analyzeReport();
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, json, 'utf8');
  fs.writeFileSync(testingJsonReportPath, json, 'utf8');
  const markdown = renderMarkdownReport();
  fs.writeFileSync(testingMarkdownReportPath, markdown, 'utf8');
  fs.writeFileSync(testingLatestReportPath, markdown, 'utf8');
  console.log(json);
  process.exitCode = report.ok ? 0 : 1;
}

function renderMarkdownReport() {
  const lines = [
    '# DevSeek Programming-Agent Benchmark Report',
    '',
    `- Run ID: ${report.runId}`,
    `- Target: ${report.target}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Artifact JSON: \`${path.relative(repoRoot, reportPath)}\``,
    `- Testing JSON: \`${path.relative(repoRoot, testingJsonReportPath)}\``,
    `- Latest report: \`${path.relative(repoRoot, testingLatestReportPath)}\``,
    '',
    '## Case Results',
    '',
    '| Case | Status | Duration | Signal |',
    '| --- | --- | ---: | --- |',
    ...report.cases.map(testCase => `| ${testCase.id} | ${testCase.status} | ${testCase.durationMs}ms | ${escapeTable(caseSignal(testCase))} |`),
    '',
    '## Findings',
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No gap was exposed. Treat this as a benchmark-design warning unless the cases exercised real file edits, verification, and repair loops.');
  } else {
    lines.push('| ID | Case | Severity | Category | Diagnosis | Next action |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const finding of report.findings) {
      lines.push(`| ${finding.id} | ${finding.caseId} | ${finding.severity} | ${finding.category} | ${escapeTable(finding.diagnosis)} | ${escapeTable(finding.nextAction)} |`);
    }
  }

  lines.push(
    '',
    '## Iteration Decision',
    '',
    ...report.iterationDecision.map(item => `- ${item}`),
    '',
    '## Case Catalog',
    '',
    ...caseCatalog.cases.map(testCase => `- ${testCase.id}: ${testCase.description}`),
    '',
  );
  return `${lines.join('\n')}\n`;
}

function caseSignal(testCase) {
  if (testCase.output) return `output=${testCase.output}`;
  if (testCase.eventTypes) return `events=${testCase.eventTypes.join(',')}`;
  if (testCase.error) return summarizeEvidence(testCase.error);
  return 'baseline';
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

async function main() {
  await runCase('PA0-cli-jsonl-sanity', cliJsonlSanityCase);
  await runCase('PA1-create-file-apply-compile', createFileApplyCompileCase);
  await runCase('PA2-modify-existing-preserve-behavior', modifyExistingPreserveBehaviorCase);
  await runCase('PA3-test-repair-loop', testRepairLoopCase);
  await runCase('PA4-agent-evidence-events', agentEvidenceEventsCase);
  await runCase('PA5-unified-diff-apply', unifiedDiffApplyCase);
  await runCase('PA6-project-test-command', projectTestCommandCase);
  await runCase('PA7-staged-incremental-requirement', stagedIncrementalRequirementCase);
  await runCase('PA8-interactive-stdin-verifier', interactiveVerifierCase);
  await runCase('PA9-multifile-devseek-verifier', multifileDevseekVerifierCase);
  await runCase('PA10-python-verifier-command', pythonVerifierCommandCase);
  await runCase('PA11-implicit-project-context', implicitProjectContextCase);
  await runCase('PA12-path-safety-guard', pathSafetyGuardCase);
  writeReports();
}

try {
  await main();
} finally {
  // Keep code/devseek-programming-agent-benchmark/<run-id>/ as test evidence.
}
