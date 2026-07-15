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
  buildC0WiringReconciliation,
  renderC0WiringReconciliationMarkdown,
  validateC0WiringReconciliation,
} from './lib/devseek-c0-wiring-reconciliation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  registry: processPath('docs/process/devseek-c0-wiring-reconciliation.json'),
  schema: processPath('docs/process/devseek-c0-wiring-reconciliation.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-c0-wiring-reconciliation.md'),
};
const reportPaths = {
  'c0-ledger-wiring': 'docs/process/devseek-c0-ledger-wiring.json',
  'c0-preregistration-wiring': 'docs/process/devseek-c0-preregistration-wiring.json',
  'c0-run-evidence-wiring': 'docs/process/devseek-c0-run-evidence-wiring.json',
  'c0-manifest-aggregator-wiring': 'docs/process/devseek-c0-manifest-aggregator-wiring.json',
  'external-authority-adapter': 'docs/process/devseek-external-authority-adapter.json',
  'gate0-decision': 'docs/process/devseek-gate0-decision-report.json',
};
const sourcePaths = [
  'package.json',
  'scripts/devseek-phase0-12-verify.mjs',
  'scripts/devseek-c0-ledger-wiring-check.mjs',
  'scripts/devseek-c0-preregistration-wiring-check.mjs',
  'scripts/devseek-c0-run-evidence-wiring-check.mjs',
  'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs',
  'scripts/devseek-external-authority-adapter-check.mjs',
  'scripts/devseek-gate0-decision-check.mjs',
  'scripts/devseek-c0-wiring-reconciliation-check.mjs',
  'scripts/test/devseek-c0-wiring-reconciliation.test.mjs',
  'docs/process/generated/devseek-c0-ledger-wiring.md',
  'docs/process/generated/devseek-c0-preregistration-wiring.md',
  'docs/process/generated/devseek-c0-run-evidence-wiring.md',
  'docs/process/generated/devseek-c0-manifest-aggregator-wiring.md',
  'docs/process/generated/devseek-external-authority-adapter.md',
];

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    ledger: readJson(paths.ledger),
    reports: Object.fromEntries(Object.entries(reportPaths).map(([id, relativePath]) => [
      id,
      readJson(processPath(relativePath)),
    ])),
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
    registry = buildC0WiringReconciliation(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderC0WiringReconciliationMarkdown(registry));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  registry ??= readJson(paths.registry);
} catch (error) {
  errors.push(`registry:read:${error.message}`);
}

if (registry) {
  errors.push(...validateSchema(registry));
}

let validationResult = null;
if (registry && sources) {
  validationResult = validateC0WiringReconciliation(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderC0WiringReconciliationMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  reconciliation_sha256: registry?.reconciliation_sha256 ?? null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function validateSchema(value) {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const schema = readJson(paths.schema);
    const validate = ajv.compile(schema);
    if (validate(value)) return [];
    return (validate.errors ?? []).map(error => (
      `schema:${error.instancePath || '/'}:${error.message}`
    ));
  } catch (error) {
    return [`schema:compile:${error.message}`];
  }
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
