import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  canonicalJson,
  ledgerHash,
  sha256Object,
} from '../lib/devseek-capability-ledger.mjs';
import {
  buildExternalAuthorityAdapterReport,
  evaluateExternalAuthorityBinding,
  externalAuthorityAttestationPayloadHash,
  externalAuthorityAdapterHash,
  verifyExternalAuthorityAttestation,
} from '../lib/devseek-external-authority-adapter.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();

test('current external authority adapter contract is fail-closed and non-qualifying', () => {
  const report = buildExternalAuthorityAdapterReport(sources);
  assert.equal(report.source_status, 'unconfigured');
  assert.equal(report.qualification_eligible, false);
  assert.equal(report.claims_permitted, false);
  assert.equal(report.asserts_gate_pass, false);
  assert.equal(report.trust_roots.length, 0);
  assert.equal(report.current_binding.independent_authority_status, 'UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT');
  assert.equal(report.current_binding.configured_and_bound, false);
  assert.equal(report.counts.bypasses, 0);
  assert.equal(report.adapter_sha256, externalAuthorityAdapterHash(report));
});

test('generated external authority adapter report is schema-valid and source-bound', () => {
  const actual = readJson('docs/process/devseek-external-authority-adapter.json');
  const expected = buildExternalAuthorityAdapterReport(sources);
  assert.equal(canonicalJson(actual), canonicalJson(expected));

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateReport = ajv.compile(readJson('docs/process/devseek-external-authority-adapter.schema.json'));
  assert.equal(validateReport(actual), true, JSON.stringify(validateReport.errors));
  ajv.compile(readJson('docs/process/devseek-external-authority-attestation.schema.json'));
});

test('boolean pass cannot forge external authority', () => {
  const { adapter } = buildVerifiedLocalAdapter();
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation: true,
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_ATTESTATION_NOT_OBJECT');
  assert.equal(result.accepted, false);
});

test('ordinary object cannot forge external authority', () => {
  const { adapter } = buildVerifiedLocalAdapter();
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation: { pass: true },
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_ATTESTATION_SCHEMA_VERSION');
  assert.equal(result.accepted, false);
});

test('revoked trust root is rejected before any claim effect', () => {
  const { adapter, attestation } = buildVerifiedLocalAdapter({ rootOverrides: { status: 'revoked' } });
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation,
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_TRUST_ROOT_REVOKED');
  assert.equal(result.accepted, false);
});

test('role reuse is rejected before any claim effect', () => {
  const { adapter, attestation } = buildVerifiedLocalAdapter({
    attestationOverrides: {
      role_bindings: [
        { role: 'attestation', key_id: 'shared-key' },
        { role: 'retention', key_id: 'shared-key' },
        { role: 'time', key_id: 'time-key' },
      ],
    },
  });
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation,
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_ROLE_REUSE');
  assert.equal(result.accepted, false);
});

test('clock rollback is rejected before any claim effect', () => {
  const { adapter, attestation } = buildVerifiedLocalAdapter({
    attestationOverrides: {
      time_anchor: {
        observed_at: '2026-07-15T00:00:00.000Z',
        previous_observed_at: '2026-07-15T00:00:01.000Z',
        trusted_nonrollback_time: true,
      },
    },
  });
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation,
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_CLOCK_ROLLBACK');
  assert.equal(result.accepted, false);
});

test('manifest provenance mismatch is rejected before any claim effect', () => {
  const { adapter, attestation } = buildVerifiedLocalAdapter();
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation,
    expected: {
      ...expectedBindings(),
      expected_manifest_sha256: '1'.repeat(64),
      expected_provenance_sha256: '2'.repeat(64),
    },
  });
  assert.equal(result.status, 'REJECTED_MANIFEST_OR_PROVENANCE_MISMATCH');
  assert.equal(result.accepted, false);
});

test('valid local crypto remains untrusted without audited registry digest', () => {
  const { adapter, attestation } = buildVerifiedLocalAdapter();
  const result = verifyExternalAuthorityAttestation({
    externalAuthorityAdapter: adapter,
    attestation,
    expected: expectedBindings(),
  });
  assert.equal(result.status, 'REJECTED_TRUST_ROOT_NOT_AUDITED');
  assert.equal(result.accepted, false);
});

test('Gate0 authority binding consumes the adapter but does not promote claims', () => {
  const report = buildExternalAuthorityAdapterReport(sources);
  const binding = evaluateExternalAuthorityBinding({
    ledger: sources.ledger,
    qualificationProfiles: sources.qualificationProfiles,
    aggregatorPolicy: sources.aggregatorPolicy,
    externalAuthorityAdapter: report,
  });
  assert.equal(binding.independent_authority_status, 'UNAVAILABLE_NO_EXTERNAL_TRUST_ROOT');
  assert.equal(binding.independent_authority_attested, false);
  assert.equal(binding.configured_and_bound, false);
});

function buildVerifiedLocalAdapter({
  rootOverrides = {},
  attestationOverrides = {},
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const adapter = buildExternalAuthorityAdapterReport(sources);
  adapter.source_status = 'verified';
  adapter.trust_roots = [{
    root_id: 'test-root-01',
    authority_id: 'test-authority-01',
    control_plane: 'external-protected',
    status: 'active',
    not_before: '2026-07-14T00:00:00.000Z',
    not_after: '2026-07-16T00:00:00.000Z',
    public_key_pem: publicKeyPem,
    ...rootOverrides,
  }];

  const attestation = {
    schema_version: 'devseek.external-authority-attestation/v1',
    attestation_id: 'test-attestation-01',
    root_id: 'test-root-01',
    authority_id: 'test-authority-01',
    status: 'active',
    issued_at: '2026-07-15T00:00:00.000Z',
    valid_from: '2026-07-14T00:00:00.000Z',
    expires_at: '2026-07-16T00:00:00.000Z',
    source_bindings: {
      capability_ledger_sha256: ledgerHash(sources.ledger),
      profile_source_sha256: sha256Object(sources.qualificationProfiles),
      evidence_source_sha256: sha256Object(sources.aggregatorPolicy),
    },
    manifest_binding: {
      evidence_manifest_sha256: 'a'.repeat(64),
      provenance_sha256: 'b'.repeat(64),
    },
    controls: Object.fromEntries([
      'source-digest-binding',
      'independent-authority-attestation',
      'organizational-role-separation',
      'revocation-aware-trust-root',
      'trusted-nonrollback-time',
      'retention-lock-or-worm',
      'manifest-provenance-binding',
    ].map(control => [control, true])),
    role_bindings: [
      { role: 'attestation', key_id: 'attestation-key' },
      { role: 'retention', key_id: 'retention-key' },
      { role: 'time', key_id: 'time-key' },
    ],
    time_anchor: {
      observed_at: '2026-07-15T00:00:00.000Z',
      previous_observed_at: '2026-07-14T23:59:59.000Z',
      trusted_nonrollback_time: true,
    },
    ...attestationOverrides,
  };
  attestation.signature = {
    algorithm: 'ed25519',
    payload_sha256: externalAuthorityAttestationPayloadHash(attestation),
    signature_base64: crypto.sign(
      null,
      Buffer.from(canonicalJson(attestation), 'utf8'),
      privateKey,
    ).toString('base64'),
  };
  return { adapter, attestation };
}

function expectedBindings() {
  return {
    capability_ledger_sha256: ledgerHash(sources.ledger),
    profile_source_sha256: sha256Object(sources.qualificationProfiles),
    evidence_source_sha256: sha256Object(sources.aggregatorPolicy),
  };
}

function loadSources() {
  const sourcePaths = [
    'docs/process/devseek-external-authority-adapter.schema.json',
    'docs/process/devseek-external-authority-attestation.schema.json',
    'docs/process/devseek-gate0-decision.schema.json',
    'scripts/lib/devseek-external-authority-adapter.mjs',
    'scripts/lib/devseek-gate0-decision.mjs',
    'scripts/devseek-external-authority-adapter-check.mjs',
    'scripts/test/devseek-external-authority-adapter.test.mjs',
    'scripts/test/devseek-gate0-decision.test.mjs',
    'package.json',
    'scripts/devseek-phase0-12-verify.mjs',
  ];
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    qualificationProfiles: readJson('docs/process/devseek-qualification-profiles.json'),
    aggregatorPolicy: readJson('docs/process/devseek-qualification-aggregator-policy.json'),
    packageJson: readJson('package.json'),
    sourceContents: Object.fromEntries(sourcePaths.map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    ])),
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}
