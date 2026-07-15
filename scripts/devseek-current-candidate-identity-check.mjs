#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  readJson,
} from './lib/devseek-capability-ledger.mjs';
import {
  buildCurrentCandidateIdentity,
  renderCurrentCandidateIdentityMarkdown,
  validateCurrentCandidateIdentity,
  validateLiveRuntimeProcesses,
} from './lib/devseek-current-candidate-identity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  registry: processPath('docs/process/devseek-current-candidate-identity.json'),
  schema: processPath('docs/process/devseek-current-candidate-identity.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-current-candidate-identity.md'),
};

const buildOptions = {
  repoRoot,
  homeDir: os.homedir(),
};
const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let registry = null;

if (write && errors.length === 0) {
  try {
    registry = buildCurrentCandidateIdentity(buildOptions);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderCurrentCandidateIdentityMarkdown(registry));
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
if (registry) {
  validationResult = validateCurrentCandidateIdentity(registry, buildOptions);
  errors.push(...validationResult.errors);
}

let liveRuntimeResult = null;
if (registry) {
  liveRuntimeResult = validateLiveRuntimeProcesses(registry);
  errors.push(...liveRuntimeResult.errors);
}

if (registry) {
  const expectedView = renderCurrentCandidateIdentityMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  live_runtime_summary: liveRuntimeResult?.summary ?? null,
  identity_probe_sha256: registry?.identity_probe_sha256 ?? null,
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
