#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  canonicalJson,
  readJson,
} from './lib/devseek-capability-ledger.mjs';
import {
  buildGate0Decision,
  validateGate0DecisionInvariants,
} from './lib/devseek-gate0-decision.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const unsupported = process.argv.slice(2).filter(argument => argument !== '--write');
const paths = {
  ledger: processPath('docs/process/devseek-capability-ledger.json'),
  milestoneProfiles: processPath('docs/process/devseek-milestone-profiles.json'),
  qualificationProfiles: processPath('docs/process/devseek-qualification-profiles.json'),
  aggregatorPolicy: processPath('docs/process/devseek-qualification-aggregator-policy.json'),
  schema: processPath('docs/process/devseek-gate0-decision.schema.json'),
  report: processPath('docs/process/devseek-gate0-decision-report.json'),
};

const errors = unsupported.map(argument => `argument:unsupported-${argument}`);
let expected;
try {
  expected = buildGate0Decision({
    ledger: readJson(paths.ledger),
    milestoneProfiles: readJson(paths.milestoneProfiles),
    qualificationProfiles: readJson(paths.qualificationProfiles),
    aggregatorPolicy: readJson(paths.aggregatorPolicy),
  });
} catch (error) {
  errors.push(`decision:build:${error.code ?? error.message}`);
}

if (write && expected && errors.length === 0) {
  fs.writeFileSync(paths.report, `${JSON.stringify(expected, null, 2)}\n`, 'utf8');
}

let actual;
let validate;
try {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  validate = ajv.compile(readJson(paths.schema));
} catch (error) {
  errors.push(`schema:compile:${error.message}`);
}
try {
  actual = readJson(paths.report);
} catch (error) {
  errors.push(`report:read:${error.message}`);
}

if (actual && validate && !validate(actual)) {
  errors.push(...validate.errors.map(error => (
    `report:schema:${error.instancePath || '/'}:${error.keyword}:${error.message}`
  )));
}
if (actual) {
  try {
    errors.push(...validateGate0DecisionInvariants(actual).map(error => `report:invariant:${error}`));
  } catch (error) {
    errors.push(`report:invariant:exception:${error.message}`);
  }
}
if (actual && expected && canonicalJson(actual) !== canonicalJson(expected)) {
  errors.push('report:source-binding-drift:run-npm-run-generate:gate0-decision');
}

const result = {
  ok: errors.length === 0,
  checker_contract_passed: errors.length === 0,
  gate0_status: actual?.qualification?.status ?? null,
  gate0_passed: actual?.qualification?.gate_passed ?? false,
  qualification_eligible: actual?.qualification?.qualification_eligible ?? false,
  external_authority_trust_anchored:
    actual?.qualification?.external_authority_trust_anchored ?? false,
  local_conformance: actual?.local_conformance?.status ?? null,
  claims: actual?.claims?.length ?? null,
  repository_pending_blockers: actual?.blockers?.repository_pending?.length ?? null,
  external_authority_blockers: actual?.blockers?.external_authority?.length ?? null,
  checker_pass_meaning: 'schema, source binding, deterministic decision, and invariants only; never Gate 0 qualification',
  errors,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

function processPath(relativePath) {
  return path.join(repoRoot, relativePath);
}
