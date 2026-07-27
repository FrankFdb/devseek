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
  POST_R4_COMPACT_INDEX_PATH,
  POST_R4_COMPACT_INDEX_VIEW_PATH,
  buildPostR4CompactIndex,
  loadPostR4CompactIndexSources,
  renderPostR4CompactIndexMarkdown,
  validatePostR4CompactIndex,
} from './lib/devseek-post-r4-compact-index.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  index: processPath(POST_R4_COMPACT_INDEX_PATH),
  schema: processPath('docs/process/devseek-post-r4-compact-index.schema.json'),
  generatedView: processPath(POST_R4_COMPACT_INDEX_VIEW_PATH),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let index = null;

try {
  sources = loadPostR4CompactIndexSources(repoRoot);
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    index = buildPostR4CompactIndex({ repoRoot, sources });
    writeJson(paths.index, index);
    writeFile(paths.generatedView, renderPostR4CompactIndexMarkdown(index));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  index ??= readJson(paths.index);
} catch (error) {
  errors.push(`index:read:${error.message}`);
}

if (index) {
  errors.push(...validateSchema(index));
}

let validationResult = null;
if (index && sources) {
  validationResult = validatePostR4CompactIndex(index, { repoRoot, sources });
  errors.push(...validationResult.errors);
}

if (index) {
  const expectedView = renderPostR4CompactIndexMarkdown(index);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  index_sha256: index?.index_sha256 ?? null,
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
