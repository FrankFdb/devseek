import assert from 'node:assert/strict';
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
  buildGate0Decision,
  gate0DecisionHash,
  protectedQualificationInputsEligible,
  signedEvidenceAuthorityBinding,
  validateGate0DecisionInvariants,
} from '../lib/devseek-gate0-decision.mjs';
import {
  qualificationProfileHash,
} from '../lib/devseek-qualification-protocol.mjs';
import {
  aggregatorPolicyHash,
  aggregatorSignerKeyHash,
} from '../lib/devseek-qualification-evidence-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();

test('current Gate 0 decision is locally consistent but honestly NOT_PASSED', () => {
  const decision = buildGate0Decision(sources);

  assert.equal(decision.local_conformance.status, 'PASSED');
  assert.equal(decision.local_conformance.asserts_protocol_execution, false);
  assert.equal(decision.local_conformance.qualification_effect, 'NONE');
  assert.deepEqual(decision.qualification, {
    status: 'NOT_PASSED',
    gate_passed: false,
    qualification_eligible: false,
    external_authority_trust_anchored: false,
    implementation_requirements_passed: false,
    exact_claim_requirements_passed: false,
  });
  assert.deepEqual(decision.claims, []);
  const expectedImplementationSatisfied = sources.ledger.capabilities.filter(
    capability => capability.domain === 'C0' && capability.implementation_state === 'wired',
  ).length;
  assert.deepEqual(decision.counts, {
    capabilities: 7,
    implementation_requirements_satisfied: expectedImplementationSatisfied,
    exact_claim_requirements_satisfied: 0,
    observed_claims: 0,
    repository_pending_blockers: 7 - expectedImplementationSatisfied,
    external_authority_blockers: 6,
  });
  assert.deepEqual(validateGate0DecisionInvariants(decision), []);
});

test('all seven C0 entries use the exact Gate 0 tuple and no Gate 1 claim leaks in', () => {
  const decision = buildGate0Decision(sources);
  const expectedIds = [
    'C0-CAPABILITY-LEDGER-SCHEMA',
    'C0-CASE-CATALOG',
    'C0-PREREGISTRATION-PLAN',
    'C0-QUALIFICATION-AGGREGATOR',
    'C0-QUALIFICATION-EVIDENCE-MANIFEST',
    'C0-QUALIFICATION-PROFILE-SCHEMA',
    'C0-RUN-EVIDENCE-LEDGER',
  ];

  assert.deepEqual(decision.capabilities.map(capability => capability.capability_id), expectedIds);
  for (const capability of decision.capabilities) {
    assert.equal(capability.claim_requirements.length, 1);
    assert.deepEqual(capability.claim_requirements[0], {
      profile_id: 'DEVSEEK-GATE0-INFRASTRUCTURE/v1',
      profile_sha256: '23f9e5cbee8e7bb7e3a3cb6977c641cf0f05d3281d1b503270c97eb216d7f0af',
      claim_scope: 'gate0-infrastructure',
      surface: 'repository-governance',
      provider: 'local-node',
      platform_profile: 'linux-x64-v1',
      minimum_level: 'L2',
      satisfied: false,
      matching_claim_ids: [],
    });
  }
});

test('repository wiring completion alone cannot turn the machine checker into Gate PASS', () => {
  const wired = structuredClone(sources);
  for (const capability of wired.ledger.capabilities.filter(entry => entry.domain === 'C0')) {
    capability.implementation_state = 'wired';
  }
  wired.ledger.ledger_sha256 = ledgerHash(wired.ledger);

  const decision = buildGate0Decision(wired);
  assert.equal(decision.qualification.implementation_requirements_passed, true);
  assert.equal(decision.blockers.repository_pending.length, 0);
  assert.equal(decision.qualification.qualification_eligible, false);
  assert.equal(decision.qualification.exact_claim_requirements_passed, false);
  assert.equal(decision.qualification.status, 'NOT_PASSED');
  assert.equal(decision.asserts_gate_pass, false);
  assert.ok(decision.blockers.external_authority.length > 0);
});

test('self-declared protected sources and fresh self-hashes never establish independent trust', () => {
  const declared = structuredClone(sources);
  declared.qualificationProfiles.integrity_scope = 'protected-qualification';
  declared.qualificationProfiles.qualification_eligible = true;
  declared.qualificationProfiles.source_status = 'verified';
  for (const profile of declared.qualificationProfiles.profiles) {
    profile.integrity_scope = 'protected-qualification';
    profile.qualification_eligible = true;
    profile.profile_sha256 = qualificationProfileHash(profile);
  }
  const qualificationDocumentForHash = structuredClone(declared.qualificationProfiles);
  delete qualificationDocumentForHash.document_sha256;
  delete qualificationDocumentForHash.source_status;
  declared.qualificationProfiles.document_sha256 = sha256Object(qualificationDocumentForHash);

  declared.aggregatorPolicy.integrity_scope = 'protected-qualification';
  declared.aggregatorPolicy.qualification_eligible = true;
  declared.aggregatorPolicy.source_status = 'verified';
  declared.aggregatorPolicy.retention_policy.storage_class = 'retention-lock-or-worm';
  for (const signer of [
    ...declared.aggregatorPolicy.manifest_signers,
    ...declared.aggregatorPolicy.retention_signers,
  ]) {
    signer.status = 'active';
    signer.key_sha256 = aggregatorSignerKeyHash(signer);
  }
  declared.aggregatorPolicy.policy_sha256 = aggregatorPolicyHash(declared.aggregatorPolicy);

  assert.equal(protectedQualificationInputsEligible(declared), false);
  const untrusted = signedEvidenceAuthorityBinding(declared);
  assert.equal(untrusted.configured_and_bound, false);
  assert.equal(untrusted.profile_bound, false);
  assert.equal(untrusted.evidence_bound, false);

  declared.ledger.qualification_claim_policy = {
    mode: 'signed-evidence-validator',
    profile_registry_sha256: untrusted.profile_source_sha256,
    evidence_registry_sha256: untrusted.evidence_source_sha256,
  };
  const locallyBound = signedEvidenceAuthorityBinding(declared);
  assert.equal(locallyBound.source_digests_bound, true);
  assert.equal(locallyBound.independent_authority_attested, false);
  assert.equal(locallyBound.independent_authority_status, 'UNAVAILABLE_NO_EXTERNAL_ATTESTATION_ADAPTER');
  assert.equal(locallyBound.configured_and_bound, false);
  assert.equal(protectedQualificationInputsEligible(declared), false);
});

test('self-consistency validation rejects forged Gate PASS even with a fresh decision digest', () => {
  const forged = buildGate0Decision(sources);
  forged.asserts_gate_pass = true;
  forged.qualification.status = 'PASSED';
  forged.qualification.gate_passed = true;
  forged.decision_sha256 = gate0DecisionHash(forged);

  const errors = validateGate0DecisionInvariants(forged);
  assert.ok(errors.includes('asserts_gate_pass:decision-mismatch'));
  assert.ok(errors.includes('qualification.gate_passed:decision-mismatch'));
  assert.ok(errors.includes('qualification.status:decision-mismatch'));
  assert.ok(errors.includes('qualification.gate_passed:blockers-must-be-empty'));
});

test('tracked report is deterministic, source-bound, and schema valid', () => {
  const actual = readJson('docs/process/devseek-gate0-decision-report.json');
  const expected = buildGate0Decision(sources);
  assert.equal(canonicalJson(actual), canonicalJson(expected));

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson('docs/process/devseek-gate0-decision.schema.json'));
  assert.equal(validate(actual), true, JSON.stringify(validate.errors));
});

test('qualification source hash drift fails closed', () => {
  const drifted = structuredClone(sources);
  drifted.qualificationProfiles.profiles[0].execution_policy.minimum_deterministic_traces += 1;
  assert.throws(
    () => buildGate0Decision(drifted),
    /Qualification profile (?:document )?hash mismatch/u,
  );
});

function loadSources() {
  return {
    ledger: readJson('docs/process/devseek-capability-ledger.json'),
    milestoneProfiles: readJson('docs/process/devseek-milestone-profiles.json'),
    qualificationProfiles: readJson('docs/process/devseek-qualification-profiles.json'),
    aggregatorPolicy: readJson('docs/process/devseek-qualification-aggregator-policy.json'),
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}
