#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  readJson,
} from './lib/devseek-capability-ledger.mjs';
import {
  buildExternalAuthorityAdapterReport,
  renderExternalAuthorityAdapterMarkdown,
  validateExternalAuthorityAdapterReport,
} from './lib/devseek-external-authority-adapter.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  qualificationProfiles: processPath('docs/process/devseek-qualification-profiles.json'),
  aggregatorPolicy: processPath('docs/process/devseek-qualification-aggregator-policy.json'),
  report: processPath('docs/process/devseek-external-authority-adapter.json'),
  schema: processPath('docs/process/devseek-external-authority-adapter.schema.json'),
  attestationSchema: processPath('docs/process/devseek-external-authority-attestation.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-external-authority-adapter.md'),
};
const sourcePaths = [
  'docs/process/devseek-external-authority-adapter.schema.json',
  'docs/process/devseek-external-authority-attestation.schema.json',
  'docs/process/devseek-gate0-decision.schema.json',
  'scripts/lib/devseek-external-authority-adapter.mjs',
  'scripts/lib/devseek-gate0-decision.mjs',
  'scripts/devseek-external-authority-adapter-check.mjs',
  'scripts/test/devseek-external-authority-adapter.test.mjs',
  'scripts/test/devseek-gate0-decision.test.mjs',
  'package.json',
  'scripts/devseek-phase0-12-verify.mjs',
];

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let report = null;

try {
  sources = {
    ledger: readJson(paths.ledger),
    qualificationProfiles: readJson(paths.qualificationProfiles),
    aggregatorPolicy: readJson(paths.aggregatorPolicy),
    packageJson: readJson(processPath('package.json')),
    sourceContents: Object.fromEntries(sourcePaths.map(relativePath => [
      relativePath,
      readText(processPath(relativePath)),
    ])),
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    report = buildExternalAuthorityAdapterReport(sources);
    writeJson(paths.report, report);
    writeFile(paths.generatedView, renderExternalAuthorityAdapterMarkdown(report));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  report ??= readJson(paths.report);
} catch (error) {
  errors.push(`report:read:${error.message}`);
}

if (report) errors.push(...validateSchema(report));
if (sources && report) errors.push(...validateExternalAuthorityAdapterReport(report, sources));

if (report) {
  const expectedView = renderExternalAuthorityAdapterMarkdown(report);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: report ? {
    adapter_sha256: report.adapter_sha256,
    source_status: report.source_status,
    trust_roots: report.counts?.trust_roots ?? null,
    source_guards_covered: report.counts
      ? `${report.counts.source_guards_covered}/${report.counts.source_guards}` : null,
    failure_oracles_covered: report.counts
      ? `${report.counts.failure_oracles_covered}/${report.counts.failure_oracles}` : null,
    current_authority_status: report.current_binding?.independent_authority_status ?? null,
    qualification_effect: report.qualification_effect,
    claims_permitted: report.claims_permitted,
    asserts_gate_pass: report.asserts_gate_pass,
  } : null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function validateSchema(value) {
  const schemaErrors = [];
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateReport = ajv.compile(readJson(paths.schema));
    if (!validateReport(value)) {
      schemaErrors.push(...(validateReport.errors ?? []).map(error => (
        `schema:${error.instancePath || '/'}:${error.message}`
      )));
    }
    ajv.compile(readJson(paths.attestationSchema));
  } catch (error) {
    schemaErrors.push(`schema:compile:${error.message}`);
  }
  return schemaErrors;
}

function processPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
