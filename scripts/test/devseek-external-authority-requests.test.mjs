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
} from '../lib/devseek-capability-ledger.mjs';
import {
  REQUIRED_GATE0_EXTERNAL_REQUESTS,
  buildExternalAuthorityRequests,
  renderExternalAuthorityRequestsMarkdown,
  validateExternalAuthorityRequests,
} from '../lib/devseek-external-authority-requests.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildExternalAuthorityRequests(sources);

test('current external authority requests are blocked request packets without qualification effect', () => {
  const actual = readJson('docs/process/devseek-external-authority-requests.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(actual.gate0_current_state.status, 'NOT_PASSED');
  assert.equal(actual.gate0_current_state.observed_claims, 0);
  assert.equal(actual.gate0_current_state.external_authority_blockers, 6);
  assert.deepEqual(
    actual.requests.map(request => request.atomic_id),
    REQUIRED_GATE0_EXTERNAL_REQUESTS.map(spec => spec.atomic_id),
  );
  assert.equal(actual.requests.every(request => request.terminal_state === 'BLOCKED'), true);
  assert.equal(actual.counts.approved_requests, 0);
  assert.equal(actual.counts.bypasses, 0);

  const validation = validateExternalAuthorityRequests(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('generated external authority request view is source-bound and schema-valid', () => {
  const actual = readJson('docs/process/devseek-external-authority-requests.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-external-authority-requests.md'),
    'utf8',
  );
  assert.equal(actualView, renderExternalAuthorityRequestsMarkdown(actual));

  const validate = compileSchema();
  assert.equal(validate(actual), true, JSON.stringify(validate.errors, null, 2));
});

test('schema rejects local approval, claim promotion, and Gate 0 assertion', () => {
  const validate = compileSchema();

  const approved = structuredClone(expected);
  approved.requests[0].terminal_state = 'APPROVED';
  assert.equal(validate(approved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/requests/0/terminal_state'));

  const claims = structuredClone(expected);
  claims.claims_permitted = true;
  assert.equal(validate(claims), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const gatePass = structuredClone(expected);
  gatePass.asserts_gate_pass = true;
  assert.equal(validate(gatePass), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/asserts_gate_pass'));
});

test('runtime fails closed when request coverage or external blockers drift', () => {
  const missingRequest = structuredClone(expected);
  missingRequest.requests.pop();
  missingRequest.counts.requests = 4;
  missingRequest.counts.blocked_requests = 4;
  assertHasRequestError(missingRequest, 'requests.atomic_ids:must-match-gate0-ext01-ext05');

  const loweredExternalBlockers = structuredClone(expected);
  loweredExternalBlockers.gate0_current_state.external_authority_blockers = 5;
  loweredExternalBlockers.counts.gate0_external_authority_blockers = 5;
  assertHasRequestError(loweredExternalBlockers, 'gate0_current_state.external_authority_blockers:must-remain-6');
});

test('runtime fails closed when local state attempts approval or trust fallback', () => {
  const approved = structuredClone(expected);
  approved.requests[0].terminal_state = 'APPROVED';
  approved.counts.approved_requests = 1;
  approved.counts.blocked_requests = 4;
  assertHasRequestError(approved, 'requests[0].terminal_state:must-be-BLOCKED-until-external-decision');

  const fallback = structuredClone(expected);
  fallback.requests[0].trusted_root_or_registry_reference.local_fallback_accepted = true;
  assertHasRequestError(
    fallback,
    'requests[0].trusted_root_or_registry_reference.local_fallback_accepted:must-be-false',
  );
});

test('runtime fails closed when package script or Phase gate coverage is missing', () => {
  const noScriptSources = structuredClone(sources);
  delete noScriptSources.packageJson.scripts['verify:external-authority-requests'];
  const noScript = buildExternalAuthorityRequests(noScriptSources);
  assertHasRequestErrorWithSources(
    noScript,
    noScriptSources,
    'sources.package_scripts.required_script_present:must-be-true',
  );

  const noGateSources = structuredClone(sources);
  noGateSources.phaseSource = noGateSources.phaseSource.replaceAll(
    'external-authority-request-packets',
    'missing-request-gate',
  );
  const noGate = buildExternalAuthorityRequests(noGateSources);
  assertHasRequestErrorWithSources(
    noGate,
    noGateSources,
    'sources.phase_gate_source.required_gate_present:must-be-true',
  );
});

test('checker command validates external authority request packet and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-external-authority-requests-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    request_set_sha256: expected.request_set_sha256,
    requests: 5,
    blocked_requests: 5,
    approved_requests: 0,
    gate0_status: 'NOT_PASSED',
    gate0_external_authority_blockers: 6,
    claims: 0,
    qualification_effect: 'NONE',
    bypasses: 0,
  });
});

function assertHasRequestError(value, expectedError) {
  assertHasRequestErrorWithSources(value, sources, expectedError);
}

function assertHasRequestErrorWithSources(value, activeSources, expectedError) {
  const result = validateExternalAuthorityRequests(value, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function loadSources() {
  return {
    gate0Decision: readJson('docs/process/devseek-gate0-decision-report.json'),
    externalAuthorityAdapter: readJson('docs/process/devseek-external-authority-adapter.json'),
    c0WiringReconciliation: readJson('docs/process/devseek-c0-wiring-reconciliation.json'),
    packageJson: readJson('package.json'),
    phaseSource: readText('scripts/devseek-phase0-12-verify.mjs'),
    sourceContents: {
      'package.json': readText('package.json'),
      'scripts/devseek-external-authority-requests-check.mjs':
        readText('scripts/devseek-external-authority-requests-check.mjs'),
      'scripts/test/devseek-external-authority-requests.test.mjs':
        readText('scripts/test/devseek-external-authority-requests.test.mjs'),
    },
  };
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-external-authority-requests.schema.json'));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
