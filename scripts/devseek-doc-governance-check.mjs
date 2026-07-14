#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_GOVERNANCE_GENERATOR_VERSION,
  validateDocGovernance,
  writeDocGovernance,
} from './lib/devseek-doc-governance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const errors = unsupported.map(argument => `argument:unsupported-${argument}`);

if (write && errors.length === 0) {
  try {
    writeDocGovernance(repoRoot);
  } catch (error) {
    errors.push(`write:${error.message}`);
  }
}

let validationResult = null;
try {
  validationResult = validateDocGovernance(repoRoot);
  errors.push(...validationResult.errors);
} catch (error) {
  errors.push(`validate:${error.message}`);
}

const result = {
  ok: errors.length === 0,
  generator: DOC_GOVERNANCE_GENERATOR_VERSION,
  summary: validationResult?.summary ?? null,
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
