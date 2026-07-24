import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  canonicalJson,
  readJson,
} from '../lib/devseek-capability-ledger.mjs';
import {
  buildR4LiveUserWayHoldoutMatrix,
  renderR4LiveUserWayHoldoutMatrixMarkdown,
  validateR4LiveUserWayHoldoutMatrix,
} from '../lib/devseek-r4-live-user-way-holdout-matrix.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4LiveUserWayHoldoutMatrix({ repoRoot });

test('R4 user-way holdout matrix preserves scenario language and blocks live execution until authorized', () => {
  const actual = readJson('docs/process/devseek-r4-live-user-way-holdout-matrix.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    cases: 5,
    locales: 2,
    blocked_cases: 5,
    live_runs_authorized: 0,
    product_fixed_language_cases: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.matrix_policy.execution_mode, 'headed');
  assert.equal(actual.matrix_policy.keep_window, true);
  assert.equal(actual.matrix_policy.keep_deepseek_page, true);
  assert.equal(actual.matrix_policy.scenario_language_source, 'scenario-contract');
  assert.equal(actual.matrix_policy.product_fixed_language_allowed, false);
  assert.equal(actual.cases.some(entry => entry.locale === 'zh-CN' && entry.expected_artifact_language === 'zh-CN'), true);
  assert.equal(actual.cases.some(entry => entry.locale === 'en-US' && entry.expected_artifact_language === 'en-US'), true);
  assert.equal(actual.cases.every(entry => entry.product_fixed_language_allowed === false), true);
  assert.equal(actual.cases.every(entry => entry.terminal_state === 'BLOCKED_NOT_AUTHORIZED'), true);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4LiveUserWayHoldoutMatrix(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 holdout matrix view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-live-user-way-holdout-matrix.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-live-user-way-holdout-matrix.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4LiveUserWayHoldoutMatrixMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 执行策略/u);
  assert.match(actualView, /## Holdout Cases/u);
  assert.match(actualView, /## Failure Analysis Before Rerun/u);
});

test('schema rejects claim promotion, live authorization, and fixed product language', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const authorized = structuredClone(expected);
  authorized.matrix_policy.live_runs_authorized = 1;
  assert.equal(validate(authorized), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/matrix_policy/live_runs_authorized'));

  const fixedLanguage = structuredClone(expected);
  fixedLanguage.cases[0].product_fixed_language_allowed = true;
  assert.equal(validate(fixedLanguage), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/cases/0/product_fixed_language_allowed'));
});

test('runtime validation fails closed when language source or rerun analysis policy drifts', () => {
  const productDefault = structuredClone(expected);
  productDefault.matrix_policy.scenario_language_source = 'product-default';
  productDefault.matrix_sha256 = '0'.repeat(64);
  assertHasMatrixError(productDefault, 'matrix_policy.scenario_language_source:must-be-scenario-contract');

  const repeatWithoutAnalysis = structuredClone(expected);
  repeatWithoutAnalysis.matrix_policy.repeat_red_loop_without_analysis_allowed = true;
  repeatWithoutAnalysis.matrix_sha256 = '0'.repeat(64);
  assertHasMatrixError(
    repeatWithoutAnalysis,
    'matrix_policy.repeat_red_loop_without_analysis_allowed:must-be-false',
  );

  const unblockedCase = structuredClone(expected);
  unblockedCase.cases[0].terminal_state = 'READY';
  unblockedCase.matrix_sha256 = '0'.repeat(64);
  assertHasMatrixError(
    unblockedCase,
    'cases.R4-HOLDOUT-ZH-DEEPSEEK-LOGIN-READY-AUDIT.terminal_state:must-be-BLOCKED_NOT_AUTHORIZED',
  );
});

test('checker command validates R4 holdout matrix and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-live-user-way-holdout-matrix-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    matrix_sha256: expected.matrix_sha256,
    cases: 5,
    locales: 2,
    blocked_cases: 5,
    live_runs_authorized: 0,
    product_fixed_language_cases: 0,
    scenario_language_source: 'scenario-contract',
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasMatrixError(value, expectedError) {
  const result = validateR4LiveUserWayHoldoutMatrix(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-live-user-way-holdout-matrix.schema.json'));
}
