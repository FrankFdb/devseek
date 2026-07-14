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
  buildProfileExecutorContracts,
  renderProfileExecutorContractsMarkdown,
  validateProfileExecutorContracts,
} from './lib/devseek-profile-executor-contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  denominatorRegistry: processPath('docs/process/devseek-profile-denominator-registry.json'),
  runnerInventory: processPath('docs/process/devseek-qualification-runner-inventory.json'),
  registry: processPath('docs/process/devseek-profile-executor-contracts.json'),
  schema: processPath('docs/process/devseek-profile-executor-contracts.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-profile-executor-contracts.md'),
  runnerSource: processPath('scripts/lib/devseek-qualification-runner.mjs'),
  oracleSource: processPath('scripts/test/devseek-profile-executor-contracts.test.mjs'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    denominatorRegistry: readJson(paths.denominatorRegistry),
    runnerInventory: readJson(paths.runnerInventory),
    sourceContents: {
      'scripts/lib/devseek-qualification-runner.mjs': fs.readFileSync(paths.runnerSource, 'utf8'),
      'scripts/test/devseek-profile-executor-contracts.test.mjs': fs.readFileSync(paths.oracleSource, 'utf8'),
    },
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildProfileExecutorContracts(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderProfileExecutorContractsMarkdown(registry));
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
  validationResult = validateProfileExecutorContracts(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderProfileExecutorContractsMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  contract_registry_sha256: registry?.contract_registry_sha256 ?? null,
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

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
