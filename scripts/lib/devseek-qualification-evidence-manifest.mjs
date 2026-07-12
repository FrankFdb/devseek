import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  CANONICALIZATION_VERSION,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';
import {
  QUALIFICATION_PROTOCOL_INTEGRITY,
  goldenCaseCatalogHash,
  qualificationProfileHash,
  qualificationReceiptHash,
  validateKeyRegistry,
  validateQualificationPlan,
  verifyProtocolSignature,
  verifyQualificationEvent,
} from './devseek-qualification-protocol.mjs';

export const EVIDENCE_MANIFEST_SCHEMA_VERSION = 'devseek.qualification-evidence-manifest/v1';
export const AGGREGATOR_POLICY_SCHEMA_VERSION = 'devseek.qualification-aggregator-policy/v1';
export const RETENTION_LOCK_SCHEMA_VERSION = 'devseek.qualification-retention-lock/v1';
export const MANIFEST_SIGNATURE_PURPOSE = 'qualification-manifest';
export const RETENTION_SIGNATURE_PURPOSE = 'retention-lock';
export const G0C_LOCAL_INTEGRITY_SCOPE = 'local-protocol-conformance';
export const G0C_INTEGRITY = Object.freeze({ ...QUALIFICATION_PROTOCOL_INTEGRITY });
export const GENESIS_RETENTION_EXPECTED_ANCHOR = Object.freeze({
  record_count: 0,
  final_record_sha256: null,
  final_lock_sha256: null,
});

// This digest is intentionally an application constant rather than a value
// learned from the adjacent policy file. The checker also verifies the reverse
// binding so a fresh-root policy/key replacement cannot establish its own trust.
export const AUDITED_LOCAL_AGGREGATOR_POLICY = Object.freeze({
  policy_id: 'DEVSEEK-G0C-LOCAL-AGGREGATOR-POLICY',
  policy_sha256: '08897f5f2c6994fd2ae4d130648c38ab2eb6971b840a02b3b212430fcd45fb9e',
});

const PROCESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/process');
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SAFE_STORE_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const CANONICAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const STORE_DIRECTORY_NAMES = Object.freeze(['manifests', 'locks', 'ids', 'records']);
const PROC_SELF_FD_DIR = '/proc/self/fd';
const GOVERNANCE_MODES = new Set(['audited-local', 'deterministic-test-only']);
// No protected policy/trust root is shipped in G0-C. Adding one requires an
// independently audited digest plus external WORM/anchor integration.
const PROTECTED_QUALIFICATION_POLICY_DIGESTS = new Set();
const LEVEL_RANK = new Map(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((level, index) => [level, index]));
const INVALIDATION_RULES = Object.freeze([
  'candidate-or-artifact-identity-change',
  'plan-or-profile-hash-change',
  'catalog-oracle-corpus-metric-change',
  'event-stream-head-advance-or-chain-failure',
  'omitted-attempt-slot-failure-veto-or-denominator-entry',
  'slot-replay-order-or-retry-adjudication-invalid',
  'dependency-claim-or-dependency-snapshot-change',
  'provider-surface-platform-or-environment-change',
  'signer-revocation-or-retention-lock-loss',
  'expires-at-reached',
]);
const SCHEMAS = buildSchemaValidators();

export class QualificationEvidenceError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = 'QualificationEvidenceError';
    this.code = code;
    this.details = details;
  }
}

export function aggregatorSignerKeyHash(entry) {
  return sha256Object(withoutKeys(entry, ['key_sha256']));
}

export function aggregatorPolicyHash(policy) {
  return sha256Object(withoutKeys(policy, ['policy_sha256']));
}

export function qualificationEvidenceManifestHash(manifest) {
  return sha256Object(withoutKeys(manifest, ['evidence_manifest_sha256', 'manifest_attestation']));
}

export function qualificationRetentionLockHash(lock) {
  return sha256Object(withoutKeys(lock, ['lock_sha256', 'lock_attestation']));
}

export function immutableManifestRecordHash(record) {
  return sha256Object(withoutKeys(record, ['record_sha256']));
}

export function hydrateAggregatorPolicy(policy) {
  for (const entry of [...(policy.manifest_signers ?? []), ...(policy.retention_signers ?? [])]) {
    entry.public_key_spki_sha256 = sha256Bytes(strictBase64(entry.public_key_spki_base64));
    entry.key_sha256 = aggregatorSignerKeyHash(entry);
  }
  policy.policy_sha256 = aggregatorPolicyHash(policy);
  return policy;
}

export function validateAggregatorPolicy(policy, { audited = false, now = undefined } = {}) {
  assertSchema(SCHEMAS.policy, policy, 'AGGREGATOR_POLICY_SCHEMA_INVALID');
  if (policy.policy_sha256 !== aggregatorPolicyHash(policy)) fail('AGGREGATOR_POLICY_HASH_MISMATCH');
  if (audited && (policy.policy_id !== AUDITED_LOCAL_AGGREGATOR_POLICY.policy_id
    || policy.policy_sha256 !== AUDITED_LOCAL_AGGREGATOR_POLICY.policy_sha256)) {
    fail('AUDITED_AGGREGATOR_POLICY_DIGEST_MISMATCH');
  }
  const allKeys = [...policy.manifest_signers, ...policy.retention_signers];
  const ids = new Set();
  const identities = new Set();
  const materials = new Set();
  for (const entry of allKeys) {
    requireCanonicalTime(entry.valid_from, 'AGGREGATOR_SIGNER_VALID_FROM_INVALID');
    if (entry.expires_at !== null) {
      requireCanonicalTime(entry.expires_at, 'AGGREGATOR_SIGNER_EXPIRES_AT_INVALID');
      if (Date.parse(entry.expires_at) <= Date.parse(entry.valid_from)) {
        fail('AGGREGATOR_SIGNER_VALIDITY_WINDOW_INVALID', entry.key_id);
      }
    }
    if (entry.key_sha256 !== aggregatorSignerKeyHash(entry)) fail('AGGREGATOR_SIGNER_KEY_HASH_MISMATCH', entry.key_id);
    const material = strictBase64(entry.public_key_spki_base64);
    if (sha256Bytes(material) !== entry.public_key_spki_sha256) fail('AGGREGATOR_PUBLIC_KEY_HASH_MISMATCH', entry.key_id);
    let publicKey;
    try {
      publicKey = crypto.createPublicKey({ key: material, format: 'der', type: 'spki' });
    } catch {
      fail('AGGREGATOR_PUBLIC_KEY_INVALID', entry.key_id);
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') fail('AGGREGATOR_PUBLIC_KEY_NOT_ED25519', entry.key_id);
    if (ids.has(entry.key_id)) fail('AGGREGATOR_KEY_ID_DUPLICATE', entry.key_id);
    if (identities.has(entry.identity)) fail('AGGREGATOR_IDENTITY_REUSED', entry.identity);
    if (materials.has(entry.public_key_spki_sha256)) fail('AGGREGATOR_KEY_MATERIAL_REUSED', entry.key_id);
    ids.add(entry.key_id);
    identities.add(entry.identity);
    materials.add(entry.public_key_spki_sha256);
    if (entry.purpose === MANIFEST_SIGNATURE_PURPOSE && !policy.manifest_signers.includes(entry)) {
      fail('AGGREGATOR_PURPOSE_LIST_MISMATCH', entry.key_id);
    }
    if (entry.purpose === RETENTION_SIGNATURE_PURPOSE && !policy.retention_signers.includes(entry)) {
      fail('AGGREGATOR_PURPOSE_LIST_MISMATCH', entry.key_id);
    }
    if (now !== undefined) assertPolicyKeyCurrent(entry, now);
  }
  assertPolicyQualificationBoundary(policy);
  const ruleTuples = new Set();
  const ruleIds = new Set();
  for (const rule of policy.claim_rules) {
    if (ruleIds.has(rule.rule_id)) fail('CLAIM_RULE_ID_DUPLICATE', rule.rule_id);
    ruleIds.add(rule.rule_id);
    const tuple = claimTuple(rule);
    if (ruleTuples.has(tuple)) fail('CLAIM_RULE_TUPLE_DUPLICATE', tuple);
    ruleTuples.add(tuple);
    if (LEVEL_RANK.get(rule.awarded_level) > LEVEL_RANK.get(rule.requested_level)) {
      fail('CLAIM_RULE_LEVEL_ESCALATION', rule.rule_id);
    }
  }
  return true;
}

function assertGovernanceMode(governanceMode, policy) {
  if (!GOVERNANCE_MODES.has(governanceMode)) fail('GOVERNANCE_MODE_UNSUPPORTED', governanceMode);
  if (governanceMode === 'deterministic-test-only') {
    const signers = [...(policy?.manifest_signers ?? []), ...(policy?.retention_signers ?? [])];
    if (!policy || policy.source_status !== 'test-fixture'
      || policy.integrity_scope !== G0C_LOCAL_INTEGRITY_SCOPE
      || policy.qualification_eligible !== false
      || policy.retention_policy?.storage_class !== 'append-only-local-cas'
      || signers.length === 0
      || signers.some(entry => entry.status !== 'test-only')) {
      fail('DETERMINISTIC_GOVERNANCE_BOUNDARY_INVALID');
    }
  }
}

function assertPolicyQualificationBoundary(policy) {
  const signers = [...policy.manifest_signers, ...policy.retention_signers];
  const necessarilyLocal = policy.integrity_scope === G0C_LOCAL_INTEGRITY_SCOPE
    || policy.source_status === 'test-fixture'
    || policy.retention_policy.storage_class === 'append-only-local-cas'
    || signers.some(entry => entry.status === 'test-only');
  if (necessarilyLocal && policy.qualification_eligible !== false) {
    fail('LOCAL_OR_TEST_POLICY_MUST_NOT_BE_QUALIFICATION_ELIGIBLE');
  }
  if (policy.qualification_eligible) {
    if (policy.integrity_scope !== 'protected-qualification'
      || policy.source_status !== 'verified'
      || policy.retention_policy.storage_class !== 'retention-lock-or-worm'
      || policy.retention_policy.independent_expected_anchor_required !== true
      || signers.some(entry => entry.status !== 'active')) {
      fail('PROTECTED_QUALIFICATION_PREREQUISITES_UNMET');
    }
    if (!PROTECTED_QUALIFICATION_POLICY_DIGESTS.has(policy.policy_sha256)) {
      fail('PROTECTED_QUALIFICATION_TRUST_NOT_CONFIGURED');
    }
  }
}

export function currentQualificationState(frozenEvidence) {
  const { plan } = frozenEvidence;
  const streams = normalizeAndVerifyStreams(frozenEvidence, { verify: false });
  return {
    candidate_identity_sha256: plan.candidate_identity_sha256,
    source_tree_sha256: plan.candidate_identity.source.source_tree_sha256,
    installed_artifact_sha256: plan.candidate_identity.artifacts.installed_artifact_sha256,
    bridge_artifact_sha256: plan.candidate_identity.artifacts.bridge_artifact_sha256,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    profile_sha256: plan.profile_sha256,
    catalog_sha256: plan.catalog_sha256,
    key_registry_sha256: plan.key_registry_sha256,
    oracle_bundle_sha256: plan.oracle_bundle_sha256,
    corpus_sha256: plan.corpus_sha256,
    metric_and_statistical_plan_sha256: plan.metric_and_statistical_plan_sha256,
    dependency_snapshot_sha256: plan.candidate_identity.dependency_snapshot_sha256,
    provider_connector_sha256: plan.candidate_identity.provider_connector.provider_connector_sha256,
    provider: plan.candidate_identity.provider_connector.provider_mode,
    surfaces: [...new Set(plan.coverage_slots.map(slot => slot.surface))].sort(),
    platform_profile: plan.candidate_identity.execution_inputs.platform_profile,
    execution_environment_sha256: plan.execution_environment_sha256,
    event_stream_heads: headsFromStreams(streams),
  };
}

export function aggregateQualificationEvidence({
  manifestId,
  generatedAt,
  expiresAt,
  supersedesManifestSha256 = null,
  frozenEvidence,
  aggregationPolicy,
  manifestSigner,
  governanceMode = 'audited-local',
}) {
  assertGovernanceMode(governanceMode, aggregationPolicy);
  requireCanonicalTime(generatedAt, 'MANIFEST_GENERATED_AT_INVALID');
  requireCanonicalTime(expiresAt, 'MANIFEST_EXPIRES_AT_INVALID');
  validateAggregatorPolicy(aggregationPolicy, { audited: governanceMode === 'audited-local', now: generatedAt });
  assertGovernanceMode(governanceMode, aggregationPolicy);
  assertManifestTimeWindow({
    generated_at: generatedAt,
    validity: { valid_from: generatedAt, expires_at: expiresAt },
  }, aggregationPolicy, frozenEvidence.plan);
  const derived = independentlyAggregateFrozenEvidence(frozenEvidence, aggregationPolicy, generatedAt);
  const qualificationEligible = aggregationPolicy.qualification_eligible
    && frozenEvidence.plan.qualification_eligible === true;
  const manifest = {
    schema_version: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    integrity: { ...G0C_INTEGRITY },
    integrity_scope: aggregationPolicy.integrity_scope,
    qualification_eligible: qualificationEligible,
    manifest_id: manifestId,
    generated_at: generatedAt,
    supersedes_manifest_sha256: supersedesManifestSha256,
    aggregation_policy_sha256: aggregationPolicy.policy_sha256,
    ...derived,
    validity: {
      valid_from: generatedAt,
      expires_at: expiresAt,
      invalidated_by: [...INVALIDATION_RULES],
    },
    evidence_manifest_sha256: null,
    manifest_attestation: null,
  };
  manifest.evidence_manifest_sha256 = qualificationEvidenceManifestHash(manifest);
  manifest.manifest_attestation = signManifestPayload(manifest, manifestSigner, aggregationPolicy);
  manifest.evidence_manifest_sha256 = qualificationEvidenceManifestHash(manifest);
  assertSchema(SCHEMAS.manifest, manifest, 'EVIDENCE_MANIFEST_SCHEMA_INVALID');
  assertManifestSignerIndependent(manifest.manifest_attestation, frozenEvidence, aggregationPolicy);
  return manifest;
}

export function createQualificationRetentionLock({
  manifest,
  aggregationPolicy,
  retentionSigner,
  retainedAt,
  retainUntil,
  previousLockSha256 = null,
  lockId = `qrl-${manifest.manifest_id}`,
}) {
  requireCanonicalTime(retainedAt, 'RETENTION_RETAINED_AT_INVALID');
  requireCanonicalTime(retainUntil, 'RETENTION_UNTIL_INVALID');
  validateAggregatorPolicy(aggregationPolicy, { now: retainedAt });
  verifyManifestStructureAndSignature(manifest, aggregationPolicy, retainedAt);
  if (Date.parse(retainedAt) < Date.parse(manifest.generated_at)) fail('RETENTION_BEFORE_MANIFEST');
  if (Date.parse(retainUntil) < Date.parse(manifest.validity.expires_at)) fail('RETENTION_BEFORE_MANIFEST_EXPIRY');
  if (Date.parse(retainUntil) - Date.parse(retainedAt)
    < aggregationPolicy.retention_policy.minimum_retention_seconds * 1000) fail('RETENTION_PERIOD_TOO_SHORT');
  const lock = {
    schema_version: RETENTION_LOCK_SCHEMA_VERSION,
    integrity: { ...G0C_INTEGRITY },
    integrity_scope: aggregationPolicy.integrity_scope,
    qualification_eligible: aggregationPolicy.qualification_eligible && manifest.qualification_eligible,
    lock_id: lockId,
    manifest_id: manifest.manifest_id,
    evidence_manifest_sha256: manifest.evidence_manifest_sha256,
    aggregation_policy_sha256: aggregationPolicy.policy_sha256,
    storage_class: aggregationPolicy.retention_policy.storage_class,
    retained_at: retainedAt,
    retain_until: retainUntil,
    previous_lock_sha256: previousLockSha256,
    lock_sha256: null,
    lock_attestation: null,
  };
  lock.lock_sha256 = qualificationRetentionLockHash(lock);
  lock.lock_attestation = signRetentionPayload(lock, retentionSigner, aggregationPolicy);
  lock.lock_sha256 = qualificationRetentionLockHash(lock);
  assertSchema(SCHEMAS.retention, lock, 'RETENTION_LOCK_SCHEMA_INVALID');
  return lock;
}

export function verifyQualificationEvidenceManifest({
  manifest,
  retentionLock,
  frozenEvidence,
  aggregationPolicy,
  currentState,
  now,
  governanceMode = 'audited-local',
}) {
  requireCanonicalTime(now, 'VERIFICATION_TIME_INVALID');
  assertGovernanceMode(governanceMode, aggregationPolicy);
  validateAggregatorPolicy(aggregationPolicy, { audited: governanceMode === 'audited-local', now });
  assertGovernanceMode(governanceMode, aggregationPolicy);
  verifyManifestStructureAndSignature(manifest, aggregationPolicy, now);
  verifyRetentionLock(retentionLock, manifest, aggregationPolicy, now);
  assertManifestTimeWindow(manifest, aggregationPolicy, frozenEvidence.plan);
  const expectedEligibility = aggregationPolicy.qualification_eligible
    && frozenEvidence.plan.qualification_eligible === true;
  if (manifest.integrity_scope !== aggregationPolicy.integrity_scope
    || manifest.qualification_eligible !== expectedEligibility) {
    fail('MANIFEST_SCOPE_OR_ELIGIBILITY_DERIVATION_MISMATCH');
  }
  assertManifestSignerIndependent(manifest.manifest_attestation, frozenEvidence, aggregationPolicy);
  assertRetentionSignerIndependent(retentionLock.lock_attestation, manifest, frozenEvidence);
  // Current validity is a separate decision from historical derivation. In
  // particular, recursively referenced manifests must still be valid at the
  // top-level reader's `now`; their own generated_at is only a recomputation
  // point for their signed derived fields.
  validateDependencyManifests(frozenEvidence.dependency_manifests ?? [], now);
  const expected = independentlyAggregateFrozenEvidence(frozenEvidence, aggregationPolicy, manifest.generated_at);
  for (const key of [
    'frozen_identity', 'event_stream_heads', 'event_receipt_bindings', 'planned_slot_bindings',
    'attempt_slot_bindings', 'run_evidence_auxiliary', 'slot_accounting',
    'failures_and_vetoes', 'claim_candidates', 'qualification_claims',
  ]) {
    if (canonicalJson(manifest[key]) !== canonicalJson(expected[key])) fail('MANIFEST_DERIVATION_MISMATCH', key);
  }
  if (!currentState || canonicalJson(currentState) !== canonicalJson(currentQualificationState(frozenEvidence))) {
    fail('CURRENT_STATE_REQUIRED_OR_MISMATCH');
  }
  assertCurrentStateMatchesManifest(currentState, manifest);
  if (Date.parse(now) < Date.parse(manifest.validity.valid_from)) fail('MANIFEST_NOT_YET_VALID');
  if (Date.parse(now) >= Date.parse(manifest.validity.expires_at)) fail('MANIFEST_EXPIRED');
  if (Date.parse(now) >= Date.parse(retentionLock.retain_until)) fail('RETENTION_LOCK_EXPIRED');
  return {
    valid: true,
    qualification_eligible: manifest.qualification_eligible,
    qualification_claims: manifest.qualification_eligible
      ? structuredClone(manifest.qualification_claims) : [],
    claim_candidates: structuredClone(manifest.claim_candidates),
  };
}

export function verifyRetentionLock(lock, manifest, policy, now) {
  assertSchema(SCHEMAS.retention, lock, 'RETENTION_LOCK_SCHEMA_INVALID');
  requireCanonicalTime(now, 'RETENTION_VERIFICATION_TIME_INVALID');
  requireCanonicalTime(lock.retained_at, 'RETENTION_RETAINED_AT_INVALID');
  requireCanonicalTime(lock.retain_until, 'RETENTION_UNTIL_INVALID');
  if (lock.lock_sha256 !== qualificationRetentionLockHash(lock)) fail('RETENTION_LOCK_HASH_MISMATCH');
  const expectedEligibility = policy.qualification_eligible && manifest.qualification_eligible;
  if (lock.manifest_id !== manifest.manifest_id
    || lock.evidence_manifest_sha256 !== manifest.evidence_manifest_sha256
    || lock.aggregation_policy_sha256 !== policy.policy_sha256
    || lock.storage_class !== policy.retention_policy.storage_class
    || lock.integrity_scope !== policy.integrity_scope
    || lock.integrity_scope !== manifest.integrity_scope
    || lock.qualification_eligible !== expectedEligibility) fail('RETENTION_LOCK_BINDING_MISMATCH');
  verifyAggregatorSignature({
    domain: 'devseek/qualification-retention-lock-signature/v1',
    purpose: RETENTION_SIGNATURE_PURPOSE,
    payload: retentionSignaturePayload(lock),
    attestation: lock.lock_attestation,
    policy,
    now,
  });
  if (Date.parse(lock.retained_at) < Date.parse(manifest.generated_at)) fail('RETENTION_BEFORE_MANIFEST');
  if (Date.parse(lock.retained_at) > Date.parse(now)) fail('RETENTION_LOCK_FROM_FUTURE');
  if (Date.parse(now) >= Date.parse(lock.retain_until)) fail('RETENTION_LOCK_EXPIRED');
  if (Date.parse(lock.retain_until) < Date.parse(manifest.validity.expires_at)) fail('RETENTION_BEFORE_MANIFEST_EXPIRY');
  if (Date.parse(lock.retain_until) - Date.parse(lock.retained_at)
    < policy.retention_policy.minimum_retention_seconds * 1000) fail('RETENTION_PERIOD_TOO_SHORT');
  return true;
}

export class ImmutableQualificationManifestStore {
  constructor({ rootDir }) {
    this.rootDir = path.resolve(rootDir);
    this.closed = false;
    assertNoSymlinkPath(this.rootDir);
    for (const directory of STORE_DIRECTORY_NAMES) {
      fs.mkdirSync(path.join(this.rootDir, directory), { recursive: true, mode: 0o700 });
      assertNoSymlinkPath(path.join(this.rootDir, directory));
    }
    assertSecureStoreLayout(this.rootDir);
    this.componentPins = captureStoreLayoutPins(this.rootDir);
  }

  retain(options) {
    this.#assertOpen();
    assertPinnedStoreLayout(this.rootDir, this.componentPins);
    try {
      return this.#retainPinned(options);
    } finally {
      if (!this.closed) assertPinnedStoreLayout(this.rootDir, this.componentPins);
    }
  }

  #retainPinned({ manifest, retentionLock, aggregationPolicy, expectedAnchor }) {
    validateAggregatorPolicy(aggregationPolicy);
    verifyManifestStructureAndSignature(manifest, aggregationPolicy, retentionLock.retained_at);
    verifyRetentionLock(retentionLock, manifest, aggregationPolicy, retentionLock.retained_at);
    const audit = this.audit({ aggregationPolicy, expectedAnchor });
    if (retentionLock.previous_lock_sha256 !== audit.final_lock_sha256) fail('RETENTION_LOCK_PREDECESSOR_MISMATCH');
    const requiredSupersedes = audit.manifest_sha256s.at(-1) ?? null;
    if (manifest.supersedes_manifest_sha256 !== requiredSupersedes) fail('MANIFEST_SUPERSESSION_CHAIN_INVALID');
    if (manifest.supersedes_manifest_sha256 === manifest.evidence_manifest_sha256) fail('MANIFEST_SELF_SUPERSESSION');
    const idFile = `${sha256Text(manifest.manifest_id)}.json`;
    const ids = storeComponentPin(this.componentPins, 'ids');
    const binding = {
      manifest_id: manifest.manifest_id,
      evidence_manifest_sha256: manifest.evidence_manifest_sha256,
    };
    const idResult = secureAtomicCompareAndCreate(ids, idFile, binding);
    if (!idResult.created) {
      const existing = readStoreJson(ids, idFile, 'MANIFEST_ID_BINDING_DELETED');
      if (canonicalJson(existing) !== canonicalJson(binding)) fail('MANIFEST_ID_REBIND_FORBIDDEN');
      if (audit.manifest_sha256s.includes(manifest.evidence_manifest_sha256)) return audit;
    }
    const manifests = storeComponentPin(this.componentPins, 'manifests');
    const locks = storeComponentPin(this.componentPins, 'locks');
    assertCreatedOrEqual(manifests, `${manifest.evidence_manifest_sha256}.json`, manifest, 'MANIFEST_HASH_COLLISION');
    assertCreatedOrEqual(locks, `${retentionLock.lock_sha256}.json`, retentionLock, 'RETENTION_LOCK_HASH_COLLISION');
    const sequence = audit.record_count + 1;
    const record = {
      schema_version: 'devseek.qualification-manifest-retention-record/v1',
      sequence,
      previous_record_sha256: audit.final_record_sha256,
      evidence_manifest_sha256: manifest.evidence_manifest_sha256,
      lock_sha256: retentionLock.lock_sha256,
      retained_at: retentionLock.retained_at,
      record_sha256: null,
    };
    record.record_sha256 = immutableManifestRecordHash(record);
    const records = storeComponentPin(this.componentPins, 'records');
    const recordFile = `${String(sequence).padStart(12, '0')}.json`;
    if (!secureAtomicCompareAndCreate(records, recordFile, record).created) fail('RETENTION_RECORD_CAS_CONFLICT');
    return this.audit({
      aggregationPolicy,
      expectedAnchor: {
        record_count: sequence,
        final_record_sha256: record.record_sha256,
        final_lock_sha256: retentionLock.lock_sha256,
      },
    });
  }

  audit(options) {
    this.#assertOpen();
    assertPinnedStoreLayout(this.rootDir, this.componentPins);
    try {
      return this.#auditPinned(options);
    } finally {
      if (!this.closed) assertPinnedStoreLayout(this.rootDir, this.componentPins);
    }
  }

  #auditPinned({ aggregationPolicy, expectedAnchor = null }) {
    validateAggregatorPolicy(aggregationPolicy);
    assertRetentionExpectedAnchor(aggregationPolicy, expectedAnchor, this.componentPins);
    const records = storeComponentPin(this.componentPins, 'records');
    const names = readStoreDirectory(records).filter(name => /^\d{12}\.json$/u.test(name)).sort();
    let prior = null;
    let finalLock = null;
    const manifestSha256s = [];
    for (const [index, name] of names.entries()) {
      if (name !== `${String(index + 1).padStart(12, '0')}.json`) fail('RETENTION_RECORD_GAP');
      const record = readStoreJson(records, name, 'RETENTION_RECORD_DELETED');
      if (record.sequence !== index + 1 || record.previous_record_sha256 !== prior) fail('RETENTION_RECORD_CHAIN_MISMATCH');
      if (record.record_sha256 !== immutableManifestRecordHash(record)) fail('RETENTION_RECORD_HASH_MISMATCH');
      const manifest = readStoreJson(storeComponentPin(this.componentPins, 'manifests'),
        `${record.evidence_manifest_sha256}.json`, 'RETENTION_ARTIFACT_DELETED');
      const lock = readStoreJson(storeComponentPin(this.componentPins, 'locks'),
        `${record.lock_sha256}.json`, 'RETENTION_ARTIFACT_DELETED');
      if (manifest.evidence_manifest_sha256 !== record.evidence_manifest_sha256
        || qualificationEvidenceManifestHash(manifest) !== record.evidence_manifest_sha256) fail('RETAINED_MANIFEST_REPLACED');
      verifyManifestStructureAndSignature(manifest, aggregationPolicy, lock.retained_at);
      verifyRetentionLock(lock, manifest, aggregationPolicy, lock.retained_at);
      if (lock.previous_lock_sha256 !== finalLock) fail('RETENTION_LOCK_CHAIN_MISMATCH');
      const idBinding = readStoreJson(storeComponentPin(this.componentPins, 'ids'),
        `${sha256Text(manifest.manifest_id)}.json`, 'MANIFEST_ID_BINDING_DELETED');
      if (idBinding.evidence_manifest_sha256 !== manifest.evidence_manifest_sha256
        || idBinding.manifest_id !== manifest.manifest_id) fail('MANIFEST_ID_BINDING_REPLACED');
      prior = record.record_sha256;
      finalLock = lock.lock_sha256;
      manifestSha256s.push(manifest.evidence_manifest_sha256);
    }
    const result = {
      record_count: names.length,
      final_record_sha256: prior,
      final_lock_sha256: finalLock,
      manifest_sha256s: manifestSha256s,
    };
    if (expectedAnchor && (expectedAnchor.record_count !== result.record_count
      || expectedAnchor.final_record_sha256 !== result.final_record_sha256
      || expectedAnchor.final_lock_sha256 !== result.final_lock_sha256)) fail('RETENTION_EXPECTED_ANCHOR_MISMATCH');
    return result;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    let closeError;
    for (const pin of this.componentPins ?? []) {
      try { fs.closeSync(pin.descriptor); } catch (error) {
        if (error.code !== 'EBADF' && closeError === undefined) closeError = error;
      }
    }
    if (closeError) throw closeError;
  }

  dispose() {
    this.close();
  }

  #assertOpen() {
    if (this.closed) fail('RETENTION_STORE_CLOSED');
  }
}

function independentlyAggregateFrozenEvidence(frozenEvidence, policy, verificationTime) {
  const { plan, profile, catalog, key_registry: registry } = frozenEvidence;
  assertSchema(SCHEMAS.profile, profile, 'QUALIFICATION_PROFILE_SCHEMA_INVALID');
  assertSchema(SCHEMAS.catalog, catalog, 'GOLDEN_CASE_CATALOG_SCHEMA_INVALID');
  const registryResult = validateKeyRegistry(registry, { now: verificationTime });
  if (!registryResult.ok) fail('QUALIFICATION_KEY_REGISTRY_INVALID', registryResult.errors.join(';'), registryResult.errors);
  if (profile.profile_sha256 !== qualificationProfileHash(profile)) fail('QUALIFICATION_PROFILE_HASH_MISMATCH');
  if (catalog.catalog_sha256 !== goldenCaseCatalogHash(catalog)) fail('GOLDEN_CASE_CATALOG_HASH_MISMATCH');
  const planResult = validateQualificationPlan(plan, { registry, profile, catalog, now: verificationTime });
  if (!planResult.ok) fail('QUALIFICATION_PLAN_INVALID', planResult.errors.join(';'), planResult.errors);
  if (plan.profile_id !== profile.profile_id || plan.profile_sha256 !== profile.profile_sha256) fail('PLAN_PROFILE_BINDING_MISMATCH');
  assertPurposeAndIdentitySeparation(frozenEvidence, policy);
  const streams = normalizeAndVerifyStreams(frozenEvidence, { verify: true, now: verificationTime });
  const campaign = streams.find(stream => stream.stream_kind === 'plan');
  if (!campaign || streams.filter(stream => stream.stream_kind === 'plan').length !== 1
    || campaign.correlation_id !== plan.qualification_campaign_id
    || campaign.events[0].event_type !== 'QualificationPlanRegistered'
    || campaign.events[0].payload?.qualification_plan_sha256 !== plan.qualification_plan_sha256) {
    fail('CAMPAIGN_REGISTRATION_STREAM_INVALID');
  }
  const runEvidenceAuxiliary = validateRunEvidenceAuxiliary(frozenEvidence.run_evidence_auxiliary ?? []);
  const accounting = deriveSlotAccounting({ plan, streams });
  const claims = deriveClaims({
    plan,
    policy,
    plannedCoverage: accounting.plannedCoverage,
    slotAccounting: accounting.slotAccounting,
    failuresAndVetoes: accounting.failuresAndVetoes,
    dependencyClaims: validateDependencyManifests(frozenEvidence.dependency_manifests ?? [], verificationTime),
  });
  const candidate = plan.candidate_identity;
  return {
    frozen_identity: {
      qualification_campaign_id: plan.qualification_campaign_id,
      candidate_identity_sha256: plan.candidate_identity_sha256,
      candidate_commit: candidate.source.git_commit,
      source_tree_sha256: candidate.source.source_tree_sha256,
      installed_artifact_sha256: candidate.artifacts.installed_artifact_sha256,
      bridge_artifact_sha256: candidate.artifacts.bridge_artifact_sha256,
      prompt_bundle_sha256: candidate.execution_inputs.prompt_bundle_sha256,
      runtime_config_sha256: candidate.execution_inputs.runtime_config_sha256,
      provider_connector_sha256: candidate.provider_connector.provider_connector_sha256,
      qualification_plan_id: plan.qualification_plan_id,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      profile_id: plan.profile_id,
      profile_sha256: plan.profile_sha256,
      catalog_sha256: plan.catalog_sha256,
      key_registry_sha256: plan.key_registry_sha256,
      oracle_bundle_sha256: plan.oracle_bundle_sha256,
      corpus_sha256: plan.corpus_sha256,
      metric_and_statistical_plan_sha256: plan.metric_and_statistical_plan_sha256,
      dependency_snapshot_sha256: candidate.dependency_snapshot_sha256,
      execution_environment_sha256: plan.execution_environment_sha256,
      provider: candidate.provider_connector.provider_mode,
      surface_set: [...new Set(plan.coverage_slots.map(slot => slot.surface))].sort(),
      platform_profile: candidate.execution_inputs.platform_profile,
    },
    event_stream_heads: headsFromStreams(streams),
    event_receipt_bindings: streams.flatMap(stream => stream.events.map((event, index) => ({
      event_sha256: event.event_sha256,
      receipt_id: stream.receipts[index].receipt_id,
      receipt_sha256: stream.receipts[index].receipt_sha256,
    }))).sort((left, right) => left.event_sha256.localeCompare(right.event_sha256)),
    planned_slot_bindings: {
      preflight: accounting.plannedPreflight,
      coverage: accounting.plannedCoverage,
    },
    attempt_slot_bindings: accounting.attemptBindings,
    run_evidence_auxiliary: runEvidenceAuxiliary,
    slot_accounting: accounting.slotAccounting,
    failures_and_vetoes: accounting.failuresAndVetoes,
    claim_candidates: claims,
    qualification_claims: policy.qualification_eligible && plan.qualification_eligible === true
      ? claims : [],
  };
}

function normalizeAndVerifyStreams(frozenEvidence, { verify, now } = {}) {
  const streams = structuredClone(frozenEvidence.event_streams ?? []);
  if (streams.length === 0) fail('EVENT_STREAMS_REQUIRED');
  const identities = new Set();
  const eventIds = new Set();
  const eventHashes = new Set();
  const receiptIds = new Set();
  const receiptHashes = new Set();
  for (const stream of streams) {
    const streamIdentity = `${stream.stream_kind}\0${stream.correlation_id}`;
    if (identities.has(streamIdentity)) fail('EVENT_STREAM_DUPLICATE', streamIdentity);
    identities.add(streamIdentity);
    if (!Array.isArray(stream.events) || stream.events.length === 0) fail('EVENT_STREAM_EMPTY', streamIdentity);
    if (!Array.isArray(stream.receipts) || stream.receipts.length !== stream.events.length) fail('EVENT_RECEIPT_CARDINALITY_MISMATCH', streamIdentity);
    for (const [index, event] of stream.events.entries()) {
      if (event.stream_kind !== stream.stream_kind || event.correlation_id !== stream.correlation_id) fail('EVENT_STREAM_ENVELOPE_MISMATCH');
      if (eventIds.has(event.event_id) || eventHashes.has(event.event_sha256)) fail('EVENT_ID_OR_HASH_DUPLICATE');
      eventIds.add(event.event_id);
      eventHashes.add(event.event_sha256);
      const receipt = stream.receipts[index];
      if (receiptIds.has(receipt.receipt_id) || receiptHashes.has(receipt.receipt_sha256)) fail('EVENT_RECEIPT_DUPLICATE');
      receiptIds.add(receipt.receipt_id);
      receiptHashes.add(receipt.receipt_sha256);
      if (verify) {
        verifyQualificationEvent(event, {
          registry: frozenEvidence.key_registry,
          now,
          priorEvent: index === 0 ? undefined : stream.events[index - 1],
          plan: frozenEvidence.plan,
        });
        verifyEventReceipt(receipt, event, frozenEvidence.key_registry);
      }
    }
  }
  return streams.sort((left, right) => `${left.stream_kind}:${left.correlation_id}`.localeCompare(`${right.stream_kind}:${right.correlation_id}`));
}

function verifyEventReceipt(receipt, event, registry) {
  assertSchema(SCHEMAS.receipt, receipt, 'QUALIFICATION_RECEIPT_SCHEMA_INVALID');
  if (!['plan-registration', 'event-append'].includes(receipt.receipt_type)
    || receipt.event_sha256 !== event.event_sha256
    || receipt.new_head_sha256 !== event.event_sha256
    || receipt.previous_head_sha256 !== event.previous_event_sha256
    || receipt.stream_kind !== event.stream_kind
    || receipt.correlation_id !== event.correlation_id
    || receipt.qualification_plan_sha256 !== event.qualification_plan_sha256
    || receipt.object_version !== event.sequence
    || receipt.receipt_sha256 !== qualificationReceiptHash(receipt)) fail('QUALIFICATION_RECEIPT_BINDING_INVALID');
  verifyProtocolSignature({
    domain: 'devseek/qualification-store-receipt/v1',
    purpose: 'store-receipt',
    payload: {
      receipt_id: receipt.receipt_id,
      receipt_type: receipt.receipt_type,
      receipt_sha256: receipt.receipt_sha256,
      qualification_plan_sha256: receipt.qualification_plan_sha256,
      trusted_recorded_at: receipt.trusted_recorded_at,
      new_head_sha256: receipt.new_head_sha256,
    },
    attestation: receipt.attestation,
    registry,
    now: receipt.trusted_recorded_at,
  });
}

function deriveSlotAccounting({ plan, streams }) {
  const sessions = streams.filter(stream => stream.stream_kind === 'session');
  const attempts = streams.filter(stream => stream.stream_kind === 'attempt');
  const allEvents = streams.flatMap(stream => stream.events);
  const eventByHash = new Map(allEvents.map(event => [event.event_sha256, event]));
  const sessionStates = new Map(sessions.map(stream => [stream.correlation_id, derivePreflightSessionState(stream)]));
  const preflightVetoes = [];
  const plannedPreflight = plan.preflight_slots.map(slot => {
    const matching = sessions.filter(stream => stream.events[0].payload?.preflight_slot_id === slot.preflight_slot_id);
    if (matching.length > 1) fail('PREFLIGHT_SLOT_CONSUMED_MORE_THAN_ONCE', slot.preflight_slot_id);
    const stream = matching[0];
    const state = stream ? sessionStates.get(stream.correlation_id) : {
      status: 'unconsumed',
      reasonCode: 'planned-preflight-unconsumed',
      evidenceEvent: null,
    };
    if (state.status !== 'ready') {
      preflightVetoes.push({
        preflight_slot_id: slot.preflight_slot_id,
        qualification_session_id: stream?.correlation_id ?? null,
        reason_code: state.reasonCode,
        evidence_event_sha256: state.evidenceEvent?.event_sha256 ?? null,
      });
    }
    return {
      preflight_slot_id: slot.preflight_slot_id,
      preflight_slot_sha256: slot.preflight_slot_sha256,
      order: slot.order,
      session_ids: matching.map(stream => stream.correlation_id).sort(),
      status: state.status,
    };
  });
  for (const stream of sessions) {
    const registeredSlot = stream.events[0].payload?.preflight_slot_id;
    if (!plan.preflight_slots.some(slot => slot.preflight_slot_id === registeredSlot)) {
      fail('SESSION_PREFLIGHT_SLOT_NOT_PLANNED', stream.correlation_id);
    }
  }
  const attemptBindings = [];
  const failures = [];
  const vetoes = [];
  const sessionFailures = sessions.flatMap(stream => stream.events
    .filter(event => event.event_type === 'SessionProductFailure')
    .map(event => {
      const failureClass = event.payload?.failure_class;
      if (!['product', 'agent', 'model', 'connector'].includes(failureClass)) {
        fail('SESSION_PRODUCT_FAILURE_CLASS_INVALID', event.event_id);
      }
      return {
        qualification_session_id: stream.correlation_id,
        preflight_slot_id: stream.events[0].payload.preflight_slot_id,
        failure_class: failureClass,
        event_sha256: event.event_sha256,
      };
    }));
  const candidateClosures = allEvents
    .filter(event => event.event_type === 'CandidateClosed'
      || (event.event_type === 'PreflightClassified' && event.payload?.decision === 'veto'))
    .map(event => ({
      correlation_id: event.correlation_id,
      reason_code: SAFE_ID_RE.test(event.payload?.reason_code ?? '') ? event.payload.reason_code : 'candidate-closed',
      event_sha256: event.event_sha256,
    }));
  let duplicateInvalid = 0;
  const plannedCoverage = plan.coverage_slots.map(slot => {
    const matching = attempts.filter(stream => stream.events[0].payload?.coverage_slot_id === slot.coverage_slot_id);
    const roles = new Map();
    for (const stream of matching) {
      const registered = stream.events[0];
      const role = registered.payload?.attempt_role;
      if (!['primary', 'adjudicated-infra-retry'].includes(role)) {
        duplicateInvalid += 1;
        continue;
      }
      const roleStreams = roles.get(role) ?? [];
      roleStreams.push(stream);
      roles.set(role, roleStreams);
      const preflight = plan.preflight_slots.find(candidate => candidate.preflight_slot_id === registered.payload?.preflight_slot_id);
      const session = sessions.find(candidate => candidate.correlation_id === registered.payload?.qualification_session_id);
      const attemptWindow = slot.attempt_windows.find(window => window.attempt_role === role);
      if (!preflight || registered.payload?.coverage_slot_sha256 !== slot.coverage_slot_sha256
        || registered.payload?.preflight_slot_sha256 !== preflight.preflight_slot_sha256
        || !SAFE_ID_RE.test(registered.payload?.qualification_session_id ?? '')
        || !session
        || session.events[0].payload?.preflight_slot_id !== preflight.preflight_slot_id
        || session.events.at(-1).event_type !== 'QualificationSessionReady'
        || !attemptWindow
        || attemptWindow.eligible_preflight_slot_id !== preflight.preflight_slot_id) fail('ATTEMPT_SLOT_BINDING_INVALID', stream.correlation_id);
      const oracleEvents = stream.events.filter(event => event.event_type === 'OracleClassified');
      const terminalEvents = stream.events.filter(event => event.event_type === 'AttemptTerminated');
      const oracle = oracleEvents.length === 1 ? oracleEvents[0] : null;
      const terminal = terminalEvents.length === 1 ? terminalEvents[0] : null;
      if (terminal && (terminal.payload?.decision !== undefined || terminal.payload?.outcome !== undefined
        || terminal.payload?.failure_class !== undefined)) fail('TERMINAL_VERDICT_DUPLICATION_FORBIDDEN', stream.correlation_id);
      if (terminal && terminal.payload?.oracle_event_sha256 !== oracle?.event_sha256) fail('TERMINAL_ORACLE_BINDING_INVALID', stream.correlation_id);
      const outcome = oracle && terminal ? oracleDecision(oracle) : 'unclassified';
      const adjudication = registered.payload?.infra_adjudication_event_sha256
        ? eventByHash.get(registered.payload.infra_adjudication_event_sha256) : null;
      if (role === 'primary' && adjudication) fail('PRIMARY_ATTEMPT_ADJUDICATION_FORBIDDEN');
      if (role === 'adjudicated-infra-retry' && (!adjudication || adjudication.event_type !== 'InfraAdjudicated')) {
        fail('RETRY_ADJUDICATION_MISSING', stream.correlation_id);
      }
      const binding = {
        attempt_id: stream.correlation_id,
        coverage_key: [plan.qualification_plan_sha256, slot.coverage_slot_id],
        coverage_slot_sha256: slot.coverage_slot_sha256,
        qualification_session_id: registered.payload.qualification_session_id,
        preflight_slot_id: preflight.preflight_slot_id,
        preflight_slot_sha256: preflight.preflight_slot_sha256,
        attempt_role: role,
        infra_adjudication_event: adjudication ? eventRef(adjudication) : null,
        oracle_event: oracle ? eventRef(oracle) : null,
        terminal_event: terminal ? eventRef(terminal) : null,
        outcome,
      };
      attemptBindings.push(binding);
      if (outcome === 'product-miss') failures.push({
        attempt_id: stream.correlation_id,
        coverage_key: binding.coverage_key,
        failure_class: oracle.payload.failure_class,
        oracle_event_sha256: oracle.event_sha256,
      });
      if (outcome === 'veto') vetoes.push({
        attempt_id: stream.correlation_id,
        coverage_key: binding.coverage_key,
        reason_code: oracle.payload.reason_code,
        oracle_event_sha256: oracle.event_sha256,
      });
    }
    for (const roleStreams of roles.values()) if (roleStreams.length > 1) duplicateInvalid += roleStreams.length - 1;
    const primary = (roles.get('primary') ?? [])[0];
    const retry = (roles.get('adjudicated-infra-retry') ?? [])[0];
    let status = 'unconsumed';
    if (primary) {
      const primaryBinding = attemptBindings.find(binding => binding.attempt_id === primary.correlation_id);
      status = primaryBinding.outcome;
      if (retry) {
        const retryBinding = attemptBindings.find(binding => binding.attempt_id === retry.correlation_id);
        const adjudication = retryBinding.infra_adjudication_event
          ? eventByHash.get(retryBinding.infra_adjudication_event.event_sha256) : null;
        if (primaryBinding.outcome !== 'infra-invalid'
          || adjudication?.payload?.original_failure_event_sha256 !== primaryBinding.oracle_event?.event_sha256) {
          duplicateInvalid += 1;
          status = 'invalid-duplicate';
        } else status = retryBinding.outcome;
      } else if (primaryBinding.outcome === 'infra-invalid') {
        const adjudication = allEvents.find(event => event.event_type === 'InfraAdjudicated'
          && event.payload?.original_slot_id === slot.coverage_slot_id
          && event.payload?.original_failure_event_sha256 === primaryBinding.oracle_event?.event_sha256);
        if (!adjudication) status = 'unclassified';
        else primaryBinding.infra_adjudication_event = eventRef(adjudication);
      }
    } else if (retry) {
      duplicateInvalid += 1;
      status = 'invalid-duplicate';
    }
    if (matching.length > 0 && duplicateInvalid > 0 && status !== 'invalid-duplicate'
      && [...roles.values()].some(roleStreams => roleStreams.length > 1)) status = 'invalid-duplicate';
    return {
      coverage_slot_id: slot.coverage_slot_id,
      coverage_slot_sha256: slot.coverage_slot_sha256,
      order: slot.order,
      capability_id: slot.capability_id,
      surface: slot.surface,
      attempt_ids: matching.map(stream => stream.correlation_id).sort(),
      status,
    };
  });
  const boundAttemptIds = new Set(attemptBindings.map(binding => binding.attempt_id));
  for (const stream of attempts) if (!boundAttemptIds.has(stream.correlation_id)) {
    fail('ATTEMPT_NOT_BOUND_TO_PLANNED_SLOT', stream.correlation_id);
  }
  const counts = status => plannedCoverage.filter(slot => slot.status === status).length;
  const excluded = plannedCoverage.flatMap(slot => {
    const binding = attemptBindings.filter(candidate => candidate.coverage_key[1] === slot.coverage_slot_id).at(-1);
    if (slot.status === 'infra-invalid') return [{
      coverage_key: [plan.qualification_plan_sha256, slot.coverage_slot_id],
      reason_code: 'independently-adjudicated-test-infra',
      evidence_event_sha256: binding?.infra_adjudication_event?.event_sha256 ?? binding?.oracle_event?.event_sha256 ?? null,
    }];
    if (slot.status === 'unclassified' || slot.status === 'invalid-duplicate') return [{
      coverage_key: [plan.qualification_plan_sha256, slot.coverage_slot_id],
      reason_code: 'unclassified',
      evidence_event_sha256: binding?.oracle_event?.event_sha256 ?? null,
    }];
    if (slot.status === 'unconsumed') return [{
      coverage_key: [plan.qualification_plan_sha256, slot.coverage_slot_id],
      reason_code: 'unconsumed-or-blocked',
      evidence_event_sha256: null,
    }];
    return [];
  });
  const pass = counts('pass');
  const miss = counts('product-miss') + counts('veto');
  const slotAccounting = {
    planned_coverage_slot_count: plan.coverage_slots.length,
    uniquely_consumed_slot_count: plannedCoverage.filter(slot => slot.attempt_ids.length > 0).length,
    passed_slot_count: pass,
    product_miss_slot_count: miss,
    infra_invalid_slot_count: counts('infra-invalid'),
    unclassified_slot_count: counts('unclassified') + counts('invalid-duplicate'),
    unconsumed_or_blocked_slot_count: counts('unconsumed'),
    duplicate_or_invalid_attempt_count: duplicateInvalid,
    denominator_policy: 'all-preregistered-and-classifiable',
    denominator_count: pass + miss,
    numerator_count: pass,
    excluded_from_denominator: excluded,
  };
  assertDenominatorConservation(slotAccounting);
  attemptBindings.sort((left, right) => left.attempt_id.localeCompare(right.attempt_id));
  failures.sort((left, right) => left.attempt_id.localeCompare(right.attempt_id));
  vetoes.sort((left, right) => left.attempt_id.localeCompare(right.attempt_id));
  sessionFailures.sort((left, right) => left.qualification_session_id.localeCompare(right.qualification_session_id));
  candidateClosures.sort((left, right) => left.event_sha256.localeCompare(right.event_sha256));
  preflightVetoes.sort((left, right) => left.preflight_slot_id.localeCompare(right.preflight_slot_id));
  const connectorFailureVetoCount = failures.filter(failure => failure.failure_class === 'connector').length;
  return {
    plannedPreflight,
    plannedCoverage,
    attemptBindings,
    slotAccounting,
    failuresAndVetoes: {
      failures,
      session_failures: sessionFailures,
      vetoes,
      preflight_vetoes: preflightVetoes,
      candidate_closures: candidateClosures,
      veto_count: vetoes.length + candidateClosures.length + preflightVetoes.length + connectorFailureVetoCount,
    },
  };
}

function derivePreflightSessionState(stream) {
  const events = stream.events;
  const observed = events.filter(event => event.event_type === 'PreflightObserved');
  const classified = events.filter(event => event.event_type === 'PreflightClassified');
  const ready = events.filter(event => event.event_type === 'QualificationSessionReady');
  const blocked = events.filter(event => event.event_type === 'QualificationSessionBlocked');
  const productFailures = events.filter(event => event.event_type === 'SessionProductFailure');
  const adjudications = events.filter(event => event.event_type === 'InfraAdjudicated');
  const skipped = events.filter(event => event.event_type === 'SlotBranchSkipped');
  const classification = classified[0];
  const terminalEvidence = productFailures[0] ?? blocked[0] ?? ready[0] ?? skipped[0] ?? events.at(-1);

  if (observed.length !== 1 || classified.length !== 1 || ready.length > 1 || blocked.length > 1
    || productFailures.length > 1 || adjudications.length > 1 || skipped.length > 1) {
    return { status: 'invalid', reasonCode: 'preflight-state-cardinality-invalid', evidenceEvent: terminalEvidence };
  }
  if (productFailures.length === 1) {
    const failureClass = productFailures[0].payload?.failure_class;
    return {
      status: 'product-failure',
      reasonCode: failureClass === 'connector' ? 'preflight-connector-failure' : 'preflight-product-failure',
      evidenceEvent: productFailures[0],
    };
  }
  if (classification?.payload?.decision === 'blocked' && ready.length === 1) {
    return {
      status: 'invalid',
      reasonCode: 'preflight-blocked-ready-conflict',
      evidenceEvent: ready[0],
    };
  }
  if (ready.length === 1 && (classification?.payload?.decision !== 'ready'
    || observed[0]?.payload?.ready !== true || blocked.length > 0 || adjudications.length > 0)) {
    return {
      status: 'invalid',
      reasonCode: 'preflight-ready-semantic-conflict',
      evidenceEvent: ready[0],
    };
  }
  if (ready.length === 1) {
    if (skipped.length === 1) {
      return { status: 'skipped', reasonCode: 'planned-preflight-skipped', evidenceEvent: skipped[0] };
    }
    return { status: 'ready', reasonCode: null, evidenceEvent: ready[0] };
  }
  if (adjudications.length === 1) {
    return { status: 'infra-invalid', reasonCode: 'planned-preflight-infra-invalid', evidenceEvent: adjudications[0] };
  }
  if (blocked.length === 1 || classification?.payload?.decision === 'blocked') {
    return { status: 'blocked', reasonCode: 'planned-preflight-blocked', evidenceEvent: blocked[0] ?? classification };
  }
  return {
    status: 'invalid',
    reasonCode: 'planned-preflight-terminal-missing-or-failed',
    evidenceEvent: terminalEvidence,
  };
}

function oracleDecision(oracle) {
  const decision = oracle.payload?.decision;
  if (!['pass', 'product-miss', 'infra-invalid', 'unclassified', 'veto'].includes(decision)) fail('ORACLE_DECISION_INVALID', oracle.event_id);
  if (decision === 'product-miss' && !['product', 'agent', 'model', 'connector'].includes(oracle.payload?.failure_class)) {
    fail('ORACLE_FAILURE_CLASS_INVALID', oracle.event_id);
  }
  if (decision === 'infra-invalid' && !['environment', 'test-infra'].includes(oracle.payload?.failure_class)) {
    fail('ORACLE_INFRA_CLASS_INVALID', oracle.event_id);
  }
  if (decision === 'veto' && !SAFE_ID_RE.test(oracle.payload?.reason_code ?? '')) fail('ORACLE_VETO_REASON_REQUIRED', oracle.event_id);
  return decision;
}

function deriveClaims({ plan, policy, plannedCoverage, slotAccounting, failuresAndVetoes, dependencyClaims }) {
  const claims = [];
  for (const rule of policy.claim_rules) {
    if (rule.profile_id !== plan.profile_id || rule.profile_sha256 !== plan.profile_sha256
      || rule.provider !== plan.candidate_identity.provider_connector.provider_mode
      || rule.platform_profile !== plan.candidate_identity.execution_inputs.platform_profile) continue;
    const exactTupleSlotIds = plannedCoverage
      .filter(slot => slot.capability_id === rule.capability_id && slot.surface === rule.surface)
      .map(slot => slot.coverage_slot_id).sort();
    if (canonicalJson([...rule.required_coverage_slot_ids].sort()) !== canonicalJson(exactTupleSlotIds)) continue;
    const slots = rule.required_coverage_slot_ids.map(slotId => plannedCoverage.find(slot => slot.coverage_slot_id === slotId));
    if (slots.some(slot => !slot || slot.capability_id !== rule.capability_id || slot.surface !== rule.surface)) continue;
    const numerator = slots.filter(slot => slot.status === 'pass').length;
    const productMiss = slots.filter(slot => ['product-miss', 'veto'].includes(slot.status)).length;
    const denominator = slots.filter(slot => ['pass', 'product-miss', 'veto'].includes(slot.status)).length;
    const estimate = denominator === 0 ? 0 : numerator / denominator;
    const dependencies = rule.dependencies.map(required => findExactDependency(required, dependencyClaims));
    const passed = numerator >= rule.minimum_numerator
      && denominator >= rule.minimum_denominator
      && estimate >= rule.minimum_rate
      && productMiss <= rule.maximum_product_miss
      && failuresAndVetoes.veto_count === 0
      && slotAccounting.duplicate_or_invalid_attempt_count === 0
      && dependencies.every(Boolean);
    if (!passed) continue;
    const tuple = {
      capability_id: rule.capability_id,
      profile_id: rule.profile_id,
      profile_sha256: rule.profile_sha256,
      claim_scope: rule.claim_scope,
      surface: rule.surface,
      provider: rule.provider,
      platform_profile: rule.platform_profile,
    };
    claims.push({
      claim_id: `qclaim-${sha256Object({ tuple, plan: plan.qualification_plan_sha256 }).slice(0, 32)}`,
      ...tuple,
      requested_level: rule.requested_level,
      awarded_level: rule.awarded_level,
      decision: 'qualified',
      contributing_coverage_keys: slots.map(slot => [plan.qualification_plan_sha256, slot.coverage_slot_id]),
      metric_results: [{
        metric_id: `${rule.rule_id}-pass-rate`,
        numerator,
        denominator,
        estimate,
        passed: true,
      }],
      satisfied_dependencies: dependencies,
    });
  }
  return claims.sort((left, right) => claimTuple(left).localeCompare(claimTuple(right)));
}

function validateDependencyManifests(dependencyManifests, verificationTime) {
  const dependencyClaims = dependencyManifests.flatMap(entry => {
    const result = verifyQualificationEvidenceManifest({
      manifest: entry.manifest,
      retentionLock: entry.retention_lock,
      frozenEvidence: entry.frozen_evidence,
      aggregationPolicy: entry.aggregation_policy,
      currentState: entry.current_state,
      now: verificationTime,
      governanceMode: entry.governance_mode ?? 'audited-local',
    });
    if (!result.qualification_eligible) fail('DEPENDENCY_MANIFEST_NOT_QUALIFICATION_ELIGIBLE');
    return result.qualification_claims.map(claim => ({
      status: 'valid',
      claim_manifest_sha256: entry.manifest.evidence_manifest_sha256,
      capability_id: claim.capability_id,
      profile_id: claim.profile_id,
      profile_sha256: claim.profile_sha256,
      claim_scope: claim.claim_scope,
      surface: claim.surface,
      provider: claim.provider,
      platform_profile: claim.platform_profile,
      awarded_level: claim.awarded_level,
    }));
  });
  const tuples = new Set();
  return dependencyClaims.map(entry => {
    if (entry.status !== 'valid' || !SHA256_RE.test(entry.claim_manifest_sha256 ?? '')
      || !LEVEL_RANK.has(entry.awarded_level)) fail('DEPENDENCY_CLAIM_INVALID');
    const tuple = claimTuple(entry);
    if (tuples.has(tuple)) fail('DEPENDENCY_CLAIM_TUPLE_DUPLICATE', tuple);
    tuples.add(tuple);
    return structuredClone(entry);
  });
}

function findExactDependency(required, claims) {
  const match = claims.find(claim => claim.capability_id === required.capability_id
    && claim.profile_id === required.profile_id
    && claim.profile_sha256 === required.profile_sha256
    && claim.claim_scope === required.claim_scope
    && claim.surface === required.surface
    && claim.provider === required.provider
    && claim.platform_profile === required.platform_profile
    && LEVEL_RANK.get(claim.awarded_level) >= LEVEL_RANK.get(required.minimum_level));
  if (!match) return null;
  const copy = structuredClone(match);
  delete copy.status;
  return copy;
}

function validateRunEvidenceAuxiliary(entries) {
  return entries.map(entry => {
    assertSchema(SCHEMAS.runSnapshot, entry.snapshot, 'RUN_EVIDENCE_SNAPSHOT_SCHEMA_INVALID');
    assertSchema(SCHEMAS.runAnchor, entry.expected_anchor, 'RUN_EVIDENCE_ANCHOR_SCHEMA_INVALID');
    const { snapshot, expected_anchor: anchor } = entry;
    if (snapshot.seal === null || snapshot.head.sealed !== true
      || snapshot.records.length !== anchor.eventCount
      || snapshot.head.eventSha256 !== anchor.finalEventSha256
      || snapshot.head.recordSha256 !== anchor.finalRecordSha256
      || snapshot.head.sealSha256 !== anchor.sealSha256) fail('RUN_EVIDENCE_SEALED_ANCHOR_MISMATCH');
    verifyRunEvidenceSnapshot(snapshot);
    return {
      run_id: snapshot.runId,
      snapshot_sha256: sha256Object(snapshot),
      expected_anchor_sha256: sha256Object(anchor),
      sealed: true,
      integrity_scope: 'product-run-diagnostics',
      qualification_eligible: false,
      auxiliary_only: true,
    };
  }).sort((left, right) => left.run_id.localeCompare(right.run_id));
}

function verifyRunEvidenceSnapshot(snapshot) {
  let previousEvent = null;
  let previousRecord = null;
  for (const [index, record] of snapshot.records.entries()) {
    const event = record.event;
    const receipt = record.receipt;
    const sequence = index + 1;
    if (record.slotSequence !== sequence || event.sequence !== sequence || receipt.sequence !== sequence
      || record.previousRecordSha256 !== previousRecord || event.previous_event_sha256 !== previousEvent
      || receipt.previous_event_sha256 !== previousEvent || event.run_id !== snapshot.runId
      || receipt.run_id !== snapshot.runId || receipt.event_sha256 !== event.event_sha256
      || receipt.idempotency_key !== event.idempotency_key
      || (sequence === 1 && event.type !== 'run.opened')
      || (sequence > 1 && event.type === 'run.opened')) fail('RUN_EVIDENCE_CHAIN_INVALID');
    if (event.event_sha256 !== sha256Object(withoutKeys(event, ['event_sha256']))) fail('RUN_EVIDENCE_EVENT_HASH_MISMATCH');
    if (receipt.receipt_sha256 !== sha256Object(withoutKeys(receipt, ['receipt_sha256']))) fail('RUN_EVIDENCE_RECEIPT_HASH_MISMATCH');
    const recordEnvelope = {
      protocol: 'devseek.run-evidence-record/v1',
      record_kind: 'event',
      slot_sequence: record.slotSequence,
      previous_record_sha256: record.previousRecordSha256,
      event,
      receipt,
    };
    if (record.recordSha256 !== sha256Object(recordEnvelope)) fail('RUN_EVIDENCE_RECORD_HASH_MISMATCH');
    previousEvent = event.event_sha256;
    previousRecord = record.recordSha256;
  }
  const sealSnapshot = snapshot.seal;
  const seal = sealSnapshot.seal;
  if (seal.event_count !== snapshot.records.length || seal.final_event_sha256 !== previousEvent
    || seal.final_record_sha256 !== previousRecord || seal.run_id !== snapshot.runId
    || sealSnapshot.slotSequence !== snapshot.records.length + 1
    || sealSnapshot.previousRecordSha256 !== previousRecord
    || seal.slot_sequence !== sealSnapshot.slotSequence
    || seal.seal_sha256 !== sha256Object(withoutKeys(seal, ['seal_sha256']))) fail('RUN_EVIDENCE_SEAL_INVALID');
  const sealEnvelope = {
    protocol: 'devseek.run-evidence-record/v1',
    record_kind: 'seal',
    slot_sequence: sealSnapshot.slotSequence,
    previous_record_sha256: sealSnapshot.previousRecordSha256,
    seal,
  };
  if (sealSnapshot.recordSha256 !== sha256Object(sealEnvelope)) fail('RUN_EVIDENCE_SEAL_RECORD_HASH_MISMATCH');
}

function headsFromStreams(streams) {
  const head = stream => {
    const event = stream.events.at(-1);
    return {
      stream_kind: stream.stream_kind,
      correlation_id: stream.correlation_id,
      sequence: event.sequence,
      event_id: event.event_id,
      event_sha256: event.event_sha256,
    };
  };
  const campaign = streams.find(stream => stream.stream_kind === 'plan');
  return {
    campaign: head(campaign),
    sessions: streams.filter(stream => stream.stream_kind === 'session').map(head)
      .sort((left, right) => left.correlation_id.localeCompare(right.correlation_id)),
    attempts: streams.filter(stream => stream.stream_kind === 'attempt').map(head)
      .sort((left, right) => left.correlation_id.localeCompare(right.correlation_id)),
  };
}

function assertDenominatorConservation(accounting) {
  const partition = accounting.passed_slot_count + accounting.product_miss_slot_count
    + accounting.infra_invalid_slot_count + accounting.unclassified_slot_count
    + accounting.unconsumed_or_blocked_slot_count;
  if (partition !== accounting.planned_coverage_slot_count
    || accounting.denominator_count !== accounting.passed_slot_count + accounting.product_miss_slot_count
    || accounting.numerator_count !== accounting.passed_slot_count
    || accounting.excluded_from_denominator.length !== accounting.planned_coverage_slot_count - accounting.denominator_count) {
    fail('SLOT_ACCOUNTING_NOT_CONSERVED');
  }
}

function assertPurposeAndIdentitySeparation(frozenEvidence, policy) {
  const qualificationMaterials = new Set(frozenEvidence.key_registry.keys.map(entry => entry.public_key_spki_sha256));
  const qualificationIdentities = new Set(frozenEvidence.key_registry.keys.map(entry => entry.identity));
  for (const entry of [...policy.manifest_signers, ...policy.retention_signers]) {
    if (qualificationMaterials.has(entry.public_key_spki_sha256)) fail('CROSS_REGISTRY_KEY_MATERIAL_REUSE');
    if (qualificationIdentities.has(entry.identity)) fail('CROSS_ROLE_IDENTITY_REUSE');
  }
}

function assertManifestSignerIndependent(attestation, frozenEvidence, policy) {
  const signer = findPolicyKey(policy, MANIFEST_SIGNATURE_PURPOSE, attestation.key_id, attestation.signer_identity);
  const actors = new Set(frozenEvidence.event_streams.flatMap(stream => stream.events.map(event => event.actor_id)));
  actors.add(frozenEvidence.plan.plan_attestation.signer_identity);
  if (actors.has(signer.identity)) fail('MANIFEST_SIGNER_NOT_INDEPENDENT');
}

function assertRetentionSignerIndependent(attestation, manifest, frozenEvidence) {
  const actors = new Set(frozenEvidence.event_streams.flatMap(stream => stream.events.map(event => event.actor_id)));
  actors.add(frozenEvidence.plan.plan_attestation.signer_identity);
  actors.add(manifest.manifest_attestation.signer_identity);
  if (actors.has(attestation.signer_identity)) fail('RETENTION_SIGNER_NOT_INDEPENDENT');
}

function verifyManifestStructureAndSignature(manifest, policy, now) {
  assertSchema(SCHEMAS.manifest, manifest, 'EVIDENCE_MANIFEST_SCHEMA_INVALID');
  assertManifestTimeWindow(manifest, policy);
  if (manifest.aggregation_policy_sha256 !== policy.policy_sha256
    || manifest.integrity_scope !== policy.integrity_scope) fail('MANIFEST_POLICY_BINDING_MISMATCH');
  if (!manifest.qualification_eligible && manifest.qualification_claims.length !== 0) {
    fail('INELIGIBLE_MANIFEST_QUALIFICATION_CLAIMS_FORBIDDEN');
  }
  if (manifest.evidence_manifest_sha256 !== qualificationEvidenceManifestHash(manifest)) fail('EVIDENCE_MANIFEST_HASH_MISMATCH');
  if (canonicalJson(manifest.validity.invalidated_by) !== canonicalJson(INVALIDATION_RULES)) fail('MANIFEST_INVALIDATION_RULES_INCOMPLETE');
  verifyAggregatorSignature({
    domain: 'devseek/qualification-evidence-manifest-signature/v1',
    purpose: MANIFEST_SIGNATURE_PURPOSE,
    payload: manifestSignaturePayload(manifest),
    attestation: manifest.manifest_attestation,
    policy,
    now,
  });
  return true;
}

function signManifestPayload(manifest, signer, policy) {
  return signAggregatorPayload({
    domain: 'devseek/qualification-evidence-manifest-signature/v1',
    purpose: MANIFEST_SIGNATURE_PURPOSE,
    payload: manifestSignaturePayload(manifest),
    signer,
    policy,
  });
}

function signRetentionPayload(lock, signer, policy) {
  return signAggregatorPayload({
    domain: 'devseek/qualification-retention-lock-signature/v1',
    purpose: RETENTION_SIGNATURE_PURPOSE,
    payload: retentionSignaturePayload(lock),
    signer,
    policy,
  });
}

function signAggregatorPayload({ domain, purpose, payload, signer, policy }) {
  const entry = findPolicyKey(policy, purpose, signer?.keyId, signer?.identity);
  if (!signer?.privateKey) fail('AGGREGATOR_PRIVATE_SIGNER_REQUIRED');
  const material = aggregatorSignatureMaterial({ domain, purpose, payload, entry, policy });
  return {
    algorithm: 'ed25519',
    key_id: entry.key_id,
    signer_identity: entry.identity,
    purpose,
    aggregation_policy_sha256: policy.policy_sha256,
    signed_payload_sha256: sha256Object(material),
    signature_base64: crypto.sign(null, Buffer.from(canonicalJson(material), 'utf8'), signer.privateKey).toString('base64'),
  };
}

function verifyAggregatorSignature({ domain, purpose, payload, attestation, policy, now }) {
  if (!attestation || attestation.algorithm !== 'ed25519' || attestation.purpose !== purpose
    || attestation.aggregation_policy_sha256 !== policy.policy_sha256) fail('AGGREGATOR_SIGNATURE_HEADER_INVALID');
  const entry = findPolicyKey(policy, purpose, attestation.key_id, attestation.signer_identity);
  assertPolicyKeyCurrent(entry, now);
  const material = aggregatorSignatureMaterial({ domain, purpose, payload, entry, policy });
  if (attestation.signed_payload_sha256 !== sha256Object(material)) fail('AGGREGATOR_SIGNED_PAYLOAD_HASH_MISMATCH');
  const publicKey = crypto.createPublicKey({ key: strictBase64(entry.public_key_spki_base64), format: 'der', type: 'spki' });
  if (!crypto.verify(null, Buffer.from(canonicalJson(material), 'utf8'), publicKey, strictBase64(attestation.signature_base64))) {
    fail('AGGREGATOR_SIGNATURE_INVALID');
  }
}

function aggregatorSignatureMaterial({ domain, purpose, payload, entry, policy }) {
  return {
    algorithm: 'ed25519',
    domain,
    purpose,
    key_id: entry.key_id,
    signer_identity: entry.identity,
    aggregation_policy_sha256: policy.policy_sha256,
    payload,
  };
}

function manifestSignaturePayload(manifest) {
  return {
    schema_version: manifest.schema_version,
    manifest_id: manifest.manifest_id,
    evidence_manifest_sha256: manifest.evidence_manifest_sha256,
    candidate_identity_sha256: manifest.frozen_identity.candidate_identity_sha256,
    qualification_plan_sha256: manifest.frozen_identity.qualification_plan_sha256,
    profile_sha256: manifest.frozen_identity.profile_sha256,
    generated_at: manifest.generated_at,
    expires_at: manifest.validity.expires_at,
  };
}

function retentionSignaturePayload(lock) {
  return {
    schema_version: lock.schema_version,
    lock_id: lock.lock_id,
    lock_sha256: lock.lock_sha256,
    manifest_id: lock.manifest_id,
    evidence_manifest_sha256: lock.evidence_manifest_sha256,
    retained_at: lock.retained_at,
    retain_until: lock.retain_until,
    previous_lock_sha256: lock.previous_lock_sha256,
  };
}

function findPolicyKey(policy, purpose, keyId, identity) {
  const entries = purpose === MANIFEST_SIGNATURE_PURPOSE ? policy.manifest_signers : policy.retention_signers;
  const entry = entries.find(candidate => candidate.key_id === keyId && candidate.identity === identity && candidate.purpose === purpose);
  if (!entry) fail('AGGREGATOR_SIGNER_NOT_ALLOWLISTED', `${purpose}:${keyId}:${identity}`);
  return entry;
}

function assertPolicyKeyCurrent(entry, now) {
  requireCanonicalTime(now, 'SIGNER_VERIFICATION_TIME_INVALID');
  if (entry.status === 'revoked' || !['active', 'test-only'].includes(entry.status)) fail('AGGREGATOR_SIGNER_REVOKED_OR_INACTIVE', entry.key_id);
  const epoch = Date.parse(now);
  if (epoch < Date.parse(entry.valid_from) || (entry.expires_at !== null && epoch >= Date.parse(entry.expires_at))) {
    fail('AGGREGATOR_SIGNER_NOT_CURRENT', entry.key_id);
  }
}

function assertCurrentStateMatchesManifest(state, manifest) {
  const frozen = manifest.frozen_identity;
  const direct = [
    'candidate_identity_sha256', 'source_tree_sha256', 'installed_artifact_sha256', 'bridge_artifact_sha256',
    'qualification_plan_sha256', 'profile_sha256', 'catalog_sha256', 'key_registry_sha256',
    'oracle_bundle_sha256', 'corpus_sha256', 'metric_and_statistical_plan_sha256',
    'dependency_snapshot_sha256', 'provider_connector_sha256', 'provider', 'platform_profile',
    'execution_environment_sha256',
  ];
  for (const key of direct) if (state[key] !== frozen[key]) fail('MANIFEST_CURRENT_IDENTITY_INVALIDATED', key);
  if (canonicalJson(state.surfaces) !== canonicalJson(frozen.surface_set)) fail('MANIFEST_SURFACE_SET_INVALIDATED');
  if (canonicalJson(state.event_stream_heads) !== canonicalJson(manifest.event_stream_heads)) fail('MANIFEST_EVENT_HEAD_INVALIDATED');
}

function claimTuple(value) {
  return [value.capability_id, value.profile_id, value.profile_sha256, value.claim_scope,
    value.surface, value.provider, value.platform_profile].join('\0');
}

function eventRef(event) {
  return { event_id: event.event_id, event_sha256: event.event_sha256 };
}

function assertCreatedOrEqual(directoryPin, basename, value, code) {
  if (secureAtomicCompareAndCreate(directoryPin, basename, value).created) return;
  if (canonicalJson(readStoreJson(directoryPin, basename, code)) !== canonicalJson(value)) fail(code);
}

function assertNoSymlinkPath(target) {
  const resolved = path.resolve(target);
  const parts = resolved.split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = lstatIfExists(current);
    if (stat?.isSymbolicLink()) fail('RETENTION_SYMLINK_PATH_FORBIDDEN', current);
  }
}

function assertSecureStoreLayout(rootDir) {
  assertSecureDirectory(rootDir);
  for (const directory of STORE_DIRECTORY_NAMES) {
    assertSecureDirectory(path.join(rootDir, directory));
  }
}

function captureStoreLayoutPins(rootDir) {
  const pins = [];
  try {
    for (const { name, componentPath } of storeComponentPaths(rootDir)) {
      const descriptor = fs.openSync(componentPath,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
      const stat = fs.fstatSync(descriptor);
      assertPosixSecureDirectoryStat(stat, componentPath);
      const pin = Object.freeze({
        component_name: name,
        component_path: componentPath,
        device: stat.dev,
        inode: stat.ino,
        realpath: fs.realpathSync.native(componentPath),
        descriptor,
        capability_path: path.join(PROC_SELF_FD_DIR, String(descriptor)),
      });
      pins.push(pin);
      assertStoreCapabilityPin(pin, { startup: true });
    }
    return Object.freeze(pins);
  } catch (error) {
    for (const pin of pins) fs.closeSync(pin.descriptor);
    throw error;
  }
}

function assertPinnedStoreLayout(rootDir, pins) {
  assertSecureStoreLayout(rootDir);
  if (!Array.isArray(pins) || pins.length !== 5) fail('RETENTION_STORE_PIN_SET_INVALID');
  for (const pin of pins) {
    assertStoreCapabilityPin(pin);
    const stat = lstatIfExists(pin.component_path);
    if (!stat?.isDirectory()
      || stat.dev !== pin.device
      || stat.ino !== pin.inode
      || fs.realpathSync.native(pin.component_path) !== pin.realpath) {
      fail('RETENTION_STORE_COMPONENT_SUBSTITUTED', pin.component_path);
    }
  }
}

function storeComponentPaths(rootDir) {
  return [
    { name: 'root', componentPath: rootDir },
    ...STORE_DIRECTORY_NAMES.map(name => ({ name, componentPath: path.join(rootDir, name) })),
  ];
}

function assertSecureDirectory(directoryPath) {
  assertNoSymlinkPath(directoryPath);
  const stat = lstatIfExists(directoryPath);
  if (!stat?.isDirectory()) fail('RETENTION_STORE_COMPONENT_INVALID', directoryPath);
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_DIRECTORY)) {
    fail('RETENTION_NOFOLLOW_UNAVAILABLE');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      fail('RETENTION_STORE_COMPONENT_CHANGED', directoryPath);
    }
    assertPosixSecureDirectoryStat(opened, directoryPath);
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    if (error.code === 'ELOOP') fail('RETENTION_SYMLINK_PATH_FORBIDDEN', directoryPath);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (fs.realpathSync.native(directoryPath) !== path.resolve(directoryPath)) {
    fail('RETENTION_STORE_REALPATH_MISMATCH', directoryPath);
  }
}

function assertRetentionExpectedAnchor(policy, anchor, pins) {
  if (policy.retention_policy.independent_expected_anchor_required && anchor == null) {
    fail('RETENTION_EXPECTED_ANCHOR_REQUIRED');
  }
  if (!anchor || typeof anchor !== 'object' || !Number.isSafeInteger(anchor.record_count)
    || anchor.record_count < 0) fail('RETENTION_EXPECTED_ANCHOR_INVALID');
  const genesis = anchor.record_count === 0;
  if (genesis !== (anchor.final_record_sha256 === null && anchor.final_lock_sha256 === null)) {
    fail('RETENTION_EXPECTED_ANCHOR_INVALID');
  }
  if (!genesis && (!SHA256_RE.test(anchor.final_record_sha256 ?? '')
    || !SHA256_RE.test(anchor.final_lock_sha256 ?? ''))) fail('RETENTION_EXPECTED_ANCHOR_INVALID');
  if (genesis) {
    const pristine = STORE_DIRECTORY_NAMES
      .every(directory => readStoreDirectory(storeComponentPin(pins, directory)).length === 0);
    if (!pristine) fail('RETENTION_GENESIS_ANCHOR_NOT_PRISTINE');
  }
}

function secureAtomicCompareAndCreate(directoryPin, basename, value) {
  assertStoreCapabilityPin(directoryPin);
  const filePath = storeCapabilityChildPath(directoryPin, basename);
  const tempBasename = `${basename}.candidate-${process.pid}-${crypto.randomUUID()}`;
  const tempPath = storeCapabilityChildPath(directoryPin, tempBasename);
  const payload = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
      | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, payload, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(tempPath, filePath);
    fs.unlinkSync(tempPath);
    fs.fsyncSync(directoryPin.descriptor);
    assertStoreCapabilityPin(directoryPin);
    assertRegularStoreFile(directoryPin, basename);
    return { created: true };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(tempPath); } catch {}
    if (error.code === 'EEXIST') {
      fs.fsyncSync(directoryPin.descriptor);
      assertStoreCapabilityPin(directoryPin);
      assertRegularStoreFile(directoryPin, basename);
      return { created: false };
    }
    throw error;
  }
}

function readStoreJson(directoryPin, basename, missingCode) {
  assertStoreCapabilityPin(directoryPin);
  const filePath = storeCapabilityChildPath(directoryPin, basename);
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) fail('RETENTION_NOFOLLOW_UNAVAILABLE');
  const expected = lstatIfExists(filePath);
  if (!expected) fail(missingCode, filePath);
  if (expected.isSymbolicLink()) fail('RETENTION_SYMLINK_PATH_FORBIDDEN', filePath);
  if (!expected.isFile()) fail('RETENTION_STORE_COMPONENT_INVALID', filePath);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
      fail('RETENTION_STORE_COMPONENT_CHANGED', filePath);
    }
    const result = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    assertStoreCapabilityPin(directoryPin);
    return result;
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(missingCode, filePath);
    if (error.code === 'ELOOP') fail('RETENTION_SYMLINK_PATH_FORBIDDEN', filePath);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertRegularStoreFile(directoryPin, basename) {
  assertStoreCapabilityPin(directoryPin);
  const filePath = storeCapabilityChildPath(directoryPin, basename);
  const stat = lstatIfExists(filePath);
  if (stat?.isSymbolicLink()) fail('RETENTION_SYMLINK_PATH_FORBIDDEN', filePath);
  if (!stat?.isFile()) fail('RETENTION_STORE_COMPONENT_INVALID', filePath);
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) fail('RETENTION_NOFOLLOW_UNAVAILABLE');
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      fail('RETENTION_STORE_COMPONENT_CHANGED', filePath);
    }
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    if (error.code === 'ELOOP') fail('RETENTION_SYMLINK_PATH_FORBIDDEN', filePath);
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  assertStoreCapabilityPin(directoryPin);
}

function assertPosixSecureDirectoryStat(stat, directoryPath) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    fail('RETENTION_POSIX_SECURITY_UNAVAILABLE', directoryPath);
  }
  if (stat.uid !== process.getuid()) fail('RETENTION_STORE_OWNER_INVALID', directoryPath);
  if ((stat.mode & 0o022) !== 0) fail('RETENTION_STORE_PERMISSIONS_INSECURE', directoryPath);
}

function assertStoreCapabilityPin(pin, { startup = false } = {}) {
  if (!pin || !Number.isInteger(pin.descriptor) || typeof pin.capability_path !== 'string') {
    fail('RETENTION_STORE_PIN_SET_INVALID');
  }
  let descriptorStat;
  let capabilityStat;
  try {
    descriptorStat = fs.fstatSync(pin.descriptor);
    capabilityStat = fs.statSync(pin.capability_path);
  } catch {
    fail(startup ? 'RETENTION_PROC_FD_UNAVAILABLE' : 'RETENTION_STORE_PIN_DESCRIPTOR_INVALID', pin.component_path);
  }
  if (!descriptorStat.isDirectory() || !capabilityStat.isDirectory()
    || descriptorStat.dev !== pin.device || descriptorStat.ino !== pin.inode
    || capabilityStat.dev !== pin.device || capabilityStat.ino !== pin.inode) {
    fail('RETENTION_STORE_CAPABILITY_MISMATCH', pin.component_path);
  }
  assertPosixSecureDirectoryStat(descriptorStat, pin.component_path);
  if (startup) {
    let capabilityRealpath;
    try {
      capabilityRealpath = fs.realpathSync.native(pin.capability_path);
    } catch {
      fail('RETENTION_PROC_FD_UNAVAILABLE', pin.component_path);
    }
    if (capabilityRealpath !== pin.realpath) fail('RETENTION_STORE_CAPABILITY_MISMATCH', pin.component_path);
  }
}

function storeComponentPin(pins, name) {
  const pin = pins?.find(candidate => candidate.component_name === name);
  if (!pin) fail('RETENTION_STORE_PIN_SET_INVALID', name);
  return pin;
}

function storeCapabilityChildPath(directoryPin, basename) {
  if (typeof basename !== 'string' || !SAFE_STORE_BASENAME_RE.test(basename)
    || basename === '.' || basename === '..' || path.basename(basename) !== basename) {
    fail('RETENTION_STORE_PATH_ESCAPE', basename);
  }
  return path.join(directoryPin.capability_path, basename);
}

function readStoreDirectory(directoryPin) {
  assertStoreCapabilityPin(directoryPin);
  const names = fs.readdirSync(directoryPin.capability_path);
  if (!names.every(name => typeof name === 'string' && SAFE_STORE_BASENAME_RE.test(name))) {
    fail('RETENTION_STORE_UNSAFE_ENTRY_NAME', directoryPin.component_path);
  }
  assertStoreCapabilityPin(directoryPin);
  return names;
}

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function buildSchemaValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const read = file => JSON.parse(fs.readFileSync(path.join(PROCESS_DIR, file), 'utf8'));
  for (const file of [
    'devseek-candidate-identity.schema.json',
    'devseek-golden-case-catalog.schema.json',
    'devseek-qualification-key-registry.schema.json',
    'devseek-qualification-profile.schema.json',
    'devseek-qualification-plan.schema.json',
    'devseek-qualification-event.schema.json',
    'devseek-qualification-receipt.schema.json',
    'devseek-run-evidence-event.schema.json',
    'devseek-run-evidence-receipt.schema.json',
    'devseek-run-evidence-seal.schema.json',
  ]) ajv.addSchema(read(file));
  const profileSet = read('devseek-qualification-profile.schema.json');
  return {
    policy: ajv.compile(read('devseek-qualification-aggregator-policy.schema.json')),
    manifest: ajv.compile(read('devseek-qualification-evidence-manifest.schema.json')),
    retention: ajv.compile(read('devseek-qualification-retention-lock.schema.json')),
    profile: ajv.getSchema(`${profileSet.$id}#/$defs/profile`),
    catalog: ajv.getSchema('https://devseek.local/schemas/devseek-golden-case-catalog-v1.json'),
    receipt: ajv.getSchema('https://devseek.local/schemas/devseek-qualification-receipt-v1.json'),
    runSnapshot: ajv.compile(read('devseek-run-evidence-snapshot.schema.json')),
    runAnchor: ajv.compile(read('devseek-run-evidence-expected-anchor.schema.json')),
  };
}

function assertSchema(validator, value, code) {
  if (!validator(value)) fail(code, validator.errors.map(error => `${error.instancePath || '/'}:${error.keyword}`).join(';'), validator.errors);
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function strictBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    fail('BASE64_INVALID');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail('BASE64_NONCANONICAL');
  return bytes;
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, 'utf8'));
}

function requireCanonicalTime(value, code) {
  if (!CANONICAL_TIME_RE.test(value ?? '')) fail(code);
  try {
    if (new Date(value).toISOString() !== value) fail(code);
  } catch (error) {
    if (error instanceof QualificationEvidenceError) throw error;
    fail(code);
  }
}

function assertManifestTimeWindow(manifest, policy, plan = undefined) {
  requireCanonicalTime(manifest.generated_at, 'MANIFEST_GENERATED_AT_INVALID');
  requireCanonicalTime(manifest.validity?.valid_from, 'MANIFEST_VALID_FROM_INVALID');
  requireCanonicalTime(manifest.validity?.expires_at, 'MANIFEST_EXPIRES_AT_INVALID');
  if (manifest.validity.valid_from !== manifest.generated_at) fail('MANIFEST_VALID_FROM_MUST_EQUAL_GENERATED_AT');
  const generated = Date.parse(manifest.generated_at);
  const expires = Date.parse(manifest.validity.expires_at);
  if (!(generated < expires)) fail('MANIFEST_VALIDITY_WINDOW_INVALID');
  if (expires - generated > policy.maximum_manifest_ttl_seconds * 1000) {
    fail('MANIFEST_MAXIMUM_TTL_EXCEEDED');
  }
  if (plan) {
    requireCanonicalTime(plan.expires_at, 'QUALIFICATION_PLAN_EXPIRES_AT_INVALID');
    if (expires > Date.parse(plan.expires_at)) fail('MANIFEST_EXPIRES_AFTER_PLAN');
  }
}

function fail(code, message = code, details = undefined) {
  throw new QualificationEvidenceError(code, message, details);
}
