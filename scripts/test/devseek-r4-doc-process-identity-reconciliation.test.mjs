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
  buildR4DocProcessIdentityReconciliation,
  renderR4DocProcessIdentityReconciliationMarkdown,
  validateR4DocProcessIdentityReconciliation,
} from '../lib/devseek-r4-doc-process-identity-reconciliation.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4DocProcessIdentityReconciliation({ repoRoot });

test('R4 doc process identity reconciliation separates implementation, artifact, handoff, and stale identity facts', () => {
  const actual = readJson('docs/process/devseek-r4-doc-process-identity-reconciliation.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    identity_artifacts_reconciled: 3,
    archived_failed_identity_snapshots: 1,
    handoff_documents_reconciled: 2,
    tracked_current_identity_usable_for_qualification: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.source_boundaries.product_implementation_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.source_boundaries.artifact_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.source_boundaries.handoff_doc_commit, '02cb792b4fe86df523c7f88eb106f13394e6f3fd');
  assert.equal(actual.identity_artifacts.tracked_current_candidate_identity.artifact_git_commit, '00449c6');
  assert.equal(actual.identity_artifacts.archived_failed_observe_identity.artifact_git_commit, '6b09d67');
  assert.equal(actual.identity_artifacts.release_candidate_identity.artifact_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(actual.identity_artifacts.tracked_current_matches_release_candidate, false);
  assert.equal(actual.identity_artifacts.archived_failed_matches_release_candidate, false);
  assert.equal(actual.conclusions.current_candidate_identity_status, 'deferred-unusable-until-clean-runtime');
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4DocProcessIdentityReconciliation(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 doc process reconciliation view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-doc-process-identity-reconciliation.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-doc-process-identity-reconciliation.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4DocProcessIdentityReconciliationMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 身份边界/u);
  assert.match(actualView, /## Handoff Drift/u);
  assert.match(actualView, /## 结论/u);
});

test('schema rejects claim promotion and live/runtime authority expansion', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));

  const runtimeObserved = structuredClone(expected);
  runtimeObserved.observation_authority.runtime_process_observation = 'ALLOWED';
  assert.equal(validate(runtimeObserved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/observation_authority/runtime_process_observation'));
});

test('runtime validation fails closed on identity promotion, archive mismatch, or missing handoff anchors', () => {
  const matchedCurrent = structuredClone(expected);
  matchedCurrent.identity_artifacts.tracked_current_matches_release_candidate = true;
  matchedCurrent.reconciliation_sha256 = '0'.repeat(64);
  assertHasReconciliationError(
    matchedCurrent,
    'identity_artifacts.tracked_current_matches_release_candidate:must-be-false',
  );

  const archivedUsable = structuredClone(expected);
  archivedUsable.identity_artifacts.archived_failed_observe_identity.usable_for_qualification = true;
  archivedUsable.reconciliation_sha256 = '0'.repeat(64);
  assertHasReconciliationError(archivedUsable, 'identity_artifacts.usable_for_qualification:must-all-be-false');

  const missingAnchor = structuredClone(expected);
  missingAnchor.handoff_documents[0].required_anchors_present -= 1;
  missingAnchor.handoff_documents[0].anchors[0].present = false;
  missingAnchor.reconciliation_sha256 = '0'.repeat(64);
  assertHasReconciliationError(missingAnchor, 'handoff_documents.docs/top-agent-convergence-audit-20260711/14-');
});

test('checker command validates R4 doc process identity reconciliation and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-doc-process-identity-reconciliation-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    reconciliation_sha256: expected.reconciliation_sha256,
    artifact_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    handoff_doc_commit: '02cb792b4fe86df523c7f88eb106f13394e6f3fd',
    release_candidate_manifest_commit: expected.source_boundaries.release_candidate_manifest_commit,
    tracked_current_identity_artifact: '00449c6',
    archived_failed_identity_artifact: '6b09d67',
    release_candidate_artifact: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    tracked_current_matches_release_candidate: false,
    archived_failed_matches_release_candidate: false,
    handoff_documents_reconciled: 2,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasReconciliationError(value, expectedError) {
  const result = validateR4DocProcessIdentityReconciliation(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-doc-process-identity-reconciliation.schema.json'));
}
