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
  buildR4RealProviderFailureTaxonomy,
  renderR4RealProviderFailureTaxonomyMarkdown,
  validateR4RealProviderFailureTaxonomy,
} from '../lib/devseek-r4-real-provider-failure-taxonomy.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4RealProviderFailureTaxonomy({ repoRoot });

test('R4 real provider failure taxonomy requires evidence analysis before rerun for every category', () => {
  const actual = readJson('docs/process/devseek-r4-real-provider-failure-taxonomy.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    categories: 10,
    required_evidence_items: 6,
    categories_allowing_rerun_without_analysis: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.rerun_policy.repeat_same_red_loop_allowed_without_analysis, false);
  assert.equal(actual.rerun_policy.generated_artifact_quality_required, true);
  assert.equal(actual.categories.some(category => category.category_id === 'SAFETY_INTERSTITIAL_OR_TOOL_BLOCK'), true);
  assert.equal(actual.categories.some(category => category.category_id === 'RESPONSE_CORRUPTED_OR_TRUNCATED'), true);
  assert.equal(actual.categories.every(category => category.rerun_allowed_without_analysis === false), true);
  assert.equal(actual.categories.every(category => category.required_evidence_before_rerun.includes('generated-artifact-quality')), true);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4RealProviderFailureTaxonomy(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 failure taxonomy view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-real-provider-failure-taxonomy.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-real-provider-failure-taxonomy.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4RealProviderFailureTaxonomyMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 重跑策略/u);
  assert.match(actualView, /## 必读证据/u);
  assert.match(actualView, /## 分类表/u);
});

test('schema rejects claim promotion, rerun bypass, and missing safety category evidence', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const rerunBypass = structuredClone(expected);
  rerunBypass.rerun_policy.repeat_same_red_loop_allowed_without_analysis = true;
  assert.equal(validate(rerunBypass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/rerun_policy/repeat_same_red_loop_allowed_without_analysis'));

  const categoryBypass = structuredClone(expected);
  categoryBypass.categories[0].rerun_allowed_without_analysis = true;
  assert.equal(validate(categoryBypass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/categories/0/rerun_allowed_without_analysis'));
});

test('runtime validation fails closed when required evidence or protected categories drift', () => {
  const missingEvidence = structuredClone(expected);
  missingEvidence.categories[0].required_evidence_before_rerun = missingEvidence.categories[0].required_evidence_before_rerun.filter(item => item !== 'report.json');
  missingEvidence.taxonomy_sha256 = '0'.repeat(64);
  assertHasTaxonomyError(
    missingEvidence,
    'categories.LOGIN_SESSION_STATE_AMBIGUOUS.required_evidence_before_rerun:missing-report.json',
  );

  const missingSafety = structuredClone(expected);
  missingSafety.categories = missingSafety.categories.filter(category => category.category_id !== 'SAFETY_INTERSTITIAL_OR_TOOL_BLOCK');
  missingSafety.taxonomy_sha256 = '0'.repeat(64);
  assertHasTaxonomyError(missingSafety, 'categories:missing-SAFETY_INTERSTITIAL_OR_TOOL_BLOCK');

  const claims = structuredClone(expected);
  claims.counts.qualification_claims = 1;
  claims.taxonomy_sha256 = '0'.repeat(64);
  assertHasTaxonomyError(claims, 'counts.qualification_claims:must-be-0');
});

test('checker command validates R4 real provider failure taxonomy and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-real-provider-failure-taxonomy-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    taxonomy_sha256: expected.taxonomy_sha256,
    categories: 10,
    required_evidence_items: 6,
    categories_allowing_rerun_without_analysis: 0,
    repeat_same_red_loop_allowed_without_analysis: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasTaxonomyError(value, expectedError) {
  const result = validateR4RealProviderFailureTaxonomy(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-real-provider-failure-taxonomy.schema.json'));
}
