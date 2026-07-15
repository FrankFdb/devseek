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
  buildExternalAuthorityRequests,
  renderExternalAuthorityRequestsMarkdown,
  validateExternalAuthorityRequests,
} from './lib/devseek-external-authority-requests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  gate0Decision: processPath('docs/process/devseek-gate0-decision-report.json'),
  externalAuthorityAdapter: processPath('docs/process/devseek-external-authority-adapter.json'),
  c0WiringReconciliation: processPath('docs/process/devseek-c0-wiring-reconciliation.json'),
  packageJson: processPath('package.json'),
  phaseSource: processPath('scripts/devseek-phase0-12-verify.mjs'),
  checkerSource: processPath('scripts/devseek-external-authority-requests-check.mjs'),
  oracleSource: processPath('scripts/test/devseek-external-authority-requests.test.mjs'),
  registry: processPath('docs/process/devseek-external-authority-requests.json'),
  schema: processPath('docs/process/devseek-external-authority-requests.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-external-authority-requests.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    gate0Decision: readJson(paths.gate0Decision),
    externalAuthorityAdapter: readJson(paths.externalAuthorityAdapter),
    c0WiringReconciliation: readJson(paths.c0WiringReconciliation),
    packageJson: readJson(paths.packageJson),
    phaseSource: readText(paths.phaseSource),
    sourceContents: {
      'package.json': readText(paths.packageJson),
      'scripts/devseek-external-authority-requests-check.mjs': readText(paths.checkerSource),
      'scripts/test/devseek-external-authority-requests.test.mjs': readText(paths.oracleSource),
    },
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildExternalAuthorityRequests(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderExternalAuthorityRequestsMarkdown(registry));
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
  validationResult = validateExternalAuthorityRequests(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderExternalAuthorityRequestsMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  request_set_sha256: registry?.request_set_sha256 ?? null,
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
