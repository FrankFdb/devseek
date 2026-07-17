#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from './lib/devseek-capability-ledger.mjs';
import {
  buildSurfaceEntryInventory,
  collectSurfaceEntryInventorySources,
  renderSurfaceEntryInventoryMarkdown,
  validateSurfaceEntryInventory,
} from './lib/devseek-surface-entry-inventory.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  inventory: processPath('docs/process/devseek-surface-entry-inventory.json'),
  schema: processPath('docs/process/devseek-surface-entry-inventory.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-surface-entry-inventory.md'),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let inventory = null;

try {
  sources = collectSurfaceEntryInventorySources(
    repoRoot,
    relativePath => readText(processPath(relativePath)),
    relativePath => readJson(processPath(relativePath)),
  );
  sources.rootPackageJson = readJson(processPath('package.json'));
  sources.sourceContents['package.json'] = readText(processPath('package.json'));
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    inventory = buildSurfaceEntryInventory(sources);
    writeJson(paths.inventory, inventory);
    writeFile(paths.generatedView, renderSurfaceEntryInventoryMarkdown(inventory));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  inventory ??= readJson(paths.inventory);
} catch (error) {
  errors.push(`inventory:read:${error.message}`);
}

if (inventory) {
  errors.push(...validateSchema(inventory));
}

let validationResult = null;
if (inventory && sources) {
  validationResult = validateSurfaceEntryInventory(inventory, sources);
  errors.push(...validationResult.errors);
}

if (inventory) {
  const expectedView = renderSurfaceEntryInventoryMarkdown(inventory);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  inventory_sha256: inventory?.inventory_sha256 ?? null,
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
