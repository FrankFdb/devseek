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
  buildR4IterationStatusRollup,
  renderR4IterationStatusRollupMarkdown,
  validateR4IterationStatusRollup,
} from './lib/devseek-r4-iteration-status-rollup.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  registry: processPath('docs/process/devseek-r4-iteration-status-rollup.json'),
  schema: processPath('docs/process/devseek-r4-iteration-status-rollup.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-r4-iteration-status-rollup.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let registry = null;

if (write && errors.length === 0) {
  try {
    registry = buildR4IterationStatusRollup({ repoRoot });
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderR4IterationStatusRollupMarkdown(registry));
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
  validationResult = validateR4IterationStatusRollup(registry, { repoRoot });
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderR4IterationStatusRollupMarkdown(registry);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  rollup_sha256: registry?.rollup_sha256 ?? null,
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
