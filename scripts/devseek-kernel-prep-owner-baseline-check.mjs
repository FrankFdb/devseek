#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from './lib/devseek-capability-ledger.mjs';
import {
  buildKernelPrepOwnerBaseline,
  collectKernelPrepOwnerBaselineSources,
  renderKernelPrepOwnerBaselineMarkdown,
  validateKernelPrepOwnerBaseline,
} from './lib/devseek-kernel-prep-owner-baseline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  baseline: processPath('docs/process/devseek-kernel-prep-owner-baseline.json'),
  schema: processPath('docs/process/devseek-kernel-prep-owner-baseline.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-kernel-prep-owner-baseline.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let baseline = null;

try {
  sources = collectKernelPrepOwnerBaselineSources(
    relativePath => fs.readFileSync(processPath(relativePath), 'utf8'),
    relativePath => readJson(processPath(relativePath)),
  );
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    baseline = buildKernelPrepOwnerBaseline(sources);
    writeJson(paths.baseline, baseline);
    writeFile(paths.generatedView, renderKernelPrepOwnerBaselineMarkdown(baseline));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  baseline ??= readJson(paths.baseline);
} catch (error) {
  errors.push(`baseline:read:${error.message}`);
}

if (baseline) errors.push(...validateSchema(baseline));

let validationResult = null;
if (baseline && sources) {
  validationResult = validateKernelPrepOwnerBaseline(baseline, sources);
  errors.push(...validationResult.errors);
}

if (baseline) {
  const expectedView = renderKernelPrepOwnerBaselineMarkdown(baseline);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  baseline_sha256: baseline?.baseline_sha256 ?? null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function validateSchema(value) {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(readJson(paths.schema));
    if (validate(value)) return [];
    return (validate.errors ?? []).map(error => `schema:${error.instancePath || '/'}:${error.message}`);
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
