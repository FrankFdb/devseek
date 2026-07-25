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
  buildR4ProcessArtifactsAggregate,
  renderR4ProcessArtifactsAggregateMarkdown,
  validateR4ProcessArtifactsAggregate,
} from '../lib/devseek-r4-process-artifacts-aggregate.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4ProcessArtifactsAggregate({ repoRoot });

test('R4 process artifacts aggregate source-binds all local R4 process artifacts without qualification effect', () => {
  const actual = readJson('docs/process/devseek-r4-process-artifacts-aggregate.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    total_artifacts: 9,
    generated_json_artifacts: 7,
    manual_markdown_artifacts: 2,
    generated_views_expected: 7,
    generated_views_matched: 7,
    generated_views_missing: 0,
    generated_views_stale: 0,
    qualification_claim_violations: 0,
    live_runs_authorized: 0,
    approved_live_requests: 0,
    gate_assertions: 0,
    artifact_errors: 0,
  });
  assert.equal(actual.aggregate_scope.r4_original_leaf_count, 6);
  assert.equal(actual.aggregate_scope.clean_runtime_terminal_state, 'BLOCKED');
  assert.equal(actual.aggregate_scope.gate0_status, 'NOT_PASSED');
  assert.equal(actual.aggregate_scope.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.aggregate_scope.live_or_provider_actions_performed, false);
  assert.equal(actual.aggregate_scope.permission_sensitive_actions_performed, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(actual.artifacts.every(artifact => artifact.qualification_effect === 'NONE'), true);
  assert.equal(actual.artifacts.every(artifact => artifact.claims_permitted === false), true);
  assert.equal(actual.artifacts.every(artifact => artifact.asserts_gate_pass === false), true);
  assert.equal(actual.artifacts.every(artifact => artifact.live_runs_authorized === 0), true);
  assert.equal(actual.artifacts.every(artifact => artifact.approved_live_requests === 0), true);
  assert.equal(actual.artifacts.every(artifact => artifact.artifact_errors.length === 0), true);
  assert.equal(
    actual.source_bindings.r4_clean_runtime_limited_observation.path,
    'docs/process/devseek-r4-clean-runtime-limited-observation.json',
  );
  assert.equal(
    actual.source_bindings.r4_authorization_and_permission_guide.path,
    'docs/process/devseek-r4-authorization-and-permission-guide.md',
  );

  const validation = validateR4ProcessArtifactsAggregate(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 process artifacts aggregate view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-process-artifacts-aggregate.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-process-artifacts-aggregate.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4ProcessArtifactsAggregateMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 资格边界/u);
  assert.match(actualView, /## Artifact 明细/u);
  assert.match(actualView, /## Source Bindings/u);
});

test('schema rejects claim promotion, live authorization, and stale generated view counts', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const artifactPromoted = structuredClone(expected);
  artifactPromoted.artifacts[0].claims_permitted = true;
  assert.equal(validate(artifactPromoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/artifacts/0/claims_permitted'));

  const liveAuthorized = structuredClone(expected);
  liveAuthorized.counts.live_runs_authorized = 1;
  assert.equal(validate(liveAuthorized), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/live_runs_authorized'));

  const staleView = structuredClone(expected);
  staleView.counts.generated_views_stale = 1;
  assert.equal(validate(staleView), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/counts/generated_views_stale'));
});

test('runtime validation fails closed on view drift, artifact claim promotion, or source-binding mismatch', () => {
  const staleView = structuredClone(expected);
  staleView.artifacts[0].generated_view_status = 'STALE';
  staleView.artifacts[0].artifact_errors = ['generated-view-stale'];
  staleView.artifacts[0].no_claims_boundary_ok = false;
  staleView.counts.generated_views_matched = 6;
  staleView.counts.generated_views_stale = 1;
  staleView.counts.artifact_errors = 1;
  staleView.aggregate_sha256 = '0'.repeat(64);
  assertHasAggregateError(staleView, 'artifacts.R4-RELEASE-CANDIDATE-MANIFEST.generated_view_status:must-be-MATCHED');

  const artifactPromoted = structuredClone(expected);
  artifactPromoted.artifacts[0].qualification_effect = 'LOCAL_PASS';
  artifactPromoted.aggregate_sha256 = '0'.repeat(64);
  assertHasAggregateError(artifactPromoted, 'artifacts.R4-RELEASE-CANDIDATE-MANIFEST.qualification_effect:must-be-NONE');

  const sourceBindingDrift = structuredClone(expected);
  sourceBindingDrift.source_bindings.r4_release_candidate_manifest.path = 'docs/process/other.json';
  sourceBindingDrift.aggregate_sha256 = '0'.repeat(64);
  assertHasAggregateError(sourceBindingDrift, 'source_bindings.r4_release_candidate_manifest.path:invalid');
});

test('checker command validates R4 process artifacts aggregate and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-process-artifacts-aggregate-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    aggregate_sha256: expected.aggregate_sha256,
    total_artifacts: 9,
    generated_json_artifacts: 7,
    manual_markdown_artifacts: 2,
    generated_views_matched: 7,
    generated_views_stale: 0,
    generated_views_missing: 0,
    qualification_claim_violations: 0,
    live_runs_authorized: 0,
    approved_live_requests: 0,
    gate_assertions: 0,
    artifact_errors: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasAggregateError(value, expectedError) {
  const result = validateR4ProcessArtifactsAggregate(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-process-artifacts-aggregate.schema.json'));
}
