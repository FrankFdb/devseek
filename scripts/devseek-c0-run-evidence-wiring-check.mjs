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
  buildC0RunEvidenceWiring,
  renderC0RunEvidenceWiringMarkdown,
  validateC0RunEvidenceWiring,
} from './lib/devseek-c0-run-evidence-wiring.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  registry: processPath('docs/process/devseek-c0-run-evidence-wiring.json'),
  schema: processPath('docs/process/devseek-c0-run-evidence-wiring.schema.json'),
  generatedView: processPath('docs/process/generated/devseek-c0-run-evidence-wiring.md'),
};
const sourcePaths = [
  'docs/process/devseek-qualification-evidence-manifest.schema.json',
  'docs/process/devseek-run-evidence-event.schema.json',
  'docs/process/devseek-run-evidence-snapshot.schema.json',
  'docs/process/devseek-run-evidence-expected-anchor.schema.json',
  'docs/process/devseek-run-evidence-correlation.schema.json',
  'scripts/lib/devseek-qualification-evidence-manifest.mjs',
  'scripts/test/devseek-qualification-evidence-manifest.test.mjs',
  'scripts/devseek-run-evidence-contract-check.mjs',
  'scripts/test/devseek-run-evidence-contract.test.mjs',
  'package.json',
  'scripts/devseek-phase0-12-verify.mjs',
  'scripts/devseek-c0-run-evidence-wiring-check.mjs',
  'scripts/test/devseek-c0-run-evidence-wiring.test.mjs',
];

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let registry = null;

try {
  sources = {
    ledger: readJson(paths.ledger),
    packageJson: readJson(processPath('package.json')),
    sourceContents: Object.fromEntries(sourcePaths.map(relativePath => [
      relativePath,
      readText(processPath(relativePath)),
    ])),
  };
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    registry = buildC0RunEvidenceWiring(sources);
    writeJson(paths.registry, registry);
    writeFile(paths.generatedView, renderC0RunEvidenceWiringMarkdown(registry));
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
  validationResult = validateC0RunEvidenceWiring(registry, sources);
  errors.push(...validationResult.errors);
}

if (registry) {
  const expectedView = renderC0RunEvidenceWiringMarkdown(registry);
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
