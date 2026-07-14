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
  buildProfileDenominatorRegistry,
  renderProfileDenominatorRegistryMarkdown,
  validateProfileDenominatorRegistry,
} from './lib/devseek-profile-denominator-registry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  milestoneProfiles: processPath('docs/process/devseek-milestone-profiles.json'),
  registry: processPath('docs/process/devseek-profile-denominator-registry.json'),
  schema: processPath('docs/process/devseek-profile-denominator-registry.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-profile-denominator-registry.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    ledger: readJson(paths.ledger),
    milestoneProfiles: readJson(paths.milestoneProfiles),
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildProfileDenominatorRegistry(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderProfileDenominatorRegistryMarkdown(registry));
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
  const schemaErrors = validateSchema(registry);
  errors.push(...schemaErrors);
}

let validationResult = null;
if (registry && sources) {
  validationResult = validateProfileDenominatorRegistry(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderProfileDenominatorRegistryMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  registry_sha256: registry?.registry_sha256 ?? null,
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
