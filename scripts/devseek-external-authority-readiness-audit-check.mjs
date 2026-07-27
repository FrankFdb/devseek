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
  EXTERNAL_AUTHORITY_READINESS_AUDIT_PATH,
  EXTERNAL_AUTHORITY_READINESS_AUDIT_VIEW_PATH,
  buildExternalAuthorityReadinessAudit,
  loadExternalAuthorityReadinessAuditSources,
  renderExternalAuthorityReadinessAuditMarkdown,
  validateExternalAuthorityReadinessAudit,
} from './lib/devseek-external-authority-readiness-audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  audit: processPath(EXTERNAL_AUTHORITY_READINESS_AUDIT_PATH),
  schema: processPath('docs/process/devseek-external-authority-readiness-audit.schema.json'),
  generatedView: processPath(EXTERNAL_AUTHORITY_READINESS_AUDIT_VIEW_PATH),
};

const errors = unknownArguments.map(argument => `argument:unsupported-${argument}`);
let sources = null;
let audit = null;

try {
  sources = loadExternalAuthorityReadinessAuditSources(repoRoot);
} catch (error) {
  errors.push(`source:read:${error.message}`);
}

if (sources && write && errors.length === 0) {
  try {
    audit = buildExternalAuthorityReadinessAudit({ repoRoot, sources });
    writeJson(paths.audit, audit);
    writeFile(paths.generatedView, renderExternalAuthorityReadinessAuditMarkdown(audit));
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

try {
  audit ??= readJson(paths.audit);
} catch (error) {
  errors.push(`audit:read:${error.message}`);
}

if (audit) {
  errors.push(...validateSchema(audit));
}

let validationResult = null;
if (audit && sources) {
  validationResult = validateExternalAuthorityReadinessAudit(audit, { repoRoot, sources });
  errors.push(...validationResult.errors);
}

if (audit) {
  const expectedView = renderExternalAuthorityReadinessAuditMarkdown(audit);
  if (!fs.existsSync(paths.generatedView)) {
    errors.push('generated-view:missing');
  } else if (fs.readFileSync(paths.generatedView, 'utf8') !== expectedView) {
    errors.push('generated-view:stale');
  }
}

const result = {
  ok: errors.length === 0,
  summary: validationResult?.summary ?? null,
  audit_sha256: audit?.audit_sha256 ?? null,
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
