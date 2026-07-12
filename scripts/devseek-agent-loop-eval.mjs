#!/usr/bin/env node
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const includeRealDeepSeek = args.has('--real-deepseek') || process.env.DEVSEEK_AGENT_LOOP_REAL_DEEPSEEK === '1';
const keepTemp = args.has('--keep-temp');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const codeRoot = path.join(repoRoot, 'code');
const safeCodeWorkspace = path.join(codeRoot, 'agent-loop-eval', runId);
const artifactDir = path.join(repoRoot, 'artifacts', 'agent-loop-eval', runId);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-agent-loop-eval-'));
const reportPath = path.join(artifactDir, 'report.json');
const testingReportRoot = path.join(repoRoot, 'docs', 'testing', 'agent-loop-eval-reports');
const testingReportDir = path.join(testingReportRoot, runId);
const testingJsonReportPath = path.join(testingReportDir, 'report.json');
const testingMarkdownReportPath = path.join(testingReportDir, 'report.md');
const testingLatestReportPath = path.join(testingReportRoot, 'latest.md');
fs.mkdirSync(artifactDir, { recursive: true });
fs.mkdirSync(testingReportDir, { recursive: true });
fs.mkdirSync(safeCodeWorkspace, { recursive: true });

const caseCatalogPath = path.join(repoRoot, 'docs/testing/agent-loop-eval-cases.json');
const caseCatalog = JSON.parse(fs.readFileSync(caseCatalogPath, 'utf8'));
const cliBin = path.join(repoRoot, 'packages/cli/dist/index.js');

const report = {
  ok: false,
  runId,
  command: ['node', 'scripts/devseek-agent-loop-eval.mjs', ...process.argv.slice(2)].join(' '),
  tempRoot,
  codeRoot,
  safeCodeWorkspace,
  artifactDir,
  reportPath,
  testingReportDir,
  testingJsonReportPath,
  testingMarkdownReportPath,
  caseCatalogPath,
  includeRealDeepSeek,
  layers: caseCatalog.layers,
  cases: [],
  findings: [],
  caseDesignReview: [],
  iterationDecision: [],
};

function addCase(record) {
  report.cases.push({
    durationMs: 0,
    ...record,
  });
}

async function runCase(id, fn, options = {}) {
  const started = Date.now();
  try {
    const details = await fn();
    addCase({
      id,
      status: details?.status ?? 'passed',
      durationMs: Date.now() - started,
      ...(details ?? {}),
    });
  } catch (error) {
    if (options.optional) {
      addCase({
        id,
        status: 'skipped',
        durationMs: Date.now() - started,
        reason: String(error?.message ?? error),
      });
      return;
    }
    addCase({
      id,
      status: 'failed',
      durationMs: Date.now() - started,
      error: String(error?.stack ?? error?.message ?? error),
    });
  }
}

async function agentCoreProtocolCase() {
  const {
    AgentApplicationService,
    createChatRequestCommand,
    CLI_SURFACE_CAPABILITIES,
    detectPlatformProfile,
  } = require(path.join(repoRoot, 'packages/shared/dist/index.js'));

  const emitted = [];
  const provider = {
    type: 'local-api',
    displayName: 'eval fake provider',
    async available() { return true; },
    async chat(options) {
      options.onDelta?.('CORE_');
      options.onDelta?.('OK');
      return 'CORE_OK';
    },
  };
  const service = new AgentApplicationService({
    getProviderType: () => 'local-api',
    getProvider: () => provider,
    bridgeChat: async () => { throw new Error('bridge must not be used in L0'); },
    getChatHistory: () => [],
    recordChatHistory: () => {},
    emitEvent: event => emitted.push(event),
    now: () => 1,
    newId: (() => {
      let index = 0;
      return () => `eval-${++index}`;
    })(),
  });
  const command = createChatRequestCommand({
    surface: 'cli',
    capabilities: CLI_SURFACE_CAPABILITIES,
    platform: detectPlatformProfile({ platform: process.platform, env: process.env }),
    prompt: 'L0 protocol replay',
    commandId: 'eval-command',
    request: { stream: true, trackHistory: false },
    now: () => 1,
  });

  await service.handle(command);
  const eventTypes = emitted.map(event => event.type);
  assert.deepEqual(eventTypes.slice(0, 2), [
    'chat.started',
    'provider.selected',
  ]);
  assert.equal(eventTypes.at(-1), 'chat.completed');

  // The persisted-secret stream boundary deliberately retains a trailing
  // window so a bearer capability split across provider chunks cannot leak.
  // Consequently, public chat.delta cardinality need not match provider chunk
  // cardinality. The protocol invariant is ordered deltas whose concatenation
  // equals the final response, followed by exactly one terminal event.
  const deltaEvents = emitted.slice(2, -1);
  assert.ok(deltaEvents.length > 0, 'streaming response must emit at least one chat.delta');
  assert.equal(deltaEvents.every(event => event.type === 'chat.delta'), true);
  assert.equal(deltaEvents.map(event => event.delta).join(''), emitted.at(-1).response);
  assert.equal(emitted.at(-1).response, 'CORE_OK');
  return { eventTypes };
}

async function cliJsonlMockCase() {
  const cwd = makeTempWorkspace('cli-jsonl-mock');
  const result = await runCli(['exec', '--jsonl', '--mock', 'L1 cli jsonl mock programming baseline'], {
    cwd,
    timeoutMs: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const events = parseJsonl(result.stdout);
  assert.deepEqual(events.map(event => event.type), [
    'chat.started',
    'provider.selected',
    'chat.completed',
  ]);
  assert.equal(events.at(-1).response, 'mock: L1 cli jsonl mock programming baseline');
  return { eventTypes: events.map(event => event.type) };
}

async function cliFakeBridgeSseCase() {
  await withFakeBridge(() => ({
    content: 'FAKE_BRIDGE_SSE_OK',
    delayMs: 40,
  }), async ({ port, seenBodies }) => {
    const cwd = makeTempWorkspace('cli-fake-bridge-sse');
    const result = await runCli(['exec', 'L2 fake bridge streaming baseline'], {
      cwd,
      timeoutMs: 10000,
      env: {
        DEVSEEK_BRIDGE_PORT: String(port),
        DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FAKE_BRIDGE_SSE_OK/);
    assert.match(result.stderr, /waiting for Bridge provider response/);
    assert.equal(seenBodies.length, 1);
    assert.equal(seenBodies[0].stream, true);
  });
  return { bridge: 'fake-sse' };
}

async function cliFakeBridgeProgrammingCase() {
  const marker = 'DEVSEEK_CLI_FAKE_BRIDGE_CODE_OK';
  const toolText = buildToolCreateCppResponse('code/cli_eval/main.cpp', marker);
  let stdout = '';
  await withFakeBridge(() => ({
    content: toolText,
    delayMs: 5,
  }), async ({ port }) => {
    const cwd = makeTempWorkspace('cli-fake-bridge-programming');
    const result = await runCli([
      'exec',
      'L3 basic programming agent: create a minimal C++ program that prints a fixed marker',
    ], {
      cwd,
      timeoutMs: 10000,
      env: {
        DEVSEEK_BRIDGE_PORT: String(port),
        DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    stdout = result.stdout;
  });
  const compiled = compileCliResponse(stdout, marker, 'fake-bridge-programming');
  return { output: compiled.output, file: compiled.fileRel, artifactFormat: compiled.format };
}

async function cliLooseToolJsonRecoveryCase() {
  const marker = 'DEVSEEK_CLI_LOOSE_JSON_RECOVERY_OK';
  const toolText = buildLooseToolCreateCppResponse('code/cli_loose_json/main.cpp', marker);
  let stdout = '';
  await withFakeBridge(() => ({
    content: toolText,
    delayMs: 5,
  }), async ({ port }) => {
    const cwd = makeTempWorkspace('cli-loose-tool-json-recovery');
    const result = await runCli([
      'exec',
      'L3b regression replay: recover a known loose tool JSON response shape and compile the file',
    ], {
      cwd,
      timeoutMs: 10000,
      env: {
        DEVSEEK_BRIDGE_PORT: String(port),
        DEVSEEK_CLI_PROGRESS_DELAY_MS: '1',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    stdout = result.stdout;
  });
  const compiled = compileCliResponse(stdout, marker, 'loose-tool-json-recovery');
  assert.equal(compiled.format, 'tool-json-recovered');
  return {
    output: compiled.output,
    file: compiled.fileRel,
    artifactFormat: compiled.format,
    expectedRecovery: true,
  };
}

async function cliRealDeepSeekProgrammingCase() {
  if (!includeRealDeepSeek) {
    return {
      status: 'skipped',
      reason: 'pass --real-deepseek or DEVSEEK_AGENT_LOOP_REAL_DEEPSEEK=1 to run live DeepSeek CLI smoke',
    };
  }

  const marker = 'DEVSEEK_CLI_REAL_DEEPSEEK_CODE_OK';
  const strictExampleContent = [
    '#include <iostream>',
    'int main() {',
    `  const char marker[] = { ${toCppAsciiArrayInitializer(marker)}, 0 };`,
    '  std::cout << marker << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n');
  const strictExample = `[TOOL:create_file ${JSON.stringify({
    filePath: 'code/cli_real_deepseek/main.cpp',
    content: strictExampleContent,
  })}]`;
  const prompt = [
    '你正在参加 DevSeek CLI 到真实 DeepSeek Web 的编程智能体冒烟测试。',
    '请只输出一个 DevSeek 工具调用，不要解释，不要放入代码块，不要输出 Markdown。',
    '工具名必须是 create_file，字段必须使用 filePath 和 content。',
    'filePath 必须是 code/cli_real_deepseek/main.cpp。',
    `content 必须是一个完整 C++17 程序，运行时只输出一行：${marker}`,
    '整个工具调用必须是合法 JSON；不要让 content 字符串里出现未转义的双引号。',
    'C++ 源码不要使用双引号字符串字面量；请像示例一样使用 const char marker[] 和十进制 ASCII 数字逐个输出。',
    '不要把下划线改成星号；下划线的 ASCII 十进制是 95。',
    `请尽量逐字照着这个合法 JSON 示例输出，只允许保持相同 marker：${strictExample}`,
  ].join('\n');
  const promptPath = path.join(artifactDir, 'real-deepseek-cli-prompt.txt');
  fs.writeFileSync(promptPath, prompt, 'utf8');

  const result = await runCli(['exec', '--jsonl', prompt], {
    cwd: safeCodeWorkspace,
    timeoutMs: 180000,
    env: {
      DEVSEEK_CLI_PROGRESS_DELAY_MS: '1000',
    },
  });
  const rawJsonlPath = path.join(artifactDir, 'real-deepseek-cli-jsonl.txt');
  fs.writeFileSync(rawJsonlPath, result.stdout, 'utf8');
  const responsePath = path.join(artifactDir, 'real-deepseek-cli-response.txt');
  if (result.status !== 0) {
    throw new Error([
      `Real DeepSeek CLI exited ${result.status}.`,
      `stderr=${summarizeEvidence(result.stderr || '<empty>')}`,
      `stdout=${summarizeEvidence(result.stdout || '<empty>')}`,
    ].join(' '));
  }
  const events = parseJsonl(result.stdout);
  const completed = events.find(event => event.type === 'chat.completed');
  assert.ok(completed && typeof completed.response === 'string', 'CLI JSONL response must include chat.completed.response');
  fs.writeFileSync(responsePath, completed.response, 'utf8');
  const compiled = compileCliResponse(completed.response, marker, 'real-deepseek-cli');
  return {
    output: compiled.output,
    file: compiled.fileRel,
    artifactFormat: compiled.format,
    eventTypes: events.map(event => event.type),
    promptPath,
    rawJsonlPath,
    responsePath,
  };
}

function runCli(cliArgs, options) {
  assert.ok(fs.existsSync(cliBin), `CLI bundle missing at ${cliBin}; run npm run cli:build first`);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [cliBin, ...cliArgs], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out after ${options.timeoutMs ?? 30000}ms. stdout=${stdout.slice(0, 1000)} stderr=${stderr.slice(0, 1000)}`));
    }, options.timeoutMs ?? 30000);

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
      resolve({
        status,
        signal,
        stdout,
        stderr,
      });
    });
  });
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
      setTimeout(() => {
        const first = response.content.slice(0, Math.max(1, Math.floor(response.content.length / 2)));
        res.write(`data: ${JSON.stringify({ delta: `\u0000RESET\u0000${first}`, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: `\u0000RESET\u0000${response.content}`, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ delta: '', done: true })}\n\n`);
        res.end();
      }, response.delayMs ?? 0);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn({ port: server.address().port, seenBodies });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function parseJsonl(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function buildToolCreateCppResponse(fileRel, marker) {
  const content = [
    '#include <iostream>',
    'int main() {',
    `  std::cout << "${marker}" << std::endl;`,
    '  return 0;',
    '}',
    '',
  ].join('\n');
  return `[TOOL:create_file ${JSON.stringify({ filePath: fileRel, content })}]`;
}

function buildLooseToolCreateCppResponse(fileRel, marker) {
  const content = [
    '#include <iostream>',
    '',
    'int main() {',
    `    std::cout << "${marker}\\n";`,
    '    return 0;',
    '}',
    '',
  ].join('\\n');
  return `[TOOL:create_file {"filePath":"${fileRel}","content":"${content}"}]`;
}

function toCppAsciiArrayInitializer(text) {
  return [...text].map(char => String(char.charCodeAt(0))).join(', ');
}

function compileCliResponse(stdout, expectedMarker, workspaceName) {
  requireCommand('g++');
  const artifact = extractSingleCppArtifact(stdout);
  const workspace = makeTempWorkspace(workspaceName);
  const abs = path.join(workspace, artifact.fileRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, artifact.content, 'utf8');
  const outRel = artifact.fileRel.replace(/\.(cc|cpp|cxx)$/i, '');
  const outAbs = path.join(workspace, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const compile = cp.spawnSync('g++', ['-std=c++17', artifact.fileRel, '-o', outRel], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const run = cp.spawnSync(outAbs, [], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = (run.stdout ?? '').trim();
  assert.equal(output, expectedMarker);
  return { output, fileRel: artifact.fileRel, format: artifact.format, workspace };
}

function extractSingleCppArtifact(text) {
  const tool = text.match(/\[TOOL:(?:create_file|replace_file)\s+({[\s\S]*})\]/);
  if (tool) {
    try {
      const parsed = JSON.parse(tool[1]);
      const fileRel = parsed.filePath || parsed.path;
      assert.equal(typeof fileRel, 'string', 'tool call must include filePath or path');
      assert.equal(typeof parsed.content, 'string', 'tool call must include content');
      return { fileRel, content: parsed.content, format: 'tool-json' };
    } catch (error) {
      const recovered = recoverLooseToolArtifact(tool[1]);
      if (recovered) {
        return recovered;
      }
      throw error;
    }
  }

  const code = text.match(/```(?:cpp|c\+\+|cc|cxx)?\s*\n([\s\S]*?)```/i);
  if (code) {
    return { fileRel: 'code/cli_eval/main.cpp', content: code[1].trim(), format: 'code-fence' };
  }
  throw new Error(`CLI response did not contain a create_file/replace_file tool call or C++ code block: ${text.slice(0, 500)}`);
}

function recoverLooseToolArtifact(rawJsonish) {
  const filePath = matchJsonishStringField(rawJsonish, 'filePath') ?? matchJsonishStringField(rawJsonish, 'path');
  const contentStart = rawJsonish.match(/"content"\s*:\s*"/);
  if (!filePath || !contentStart) {
    return null;
  }
  const start = contentStart.index + contentStart[0].length;
  const end = rawJsonish.lastIndexOf('"}');
  if (end <= start) {
    return null;
  }
  return {
    fileRel: decodeJsonishString(filePath),
    content: decodeLooseSourceContent(rawJsonish.slice(start, end)),
    format: 'tool-json-recovered',
  };
}

function matchJsonishStringField(text, fieldName) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`);
  return text.match(pattern)?.[1] ?? null;
}

function decodeLooseSourceContent(text) {
  const protectedCppNewline = '\u0000DEVSEEK_CPP_NEWLINE_ESCAPE\u0000';
  return decodeJsonishString(text.replace(/\\n(?=")/g, protectedCppNewline))
    .replaceAll(protectedCppNewline, '\\n');
}

function decodeJsonishString(text) {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function requireCommand(command) {
  const result = cp.spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, `${command} is required for programming-agent eval`);
}

function makeTempWorkspace(name) {
  const workspace = path.join(tempRoot, name);
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

function finalizeReport() {
  report.ok = report.cases.every(testCase => testCase.status === 'passed' || testCase.status === 'skipped');
  const analysis = analyzeReport();
  report.findings = analysis.findings;
  report.caseDesignReview = analysis.caseDesignReview;
  report.iterationDecision = analysis.iterationDecision;
  report.summary = analysis.summary;

  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, json, 'utf8');
  fs.writeFileSync(testingJsonReportPath, json, 'utf8');
  const markdown = renderMarkdownReport(report);
  fs.writeFileSync(testingMarkdownReportPath, markdown, 'utf8');
  fs.writeFileSync(testingLatestReportPath, markdown, 'utf8');
  console.log(json);
}

function analyzeReport() {
  const findings = [];
  const caseDesignReview = [];
  const requiredLayerIds = new Set(caseCatalog.layers
    .filter(layer => layer.requiredForSubmit)
    .map(layer => layer.id));

  for (const testCase of report.cases) {
    const layer = caseCatalog.layers.find(candidate => candidate.id === testCase.id);
    const required = requiredLayerIds.has(testCase.id);
    caseDesignReview.push(reviewCaseDesign(testCase, layer, required));

    if (testCase.status === 'failed') {
      const category = classifyFailure(testCase);
      findings.push({
        id: `F${findings.length + 1}`,
        caseId: testCase.id,
        severity: severityForFailure(category, required),
        status: 'open',
        category,
        evidence: summarizeEvidence(testCase.error ?? testCase.reason ?? ''),
        diagnosis: diagnosisForFailure(category, testCase),
        nextAction: nextActionForFailure(category, testCase),
      });
      continue;
    }

    if (testCase.status === 'passed' && testCase.artifactFormat === 'tool-json-recovered' && !testCase.expectedRecovery) {
      findings.push({
        id: `F${findings.length + 1}`,
        caseId: testCase.id,
        severity: 'medium',
        status: 'mitigated-by-evaluator',
        category: 'model-protocol-gap',
        evidence: 'The evaluator recovered a non-strict tool JSON payload and still compiled the produced program.',
        diagnosis: 'The live model path can produce useful code while violating the strict tool-call contract.',
        nextAction: 'Tighten the prompt and agent contract, then add a deterministic L3 replay for this loose JSON shape.',
      });
      continue;
    }

    if (testCase.status === 'passed' && testCase.artifactFormat === 'code-fence') {
      findings.push({
        id: `F${findings.length + 1}`,
        caseId: testCase.id,
        severity: 'medium',
        status: 'open',
        category: 'agent-tool-contract-gap',
        evidence: 'The evaluator accepted a C++ code fence instead of a structured create_file tool call.',
        diagnosis: 'The coding path is not consistently producing structured file artifacts.',
        nextAction: 'Promote this response shape into a deterministic replay, then make the model/tool contract stricter.',
      });
    }
  }

  const failedRequired = report.cases.filter(testCase => requiredLayerIds.has(testCase.id) && testCase.status === 'failed');
  const skippedRequired = report.cases.filter(testCase => requiredLayerIds.has(testCase.id) && testCase.status === 'skipped');
  const passed = report.cases.filter(testCase => testCase.status === 'passed').length;
  const failed = report.cases.filter(testCase => testCase.status === 'failed').length;
  const skipped = report.cases.filter(testCase => testCase.status === 'skipped').length;

  const iterationDecision = [];
  if (failedRequired.length > 0) {
    iterationDecision.push('Stop promotion: fix DevSeek deterministic subloop regressions before running broader evals.');
  }
  if (skippedRequired.length > 0) {
    iterationDecision.push('Stop promotion: required deterministic subloops were skipped, so the run is not a valid gate.');
  }
  if (findings.length === 0 && failedRequired.length === 0) {
    iterationDecision.push('No DevSeek defect was exposed by this run; treat it as a baseline signal and add harder failure-injection cases next.');
  }
  if (findings.some(finding => finding.category === 'model-protocol-gap')) {
    iterationDecision.push('Convert the live model protocol gap into a deterministic L3 replay, then iterate prompt/contract until strict tool JSON is stable.');
  }
  if (findings.some(finding => finding.category === 'generated-code-defect')) {
    iterationDecision.push('Convert the generated-code failure into a deterministic repair replay, then require the agent to rerun the verifier after fixing.');
  }
  if (findings.some(finding => finding.category === 'test-case-design-gap')) {
    iterationDecision.push('Redesign the affected case before using its result as product evidence.');
  }
  if (findings.length > 0 && iterationDecision.length === 0) {
    iterationDecision.push('Do not promote the affected live layer yet; classify the finding, add a deterministic replay when possible, and rerun.');
  }
  if (iterationDecision.length === 0) {
    iterationDecision.push('All required subloops passed; continue by adding the next capability step rather than widening real-provider dependence.');
  }

  return {
    findings,
    caseDesignReview,
    iterationDecision,
    summary: {
      passed,
      failed,
      skipped,
      findings: findings.length,
      requiredFailures: failedRequired.length,
      requiredSkips: skippedRequired.length,
      testingReportPath: testingMarkdownReportPath,
      latestTestingReportPath: testingLatestReportPath,
    },
  };
}

function reviewCaseDesign(testCase, layer, required) {
  const base = {
    caseId: testCase.id,
    layerKind: layer?.kind ?? 'unknown',
    requiredForSubmit: required,
    status: testCase.status,
    verdict: 'reasonable',
    limitation: '',
    nextCaseImprovement: '',
  };

  if (testCase.id === 'L0-agent-core-protocol') {
    return {
      ...base,
      limitation: 'Covers event protocol only; it does not prove tool execution, repair, or UI state.',
      nextCaseImprovement: 'Add replay fixtures for tool events, evidence, history, and QualityGate transitions.',
    };
  }
  if (testCase.id === 'L1-cli-jsonl-mock') {
    return {
      ...base,
      limitation: 'Covers machine-readable CLI output; it does not validate Bridge or generated code quality.',
      nextCaseImprovement: 'Add negative JSONL cases for stderr pollution and malformed event ordering.',
    };
  }
  if (testCase.id === 'L2-cli-fake-bridge-sse') {
    return {
      ...base,
      limitation: 'Covers SSE transport with a fake Bridge; it does not validate live Provider behavior.',
      nextCaseImprovement: 'Add timeout, reset, and partial-delta replay cases.',
    };
  }
  if (testCase.id === 'L3-cli-fake-bridge-programming') {
    return {
      ...base,
      limitation: 'Covers a single-file compile/run path; it does not test modifying existing projects or multi-file builds.',
      nextCaseImprovement: 'Add modify-existing, failing-build repair, and multi-file project fixtures.',
    };
  }
  if (testCase.id === 'L3b-cli-loose-tool-json-recovery') {
    return {
      ...base,
      verdict: 'regression-replay',
      limitation: 'Covers one known loose JSON shape; it does not prove all malformed tool outputs are recoverable.',
      nextCaseImprovement: 'Add more captured live responses as replay fixtures only after each one has a clear oracle.',
    };
  }
  if (testCase.id === 'L4-cli-real-deepseek-programming') {
    if (testCase.status === 'skipped') {
      return {
        ...base,
        verdict: 'reasonable-but-no-live-signal',
        limitation: 'Live DeepSeek was intentionally skipped, so this run cannot evaluate model protocol adherence.',
        nextCaseImprovement: 'Run verify:agent-loop-eval:real when Bridge login state is available.',
      };
    }
    if (testCase.status === 'passed' && testCase.artifactFormat === 'tool-json-recovered') {
      return {
        ...base,
        verdict: 'valuable-finding',
        limitation: 'The case found a live protocol looseness but currently relies on evaluator recovery.',
        nextCaseImprovement: 'Freeze the loose response as an L3 replay and iterate until strict tool JSON passes without recovery.',
      };
    }
    return {
      ...base,
      limitation: 'Uses JSONL final response for the compile oracle; live streaming display still needs a separate surface-oriented smoke.',
      nextCaseImprovement: 'Any live failure should be downgraded into deterministic L0-L3 replay before product fixes are accepted.',
    };
  }
  return {
    ...base,
    verdict: 'needs-review',
    limitation: 'No explicit design review rule exists for this case.',
    nextCaseImprovement: 'Add a case-design review rule before using this layer as a promotion gate.',
  };
}

function classifyFailure(testCase) {
  const text = `${testCase.error ?? ''}\n${testCase.reason ?? ''}`;
  if (/g\+\+ is required/i.test(text)) {
    return 'local-test-prerequisite';
  }
  if (testCase.id === 'L4-cli-real-deepseek-programming' && /ECONNREFUSED|Bridge|login|401|403|429|rate|network|timed out|timeout/i.test(text)) {
    return 'real-provider-environment';
  }
  if (/JSON\.parse|SyntaxError|tool call must|did not contain a create_file|tool call/i.test(text)) {
    return 'model-protocol-gap';
  }
  if (/g\+\+|compile|assert\.equal\(compile\.status|assert\.equal\(run\.status|expectedMarker/i.test(text)) {
    return 'generated-code-defect';
  }
  if (/No explicit design review|unreasonable case|fixture/i.test(text)) {
    return 'test-case-design-gap';
  }
  if (/^L[0-3]-/.test(testCase.id)) {
    return 'devseek-deterministic-regression';
  }
  return 'needs-triage';
}

function severityForFailure(category, required) {
  if (category === 'real-provider-environment' || category === 'local-test-prerequisite') {
    return 'low';
  }
  if (required) {
    return 'high';
  }
  if (category === 'test-case-design-gap') {
    return 'medium';
  }
  return 'medium';
}

function diagnosisForFailure(category, testCase) {
  const diagnoses = {
    'local-test-prerequisite': 'The eval environment is missing a required local command, so product behavior was not evaluated.',
    'real-provider-environment': 'The live Provider path is unavailable or unstable; this is not enough evidence for a DevSeek logic bug.',
    'model-protocol-gap': 'The model/provider path did not emit a strict file artifact contract.',
    'generated-code-defect': 'The coding output was captured but did not compile or run to the required marker.',
    'test-case-design-gap': 'The case itself is not yet trustworthy as a product signal.',
    'devseek-deterministic-regression': 'A required deterministic subloop failed, which points at DevSeek core/CLI behavior.',
    'needs-triage': 'The failure does not match a known bucket and needs manual classification.',
  };
  return diagnoses[category] ?? `Manual triage is required for ${testCase.id}.`;
}

function nextActionForFailure(category) {
  const actions = {
    'local-test-prerequisite': 'Install or configure the missing local prerequisite, then rerun the same case.',
    'real-provider-environment': 'Capture prompt/response logs, verify Bridge/login/network state, and rerun without changing product logic first.',
    'model-protocol-gap': 'Save the response as a deterministic replay, tighten prompt/tool contract, and rerun L3 before L4.',
    'generated-code-defect': 'Turn the compile/run failure into a repair fixture and make the agent rerun the verifier after fixing.',
    'test-case-design-gap': 'Rewrite the case objective and oracle before using it as a gate.',
    'devseek-deterministic-regression': 'Fix the failing DevSeek core/CLI behavior and rerun verify:agent-loop-eval.',
    'needs-triage': 'Classify the failure, add the bucket to the report rules, then rerun.',
  };
  return actions[category] ?? actions['needs-triage'];
}

function summarizeEvidence(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'No evidence text captured.';
}

function renderMarkdownReport(currentReport) {
  const lines = [
    '# DevSeek Agent Loop Eval Report',
    '',
    `- Run ID: ${currentReport.runId}`,
    `- Command: \`${currentReport.command}\``,
    `- Result: ${currentReport.ok ? 'PASS' : 'FAIL'}`,
    `- Artifact JSON: \`${path.relative(repoRoot, currentReport.reportPath)}\``,
    `- Testing JSON: \`${path.relative(repoRoot, currentReport.testingJsonReportPath)}\``,
    `- Latest report: \`${path.relative(repoRoot, testingLatestReportPath)}\``,
    '',
    '## Case Results',
    '',
    '| Case | Status | Duration | Signal |',
    '| --- | --- | ---: | --- |',
    ...currentReport.cases.map(testCase => {
      const signal = testCase.artifactFormat
        ? `${testCase.artifactFormat}${testCase.output ? `, output=${testCase.output}` : ''}`
        : (testCase.eventTypes ? `events=${testCase.eventTypes.join(',')}` : (testCase.reason ?? testCase.bridge ?? 'baseline'));
      return `| ${testCase.id} | ${testCase.status} | ${testCase.durationMs}ms | ${escapeMarkdownTable(signal)} |`;
    }),
    '',
    '## Findings',
    '',
  ];

  if (currentReport.findings.length === 0) {
    lines.push('No DevSeek defect was exposed by this run. This is only a baseline signal; add harder cases before claiming broader capability.');
  } else {
    lines.push('| ID | Case | Severity | Category | Status | Diagnosis | Next action |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const finding of currentReport.findings) {
      lines.push(`| ${finding.id} | ${finding.caseId} | ${finding.severity} | ${finding.category} | ${finding.status} | ${escapeMarkdownTable(finding.diagnosis)} | ${escapeMarkdownTable(finding.nextAction)} |`);
    }
  }

  lines.push(
    '',
    '## Case Design Review',
    '',
    '| Case | Verdict | Limitation | Next case improvement |',
    '| --- | --- | --- | --- |',
  );
  for (const review of currentReport.caseDesignReview) {
    lines.push(`| ${review.caseId} | ${review.verdict} | ${escapeMarkdownTable(review.limitation)} | ${escapeMarkdownTable(review.nextCaseImprovement)} |`);
  }

  lines.push(
    '',
    '## Iteration Decision',
    '',
    ...currentReport.iterationDecision.map(item => `- ${item}`),
    '',
  );

  return `${lines.join('\n')}\n`;
}

function escapeMarkdownTable(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

async function main() {
  await runCase('L0-agent-core-protocol', agentCoreProtocolCase);
  await runCase('L1-cli-jsonl-mock', cliJsonlMockCase);
  await runCase('L2-cli-fake-bridge-sse', cliFakeBridgeSseCase);
  await runCase('L3-cli-fake-bridge-programming', cliFakeBridgeProgrammingCase);
  await runCase('L3b-cli-loose-tool-json-recovery', cliLooseToolJsonRecoveryCase);
  await runCase('L4-cli-real-deepseek-programming', cliRealDeepSeekProgrammingCase, { optional: !includeRealDeepSeek });

  finalizeReport();
  process.exitCode = report.ok ? 0 : 1;
}

try {
  await main();
} finally {
  if (!keepTemp) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
