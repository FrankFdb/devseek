#!/usr/bin/env node
/**
 * Exact-VSIX controlled Surface conformance harness.
 *
 * This deliberately stops at T3: it installs the exact VSIX into isolated
 * VS Code directories and exercises the real extension/Webview inbound route,
 * but a driver invokes the test-only command and confirms intent
 * programmatically. It is not a natural type/click/approval journey (T4), a
 * live DeepSeek-Web journey (T5), or qualification evidence.
 */

import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const extensionRoot = path.join(repoRoot, 'packages/vscode-extension');
const bridgeEvidencePath = path.join(repoRoot, 'packages/bridge/dist/run-evidence.js');
const sharedPath = path.join(repoRoot, 'packages/shared/dist/index.js');
const codeBin = argValue('--code') || process.env.VSCODE_BIN || 'code';
const timeoutMs = positiveInteger(argValue('--timeout-ms') || process.env.DEVSEEK_CONTROLLED_VSIX_TIMEOUT_MS, 180_000);
const keepTmp = hasFlag('--keep') || process.env.DEVSEEK_CONTROLLED_VSIX_KEEP === '1';
const keepWindow = hasFlag('--keep-window') || process.env.DEVSEEK_CONTROLLED_VSIX_KEEP_WINDOW === '1';
const targetRelativePath = 'controlled-sim.txt';
const targetContent = 'CONTROLLED_SIM_OK\n';
const prompt = [
  `请在当前工作区创建 ${targetRelativePath}。`,
  '文件内容必须精确包含一行 CONTROLLED_SIM_OK。',
  '完成写入和读回验证后结束任务，不要修改其他用户文件。',
].join('');
const incrementalPromptPrefix = [
  '【同一 DeepSeek 会话增量上下文】',
  '沿用本会话上一轮已经建立的 DevSeek 编程智能体规则、工具协议、项目约束和当前任务目标。',
  '下面只包含新增的用户纠偏、工具结果或系统反馈；不要要求重新发送固定规则，不要重复已完成步骤。',
  '',
].join('\n') + '\n';

let tmpRoot = '';
let fakeBridge;
let finalReport;
let promptContractSelfTest;

if (hasFlag('--prompt-contract-self-test')) {
  const selfTestReport = runPromptContractSelfTest(prompt);
  const output = JSON.stringify(selfTestReport, null, 2);
  if (selfTestReport.ok) console.log(output);
  else console.error(output);
  process.exit(selfTestReport.ok ? 0 : 1);
}

try {
  promptContractSelfTest = runPromptContractSelfTest(prompt);
  if (!promptContractSelfTest.ok) {
    throw new Error(`Controlled prompt-contract self-test failed: ${promptContractSelfTest.errors.join('; ')}`);
  }
  requireFile(bridgeEvidencePath, 'Bridge run-evidence build');
  requireFile(sharedPath, 'Shared run-evidence build');
  const vsixPath = resolveVsixPath();
  requireFile(vsixPath, 'DevSeek VSIX');

  const sourceHead = gitHead();
  const vsixSha256 = sha256File(vsixPath);
  const packaged = readVsixPackage(vsixPath);
  const expectedIdentity = normalizeExtensionIdentity(packaged, 'VSIX package.json');
  if (!sourceHead.startsWith(expectedIdentity.devseekBuild.gitCommit)) {
    throw new Error(
      `VSIX gitCommit ${expectedIdentity.devseekBuild.gitCommit} does not match current HEAD ${sourceHead}`,
    );
  }

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-controlled-vsix-'));
  const workspaceDir = path.join(tmpRoot, 'workspace');
  const driverDir = path.join(tmpRoot, 'driver-extension');
  const userDataDir = path.join(tmpRoot, 'user-data');
  const extensionsDir = path.join(tmpRoot, 'extensions');
  const driverReportPath = path.join(tmpRoot, 'driver-report.json');
  const progressPath = path.join(tmpRoot, 'driver-progress.jsonl');
  const vscodeLogPath = path.join(tmpRoot, 'vscode.log');
  const bridgeToken = crypto.randomBytes(32).toString('hex');
  for (const directory of [workspaceDir, driverDir, userDataDir, extensionsDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  installVsix({ vsixPath, userDataDir, extensionsDir });
  const installed = findInstalledExtension(extensionsDir, expectedIdentity.id);
  const installedIdentity = normalizeExtensionIdentity(installed.packageJson, 'installed package.json');
  assertSameIdentity(expectedIdentity, installedIdentity, 'installed extension');

  fakeBridge = await startControlledBridge({
    token: bridgeToken,
    workspaceDir,
    runtimeIdentity: expectedIdentity,
    expectedPrompt: prompt,
    promptContractSelfTest,
  });
  writeWorkspaceFixture({ workspaceDir, bridgeToken, port: fakeBridge.port });
  writeDriverExtension({
    driverDir,
    driverReportPath,
    progressPath,
    workspaceDir,
    extensionsDir,
    expectedExtensionPath: installed.extensionPath,
    expectedIdentity,
    prompt,
    targetRelativePath,
    targetContent,
    timeoutMs,
    port: fakeBridge.port,
  });

  const driverReport = await runVsCodeDriver({
    driverDir,
    driverReportPath,
    progressPath,
    workspaceDir,
    userDataDir,
    extensionsDir,
    vscodeLogPath,
  });
  const bridgeReport = summarizeControlledBridge(fakeBridge.state);
  const runIds = [...new Set(fakeBridge.state.chatRequests.map(request => request.runId).filter(Boolean))];
  const evidence = runIds.length === 1
    ? inspectRunEvidence(workspaceDir, runIds[0])
    : {
        ok: false,
        runId: runIds[0] || '',
        errors: [`Expected exactly one evidence runId, received ${runIds.length}`],
        eventTypes: [],
      };

  const errors = [];
  if (!driverReport.ok) errors.push(...(driverReport.errors || ['VS Code driver failed']));
  if (!bridgeReport.ok) errors.push(...bridgeReport.errors);
  if (!evidence.ok) errors.push(...evidence.errors);

  finalReport = {
    ok: errors.length === 0,
    mode: 'exact-vsix-controlled-surface',
    classification: {
      stage: 'T3',
      name: 'Surface conformance',
      provider: 'controlled-deterministic-fake-bridge',
      surface: 'real-installed-vsix-in-vscode-extension-host',
      inputRoute: 'webview-message-via-test-only-command',
      approvalRoute: 'programmatic-intentConfirmed',
      naturalUi: false,
      liveProvider: false,
      integrityScope: 'product-run-diagnostics',
      qualificationEligible: false,
      limitations: [
        'The driver invokes _devseek.harnessSubmitChatMessage instead of typing and clicking in the Webview.',
        'Intent approval is controlled by intentConfirmed=true; no approval UI is clicked.',
        'The provider is deterministic and local, not the live DeepSeek Web surface.',
        'This T3 result cannot be promoted to T4/T5 or a qualification claim.',
      ],
    },
    artifact: {
      vsixPath,
      sha256: vsixSha256,
      sourceHead,
      packaged: expectedIdentity,
      installed: installedIdentity,
      installedExtensionPath: installed.extensionPath,
    },
    driver: driverReport,
    bridge: bridgeReport,
    evidence,
    errors,
    harness: {
      tmpRoot,
      workspaceDir,
      vscodeLogPath,
      progressPath,
      codeBin,
      promptContractSelfTest,
      cleanup: !keepTmp && errors.length === 0 ? 'removed-after-success' : 'retained-for-inspection',
    },
  };
} catch (error) {
  finalReport = {
    ok: false,
    mode: 'exact-vsix-controlled-surface',
    classification: {
      stage: 'T3',
      naturalUi: false,
      liveProvider: false,
      integrityScope: 'product-run-diagnostics',
      qualificationEligible: false,
    },
    errors: [errorMessage(error)],
    harness: {
      tmpRoot,
      codeBin,
      promptContractSelfTest,
      cleanup: 'retained-for-inspection',
    },
  };
} finally {
  if (fakeBridge) await closeServer(fakeBridge.server);
}

const serialized = JSON.stringify(finalReport, null, 2);
if (finalReport.ok) console.log(serialized);
else console.error(serialized);

if (tmpRoot && finalReport.ok && !keepTmp) {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(finalReport.ok ? 0 : 1);

function hasFlag(flag) {
  return args.includes(flag);
}

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
}

function positiveInteger(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function requireFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} was not found: ${filePath || '(empty path)'}`);
  }
}

function resolveVsixPath() {
  const explicit = argValue('--vsix') || process.env.DEVSEEK_CONTROLLED_VSIX;
  if (explicit) return path.resolve(repoRoot, explicit);
  return [
    path.join(repoRoot, 'devseek-netai-latest.vsix'),
    path.join(extensionRoot, 'devseek-netai-latest.vsix'),
  ].find(candidate => fs.existsSync(candidate)) || '';
}

function gitHead() {
  const result = cp.spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error(`Unable to read git HEAD: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readVsixPackage(vsixPath) {
  const result = cp.spawnSync('unzip', ['-p', vsixPath, 'extension/package.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Unable to read VSIX package.json: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function normalizeExtensionIdentity(packageJson, label) {
  const publisher = String(packageJson?.publisher || '').trim();
  const name = String(packageJson?.name || '').trim();
  const version = String(packageJson?.version || '').trim();
  const build = packageJson?.devseekBuild || {};
  const devseekBuild = {
    channel: String(build.channel || '').trim(),
    buildId: String(build.buildId || '').trim(),
    gitCommit: String(build.gitCommit || '').trim(),
  };
  if (!publisher || !name || !version || !devseekBuild.channel || !devseekBuild.buildId || !devseekBuild.gitCommit) {
    throw new Error(`${label} does not contain a complete DevSeek release identity`);
  }
  if (!/^[a-f0-9]{7,40}$/i.test(devseekBuild.gitCommit)) {
    throw new Error(`${label} has an invalid devseekBuild.gitCommit`);
  }
  return { id: `${publisher}.${name}`, publisher, name, version, devseekBuild };
}

function assertSameIdentity(expected, actual, label) {
  const fields = [
    ['id', expected.id, actual.id],
    ['version', expected.version, actual.version],
    ['channel', expected.devseekBuild.channel, actual.devseekBuild.channel],
    ['buildId', expected.devseekBuild.buildId, actual.devseekBuild.buildId],
    ['gitCommit', expected.devseekBuild.gitCommit, actual.devseekBuild.gitCommit],
  ];
  const mismatches = fields.filter(([, left, right]) => left !== right);
  if (mismatches.length > 0) {
    throw new Error(`${label} identity mismatch: ${mismatches.map(([field, left, right]) => `${field}=${left}/${right}`).join(', ')}`);
  }
}

function installVsix({ vsixPath, userDataDir, extensionsDir }) {
  const result = cp.spawnSync(codeBin, [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', vsixPath,
    '--force',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Temporary VSIX install failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

function findInstalledExtension(extensionsDir, expectedId) {
  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extensionPath = path.join(extensionsDir, entry.name);
    const packagePath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(packagePath)) continue;
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (`${packageJson.publisher}.${packageJson.name}` === expectedId) return { extensionPath, packageJson };
  }
  throw new Error(`Installed extension ${expectedId} was not found below ${extensionsDir}`);
}

function writeWorkspaceFixture({ workspaceDir, bridgeToken, port }) {
  const settingsDir = path.join(workspaceDir, '.vscode');
  const devseekDir = path.join(workspaceDir, '.devseek');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(devseekDir, { recursive: true });
  fs.writeFileSync(path.join(devseekDir, 'bridge-token'), `${bridgeToken}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
    'devseek.provider': 'bridge',
    'devseek.agentEnabled': true,
    'devseek.autopilotMode': true,
    'devseek.serverPort': port,
    'devseek.newSessionPerRequest': true,
    'devseek.requestTimeoutMs': 60_000,
    'devseek.traceLevel': 'debug',
    'devseek.editAutoAcceptDelay': 0,
  }, null, 2), 'utf8');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function promptFeedbackRounds(promptText) {
  return [...String(promptText).matchAll(/\[工具结果 Round (\d+)\]/g)]
    .map(match => Number(match[1]));
}

function countExactOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function lastFlattenedPromptSegment(promptText) {
  const separatorIndex = promptText.lastIndexOf('\n\n');
  return separatorIndex >= 0 ? promptText.slice(separatorIndex + 2) : promptText;
}

function bindControlledPromptContract({ promptText, ordinal, expectedPrompt, runId, priorRequests }) {
  const text = String(promptText || '');
  const expectedUserSha256 = sha256Text(expectedPrompt);
  const feedbackRounds = promptFeedbackRounds(text);
  const expectedPromptOccurrences = countExactOccurrences(text, expectedPrompt);
  const fullPromptHasInitialIntent = expectedPromptOccurrences > 0;
  const mode = text.startsWith(incrementalPromptPrefix)
    ? 'incremental'
    : fullPromptHasInitialIntent ? 'full' : 'unknown';
  const baseObserved = {
    mode,
    promptLength: text.length,
    promptSha256: sha256Text(text),
    feedbackRounds,
    expectedUserPromptOccurrences: expectedPromptOccurrences,
  };

  if (ordinal === 1) {
    const observedUserPrompt = lastFlattenedPromptSegment(text);
    const conditions = [
      ['first request has no prior attempts', priorRequests.length === 0],
      ['run correlation is present', Boolean(runId)],
      ['transport is a full flattened prompt', mode === 'full'],
      ['prompt is non-empty', text.length > 0],
      ['prompt ends at the exact expected user intent', text.endsWith(`\n\n${expectedPrompt}`)],
      ['extracted user intent equals the expected text', observedUserPrompt === expectedPrompt],
      ['expected user intent occurs exactly once', expectedPromptOccurrences === 1],
      ['first request contains no tool-feedback round', feedbackRounds.length === 0],
    ];
    const failed = conditions.find(([, passed]) => !passed);
    return {
      contractVersion: 'devseek.controlled-prompt-binding/v1',
      expected: {
        ordinal: 1,
        kind: 'initial-user-intent',
        mode: 'full',
        requiredPrefix: '[指令]\\n',
        userPrompt: expectedPrompt,
        userPromptLength: expectedPrompt.length,
        userPromptSha256: expectedUserSha256,
      },
      observed: {
        ...baseObserved,
        userPrompt: observedUserPrompt,
        userPromptLength: observedUserPrompt.length,
        userPromptSha256: sha256Text(observedUserPrompt),
      },
      bound: !failed,
      reason: failed ? failed[0] : 'Exact initial user intent is bound to the full Bridge prompt.',
    };
  }

  const expectedFeedbackRound = ordinal - 1;
  const expectedRunId = priorRequests[0]?.runId || '';
  const priorChainBound = priorRequests.length === ordinal - 1
    && priorRequests.every(request => request.bound === true && request.promptContract?.bound === true);
  const sameRun = Boolean(runId) && Boolean(expectedRunId) && runId === expectedRunId;
  const expectedRounds = Array.from({ length: expectedFeedbackRound }, (_, index) => index + 1);
  const roundsBound = mode === 'incremental'
    ? feedbackRounds.length === 1 && feedbackRounds[0] === expectedFeedbackRound
    : feedbackRounds.length === expectedRounds.length
      && feedbackRounds.every((round, index) => round === expectedRounds[index]);
  const lastMarker = `[工具结果 Round ${expectedFeedbackRound}]`;
  const lastMarkerIndex = text.lastIndexOf(lastMarker);
  const hasFeedbackBody = lastMarkerIndex >= 0
    && text.slice(lastMarkerIndex + lastMarker.length).trim().length > 0;
  const fullIntentBoundary = `\n\n${expectedPrompt}\n\n[助手]\n`;
  const initialIntentBound = mode === 'incremental'
    ? priorRequests[0]?.promptContract?.bound === true
    : text.includes(fullIntentBoundary)
      && expectedPromptOccurrences === 1;
  const conditions = [
    ['all prior request attempts are present and bound', priorChainBound],
    ['runId matches the bound initial request', sameRun],
    ['transport is full or the exact incremental-session form', mode === 'full' || mode === 'incremental'],
    ['initial user intent remains bound', initialIntentBound],
    [`tool-feedback rounds are continuous through Round ${expectedFeedbackRound}`, roundsBound],
    [`Round ${expectedFeedbackRound} contains non-empty tool feedback`, hasFeedbackBody],
  ];
  const failed = conditions.find(([, passed]) => !passed);
  return {
    contractVersion: 'devseek.controlled-prompt-binding/v1',
    expected: {
      ordinal,
      kind: 'tool-feedback',
      modes: ['full', 'incremental'],
      runId: expectedRunId,
      priorBoundRequests: ordinal - 1,
      feedbackRound: expectedFeedbackRound,
      feedbackMarker: lastMarker,
      userPromptLength: expectedPrompt.length,
      userPromptSha256: expectedUserSha256,
    },
    observed: {
      ...baseObserved,
      runId,
      priorRequestCount: priorRequests.length,
      priorBoundRequestCount: priorRequests.filter(request => request.bound === true).length,
      feedbackBodyLength: lastMarkerIndex >= 0
        ? text.slice(lastMarkerIndex + lastMarker.length).trim().length
        : 0,
      initialIntentBound,
    },
    bound: !failed,
    reason: failed ? failed[0] : `Continuous tool-feedback Round ${expectedFeedbackRound} is bound to the initial intent.`,
  };
}

function runPromptContractSelfTest(expectedPrompt) {
  const runId = 'prompt-contract-self-test-run';
  const validInitialText = `[指令]\nself-test system contract\n\n${expectedPrompt}`;
  const validProductInitialText = `你是一个拥有完整工具访问权限的编程智能体。\n\n[工具协议]\n必须使用受控工具。\n\n${expectedPrompt}`;
  const validInitial = bindControlledPromptContract({
    promptText: validInitialText,
    ordinal: 1,
    expectedPrompt,
    runId,
    priorRequests: [],
  });
  const validPrior = [{
    runId,
    bound: validInitial.bound,
    promptContract: validInitial,
  }];
  const validRoundTwoText = `${incrementalPromptPrefix}[助手]\n[DevSeek 已执行工具请求摘要]\n\n[工具结果 Round 1]\nself-test tool result`;
  const validFullRoundTwoText = `${validInitialText}\n\n[助手]\n[DevSeek 已执行工具请求摘要]\n\n[工具结果 Round 1]\nself-test tool result`;
  const cases = [
    { name: 'exact-initial-intent', expectedBound: true, binding: validInitial },
    {
      name: 'product-flattened-initial-intent',
      expectedBound: true,
      binding: bindControlledPromptContract({
        promptText: validProductInitialText,
        ordinal: 1,
        expectedPrompt,
        runId,
        priorRequests: [],
      }),
    },
    {
      name: 'empty-prompt',
      expectedBound: false,
      binding: bindControlledPromptContract({ promptText: '', ordinal: 1, expectedPrompt, runId, priorRequests: [] }),
    },
    {
      name: 'empty-user-tail',
      expectedBound: false,
      binding: bindControlledPromptContract({ promptText: '[指令]\nself-test system contract\n\n', ordinal: 1, expectedPrompt, runId, priorRequests: [] }),
    },
    {
      name: 'replaced-user-intent',
      expectedBound: false,
      binding: bindControlledPromptContract({
        promptText: `[指令]\nself-test system contract\n\n${expectedPrompt.replace('CONTROLLED_SIM_OK', 'CONTROLLED_SIM_CHANGED')}`,
        ordinal: 1,
        expectedPrompt,
        runId,
        priorRequests: [],
      }),
    },
    {
      name: 'expected-intent-with-appended-replacement',
      expectedBound: false,
      binding: bindControlledPromptContract({
        promptText: `${validInitialText}\n附加并执行另一个任务`,
        ordinal: 1,
        expectedPrompt,
        runId,
        priorRequests: [],
      }),
    },
    {
      name: 'continuous-incremental-round-two',
      expectedBound: true,
      binding: bindControlledPromptContract({
        promptText: validRoundTwoText,
        ordinal: 2,
        expectedPrompt,
        runId,
        priorRequests: validPrior,
      }),
    },
    {
      name: 'continuous-full-round-two',
      expectedBound: true,
      binding: bindControlledPromptContract({
        promptText: validFullRoundTwoText,
        ordinal: 2,
        expectedPrompt,
        runId,
        priorRequests: validPrior,
      }),
    },
    {
      name: 'gapped-tool-feedback-round',
      expectedBound: false,
      binding: bindControlledPromptContract({
        promptText: validRoundTwoText.replace('Round 1', 'Round 2'),
        ordinal: 2,
        expectedPrompt,
        runId,
        priorRequests: validPrior,
      }),
    },
    {
      name: 'follow-up-without-bound-prior',
      expectedBound: false,
      binding: bindControlledPromptContract({
        promptText: validRoundTwoText,
        ordinal: 2,
        expectedPrompt,
        runId,
        priorRequests: [],
      }),
    },
    {
      name: 'follow-up-run-correlation-switch',
      expectedBound: false,
      binding: bindControlledPromptContract({
        promptText: validRoundTwoText,
        ordinal: 2,
        expectedPrompt,
        runId: `${runId}-replacement`,
        priorRequests: validPrior,
      }),
    },
  ];
  const results = cases.map(testCase => ({
    name: testCase.name,
    expectedBound: testCase.expectedBound,
    observedBound: testCase.binding.bound,
    reason: testCase.binding.reason,
    passed: testCase.binding.bound === testCase.expectedBound,
  }));
  const errors = results.filter(result => !result.passed)
    .map(result => `${result.name}: expected bound=${result.expectedBound}, observed ${result.observedBound}`);
  return {
    ok: errors.length === 0,
    contractVersion: 'devseek.controlled-prompt-binding/v1',
    cases: results,
    errors,
  };
}

async function startControlledBridge({ token, workspaceDir, runtimeIdentity, expectedPrompt, promptContractSelfTest }) {
  const { attachBridgeRunEvidence } = require(bridgeEvidencePath);
  const state = {
    chatRequests: [],
    rejectedRequests: [],
    providerInvocationCount: 0,
    statusRequests: 0,
    authFailures: 0,
    promptContractSelfTest,
    errors: [],
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/ping') return sendJson(response, 200, { ok: true });
      if (request.headers['x-devseek-token'] !== token) {
        state.authFailures += 1;
        return sendJson(response, 401, { error: 'UNAUTHORIZED' });
      }
      if (url.pathname === '/status') {
        state.statusRequests += 1;
        return sendJson(response, 200, {
          idle: true,
          queueLength: 0,
          browserReady: true,
          appVersion: runtimeIdentity.version,
          buildChannel: runtimeIdentity.devseekBuild.channel,
          buildId: runtimeIdentity.devseekBuild.buildId,
          gitCommit: runtimeIdentity.devseekBuild.gitCommit,
        });
      }
      if (url.pathname === '/chat' && request.method === 'POST') {
        const body = JSON.parse(await readRequestBody(request));
        const runId = headerText(request, 'x-devseek-run-id');
        const traceWorkspaceRoot = headerText(request, 'x-devseek-trace-workspace-root');
        const operationId = headerText(request, 'x-devseek-operation-id');
        const authorityToken = headerText(request, 'x-devseek-evidence-authority');
        if (!runId || !traceWorkspaceRoot || !operationId || !authorityToken) {
          return sendJson(response, 400, { error: 'MISSING_RUN_EVIDENCE_HEADERS' });
        }
        if (path.resolve(traceWorkspaceRoot) !== path.resolve(workspaceDir)) {
          return sendJson(response, 400, { error: 'WORKSPACE_ROOT_MISMATCH' });
        }
        const promptText = String(body.prompt || '');
        const ordinal = state.chatRequests.length + 1;
        const promptContract = bindControlledPromptContract({
          promptText,
          ordinal,
          expectedPrompt,
          runId,
          priorRequests: state.chatRequests,
        });
        const evidence = attachBridgeRunEvidence({
          workspaceRoot: traceWorkspaceRoot,
          runId,
          operationId,
          authorityToken,
        });
        evidence.record('provider.requested', {
          provider: 'controlled-fixture',
          layer: 'deterministic-fake-provider',
          prompt_length: promptText.length,
          prompt_sha256: sha256Text(promptText),
          prompt_contract_version: promptContract.contractVersion,
          prompt_contract_bound: promptContract.bound,
          prompt_contract_reason: promptContract.reason,
        });
        const requestRecord = {
          ordinal,
          runId,
          operationId,
          stream: body.stream !== false,
          newSession: body.newSession === true,
          mode: body.mode || 'fast',
          promptLength: promptText.length,
          promptSha256: sha256Text(promptText),
          expected: promptContract.expected,
          observed: promptContract.observed,
          bound: promptContract.bound,
          reason: promptContract.reason,
          promptContract,
        };
        state.chatRequests.push(requestRecord);
        if (!promptContract.bound) {
          state.rejectedRequests.push(requestRecord);
          evidence.record('provider.failed', {
            provider: 'controlled-fixture',
            layer: 'deterministic-fake-provider',
            error_code: 'PROMPT_CONTRACT_MISMATCH',
            prompt_contract_version: promptContract.contractVersion,
            prompt_contract_bound: false,
            prompt_contract_reason: promptContract.reason,
          });
          return sendJson(response, 422, {
            error: 'PROMPT_CONTRACT_MISMATCH',
            ordinal,
            bound: false,
            reason: promptContract.reason,
          });
        }
        state.providerInvocationCount += 1;
        const providerText = controlledProviderResponse({ ordinal, workspaceDir });
        evidence.record('provider.completed', {
          provider: 'controlled-fixture',
          layer: 'deterministic-fake-provider',
          response_length: providerText.length,
          prompt_contract_version: promptContract.contractVersion,
          prompt_contract_bound: true,
        });
        requestRecord.responseLength = providerText.length;
        if (body.stream !== false || String(request.headers.accept || '').includes('text/event-stream')) {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'close',
          });
          response.write(`data: ${JSON.stringify({ delta: providerText, done: false })}\n\n`);
          response.end(`data: ${JSON.stringify({ delta: '', done: true })}\n\n`);
          return;
        }
        return sendJson(response, 200, { content: providerText });
      }
      if (url.pathname === '/index/file') return sendJson(response, 404, { error: 'NOT_INDEXED' });
      if (['/cancel', '/preattach', '/shutdown', '/relogin'].includes(url.pathname)) {
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      state.errors.push(errorMessage(error));
      if (!response.headersSent) sendJson(response, 500, { error: 'CONTROLLED_BRIDGE_FAILURE' });
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Controlled Bridge did not bind a TCP port');
  return { server, port: address.port, state };
}

function controlledProviderResponse({ ordinal, workspaceDir }) {
  const targetExists = fs.existsSync(path.join(workspaceDir, targetRelativePath));
  const activeTodos = {
    todoList: [
      { id: 1, title: '创建受控仿真文件', status: 'in-progress' },
      { id: 2, title: '读回并核验精确内容', status: 'not-started' },
    ],
  };
  const completedTodos = {
    todoList: [
      { id: 1, title: '创建受控仿真文件', status: 'completed' },
      { id: 2, title: '读回并核验精确内容', status: 'completed' },
    ],
  };
  const calls = [`[TOOL:manage_todo_list ${JSON.stringify(activeTodos)}]`];
  if (!targetExists || ordinal === 1) {
    calls.push(`[TOOL:create_file ${JSON.stringify({ path: targetRelativePath, content: targetContent })}]`);
  }
  calls.push(`[TOOL:read_file ${JSON.stringify({ path: targetRelativePath })}]`);
  calls.push(`[TOOL:manage_todo_list ${JSON.stringify(completedTodos)}]`);
  calls.push(`[TOOL:task_complete ${JSON.stringify({
    summary: `已创建并读回 ${targetRelativePath}，确认精确内容为 CONTROLLED_SIM_OK。`,
  })}]`);
  return ['我会创建指定文件，并通过真实文件工具读回核验后结算。', ...calls].join('\n');
}

function headerText(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) {
        reject(new Error('Controlled Bridge request exceeded 2 MiB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function writeDriverExtension(options) {
  const {
    driverDir,
    driverReportPath,
    progressPath,
    workspaceDir,
    extensionsDir,
    expectedExtensionPath,
    expectedIdentity,
    prompt: driverPrompt,
    targetRelativePath: targetPath,
    targetContent: expectedContent,
    timeoutMs: driverTimeoutMs,
    port,
    keepWindow,
  } = options;
  fs.writeFileSync(path.join(driverDir, 'package.json'), JSON.stringify({
    name: 'devseek-controlled-vsix-driver',
    displayName: 'DevSeek Controlled VSIX Driver',
    version: '0.0.0',
    publisher: 'devseek-harness',
    engines: { vscode: '^1.85.0' },
    activationEvents: ['*'],
    main: './extension.js',
  }, null, 2), 'utf8');

  const source = String.raw`
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const reportPath = __REPORT_PATH__;
const progressPath = __PROGRESS_PATH__;
const workspaceDir = __WORKSPACE_DIR__;
const extensionsDir = __EXTENSIONS_DIR__;
const expectedExtensionPath = __EXPECTED_EXTENSION_PATH__;
const expectedIdentity = __EXPECTED_IDENTITY__;
const prompt = __PROMPT__;
const targetRelativePath = __TARGET_RELATIVE_PATH__;
const targetContent = __TARGET_CONTENT__;
const timeoutMs = __TIMEOUT_MS__;
const port = __PORT__;
const keepWindow = __KEEP_WINDOW__;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function normalize(value) { return path.resolve(value).replace(/\\/g, '/'); }
function writeReport(payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
}
function progress(stage, extra = {}) {
  fs.appendFileSync(progressPath, JSON.stringify({ ts: new Date().toISOString(), stage, ...extra }) + '\n', 'utf8');
}
function parseJsonLine(line) { try { return JSON.parse(line); } catch { return null; } }
function collectRunLogs() {
  const directory = path.join(workspaceDir, '.devseek', 'runs');
  if (!fs.existsSync(directory)) return { logs: [], terminal: null };
  const logs = fs.readdirSync(directory)
    .filter(name => name.endsWith('.log'))
    .map(name => {
      const absolutePath = path.join(directory, name);
      const events = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).filter(Boolean).map(parseJsonLine).filter(Boolean);
      const terminalEvent = events.find(event => event.event === 'agent-run-completed' || event.event === 'agent-run-failed');
      return {
        path: path.relative(workspaceDir, absolutePath).replace(/\\/g, '/'),
        events: events.length,
        lastEvent: events.at(-1)?.event || '',
        terminal: terminalEvent ? {
          event: terminalEvent.event,
          runId: terminalEvent.runId || '',
          data: terminalEvent.data || {},
        } : null,
      };
    });
  return { logs, terminal: logs.map(log => log.terminal).find(Boolean) || null };
}
async function waitForCommand(command, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await vscode.commands.getCommands(false)).includes(command)) return true;
    await delay(250);
  }
  return false;
}
async function updateConfig(key, value) {
  await vscode.workspace.getConfiguration('devseek').update(key, value, vscode.ConfigurationTarget.Workspace);
}
function runtimeIdentity() {
  const extension = vscode.extensions.getExtension(expectedIdentity.id);
  if (!extension) throw new Error('Installed DevSeek extension is absent from the Extension Host');
  const pkg = extension.packageJSON || {};
  const build = pkg.devseekBuild || {};
  const actual = {
    id: extension.id,
    version: String(pkg.version || ''),
    devseekBuild: {
      channel: String(build.channel || ''),
      buildId: String(build.buildId || ''),
      gitCommit: String(build.gitCommit || ''),
    },
    extensionPath: extension.extensionPath,
  };
  const identityMatches = actual.id === expectedIdentity.id
    && actual.version === expectedIdentity.version
    && actual.devseekBuild.channel === expectedIdentity.devseekBuild.channel
    && actual.devseekBuild.buildId === expectedIdentity.devseekBuild.buildId
    && actual.devseekBuild.gitCommit === expectedIdentity.devseekBuild.gitCommit;
  const pathMatches = normalize(actual.extensionPath) === normalize(expectedExtensionPath)
    && normalize(actual.extensionPath).startsWith(normalize(extensionsDir) + '/');
  return { actual, identityMatches, pathMatches, extension };
}
function evaluate() {
  const target = path.join(workspaceDir, targetRelativePath);
  const artifactExists = fs.existsSync(target) && fs.statSync(target).isFile();
  const actualContent = artifactExists ? fs.readFileSync(target, 'utf8') : '';
  const runLogs = collectRunLogs();
  const terminal = runLogs.terminal;
  const data = terminal?.data || {};
  const changedPaths = Array.isArray(data.changedPaths) ? data.changedPaths.map(value => {
    const candidate = String(value).replace(/\\/g, '/');
    const relative = path.isAbsolute(candidate) ? path.relative(workspaceDir, candidate) : candidate;
    return relative.replace(/\\/g, '/').replace(/^\.\//, '');
  }) : [];
  const isInternalPath = value => value === '.devseek' || value.startsWith('.devseek/')
    || value === '.vscode' || value.startsWith('.vscode/');
  const userChangedPaths = changedPaths.filter(value => !isInternalPath(value));
  const unexpectedChangedPaths = userChangedPaths.filter(value => value !== targetRelativePath);
  const unexpectedUserFiles = [];
  function visitUserFiles(directory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (isInternalPath(relativePath) || relativePath === '.git' || relativePath.startsWith('.git/')) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visitUserFiles(absolutePath, relativePath);
      else if (relativePath !== targetRelativePath) unexpectedUserFiles.push(relativePath);
    }
  }
  visitUserFiles(workspaceDir);
  return {
    ok: artifactExists
      && actualContent === targetContent
      && terminal?.event === 'agent-run-completed'
      && data.status === 'completed'
      && Number(data.tasksApplied || 0) > 0
      && Number(data.tasksFailed || 0) === 0
      && userChangedPaths.length === 1
      && userChangedPaths[0] === targetRelativePath
      && unexpectedChangedPaths.length === 0
      && unexpectedUserFiles.length === 0,
    artifact: {
      path: targetRelativePath,
      exists: artifactExists,
      exactContent: actualContent === targetContent,
      byteLength: Buffer.byteLength(actualContent),
      changedPaths,
      userChangedPaths,
      unexpectedChangedPaths,
      unexpectedUserFiles,
    },
    runLogs,
  };
}

async function activate() {
  const report = {
    ok: false,
    route: 'webview-message',
    approval: 'controlled-intent-confirmed',
    naturalUi: false,
    commandName: '_devseek.harnessSubmitChatMessage',
    commandInjected: false,
    commandCompleted: false,
    identity: null,
    artifact: null,
    runLogs: { logs: [], terminal: null },
    errors: [],
  };
  try {
    progress('activate-started');
    await updateConfig('provider', 'bridge');
    await updateConfig('agentEnabled', true);
    await updateConfig('autopilotMode', true);
    await updateConfig('traceLevel', 'debug');
    await updateConfig('serverPort', port);
    await updateConfig('newSessionPerRequest', true);
    await updateConfig('requestTimeoutMs', 60000);
    const identity = runtimeIdentity();
    report.identity = { actual: identity.actual, identityMatches: identity.identityMatches, pathMatches: identity.pathMatches };
    if (!identity.identityMatches || !identity.pathMatches) throw new Error('Runtime extension identity/path does not match the exact temporary VSIX install');
    await identity.extension.activate();
    await vscode.commands.executeCommand('workbench.view.extension.devseek-sidebar').catch(() => {});
    await vscode.commands.executeCommand('devseek.openChat').catch(() => {});
    if (!await waitForCommand(report.commandName, 60000)) throw new Error('DevSeek controlled inbound command was not registered within 60s');
    await delay(750);
    let commandError = '';
    void vscode.commands.executeCommand(report.commandName, prompt, prompt, true, 'fast')
      .then(() => { report.commandCompleted = true; progress('command-completed'); })
      .catch(error => { commandError = String(error?.stack || error?.message || error); progress('command-failed', { error: commandError }); });
    report.commandInjected = true;
    progress('command-injected');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const evaluation = evaluate();
      report.artifact = evaluation.artifact;
      report.runLogs = evaluation.runLogs;
      if (commandError) throw new Error(commandError);
      if (evaluation.ok) {
        const completionDeadline = Date.now() + 5000;
        while (!report.commandCompleted && Date.now() < completionDeadline) await delay(100);
        report.ok = true;
        break;
      }
      if (evaluation.runLogs.terminal?.event === 'agent-run-failed') break;
      await delay(500);
    }
    if (!report.ok) report.errors.push('Exact-VSIX run did not produce the expected artifact and completed settlement terminal.');
  } catch (error) {
    report.errors.push(String(error?.stack || error?.message || error));
  } finally {
    const evaluation = evaluate();
    report.artifact = evaluation.artifact;
    report.runLogs = evaluation.runLogs;
    progress('write-report', { ok: report.ok });
    writeReport(report);
    await delay(300);
    if (!keepWindow) {
      await vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
    }
  }
}

module.exports = { activate };
  `
    .replace('__REPORT_PATH__', JSON.stringify(driverReportPath))
    .replace('__PROGRESS_PATH__', JSON.stringify(progressPath))
    .replace('__WORKSPACE_DIR__', JSON.stringify(workspaceDir))
    .replace('__EXTENSIONS_DIR__', JSON.stringify(extensionsDir))
    .replace('__EXPECTED_EXTENSION_PATH__', JSON.stringify(expectedExtensionPath))
    .replace('__EXPECTED_IDENTITY__', JSON.stringify(expectedIdentity))
    .replace('__PROMPT__', JSON.stringify(driverPrompt))
    .replace('__TARGET_RELATIVE_PATH__', JSON.stringify(targetPath))
    .replace('__TARGET_CONTENT__', JSON.stringify(expectedContent))
    .replace('__TIMEOUT_MS__', JSON.stringify(driverTimeoutMs))
    .replace('__PORT__', JSON.stringify(port))
    .replace('__KEEP_WINDOW__', JSON.stringify(keepWindow));
  fs.writeFileSync(path.join(driverDir, 'extension.js'), source, 'utf8');
}

async function runVsCodeDriver(options) {
  const {
    driverDir,
    driverReportPath,
    progressPath,
    workspaceDir,
    userDataDir,
    extensionsDir,
    vscodeLogPath,
    keepWindow,
  } = options;
  const logFd = fs.openSync(vscodeLogPath, 'a');
  const child = cp.spawn(codeBin, [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--extensionDevelopmentPath', driverDir,
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    '--disable-updates',
    '--disable-telemetry',
    '--disable-chromium-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--new-window',
    '--wait',
    workspaceDir,
  ], {
    cwd: repoRoot,
    detached: keepWindow,
    env: {
      ...process.env,
      DEVSEEK_REAL_PLUGIN_DEEPSEEK: '1',
      DEVSEEK_REAL_PLUGIN_PROGRESS_PATH: progressPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: ['ignore', logFd, logFd],
  });
  if (keepWindow) child.unref();
  let exited = false;
  let exitCode = null;
  child.on('exit', code => { exited = true; exitCode = code; });
  const deadline = Date.now() + timeoutMs + 60_000;
  try {
    while (Date.now() < deadline) {
      if (fs.existsSync(driverReportPath)) {
        if (!keepWindow) await waitForChildExit(child, 10_000);
        return JSON.parse(fs.readFileSync(driverReportPath, 'utf8'));
      }
      if (exited) {
        return {
          ok: false,
          errors: [`VS Code exited before writing the driver report (exitCode=${exitCode}).`],
          progress: readTail(progressPath),
        };
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return {
      ok: false,
      errors: [`VS Code controlled harness timed out after ${timeoutMs}ms.`],
      progress: readTail(progressPath),
    };
  } finally {
    if (child.exitCode === null && !keepWindow) child.kill('SIGTERM');
    fs.closeSync(logFd);
  }
}

function readTail(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-20);
}

function waitForChildExit(child, waitMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, waitMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function summarizeControlledBridge(state) {
  const errors = [...state.errors];
  const acceptedRequestCount = state.chatRequests.filter(request => request.bound === true).length;
  const allRequestsBound = state.chatRequests.length > 0
    && state.chatRequests.every(request => request.bound === true && request.promptContract?.bound === true);
  if (state.authFailures !== 0) errors.push(`Controlled Bridge observed ${state.authFailures} authentication failures`);
  if (state.chatRequests.length < 1) errors.push('Controlled Bridge received no /chat request');
  if (state.chatRequests.some(request => !request.runId || !request.operationId)) {
    errors.push('At least one controlled /chat request lacked run/operation correlation');
  }
  if (!state.promptContractSelfTest?.ok) errors.push('Controlled prompt-contract negative self-test did not pass');
  if (state.rejectedRequests.length > 0) {
    errors.push(`Controlled Bridge rejected ${state.rejectedRequests.length} prompt-contract request(s)`);
  }
  if (state.providerInvocationCount !== acceptedRequestCount) {
    errors.push(`Controlled provider invocation count ${state.providerInvocationCount} does not match ${acceptedRequestCount} bound request(s)`);
  }
  if (!allRequestsBound) errors.push('Not every controlled /chat request is bound to the expected user intent');
  return {
    ok: errors.length === 0,
    statusRequests: state.statusRequests,
    authFailures: state.authFailures,
    chatRequestCount: state.chatRequests.length,
    acceptedRequestCount,
    rejectedRequestCount: state.rejectedRequests.length,
    providerInvocationCount: state.providerInvocationCount,
    rejectedRequests: state.rejectedRequests,
    promptContract: {
      contractVersion: 'devseek.controlled-prompt-binding/v1',
      selfTest: state.promptContractSelfTest,
      expected: state.chatRequests.map(request => request.expected),
      observed: state.chatRequests.map(request => request.observed),
      bound: allRequestsBound,
    },
    chatRequests: state.chatRequests,
    errors,
  };
}

function inspectRunEvidence(workspaceDir, runId) {
  try {
    const { FileSystemRunEvidenceLedger, PRODUCT_RUN_EVIDENCE_DIRECTORY } = require(sharedPath);
    const rootDir = path.join(workspaceDir, PRODUCT_RUN_EVIDENCE_DIRECTORY);
    const ledger = new FileSystemRunEvidenceLedger({ rootDir });
    const verification = ledger.verify(runId);
    const events = ledger.read(runId);
    const seal = ledger.getSeal(runId);
    const eventTypes = events.map(event => event.type);
    const providerEvents = events
      .filter(event => event.type === 'provider.requested' || event.type === 'provider.completed' || event.type === 'provider.failed')
      .map(event => ({
        type: event.type,
        surface: event.surface,
        operationId: objectPayload(event.payload).operation_id || '',
        boundary: objectPayload(event.payload).boundary || '',
      }));
    const settled = [...events].reverse().find(event => event.type === 'run.settled');
    const requiredTypes = ['run.opened', 'command.accepted', 'provider.requested', 'provider.completed', 'side_effect.committed', 'run.settled'];
    const missingTypes = requiredTypes.filter(type => !eventTypes.includes(type));
    const adverseTypes = eventTypes.filter(type => [
      'evidence.degraded',
      'provider.failed',
      'side_effect.failed',
      'side_effect.indeterminate',
      'verification.failed',
      'quality_gate.failed',
      'quality_gate.vetoed',
    ].includes(type));
    const boundaries = new Set(providerEvents.map(event => event.boundary));
    const operationIds = new Set(providerEvents.map(event => event.operationId).filter(Boolean));
    const providerPairsComplete = [...operationIds].every(operationId => {
      const scoped = providerEvents.filter(event => event.operationId === operationId);
      return ['vscode-provider-client', 'bridge-server'].every(boundary => {
        const side = scoped.filter(event => event.boundary === boundary);
        return side.filter(event => event.type === 'provider.requested').length === 1
          && side.filter(event => event.type === 'provider.completed').length === 1;
      });
    });
    const errors = [];
    if (!verification.valid || verification.status !== 'valid-sealed') errors.push(`Run evidence verification status is ${verification.status}`);
    if (!seal) errors.push('Run evidence is not sealed');
    if (missingTypes.length > 0) errors.push(`Run evidence is missing: ${missingTypes.join(', ')}`);
    if (adverseTypes.length > 0) errors.push(`Run evidence contains adverse events: ${adverseTypes.join(', ')}`);
    if (!boundaries.has('vscode-provider-client') || !boundaries.has('bridge-server') || !providerPairsComplete) {
      errors.push('Provider evidence is not closed at both vscode-provider-client and bridge-server boundaries');
    }
    if (objectPayload(settled?.payload).status !== 'completed') errors.push('run.settled does not report completed');
    if (verification.integrityScope !== 'product-run-diagnostics' || verification.qualificationEligible !== false) {
      errors.push('Run evidence crossed the diagnostic/qualification boundary');
    }
    return {
      ok: errors.length === 0,
      runId,
      verification,
      sealed: Boolean(seal),
      sealSha256: seal?.seal_sha256 || '',
      eventTypes,
      providerEvents,
      errors,
    };
  } catch (error) {
    return { ok: false, runId, errors: [errorMessage(error)], eventTypes: [] };
  }
}

function objectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}
