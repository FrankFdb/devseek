#!/usr/bin/env node

import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  evaluateCodingConformanceFixture,
} from '../packages/shared/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const vscodeReportValue = argValue('--vscode-report') || process.env.DEVSEEK_VSCODE_CONFORMANCE_REPORT || '';
const vscodeReportPath = vscodeReportValue ? path.resolve(repoRoot, vscodeReportValue) : '';
const outputPathValue = argValue('--output') || process.env.DEVSEEK_SURFACE_CONFORMANCE_REPORT || '';
const outputPath = outputPathValue ? path.resolve(repoRoot, outputPathValue) : '';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-surface-product-conformance-'));

let report;
try {
  if (!vscodeReportPath || !fs.existsSync(vscodeReportPath)) {
    throw new Error('Pass an existing exact-VSIX report with --vscode-report <path>.');
  }
  const cliReportPath = path.join(tempRoot, 'cli.json');
  const headlessReportPath = path.join(tempRoot, 'headless.json');
  runProductProbe('packages/cli/test/coding-conformance-development-baseline.test.mjs', cliReportPath);
  runProductProbe('packages/headless/test/headless-coding-kernel.test.mjs', headlessReportPath);

  const surfaceReports = {
    cli: readJson(cliReportPath),
    headless: readJson(headlessReportPath),
    vscode: readJson(vscodeReportPath).codingConformance,
  };
  const cases = CODING_CONFORMANCE_DEVELOPMENT_FIXTURES.map(fixture => {
    const observations = ['vscode', 'cli', 'headless'].map(surface => {
      const observation = surfaceReports[surface]?.observations?.find(
        candidate => candidate?.projection?.fixtureId === fixture.fixtureId,
      );
      if (!observation) throw new Error(`${fixture.fixtureId}: missing ${surface} product observation`);
      return observation;
    });
    const evaluation = evaluateCodingConformanceFixture(fixture, observations);
    return {
      fixtureId: fixture.fixtureId,
      ok: evaluation.contractConformant && evaluation.productRouteEvidenceComplete,
      evaluation,
    };
  });
  const errors = cases.flatMap(candidate => candidate.ok
    ? []
    : [`${candidate.fixtureId}: ${JSON.stringify(candidate.evaluation.violations)}`]);
  report = {
    ok: errors.length === 0 && cases.length === 5,
    schemaVersion: 'devseek.surface-product-conformance-report/v1',
    evidenceClass: 'product-route',
    surfaces: ['vscode', 'cli', 'headless'],
    fixtureCount: cases.length,
    productRouteEvidenceCompleteCount: cases.filter(candidate => candidate.ok).length,
    qualificationEligible: false,
    claimsPermitted: false,
    sourceReports: {
      vscode: vscodeReportPath,
      cli: cliReportPath,
      headless: headlessReportPath,
    },
    cases,
    errors,
  };
} catch (error) {
  report = {
    ok: false,
    schemaVersion: 'devseek.surface-product-conformance-report/v1',
    qualificationEligible: false,
    claimsPermitted: false,
    errors: [error instanceof Error ? error.message : String(error)],
  };
}

const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}
if (report.ok) console.log(serialized);
else console.error(serialized);
if (!outputPath || !report.ok) fs.rmSync(tempRoot, { recursive: true, force: true });
process.exit(report.ok ? 0 : 1);

function runProductProbe(relativeTestPath, reportPath) {
  const result = cp.spawnSync(process.execPath, ['--test', relativeTestPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEVSEEK_CODING_CONFORMANCE_REPORT_PATH: reportPath,
    },
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error([
      `${relativeTestPath} failed with exit ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  if (!fs.existsSync(reportPath)) throw new Error(`${relativeTestPath} did not write its product report`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : '';
}
