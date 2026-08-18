import fs from 'node:fs';
import path from 'node:path';

const inputs = {
  baselineTwoRound: loadReport('--baseline-two-round'),
  optimizedTwoRound: loadReport('--optimized-two-round'),
  baselineMultifile: loadReport('--baseline-multifile'),
  optimizedMultifile: loadReport('--optimized-multifile'),
  existingEditGuard: loadReport('--existing-edit-guard'),
};
const outputPath = argument('--output');
const errors = [];

assertReport(inputs.baselineTwoRound, 't2-cpp-failed-write-recovered', 'baseline two-round');
assertReport(inputs.optimizedTwoRound, 't2-cpp-failed-write-recovered', 'optimized two-round');
assertReport(inputs.baselineMultifile, 'agent-fit-multifile-with-test', 'baseline multi-file');
assertReport(inputs.optimizedMultifile, 'agent-fit-multifile-with-test', 'optimized multi-file');
assertReport(inputs.existingEditGuard, 'existing-js-fix', 'existing-edit guard');

const baselineTwoRound = requestSummary(inputs.baselineTwoRound);
const optimizedTwoRound = requestSummary(inputs.optimizedTwoRound);
const baselineMultifile = requestSummary(inputs.baselineMultifile);
const optimizedMultifile = requestSummary(inputs.optimizedMultifile);
const existingEditGuard = requestSummary(inputs.existingEditGuard);

expect(baselineTwoRound.agentExecutionCount === 2, 'two-round baseline must contain two implementation rounds');
expect(baselineTwoRound.independentReviewCount === 1, 'two-round baseline must expose one redundant independent review');
expect(optimizedTwoRound.agentExecutionCount === 2, 'optimized two-round case changed the implementation round count');
expect(optimizedTwoRound.independentReviewCount === 0, 'optimized two-round case still invokes independent review');
expect(optimizedTwoRound.requestCount === baselineTwoRound.requestCount - 1, 'two-round request count did not drop by one');

const optimizedRounds = requests(inputs.optimizedTwoRound).filter(request => request.requestKind === 'agent-execution');
expect(optimizedRounds[0]?.newSession === true, 'first implementation round must start a fresh provider session');
expect(optimizedRounds[1]?.newSession === false, 'second implementation round must retain the provider session');
expect(
  Number(optimizedRounds[1]?.promptBytes) < Number(optimizedRounds[0]?.promptBytes) * 0.25,
  'second implementation round is not a bounded incremental prompt',
);

expect(baselineMultifile.agentExecutionCount === 1, 'multi-file baseline must contain one implementation round');
expect(baselineMultifile.independentReviewCount === 1, 'multi-file baseline must expose one redundant independent review');
expect(optimizedMultifile.agentExecutionCount === 1, 'optimized multi-file case changed the implementation round count');
expect(optimizedMultifile.independentReviewCount === 0, 'optimized multi-file case still invokes independent review');
expect(optimizedMultifile.requestCount === baselineMultifile.requestCount - 1, 'multi-file request count did not drop by one');

expect(existingEditGuard.agentExecutionCount === 1, 'existing-edit guard must contain one implementation round');
expect(existingEditGuard.independentReviewCount === 1, 'existing source edit bypassed independent review');

const optimizedArtifacts = [
  inputs.optimizedTwoRound,
  inputs.optimizedMultifile,
  inputs.existingEditGuard,
].map(report => `${report.artifact.sha256}:${report.artifact.packaged.version}`);
expect(new Set(optimizedArtifacts).size === 1, 'optimized cases did not execute the same exact VSIX');

const baselineLowRisk = combine(baselineTwoRound, baselineMultifile);
const optimizedLowRisk = combine(optimizedTwoRound, optimizedMultifile);
const savedRequests = baselineLowRisk.requestCount - optimizedLowRisk.requestCount;
const savedPromptBytes = baselineLowRisk.promptBytes - optimizedLowRisk.promptBytes;
expect(savedRequests === 2, `expected two removed provider requests, observed ${savedRequests}`);
expect(savedPromptBytes > 0, 'optimized low-risk cases did not reduce transport prompt bytes');

const result = {
  protocol: 'devseek.t10-provider-efficiency-evaluation/v1',
  ok: errors.length === 0,
  exactVsix: {
    version: inputs.optimizedTwoRound.artifact.packaged.version,
    sha256: inputs.optimizedTwoRound.artifact.sha256,
  },
  cases: {
    baselineTwoRound,
    optimizedTwoRound,
    baselineMultifile,
    optimizedMultifile,
    existingEditGuard,
  },
  lowRiskComparison: {
    baseline: baselineLowRisk,
    optimized: optimizedLowRisk,
    savedRequests,
    requestReductionPercent: percent(savedRequests, baselineLowRisk.requestCount),
    savedPromptBytes,
    promptByteReductionPercent: percent(savedPromptBytes, baselineLowRisk.promptBytes),
  },
  errors,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), serialized, 'utf8');
}
process.stdout.write(serialized);
process.exitCode = result.ok ? 0 : 1;

function loadReport(flag) {
  const value = argument(flag);
  if (!value) throw new Error(`${flag} is required`);
  const absolutePath = path.resolve(value);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function assertReport(report, expectedScenario, label) {
  if (report?.ok !== true) errors.push(`${label} exact-VSIX workflow failed`);
  if (report?.classification?.surface !== 'real-installed-vsix-in-vscode-extension-host') {
    errors.push(`${label} did not use the real installed VSIX surface`);
  }
  if (!scenarioIds(report).includes(expectedScenario)) errors.push(`${label} scenario identity changed`);
  const terminal = report?.driver?.cases?.[0]?.runLogs?.terminal;
  if (terminal?.data?.canonicalCompletionStatus !== 'completed') {
    errors.push(`${label} did not settle canonical completion`);
  }
  for (const request of requests(report)) {
    if (!request.samplingId || !request.operationId) errors.push(`${label} request lost provider correlation identity`);
    if (!Number.isSafeInteger(request.transportAttempt) || request.transportAttempt < 1) {
      errors.push(`${label} request has invalid transport attempt`);
    }
    if (!Number.isSafeInteger(request.promptBytes) || request.promptBytes < request.promptLength) {
      errors.push(`${label} request has invalid UTF-8 prompt budget`);
    }
  }
}

function requestSummary(report) {
  const observed = requests(report);
  return {
    scenario: scenarioIds(report),
    requestCount: observed.length,
    agentExecutionCount: observed.filter(request => request.requestKind === 'agent-execution').length,
    independentReviewCount: observed.filter(request => request.requestKind === 'independent-review').length,
    promptBytes: observed.reduce((sum, request) => sum + request.promptBytes, 0),
  };
}

function combine(...summaries) {
  return {
    requestCount: summaries.reduce((sum, summary) => sum + summary.requestCount, 0),
    agentExecutionCount: summaries.reduce((sum, summary) => sum + summary.agentExecutionCount, 0),
    independentReviewCount: summaries.reduce((sum, summary) => sum + summary.independentReviewCount, 0),
    promptBytes: summaries.reduce((sum, summary) => sum + summary.promptBytes, 0),
  };
}

function requests(report) {
  return Array.isArray(report?.bridge?.chatRequests) ? report.bridge.chatRequests : [];
}

function scenarioIds(report) {
  return Array.isArray(report?.scenario?.cases)
    ? report.scenario.cases.map(candidate => String(candidate.id || ''))
    : [String(report?.scenario?.id || '')];
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function percent(value, total) {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}
