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
  buildC0LedgerWiring,
  collectProcessFiles,
  renderC0LedgerWiringMarkdown,
  validateC0LedgerWiring,
} from './lib/devseek-c0-ledger-wiring.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  packageJson: processPath('package.json'),
  registry: processPath('docs/process/devseek-c0-ledger-wiring.json'),
  schema: processPath('docs/process/devseek-c0-ledger-wiring.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-c0-ledger-wiring.md'),
  packageSource: processPath('package.json'),
  phaseSource: processPath('scripts/devseek-phase0-12-verify.mjs'),
  capabilityLedgerChecker: processPath('scripts/devseek-capability-ledger-check.mjs'),
  c0WiringChecker: processPath('scripts/devseek-c0-ledger-wiring-check.mjs'),
  c0RunEvidenceWiringChecker: processPath('scripts/devseek-c0-run-evidence-wiring-check.mjs'),
  c0ManifestAggregatorWiringChecker: processPath('scripts/devseek-c0-manifest-aggregator-wiring-check.mjs'),
  externalAuthorityAdapterChecker: processPath('scripts/devseek-external-authority-adapter-check.mjs'),
  profileDenominatorChecker: processPath('scripts/devseek-profile-denominator-registry-check.mjs'),
  gate0DecisionChecker: processPath('scripts/devseek-gate0-decision-check.mjs'),
  oracleSource: processPath('scripts/test/devseek-c0-ledger-wiring.test.mjs'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    repoRoot,
    ledger: readJson(paths.ledger),
    packageJson: readJson(paths.packageJson),
    processFiles: collectProcessFiles(repoRoot),
    sourceContents: {
      'package.json': readText(paths.packageSource),
      'scripts/devseek-phase0-12-verify.mjs': readText(paths.phaseSource),
      'scripts/devseek-capability-ledger-check.mjs': readText(paths.capabilityLedgerChecker),
      'scripts/devseek-c0-ledger-wiring-check.mjs': readText(paths.c0WiringChecker),
      'scripts/devseek-c0-run-evidence-wiring-check.mjs': readText(paths.c0RunEvidenceWiringChecker),
      'scripts/devseek-c0-manifest-aggregator-wiring-check.mjs': readText(paths.c0ManifestAggregatorWiringChecker),
      'scripts/devseek-external-authority-adapter-check.mjs': readText(paths.externalAuthorityAdapterChecker),
      'scripts/devseek-profile-denominator-registry-check.mjs': readText(paths.profileDenominatorChecker),
      'scripts/devseek-gate0-decision-check.mjs': readText(paths.gate0DecisionChecker),
      'scripts/test/devseek-c0-ledger-wiring.test.mjs': readText(paths.oracleSource),
    },
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildC0LedgerWiring(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderC0LedgerWiringMarkdown(registry));
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
  validationResult = validateC0LedgerWiring(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderC0LedgerWiringMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  wiring_sha256: registry?.wiring_sha256 ?? null,
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
