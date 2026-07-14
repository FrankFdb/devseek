#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  activeBaselineSelectorHash,
  readJson,
  renderActiveBaselineSelectorMarkdown,
  validateActiveBaselineSelector,
} from './lib/devseek-active-baseline-selector.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  selector: processPath('docs/process/devseek-active-baseline-selector.json'),
  schema: processPath('docs/process/devseek-active-baseline-selector.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-active-baseline-selector.md'),
};

const errors = unsupported.map(argument => `argument:unsupported-${argument}`);
let selector;
try {
  selector = readJson(paths.selector);
} catch (error) {
  errors.push(`selector:read:${error.message}`);
}

if (write && selector && errors.length === 0) {
  const expectedSelector = structuredClone(selector);
  expectedSelector.selector_sha256 = activeBaselineSelectorHash(expectedSelector);
  fs.writeFileSync(paths.selector, `${JSON.stringify(expectedSelector, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(paths.generatedView), { recursive: true });
  fs.writeFileSync(paths.generatedView, renderActiveBaselineSelectorMarkdown(expectedSelector), 'utf8');
  selector = expectedSelector;
}

let validate;
try {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  validate = ajv.compile(readJson(paths.schema));
} catch (error) {
  errors.push(`schema:compile:${error.message}`);
}

if (selector && validate && !validate(selector)) {
  errors.push(...validate.errors.map(error => (
    `selector:schema:${error.instancePath || '/'}:${error.keyword}:${error.message}`
  )));
}
let validationResult;
if (selector) {
  validationResult = validateActiveBaselineSelector(selector, repoRoot);
  errors.push(...validationResult.errors.map(error => `selector:invariant:${error}`));
}
if (selector) {
  const expectedView = renderActiveBaselineSelectorMarkdown(selector);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push(`generated:missing-${path.relative(repoRoot, paths.generatedView)}`);
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push(`generated:stale-${path.relative(repoRoot, paths.generatedView)}`);
  }
}

const result = {
  ok: errors.length === 0,
  selector_id: selector?.selector_id ?? null,
  asserts_gate_pass: selector?.asserts_gate_pass ?? null,
  active_baselines: validationResult?.summary?.active_baselines ?? null,
  selector_sha256: validationResult?.summary?.selector_sha256 ?? null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function processPath(relativePath) {
  return path.join(repoRoot, relativePath);
}
