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
  EXTERNAL_AUTHORITY_READINESS_REQUIRED_SOURCE_PATHS,
  buildExternalAuthorityReadinessAudit,
  loadExternalAuthorityReadinessAuditSources,
  renderExternalAuthorityReadinessAuditMarkdown,
  validateExternalAuthorityReadinessAudit,
} from '../lib/devseek-external-authority-readiness-audit.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadExternalAuthorityReadinessAuditSources(repoRoot);
const expected = buildExternalAuthorityReadinessAudit({ repoRoot, sources });

test('External authority readiness audit is source-bound and non-qualifying', () => {
  const actual = readJson('docs/process/devseek-external-authority-readiness-audit.json');

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.equal(actual.audit_scope.request_terminal_states_changed, false);
  assert.equal(actual.audit_scope.qualification_ledger_writes, false);
  assert.equal(actual.audit_scope.local_repository_may_unblock, false);
  assert.equal(actual.readiness_boundary.gate0_status, 'NOT_PASSED');
  assert.equal(actual.readiness_boundary.gate0_external_authority_blockers, 6);
  assert.equal(actual.readiness_boundary.r4_live_authorization_blocked, 5);
  assert.equal(actual.readiness_boundary.live_runs_authorized, 0);
  assert.equal(actual.readiness_boundary.qualification_claims, 0);

  const sourcePaths = Object.values(actual.source_bindings).map(binding => binding.path);
  for (const sourcePath of EXTERNAL_AUTHORITY_READINESS_REQUIRED_SOURCE_PATHS) {
    assert.ok(sourcePaths.includes(sourcePath), `missing ${sourcePath}`);
  }

  const validation = validateExternalAuthorityReadinessAudit(actual, { repoRoot, sources });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('External authority readiness audit covers all EXT and R4 live requests with executable next actions', () => {
  const actual = readJson('docs/process/devseek-external-authority-readiness-audit.json');

  assert.deepEqual(actual.counts, {
    request_audits: 10,
    gate0_external_request_audits: 5,
    r4_live_request_audits: 5,
    blocked_requests: 10,
    approved_requests: 0,
    local_unblockable_requests: 0,
    executable_recovery_statements: 10,
    blocker_precision_ok: 10,
    terminal_states_preserved: 10,
    live_runs_authorized: 0,
    qualification_claims: 0,
    gate_pass_assertions: 0,
    ledger_writes: 0,
    provider_actions_performed: 0,
  });
  assert.equal(
    actual.request_audits.every(request => (
      request.terminal_state === 'BLOCKED'
        && request.blocker_precision === 'PRECISE'
        && request.local_repository_may_unblock === false
        && request.next_authorization_action.length > 0
        && request.terminal_state_preserved === true
    )),
    true,
  );
  assert.deepEqual(
    actual.request_audits.filter(request => request.request_family === 'Gate0ExternalAuthorityRequest')
      .map(request => request.atomic_id),
    [
      'EXT-01-SOURCE-REGISTRY-BINDING',
      'EXT-02-INDEPENDENT-ATTESTATION',
      'EXT-03-PROTECTED-PROFILE-POLICY',
      'EXT-04-ROLES-KEYS',
      'EXT-05-RETENTION-TIME',
    ],
  );
  assert.deepEqual(
    actual.request_audits.filter(request => request.request_family === 'R4LiveQualificationAuthorization')
      .map(request => request.atomic_id),
    [
      'R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION',
      'R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE',
      'R4-LIVE-AUTH-03-HOLDOUT-PROFILE',
      'R4-LIVE-AUTH-04-TRUSTED-EVIDENCE',
      'R4-LIVE-AUTH-05-QUALIFICATION-IMPORT',
    ],
  );
});

test('External authority readiness audit generated view is Chinese-readable and schema-valid', () => {
  const actual = readJson('docs/process/devseek-external-authority-readiness-audit.json');
  const actualView = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-external-authority-readiness-audit.md'),
    'utf8',
  );

  assert.equal(actualView, renderExternalAuthorityReadinessAuditMarkdown(actual));
  assert.match(actualView, /## 摘要/u);
  assert.match(actualView, /## 审计边界/u);
  assert.match(actualView, /## Request Readiness/u);
  assert.match(actualView, /## 下一步授权动作/u);

  const validate = compileSchema();
  assert.equal(validate(actual), true, JSON.stringify(validate.errors, null, 2));
});

test('External authority readiness audit schema rejects approval, claims, and local unblock attempts', () => {
  const validate = compileSchema();

  const approved = structuredClone(expected);
  approved.request_audits[0].terminal_state = 'APPROVED';
  assert.equal(validate(approved), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/request_audits/0/terminal_state'));

  const claims = structuredClone(expected);
  claims.claims_permitted = true;
  assert.equal(validate(claims), false);
  assert.ok(validate.errors.some(error => error.instancePath === '/claims_permitted'));

  const localUnblock = structuredClone(expected);
  localUnblock.request_audits[0].local_repository_may_unblock = true;
  assert.equal(validate(localUnblock), false);
  assert.ok(
    validate.errors.some(error => error.instancePath === '/request_audits/0/local_repository_may_unblock'),
  );
});

test('External authority readiness runtime validation fails closed on source, terminal-state, or script drift', () => {
  const terminalDrift = structuredClone(expected);
  terminalDrift.request_audits[0].terminal_state = 'APPROVED';
  terminalDrift.audit_sha256 = '0'.repeat(64);
  assertHasAuditError(terminalDrift, 'request_audits[0].terminal_state:must-be-BLOCKED');

  const sourceBindingDrift = structuredClone(expected);
  sourceBindingDrift.source_bindings.external_authority_requests.path = 'docs/process/other.json';
  sourceBindingDrift.audit_sha256 = '0'.repeat(64);
  assertHasAuditError(
    sourceBindingDrift,
    'source_bindings:missing-docs/process/devseek-external-authority-requests.json',
  );

  const noScriptSources = loadExternalAuthorityReadinessAuditSources(repoRoot, {
    packageJson: {
      ...sources.packageJson,
      scripts: {
        ...sources.packageJson.scripts,
        'verify:external-authority-readiness-audit': undefined,
      },
    },
  });
  delete noScriptSources.packageJson.scripts['verify:external-authority-readiness-audit'];
  const noScript = buildExternalAuthorityReadinessAudit({ repoRoot, sources: noScriptSources });
  assertHasAuditErrorWithSources(
    noScript,
    noScriptSources,
    'source_bindings.package_scripts.required_script_present:must-be-true',
  );
});

test('External authority readiness checker command validates the generated audit', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-external-authority-readiness-audit-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    audit_sha256: expected.audit_sha256,
    request_audits: 10,
    gate0_external_request_audits: 5,
    r4_live_request_audits: 5,
    blocked_requests: 10,
    approved_requests: 0,
    local_unblockable_requests: 0,
    executable_recovery_statements: 10,
    blocker_precision_ok: 10,
    terminal_states_preserved: 10,
    live_runs_authorized: 0,
    qualification_claims: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasAuditError(value, expectedError) {
  assertHasAuditErrorWithSources(value, sources, expectedError);
}

function assertHasAuditErrorWithSources(value, activeSources, expectedError) {
  const result = validateExternalAuthorityReadinessAudit(value, { repoRoot, sources: activeSources });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson('docs/process/devseek-external-authority-readiness-audit.schema.json'));
}
