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
  buildR4ExistingLiveFailureTaxonomyMapping,
  renderR4ExistingLiveFailureTaxonomyMappingMarkdown,
  validateR4ExistingLiveFailureTaxonomyMapping,
} from '../lib/devseek-r4-existing-live-failure-taxonomy-mapping.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ExistingLiveFailureTaxonomyMapping({ repoRoot });

test('R4 existing live failure mapping consumes only existing evidence and blocks rerun without analysis', () => {
  const actual = readJson('docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    failures: 4,
    report_json_failures: 2,
    archive_doc_failures: 1,
    conversation_fact_failures: 1,
    failures_with_complete_required_evidence: 0,
    blocked_needs_evidence: 4,
    rerun_allowed_without_analysis: 0,
    live_runs_executed: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.mapping_policy.only_existing_evidence_consumed, true);
  assert.equal(actual.mapping_policy.live_runs_executed, 0);
  assert.equal(actual.mapping_policy.provider_actions_performed, false);
  assert.equal(actual.mapping_policy.screenshot_or_chat_alone_complete_evidence_allowed, false);
  assert.equal(actual.failures.every(failure => failure.terminal_state === 'BLOCKED_NEEDS_EVIDENCE'), true);
  assert.equal(actual.failures.every(failure => failure.rerun_allowed_without_analysis === false), true);
  assert.equal(actual.failures.every(failure => failure.complete_required_evidence === false), true);
  assert.equal(actual.failures.every(failure => failure.missing_required_evidence.length > 0), true);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4ExistingLiveFailureTaxonomyMapping(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('R4 existing live failure mapping separates report evidence from screenshot-only facts', () => {
  const actual = readJson('docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.json');
  const reportFailures = actual.failures.filter(failure => failure.source_type === 'report-json');
  const screenshotFailure = actual.failures.find(failure => failure.source_type === 'conversation-fact-summary');

  assert.equal(reportFailures.length, 2);
  assert.equal(reportFailures.every(failure => failure.present_required_evidence.includes('report.json')), true);
  assert.equal(reportFailures.every(failure => failure.present_required_evidence.includes('provider-classification')), true);
  assert.equal(reportFailures.every(failure => failure.report_facts.provider_classification === 'login_required'), true);
  assert.ok(screenshotFailure);
  assert.deepEqual(screenshotFailure.present_required_evidence, []);
  assert.deepEqual(
    screenshotFailure.taxonomy_categories,
    ['SAFETY_INTERSTITIAL_OR_TOOL_BLOCK', 'RESPONSE_CORRUPTED_OR_TRUNCATED'],
  );
});

test('generated R4 existing live failure mapping view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-existing-live-failure-taxonomy-mapping.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4ExistingLiveFailureTaxonomyMappingMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 执行边界/u);
  assert.match(actualView, /## 映射表/u);
  assert.match(actualView, /## Source Bindings/u);
});

test('schema rejects claim promotion, rerun bypass, and complete-evidence promotion', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const rerunBypass = structuredClone(expected);
  rerunBypass.failures[0].rerun_allowed_without_analysis = true;
  assert.equal(validate(rerunBypass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/failures/0/rerun_allowed_without_analysis'));

  const completeEvidence = structuredClone(expected);
  completeEvidence.failures[0].complete_required_evidence = true;
  assert.equal(validate(completeEvidence), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/failures/0/complete_required_evidence'));
});

test('runtime validation fails closed on unknown categories, screenshot evidence promotion, or live execution', () => {
  const unknownCategory = structuredClone(expected);
  unknownCategory.failures[0].taxonomy_categories = ['UNKNOWN'];
  unknownCategory.mapping_sha256 = '0'.repeat(64);
  assertHasMappingError(unknownCategory, 'failures.R4-LIVE-FAILURE-LOGIN-20260722T105032Z.taxonomy_categories:unknown-UNKNOWN');

  const screenshotEvidencePromotion = structuredClone(expected);
  screenshotEvidencePromotion.failures[3].present_required_evidence = ['report.json'];
  screenshotEvidencePromotion.mapping_sha256 = '0'.repeat(64);
  assertHasMappingError(
    screenshotEvidencePromotion,
    'failures.R4-LIVE-FAILURE-CURRENT-USER-SCREENSHOT-RESPONSE-CORRUPTED.conversation_fact:must-not-count-required-evidence',
  );

  const liveExecuted = structuredClone(expected);
  liveExecuted.mapping_policy.live_runs_executed = 1;
  liveExecuted.counts.live_runs_executed = 1;
  liveExecuted.mapping_sha256 = '0'.repeat(64);
  assertHasMappingError(liveExecuted, 'mapping_policy.live_runs_executed:must-be-0');
});

test('checker command validates R4 existing live failure mapping and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-existing-live-failure-taxonomy-mapping-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    mapping_sha256: expected.mapping_sha256,
    failures: 4,
    report_json_failures: 2,
    archive_doc_failures: 1,
    conversation_fact_failures: 1,
    failures_with_complete_required_evidence: 0,
    blocked_needs_evidence: 4,
    rerun_allowed_without_analysis: 0,
    live_runs_executed: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasMappingError(value, expectedError) {
  const result = validateR4ExistingLiveFailureTaxonomyMapping(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-existing-live-failure-taxonomy-mapping.schema.json'));
}
