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
  buildC0PreregistrationWiring,
  collectInventorySources,
  renderC0PreregistrationWiringMarkdown,
  validateC0PreregistrationWiring,
} from './lib/devseek-c0-preregistration-wiring.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  runnerInventory: processPath('docs/process/devseek-qualification-runner-inventory.json'),
  executorContracts: processPath('docs/process/devseek-profile-executor-contracts.json'),
  registry: processPath('docs/process/devseek-c0-preregistration-wiring.json'),
  schema: processPath('docs/process/devseek-c0-preregistration-wiring.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-c0-preregistration-wiring.md'),
  packageSource: processPath('package.json'),
  phaseSource: processPath('scripts/devseek-phase0-12-verify.mjs'),
  qualificationPlanSchema: processPath('docs/process/devseek-qualification-plan.schema.json'),
  qualificationEventSchema: processPath('docs/process/devseek-qualification-event.schema.json'),
  qualificationReceiptSchema: processPath('docs/process/devseek-qualification-receipt.schema.json'),
  qualificationProtocolSource: processPath('scripts/lib/devseek-qualification-protocol.mjs'),
  qualificationRunnerSource: processPath('scripts/lib/devseek-qualification-runner.mjs'),
  qualificationRunnerTest: processPath('scripts/test/devseek-qualification-runner.test.mjs'),
  qualificationProtocolTest: processPath('scripts/test/devseek-qualification-protocol.test.mjs'),
  checkerSource: processPath('scripts/devseek-c0-preregistration-wiring-check.mjs'),
  oracleSource: processPath('scripts/test/devseek-c0-preregistration-wiring.test.mjs'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  const runnerInventory = readJson(paths.runnerInventory);
  sources = {
    repoRoot,
    ledger: readJson(paths.ledger),
    runnerInventory,
    executorContracts: readJson(paths.executorContracts),
    packageJson: readJson(paths.packageSource),
    sourceContents: {
      ...collectInventorySources(repoRoot, runnerInventory),
      'package.json': readText(paths.packageSource),
      'scripts/devseek-phase0-12-verify.mjs': readText(paths.phaseSource),
      'docs/process/devseek-qualification-plan.schema.json': readText(paths.qualificationPlanSchema),
      'docs/process/devseek-qualification-event.schema.json': readText(paths.qualificationEventSchema),
      'docs/process/devseek-qualification-receipt.schema.json': readText(paths.qualificationReceiptSchema),
      'scripts/lib/devseek-qualification-protocol.mjs': readText(paths.qualificationProtocolSource),
      'scripts/lib/devseek-qualification-runner.mjs': readText(paths.qualificationRunnerSource),
      'scripts/test/devseek-qualification-runner.test.mjs': readText(paths.qualificationRunnerTest),
      'scripts/test/devseek-qualification-protocol.test.mjs': readText(paths.qualificationProtocolTest),
      'scripts/devseek-c0-preregistration-wiring-check.mjs': readText(paths.checkerSource),
      'scripts/test/devseek-c0-preregistration-wiring.test.mjs': readText(paths.oracleSource),
    },
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildC0PreregistrationWiring(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderC0PreregistrationWiringMarkdown(registry));
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
  validationResult = validateC0PreregistrationWiring(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderC0PreregistrationWiringMarkdown(registry);
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
