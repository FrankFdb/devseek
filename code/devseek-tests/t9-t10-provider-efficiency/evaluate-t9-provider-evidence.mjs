import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const {
  FileSystemRunEvidenceLedger,
  productRunEvidenceRoot,
} = require(path.join(repoRoot, 'packages/shared/dist/index.js'));

const reportPaths = collectArguments('--report');
const outputPath = argument('--output');
if (reportPaths.length === 0) throw new Error('At least one --report path is required');

const evaluations = reportPaths.map(evaluateReport);
const errors = evaluations.flatMap(evaluation => evaluation.errors.map(error => (
  `${path.basename(evaluation.reportPath)}: ${error}`
)));
const result = {
  protocol: 'devseek.t9-provider-efficiency-evaluation/v1',
  ok: errors.length === 0,
  reportCount: evaluations.length,
  cases: evaluations,
  errors,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), serialized, 'utf8');
}
process.stdout.write(serialized);
process.exitCode = result.ok ? 0 : 1;

function evaluateReport(reportPath) {
  const absoluteReportPath = path.resolve(reportPath);
  const report = JSON.parse(fs.readFileSync(absoluteReportPath, 'utf8'));
  const errors = [];
  const scenarios = Array.isArray(report?.scenario?.cases)
    ? report.scenario.cases.map(candidate => String(candidate.id || ''))
    : [String(report?.scenario?.id || '')];
  if (report?.ok !== true) errors.push('exact-VSIX report did not pass');
  if (report?.classification?.surface !== 'real-installed-vsix-in-vscode-extension-host') {
    errors.push(`unexpected execution surface: ${String(report?.classification?.surface)}`);
  }

  const workspaceDir = String(report?.harness?.workspaceDir || '');
  if (!workspaceDir || !fs.existsSync(workspaceDir)) errors.push('retained exact-VSIX workspace is unavailable');
  const requests = Array.isArray(report?.bridge?.chatRequests) ? report.bridge.chatRequests : [];
  if (requests.length === 0) errors.push('controlled Bridge observed no main provider request');
  for (const request of requests) {
    if (!isCorrelationId(request.samplingId)) errors.push(`request ${request.operationId} has no samplingId`);
    if (!Number.isSafeInteger(request.transportAttempt) || request.transportAttempt < 1) {
      errors.push(`request ${request.operationId} has invalid transportAttempt`);
    }
    if (!(Number(request.promptBytes) >= Number(request.promptLength))) {
      errors.push(`request ${request.operationId} has invalid UTF-8 prompt byte measurement`);
    }
  }

  const samplingGroups = groupBy(requests, request => request.samplingId);
  for (const [samplingId, group] of samplingGroups) {
    const attempts = group.map(request => request.transportAttempt).sort((a, b) => a - b);
    const expected = Array.from({ length: attempts.at(-1) || 0 }, (_, index) => index + 1);
    if (!isCorrelationId(samplingId) || JSON.stringify(attempts) !== JSON.stringify(expected)) {
      errors.push(`sampling ${samplingId || '(missing)'} attempts are not one-based and contiguous: ${JSON.stringify(attempts)}`);
    }
    if (new Set(group.map(request => request.operationId)).size !== group.length) {
      errors.push(`sampling ${samplingId} reused an operationId across transport attempts`);
    }
  }

  const caseReports = Array.isArray(report?.driver?.cases) ? report.driver.cases : [];
  const runIds = [...new Set(caseReports.map(candidate => candidate?.runLogs?.terminal?.runId).filter(Boolean))];
  const profiles = [];
  if (workspaceDir && fs.existsSync(workspaceDir)) {
    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceDir) });
    for (const runId of runIds) inspectRun(ledger, runId, requests, profiles, errors);
  }
  if (profiles.length === 0) errors.push('no client-side provider efficiency profiles were persisted');

  applyScenarioAssertions({ scenarios, requests, profiles, errors });
  return {
    reportPath: absoluteReportPath,
    scenarios,
    runIds,
    requestCount: requests.length,
    samplingCount: samplingGroups.size,
    profileCount: profiles.length,
    retrySamplingCount: [...samplingGroups.values()].filter(group => group.length > 1).length,
    partialOutputFailureCount: profiles.filter(profile => (
      profile.eventType === 'provider.failed' && profile.efficiency.stream_bytes_observed > 0
    )).length,
    profileStats: summarizeProfiles(profiles),
    ok: errors.length === 0,
    errors,
  };
}

function summarizeProfiles(profiles) {
  const phaseTotals = {};
  for (const profile of profiles) {
    for (const [phase, duration] of Object.entries(profile.efficiency.phases_ms)) {
      phaseTotals[phase] = roundMetric((phaseTotals[phase] || 0) + Number(duration));
    }
  }
  return {
    totalMs: summarizeMetric(profiles.map(profile => profile.efficiency.total_ms)),
    timeToFirstOutputMs: summarizeMetric(profiles
      .map(profile => profile.efficiency.time_to_first_output_ms)
      .filter(value => value !== null)),
    promptBytes: summarizeMetric(profiles.map(profile => profile.efficiency.prompt_budget.total_bytes)),
    outputBytes: summarizeMetric(profiles
      .map(profile => profile.efficiency.output_bytes)
      .filter(value => value !== null)),
    internalRetryCount: profiles.reduce((sum, profile) => sum + Number(profile.efficiency.retry_count), 0),
    phaseTotalsMs: phaseTotals,
  };
}

function summarizeMetric(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return { count: 0, min: null, max: null, total: 0 };
  return {
    count: numbers.length,
    min: roundMetric(Math.min(...numbers)),
    max: roundMetric(Math.max(...numbers)),
    total: roundMetric(numbers.reduce((sum, value) => sum + value, 0)),
  };
}

function roundMetric(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function inspectRun(ledger, runId, requests, profiles, errors) {
  const verification = ledger.verify(runId);
  if (!verification.valid || verification.status !== 'valid-sealed') {
    errors.push(`run ${runId} evidence is ${verification.status}`);
  }
  const providerEvents = ledger.read(runId).filter(event => (
    event.type.startsWith('provider.')
    && event.payload?.boundary === 'vscode-provider-client'
  ));
  const byOperation = groupBy(providerEvents, event => event.payload?.operation_id);
  for (const [operationId, events] of byOperation) {
    const requested = events.filter(event => event.type === 'provider.requested');
    const terminals = events.filter(event => event.type === 'provider.completed' || event.type === 'provider.failed');
    if (requested.length !== 1 || terminals.length !== 1) {
      errors.push(`operation ${operationId} has requested=${requested.length}, terminal=${terminals.length}`);
      continue;
    }
    const requestPayload = requested[0].payload;
    const terminalPayload = terminals[0].payload;
    const efficiency = terminalPayload.efficiency;
    try {
      assert.equal(efficiency.protocol, 'devseek.provider-efficiency/v1');
      assert.equal(efficiency.layer, 'vscode-provider-client');
      assert.equal(efficiency.operation_id, operationId);
      assert.equal(efficiency.sampling_id, requestPayload.sampling_id);
      assert.equal(efficiency.transport_attempt, requestPayload.transport_attempt);
      assert.equal(efficiency.prompt_budget.protocol, 'devseek.provider-prompt-budget/v1');
      assert.equal(efficiency.prompt_budget.total_bytes, requestPayload.prompt_budget.total_bytes);
      assert.ok(['within', 'warning', 'exceeded'].includes(efficiency.prompt_budget.status));
      assert.ok(Number.isFinite(efficiency.total_ms) && efficiency.total_ms >= 0);
      assert.ok(efficiency.time_to_first_output_ms === null || (
        Number.isFinite(efficiency.time_to_first_output_ms)
        && efficiency.time_to_first_output_ms >= 0
        && efficiency.time_to_first_output_ms <= efficiency.total_ms + 1
      ));
      const phaseTotal = Object.values(efficiency.phases_ms).reduce((sum, value) => sum + Number(value), 0);
      assert.ok(Math.abs(phaseTotal - efficiency.total_ms) <= 6);
    } catch (error) {
      errors.push(`operation ${operationId} efficiency contract failed: ${error.message}`);
      continue;
    }
    const transportRequest = requests.find(request => request.operationId === operationId);
    if (!transportRequest) errors.push(`operation ${operationId} has no controlled transport observation`);
    else {
      if (transportRequest.samplingId !== efficiency.sampling_id) errors.push(`operation ${operationId} samplingId changed at transport`);
      if (transportRequest.transportAttempt !== efficiency.transport_attempt) errors.push(`operation ${operationId} attempt changed at transport`);
    }
    profiles.push({ runId, operationId, eventType: terminals[0].type, efficiency });
  }
}

function applyScenarioAssertions({ scenarios, requests, profiles, errors }) {
  if (scenarios.includes('t9-transport-reset-recovery')) {
    const retry = [...groupBy(requests, request => request.samplingId).values()]
      .find(group => group.map(request => request.transportAttempt).sort().join(',') === '1,2');
    if (!retry) errors.push('transport-reset case did not expose one semantic sampling across two transport attempts');
    if (!profiles.some(profile => profile.eventType === 'provider.failed')
      || !profiles.some(profile => profile.eventType === 'provider.completed')) {
      errors.push('transport-reset case does not contain failed then completed attempt profiles');
    }
  }
  if (scenarios.includes('stream-truncated-no-mutation')) {
    if (requests.some(request => request.transportAttempt > 1)) {
      errors.push('partial-output stream corruption was retried');
    }
    if (!profiles.some(profile => (
      profile.eventType === 'provider.failed'
      && profile.efficiency.stream_bytes_observed > 0
      && profile.efficiency.time_to_first_output_ms !== null
    ))) errors.push('partial-output failure lacks observed output/TTFO evidence');
  }
  if (scenarios.includes('t1-direct-cn-typo-colloquial')) {
    if (!profiles.some(profile => profile.eventType === 'provider.completed')) {
      errors.push('Chinese typo direct-answer case has no completed provider profile');
    }
  }
  if (scenarios.includes('t1-followup-cn-detail')) {
    if (new Set(requests.map(request => request.samplingId)).size < 2) {
      errors.push('multi-turn follow-up reused one semantic sampling identity across turns');
    }
  }
  if (scenarios.includes('agent-fit-multifile-with-test')) {
    if (!profiles.some(profile => profile.eventType === 'provider.completed')) {
      errors.push('multi-file coding case has no completed provider profile');
    }
  }
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function isCorrelationId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/u.test(value);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function collectArguments(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}
