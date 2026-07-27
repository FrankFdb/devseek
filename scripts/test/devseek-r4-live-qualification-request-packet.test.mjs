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
  buildR4LiveQualificationRequestPacket,
  renderR4LiveQualificationRequestPacketMarkdown,
  validateR4LiveQualificationRequestPacket,
} from '../lib/devseek-r4-live-qualification-request-packet.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = buildR4LiveQualificationRequestPacket({ repoRoot });

test('R4 live qualification request packet blocks qualification until explicit live, candidate, profile, evidence, and import authority exist', () => {
  const actual = readJson('docs/process/devseek-r4-live-qualification-request-packet.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.deepEqual(actual.counts, {
    requests: 5,
    blocked_requests: 5,
    approved_requests: 0,
    live_runs_authorized: 0,
    qualification_claims: 0,
  });
  assert.equal(actual.candidate_scope.artifact_source_commit, 'a034e5e050c044460fb07705639d9d41e6b193c0');
  assert.equal(
    actual.candidate_scope.current_candidate_identity_status,
    expected.candidate_scope.current_candidate_identity_status,
  );
  assert.equal(actual.candidate_scope.clean_runtime_identity_required, true);
  assert.equal(actual.candidate_scope.repository_current_identity_may_substitute, false);
  assert.equal(actual.qualification_boundary.gate0_status, 'NOT_PASSED');
  assert.equal(actual.qualification_boundary.r1_qualification_status, 'NOT_STARTED');
  assert.equal(actual.qualification_boundary.external_authority_blockers, 6);
  assert.equal(actual.live_terms.execution_mode, 'headed');
  assert.equal(actual.live_terms.keep_window, true);
  assert.equal(actual.live_terms.keep_deepseek_page, true);
  assert.equal(actual.live_terms.scenario_language_policy, 'language-comes-from-scenario-contract-not-product-default');
  assert.equal(actual.requests.every(request => request.terminal_state === 'BLOCKED'), true);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);

  const validation = validateR4LiveQualificationRequestPacket(actual, { repoRoot });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated R4 live qualification request packet view is source-bound and Chinese-readable', () => {
  const actualRegistry = readJson('docs/process/devseek-r4-live-qualification-request-packet.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-r4-live-qualification-request-packet.md'),
    'utf8',
  );

  assert.equal(actualView, renderR4LiveQualificationRequestPacketMarkdown(actualRegistry));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 候选与资格边界/u);
  assert.match(actualView, /## Live 条款/u);
  assert.match(actualView, /## 请求清单/u);
});

test('schema rejects claim promotion, approval, and live/runtime authority expansion', () => {
  const validate = compileSchema();

  const promoted = structuredClone(expected);
  promoted.claims_permitted = true;
  assert.equal(validate(promoted), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const approved = structuredClone(expected);
  approved.requests[0].terminal_state = 'APPROVED';
  assert.equal(validate(approved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/requests/0/terminal_state'));

  const runtimeObserved = structuredClone(expected);
  runtimeObserved.observation_authority.runtime_process_observation = 'ALLOWED';
  assert.equal(validate(runtimeObserved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/observation_authority/runtime_process_observation'));
});

test('runtime validation fails closed on local substitution, live authorization, or unblocked request', () => {
  const localSubstitution = structuredClone(expected);
  localSubstitution.qualification_boundary.local_smoke_may_substitute = true;
  localSubstitution.packet_sha256 = '0'.repeat(64);
  assertHasPacketError(localSubstitution, 'qualification_boundary.local_smoke_may_substitute:must-be-false');

  const liveAuthorized = structuredClone(expected);
  liveAuthorized.counts.live_runs_authorized = 1;
  liveAuthorized.packet_sha256 = '0'.repeat(64);
  assertHasPacketError(liveAuthorized, 'counts.live_runs_authorized:must-be-0');

  const unblockedRequest = structuredClone(expected);
  unblockedRequest.requests[0].terminal_state = 'APPROVED';
  unblockedRequest.packet_sha256 = '0'.repeat(64);
  assertHasPacketError(
    unblockedRequest,
    'requests.R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION.terminal_state:must-be-BLOCKED',
  );
});

test('checker command validates R4 live qualification request packet and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-r4-live-qualification-request-packet-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    packet_sha256: expected.packet_sha256,
    artifact_source_commit: 'a034e5e050c044460fb07705639d9d41e6b193c0',
    vsix_sha256: expected.candidate_scope.vsix_sha256,
    current_candidate_identity_status: expected.candidate_scope.current_candidate_identity_status,
    gate0_status: 'NOT_PASSED',
    r1_qualification_status: 'NOT_STARTED',
    external_authority_blockers: 6,
    requests: 5,
    blocked_requests: 5,
    live_runs_authorized: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasPacketError(value, expectedError) {
  const result = validateR4LiveQualificationRequestPacket(value, { repoRoot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-r4-live-qualification-request-packet.schema.json'));
}
