import cp from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const matrixPath = path.join(scriptDir, 'product-simulation-matrix.json');
const harnessPath = path.join(
  repoRoot,
  'packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs',
);
const vsixPath = requiredPath('--vsix');
const reportDir = path.resolve(
  argument('--report-dir') || path.join(scriptDir, 'reports/comprehensive-product-simulation'),
);
const aggregatePath = path.resolve(
  argument('--output') || path.join(reportDir, 'aggregate.json'),
);
const timeoutMs = positiveInteger(argument('--timeout-ms'), 600_000);
const onlySuites = new Set(argument('--only').split(',').map(value => value.trim()).filter(Boolean));
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const selectedSuites = matrix.suites.filter(suite => onlySuites.size === 0 || onlySuites.has(suite.id));

if (selectedSuites.length === 0) {
  throw new Error('No product simulation suite matched --only.');
}

fs.mkdirSync(reportDir, { recursive: true });
const exactVsixSha256 = sha256File(vsixPath);
const startedAt = new Date().toISOString();
const suiteResults = [];

for (const [index, suite] of selectedSuites.entries()) {
  const reportPath = path.join(reportDir, `${String(index + 1).padStart(2, '0')}-${suite.id}.json`);
  process.stdout.write(`[${index + 1}/${selectedSuites.length}] ${suite.id} (${suite.case_count} cases) ... `);
  const execution = cp.spawnSync(process.execPath, [
    harnessPath,
    '--suite', suite.id,
    '--vsix', vsixPath,
    '--timeout-ms', String(timeoutMs),
    '--report', reportPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs + 120_000,
  });
  const report = readJsonIfPresent(reportPath);
  const errors = validateSuiteResult({
    suite,
    execution,
    report,
    exactVsixSha256,
  });
  const result = {
    id: suite.id,
    ok: errors.length === 0,
    expectedCaseCount: suite.case_count,
    observedCaseCount: report?.scenario?.cases?.length ?? 0,
    dimensions: suite.dimensions,
    reportPath: path.relative(repoRoot, reportPath),
    providerRequestCount: report?.bridge?.chatRequests?.length ?? 0,
    buildVersion: report?.artifact?.packaged?.version ?? '',
    vsixSha256: report?.artifact?.sha256 ?? '',
    errors,
  };
  suiteResults.push(result);
  process.stdout.write(result.ok ? 'PASS\n' : `FAIL (${errors.join('; ')})\n`);
  if (!result.ok) {
    const diagnostic = `${execution.stdout || ''}\n${execution.stderr || ''}`.trim().slice(-4000);
    if (diagnostic) process.stderr.write(`${diagnostic}\n`);
  }
}

const totalCases = suiteResults.reduce((sum, result) => sum + result.observedCaseCount, 0);
const expectedCases = suiteResults.reduce((sum, result) => sum + result.expectedCaseCount, 0);
const failedSuites = suiteResults.filter(result => !result.ok);
const aggregate = {
  protocol: 'devseek.t9-t10-comprehensive-product-simulation/v1',
  ok: failedSuites.length === 0 && totalCases === expectedCases,
  matrix: {
    schemaVersion: matrix.schema_version,
    path: path.relative(repoRoot, matrixPath),
    purpose: matrix.purpose,
  },
  exactVsix: {
    path: path.relative(repoRoot, vsixPath),
    sha256: exactVsixSha256,
  },
  startedAt,
  completedAt: new Date().toISOString(),
  selectedSuiteCount: selectedSuites.length,
  passedSuiteCount: suiteResults.length - failedSuites.length,
  expectedCaseCount: expectedCases,
  observedCaseCount: totalCases,
  suites: suiteResults,
  errors: failedSuites.flatMap(result => result.errors.map(error => `${result.id}: ${error}`)),
};

fs.mkdirSync(path.dirname(aggregatePath), { recursive: true });
fs.writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: aggregate.ok,
  suites: `${aggregate.passedSuiteCount}/${aggregate.selectedSuiteCount}`,
  cases: `${aggregate.observedCaseCount}/${aggregate.expectedCaseCount}`,
  exactVsixSha256,
  aggregatePath: path.relative(repoRoot, aggregatePath),
  errors: aggregate.errors,
}, null, 2)}\n`);
process.exitCode = aggregate.ok ? 0 : 1;

function validateSuiteResult({ suite, execution, report, exactVsixSha256: expectedSha }) {
  const errors = [];
  if (execution.error) errors.push(`harness execution error: ${execution.error.message}`);
  if (execution.status !== 0) errors.push(`harness exit status ${execution.status ?? 'missing'}`);
  if (!report) return [...errors, 'suite report missing or unreadable'];
  if (report.ok !== true) errors.push('suite report failed');
  if (report.classification?.surface !== 'real-installed-vsix-in-vscode-extension-host') {
    errors.push('suite did not execute the installed VSIX surface');
  }
  if (report.artifact?.sha256 !== expectedSha) errors.push('suite artifact SHA-256 differs from requested VSIX');
  const caseIds = Array.isArray(report.scenario?.cases)
    ? report.scenario.cases.map(candidate => String(candidate.id || ''))
    : [];
  if (caseIds.length !== suite.case_count) {
    errors.push(`expected ${suite.case_count} cases, observed ${caseIds.length}`);
  }
  if (new Set(caseIds).size !== caseIds.length) errors.push('suite contains duplicate case identities');
  const driverCases = Array.isArray(report.driver?.cases) ? report.driver.cases : [];
  if (driverCases.length !== suite.case_count) {
    errors.push(`expected ${suite.case_count} driver cases, observed ${driverCases.length}`);
  }
  for (const candidate of driverCases) {
    if (candidate.ok !== true) errors.push(`driver case failed: ${candidate.scenario || candidate.kind || 'unknown'}`);
  }
  for (const boundary of ['driver', 'bridge', 'evidence', 'runEvidence', 'codingConformance']) {
    if (report[boundary]?.ok !== true) errors.push(`${boundary} boundary failed`);
  }
  return [...new Set(errors)];
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requiredPath(flag) {
  const value = argument(flag);
  if (!value) throw new Error(`${flag} is required`);
  const resolved = path.resolve(repoRoot, value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${flag} file was not found: ${resolved}`);
  }
  return resolved;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}
