#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from './lib/devseek-active-baseline-selector.mjs';
import {
  legacyDocInventoryHash,
  renderLegacyDocInventoryMarkdown,
  validateLegacyDocInventory,
} from './lib/devseek-legacy-doc-inventory.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  inventory: processPath('docs/process/devseek-legacy-doc-inventory.json'),
  schema: processPath('docs/process/devseek-legacy-doc-inventory.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-legacy-doc-inventory.md'),
};

const errors = unsupported.map(argument => `argument:unsupported-${argument}`);
let inventory;
try {
  inventory = readJson(paths.inventory);
} catch (error) {
  errors.push(`inventory:read:${error.message}`);
}

if (write && inventory && errors.length === 0) {
  const expectedInventory = structuredClone(inventory);
  expectedInventory.inventory_sha256 = legacyDocInventoryHash(expectedInventory);
  fs.writeFileSync(paths.inventory, `${JSON.stringify(expectedInventory, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(paths.generatedView), { recursive: true });
  fs.writeFileSync(paths.generatedView, renderLegacyDocInventoryMarkdown(expectedInventory, repoRoot), 'utf8');
  inventory = expectedInventory;
}

let validate;
try {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  validate = ajv.compile(readJson(paths.schema));
} catch (error) {
  errors.push(`schema:compile:${error.message}`);
}

if (inventory && validate && !validate(inventory)) {
  errors.push(...validate.errors.map(error => (
    `inventory:schema:${error.instancePath || '/'}:${error.keyword}:${error.message}`
  )));
}

let validationResult;
if (inventory) {
  validationResult = validateLegacyDocInventory(inventory, repoRoot);
  errors.push(...validationResult.errors.map(error => `inventory:invariant:${error}`));
}
if (inventory) {
  const expectedView = renderLegacyDocInventoryMarkdown(inventory, repoRoot);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push(`generated:missing-${path.relative(repoRoot, paths.generatedView)}`);
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push(`generated:stale-${path.relative(repoRoot, paths.generatedView)}`);
  }
}

const result = {
  ok: errors.length === 0,
  inventory_id: inventory?.inventory_id ?? null,
  asserts_gate_pass: inventory?.asserts_gate_pass ?? null,
  expected_inventory_count: validationResult?.summary?.expected_inventory_count ?? null,
  inventoried_document_count: validationResult?.summary?.inventoried_document_count ?? null,
  missing_coverage_count: validationResult?.summary?.missing_coverage_count ?? null,
  unexpected_coverage_count: validationResult?.summary?.unexpected_coverage_count ?? null,
  unresolved_count: validationResult?.summary?.unresolved_count ?? null,
  inventory_sha256: validationResult?.summary?.inventory_sha256 ?? null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function processPath(relativePath) {
  return path.join(repoRoot, relativePath);
}
