import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  CANONICALIZATION_VERSION,
  HASH_ALGORITHM,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const SIGNATURE_ALGORITHM = 'ed25519';
export const LOCAL_INTEGRITY_SCOPE = 'local-protocol-conformance';
export const QUALIFICATION_PROTOCOL_INTEGRITY = Object.freeze({
  hash_algorithm: HASH_ALGORITHM,
  canonicalization_version: CANONICALIZATION_VERSION,
  signature_algorithm: SIGNATURE_ALGORITHM,
});
export const AUDITED_LOCAL_GOVERNANCE = Object.freeze({
  profile_id: 'GATE0-G0B-LOCAL-PROTOCOL-CONFORMANCE/v1',
  profile_sha256: '95da05aa061d26ff9132719c00851f29cdb1b95bc7d602e7267b4b66f7bb9ab3',
  catalog_id: 'DEVSEEK-G0B-PROTOCOL-CONFORMANCE',
  catalog_sha256: 'a82b73b8d66dafb9060f90ee1d2d70f346b1281c9e98be23dbebb6a4d9059e94',
  key_registry_id: 'DEVSEEK-G0B-LOCAL-TEST-KEYS',
  key_registry_sha256: '4e7dfc5a9bb4cbf11446823f0e0c0fc658c5a57b5b480f2cba6453945beda8cf',
});

const SHA256_RE = /^[a-f0-9]{64}$/u;
const CANONICAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const PROCESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/process');
const SCHEMA_FILES = Object.freeze({
  candidate: 'devseek-candidate-identity.schema.json',
  catalog: 'devseek-golden-case-catalog.schema.json',
  profileSet: 'devseek-qualification-profile.schema.json',
  plan: 'devseek-qualification-plan.schema.json',
  event: 'devseek-qualification-event.schema.json',
  receipt: 'devseek-qualification-receipt.schema.json',
});
const SCHEMA_IDS = Object.freeze({
  catalog: 'https://devseek.local/schemas/devseek-golden-case-catalog-v1.json',
  profile: 'https://devseek.local/schemas/devseek-qualification-profile-set-v1.json#/$defs/profile',
  plan: 'https://devseek.local/schemas/devseek-qualification-plan-v1.json',
  event: 'https://devseek.local/schemas/devseek-qualification-event-v1.json',
  receipt: 'https://devseek.local/schemas/devseek-qualification-receipt-v1.json',
});
const RUNTIME_SCHEMAS = buildRuntimeSchemaValidators();
const PURPOSES = new Set([
  'qualification-plan',
  'runner-event',
  'oracle-classification',
  'infra-adjudication',
  'store-receipt',
  'action-guard',
]);

const EVENT_PURPOSE = new Map([
  ['QualificationPlanRegistered', 'qualification-plan'],
  ['OracleClassified', 'oracle-classification'],
  ['InfraAdjudicated', 'infra-adjudication'],
  ['ExternalActionAuthorized', 'action-guard'],
  ['ExternalActionStarted', 'action-guard'],
]);

const FIRST_EVENT = Object.freeze({
  plan: 'QualificationPlanRegistered',
  session: 'QualificationSessionRegistered',
  attempt: 'AttemptRegistered',
});

const TERMINAL_EVENTS = new Set(['CandidateClosed', 'AttemptTerminated']);
const TRANSITIONS = new Map([
  ['QualificationPlanRegistered', new Set(['CandidateBlocked', 'CandidateClosed'])],
  ['CandidateBlocked', new Set(['CandidateClosed'])],
  ['QualificationSessionRegistered', new Set(['PreflightAttemptStarted', 'ExternalActionAuthorized'])],
  ['PreflightAttemptStarted', new Set(['PreflightObserved', 'QualificationSessionBlocked', 'ExternalActionAuthorized'])],
  ['PreflightObserved', new Set(['PreflightClassified'])],
  ['PreflightClassified', new Set([
    'QualificationSessionReady',
    'QualificationSessionBlocked',
    'SessionProductFailure',
  ])],
  ['QualificationSessionBlocked', new Set(['InfraAdjudicated', 'CandidateClosed'])],
  ['InfraAdjudicated', new Set(['CandidateClosed'])],
  ['QualificationSessionReady', new Set(['SlotBranchSkipped'])],
  ['SlotBranchSkipped', new Set(['SlotBranchSkipped'])],
  ['SessionProductFailure', new Set(['CandidateClosed'])],
  ['AttemptRegistered', new Set(['AttemptStarted'])],
  ['AttemptStarted', new Set(['ExternalActionAuthorized', 'AttemptAbandoned'])],
  ['ExternalActionAuthorized', new Set(['ExternalActionStarted', 'AttemptAbandoned'])],
  ['ExternalActionStarted', new Set(['RunObserved', 'PreflightObserved', 'AttemptAbandoned', 'ExternalActionAuthorized'])],
  ['RunObserved', new Set(['RunObserved', 'PreflightObserved', 'OracleClassified', 'ExternalActionAuthorized'])],
  ['AttemptAbandoned', new Set(['OracleClassified'])],
  ['OracleClassified', new Set(['AttemptTerminated'])],
]);

export class QualificationProtocolError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = 'QualificationProtocolError';
    this.code = code;
    this.details = details;
  }
}

export function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashText(value) {
  return hashBytes(Buffer.from(String(value), 'utf8'));
}

export function publicKeySpkiSha256(publicKeySpkiBase64) {
  return hashBytes(strictBase64Decode(publicKeySpkiBase64));
}

export function keyEntryHash(entry) {
  return sha256Object(withoutKeys(entry, ['key_sha256']));
}

export function keyRegistryHash(registry) {
  return sha256Object(withoutKeys(registry, ['registry_sha256', 'source_status']));
}

export function candidateIdentityHash(candidate) {
  return sha256Object(withoutKeys(candidate, ['candidate_identity_sha256']));
}

export function goldenCaseHash(caseEntry) {
  return sha256Object(withoutKeys(caseEntry, ['case_sha256']));
}

export function goldenCaseCatalogHash(catalog) {
  return sha256Object(withoutKeys(catalog, ['catalog_sha256', 'source_status']));
}

export function qualificationProfileHash(profile) {
  return sha256Object(withoutKeys(profile, ['profile_sha256']));
}

export function preflightSlotHash(slot) {
  return sha256Object(withoutKeys(slot, ['preflight_slot_sha256']));
}

export function coverageSlotHash(slot) {
  return sha256Object(withoutKeys(slot, ['coverage_slot_sha256']));
}

export function qualificationPlanHash(plan) {
  const copy = structuredClone(plan);
  delete copy.qualification_plan_sha256;
  // The attestation signs the content hash. Excluding the complete envelope is
  // intentional: signed_payload_sha256 would otherwise introduce a circular
  // dependency between the object hash and its signature metadata.
  delete copy.plan_attestation;
  return sha256Object(copy);
}

export function qualificationEventHash(event) {
  const copy = structuredClone(event);
  delete copy.event_sha256;
  delete copy.event_attestation;
  return sha256Object(copy);
}

export function qualificationReceiptHash(receipt) {
  const copy = structuredClone(receipt);
  delete copy.receipt_sha256;
  delete copy.attestation;
  return sha256Object(copy);
}

export function validateKeyRegistry(registry, { now = undefined } = {}) {
  const errors = [];
  if (!isObject(registry)) return invalid('KEY_REGISTRY_INVALID', ['registry:expected-object']);
  validateProtocolHeader(registry, 'registry', errors);
  if (registry.schema_version !== 'devseek.qualification-key-registry/v1') {
    errors.push('registry.schema_version:unsupported');
  }
  if (registry.integrity_scope !== LOCAL_INTEGRITY_SCOPE
    || registry.qualification_eligible !== false
    || registry.source_status !== 'verified'
    || !SAFE_ID_RE.test(registry.registry_id ?? '')
    || !Number.isSafeInteger(registry.registry_version)
    || registry.registry_version < 1) errors.push('registry:local-contract-invalid');
  if (!Array.isArray(registry.keys) || registry.keys.length === 0) errors.push('registry.keys:required');
  const ids = new Set();
  const identities = new Set();
  const publicKeys = new Set();
  for (const [index, entry] of (registry.keys ?? []).entries()) {
    const at = `registry.keys[${index}]`;
    if (!isObject(entry)) { errors.push(`${at}:expected-object`); continue; }
    if (!SAFE_ID_RE.test(entry.key_id ?? '')) errors.push(`${at}.key_id:invalid`);
    if (ids.has(entry.key_id)) errors.push(`${at}.key_id:duplicate`);
    ids.add(entry.key_id);
    if (!SAFE_ID_RE.test(entry.identity ?? '')) errors.push(`${at}.identity:invalid`);
    const identityPurpose = `${entry.identity}:${(entry.purposes ?? []).join(',')}`;
    if (identities.has(identityPurpose)) errors.push(`${at}.identity-purpose:duplicate`);
    identities.add(identityPurpose);
    if (entry.algorithm !== SIGNATURE_ALGORITHM) errors.push(`${at}.algorithm:unsupported`);
    if (entry.public_key_encoding !== 'spki-der-base64') errors.push(`${at}.public_key_encoding:unsupported`);
    let publicKey;
    try {
      const der = strictBase64Decode(entry.public_key_spki_base64);
      if (hashBytes(der) !== entry.public_key_spki_sha256) errors.push(`${at}.public_key_spki_sha256:mismatch`);
      if (publicKeys.has(entry.public_key_spki_sha256)) errors.push(`${at}.public_key_spki_sha256:duplicate-key-material`);
      publicKeys.add(entry.public_key_spki_sha256);
      publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      if (publicKey.asymmetricKeyType !== 'ed25519') errors.push(`${at}.public_key:not-ed25519`);
    } catch (error) {
      errors.push(`${at}.public_key:invalid-${error.code ?? 'encoding'}`);
    }
    if (!Array.isArray(entry.purposes) || entry.purposes.length === 0) errors.push(`${at}.purposes:required`);
    for (const purpose of entry.purposes ?? []) if (!PURPOSES.has(purpose)) errors.push(`${at}.purposes:unsupported-${purpose}`);
    if (entry.key_sha256 !== keyEntryHash(entry)) errors.push(`${at}.key_sha256:mismatch`);
    if (entry.trust_scope !== 'deterministic-test-only'
      || entry.status !== 'test-only'
      || entry.private_key_material_prohibited !== true
      || entry.integrity_scope !== LOCAL_INTEGRITY_SCOPE
      || entry.qualification_eligible !== false) errors.push(`${at}:local-test-key-contract-invalid`);
    if (!canonicalTimestamp(entry.valid_from)) errors.push(`${at}.valid_from:noncanonical`);
    if (entry.expires_at !== null && !canonicalTimestamp(entry.expires_at)) errors.push(`${at}.expires_at:noncanonical`);
    if (entry.expires_at !== null && Date.parse(entry.valid_from) >= Date.parse(entry.expires_at)) errors.push(`${at}:invalid-validity-window`);
    if (now !== undefined && publicKey) {
      const epoch = trustedEpoch(now);
      if (epoch < Date.parse(entry.valid_from)) errors.push(`${at}:not-yet-valid`);
      if (entry.expires_at !== null && epoch >= Date.parse(entry.expires_at)) errors.push(`${at}:expired`);
      if (entry.status === 'revoked' || entry.status === 'expired') errors.push(`${at}:inactive`);
    }
  }
  if (registry.registry_sha256 !== keyRegistryHash(registry)) errors.push('registry.registry_sha256:mismatch');
  return errors.length ? invalid('KEY_REGISTRY_INVALID', errors) : { ok: true, errors: [], summary: { keys: ids.size, registry_sha256: registry.registry_sha256 } };
}

export function findRegistryKey(registry, { keyId, purpose, signerIdentity, now }) {
  const result = validateKeyRegistry(registry, { now });
  if (!result.ok) throw new QualificationProtocolError('KEY_REGISTRY_INVALID', result.errors.join(';'));
  const entry = registry.keys.find(candidate => candidate.key_id === keyId);
  if (!entry) throw new QualificationProtocolError('KEY_UNKNOWN');
  if (!entry.purposes.includes(purpose)) throw new QualificationProtocolError('KEY_PURPOSE_MISMATCH');
  if (entry.identity !== signerIdentity) throw new QualificationProtocolError('KEY_IDENTITY_MISMATCH');
  return entry;
}

export function signProtocolPayload({ domain, purpose, payload, signer, keyRegistrySha256 }) {
  assertPurpose(purpose);
  if (!signer?.privateKey || !SAFE_ID_RE.test(signer.keyId ?? '') || !SAFE_ID_RE.test(signer.identity ?? '')) {
    throw new QualificationProtocolError('SIGNER_INVALID');
  }
  const signed = signatureMaterial({
    algorithm: SIGNATURE_ALGORITHM,
    domain,
    purpose,
    payload,
    keyRegistrySha256,
    keyId: signer.keyId,
    signerIdentity: signer.identity,
  });
  const signature = crypto.sign(null, Buffer.from(canonicalJson(signed), 'utf8'), signer.privateKey);
  return {
    algorithm: SIGNATURE_ALGORITHM,
    key_id: signer.keyId,
    signer_identity: signer.identity,
    purpose,
    key_registry_sha256: keyRegistrySha256,
    signed_payload_sha256: sha256Object(signed),
    signature_base64: signature.toString('base64'),
  };
}

export function verifyProtocolSignature({ domain, purpose, payload, attestation, registry, now }) {
  if (!isObject(attestation)) throw new QualificationProtocolError('SIGNATURE_MISSING');
  if (attestation.algorithm !== SIGNATURE_ALGORITHM) throw new QualificationProtocolError('ALGORITHM_UNSUPPORTED');
  if (attestation.purpose !== purpose) throw new QualificationProtocolError('SIGNATURE_PURPOSE_MISMATCH');
  if (attestation.key_registry_sha256 !== registry.registry_sha256) throw new QualificationProtocolError('KEY_REGISTRY_BINDING_MISMATCH');
  const entry = findRegistryKey(registry, {
    keyId: attestation.key_id,
    purpose,
    signerIdentity: attestation.signer_identity,
    now,
  });
  const signed = signatureMaterial({
    algorithm: attestation.algorithm,
    domain,
    purpose,
    payload,
    keyRegistrySha256: registry.registry_sha256,
    keyId: attestation.key_id,
    signerIdentity: attestation.signer_identity,
  });
  if (attestation.signed_payload_sha256 !== sha256Object(signed)) throw new QualificationProtocolError('SIGNED_PAYLOAD_HASH_MISMATCH');
  const signature = strictBase64Decode(attestation.signature_base64);
  const publicKey = crypto.createPublicKey({
    key: strictBase64Decode(entry.public_key_spki_base64),
    format: 'der',
    type: 'spki',
  });
  if (!crypto.verify(null, Buffer.from(canonicalJson(signed), 'utf8'), publicKey, signature)) {
    throw new QualificationProtocolError('SIGNATURE_INVALID');
  }
  return true;
}

export function createSignedPlan(planInput, { signer, registry }) {
  const plan = structuredClone(planInput);
  hydrateCandidate(plan.candidate_identity);
  for (const slot of plan.preflight_slots ?? []) slot.preflight_slot_sha256 = preflightSlotHash(slot);
  for (const slot of plan.coverage_slots ?? []) slot.coverage_slot_sha256 = coverageSlotHash(slot);
  plan.candidate_identity_sha256 = plan.candidate_identity.candidate_identity_sha256;
  plan.key_registry_sha256 = registry.registry_sha256;
  plan.qualification_plan_sha256 = qualificationPlanHash(plan);
  const payload = planSignaturePayload(plan);
  plan.plan_attestation = signProtocolPayload({
    domain: 'devseek/qualification-plan-signature/v1',
    purpose: 'qualification-plan',
    payload,
    signer,
    keyRegistrySha256: registry.registry_sha256,
  });
  plan.qualification_plan_sha256 = qualificationPlanHash(plan);
  return plan;
}

export function validateQualificationPlan(plan, { registry, profile, catalog, seedReveal, now } = {}) {
  const errors = [];
  try {
    errors.push(...runtimeSchemaErrors('plan', plan, 'plan'));
    validateProtocolHeader(plan, 'plan', errors);
    if (plan.schema_version !== 'devseek.qualification-plan/v1') errors.push('plan.schema_version:unsupported');
    if (plan.integrity_scope !== LOCAL_INTEGRITY_SCOPE || plan.qualification_eligible !== false) errors.push('plan:local-scope-required');
    if (!SAFE_ID_RE.test(plan.qualification_campaign_id ?? '')
      || !SAFE_ID_RE.test(plan.qualification_plan_id ?? '')
      || !SAFE_ID_RE.test(plan.profile_id ?? '')) errors.push('plan:invalid-identity');
    validateCandidateShape(plan.candidate_identity, errors);
    if (candidateIdentityHash(plan.candidate_identity) !== plan.candidate_identity_sha256) errors.push('plan.candidate_identity_sha256:mismatch');
    if (plan.candidate_identity?.candidate_identity_sha256 !== plan.candidate_identity_sha256) errors.push('plan.candidate_identity:self-hash-mismatch');
    if (registry && plan.key_registry_sha256 !== registry.registry_sha256) errors.push('plan.key_registry_sha256:mismatch');
    if (profile && plan.profile_sha256 !== profile.profile_sha256) errors.push('plan.profile_sha256:mismatch');
    if (profile && plan.profile_id !== profile.profile_id) errors.push('plan.profile_id:mismatch');
    if (catalog && plan.catalog_sha256 !== catalog.catalog_sha256) errors.push('plan.catalog_sha256:mismatch');
    for (const field of [
      'profile_sha256',
      'catalog_sha256',
      'key_registry_sha256',
      'oracle_bundle_sha256',
      'corpus_sha256',
      'metric_and_statistical_plan_sha256',
      'execution_environment_sha256',
    ]) if (!SHA256_RE.test(plan[field] ?? '')) errors.push(`plan.${field}:invalid`);
    if (plan.competitor_identity_set_sha256 !== null && !SHA256_RE.test(plan.competitor_identity_set_sha256 ?? '')) {
      errors.push('plan.competitor_identity_set_sha256:invalid');
    }
    if (plan.randomization?.algorithm !== 'sha256-counter-v1'
      || !SHA256_RE.test(plan.randomization?.seed_commitment_sha256 ?? '')
      || !SAFE_ID_RE.test(plan.randomization?.seed_reveal_encrypted_ref ?? '')
      || plan.randomization?.reveal_after_event !== 'QualificationPlanRegistered'
      || plan.randomization?.commitment_verification_required !== true) errors.push('plan.randomization:invalid');
    if (!canonicalTimestamp(plan.created_at) || !canonicalTimestamp(plan.valid_from) || !canonicalTimestamp(plan.expires_at)) errors.push('plan:noncanonical-time');
    const created = Date.parse(plan.created_at);
    const validFrom = Date.parse(plan.valid_from);
    const expires = Date.parse(plan.expires_at);
    if (!(validFrom <= created && created < expires)) errors.push('plan:invalid-validity-window');
    if (!Array.isArray(plan.preflight_slots) || plan.preflight_slots.length === 0) errors.push('plan.preflight_slots:required');
    if (!Array.isArray(plan.coverage_slots) || plan.coverage_slots.length === 0) errors.push('plan.coverage_slots:required');
    const ids = new Set();
    const orders = new Set();
    const preflight = new Map();
    for (const slot of plan.preflight_slots ?? []) {
      validateSlotBase(slot, 'preflight', ids, orders, validFrom, expires, errors);
      validateAllowedActions(slot.allowed_actions, `preflight:${slot.preflight_slot_id}`, errors);
      if (slot.preflight_slot_sha256 !== preflightSlotHash(slot)) errors.push(`preflight:${slot.preflight_slot_id}:hash-mismatch`);
      preflight.set(slot.preflight_slot_id, slot);
      if (slot.retry_of_preflight_slot_id !== null) {
        const prior = preflight.get(slot.retry_of_preflight_slot_id);
        if (!prior || prior.order >= slot.order) errors.push(`preflight:${slot.preflight_slot_id}:invalid-retry-edge`);
      }
    }
    for (const slot of plan.coverage_slots ?? []) {
      validateSlotBase(slot, 'coverage', ids, orders, validFrom, expires, errors);
      if (!SAFE_ID_RE.test(slot.case_id ?? '') || !Number.isSafeInteger(slot.case_version) || slot.case_version < 1) {
        errors.push(`coverage:${slot.coverage_slot_id}:invalid-case`);
      }
      if (slot.coverage_slot_sha256 !== coverageSlotHash(slot)) errors.push(`coverage:${slot.coverage_slot_id}:hash-mismatch`);
      const roles = new Set();
      for (const window of slot.attempt_windows ?? []) {
        if (!['primary', 'adjudicated-infra-retry'].includes(window.attempt_role) || roles.has(window.attempt_role)) {
          errors.push(`coverage:${slot.coverage_slot_id}:invalid-or-duplicate-role`);
        }
        roles.add(window.attempt_role);
        if (!preflight.has(window.eligible_preflight_slot_id)) errors.push(`coverage:${slot.coverage_slot_id}:unknown-preflight`);
        validateWindow(window.scheduled_window, validFrom, expires, `coverage:${slot.coverage_slot_id}`, errors);
        if (Array.isArray(window.scheduled_window)
          && (Date.parse(window.scheduled_window[0]) < Date.parse(slot.scheduled_window?.[0])
            || Date.parse(window.scheduled_window[1]) > Date.parse(slot.scheduled_window?.[1]))) {
          errors.push(`coverage:${slot.coverage_slot_id}:attempt-window-outside-slot`);
        }
        validateAllowedActions(window.allowed_actions, `coverage:${slot.coverage_slot_id}:${window.attempt_role}`, errors);
        if (window.attempt_role === 'primary' && window.retry_of_attempt_role !== null) errors.push(`coverage:${slot.coverage_slot_id}:primary-retry-edge-forbidden`);
        if (window.attempt_role === 'adjudicated-infra-retry' && window.retry_of_attempt_role !== 'primary') errors.push(`coverage:${slot.coverage_slot_id}:retry-must-reference-primary`);
      }
      if (!roles.has('primary')) errors.push(`coverage:${slot.coverage_slot_id}:primary-required`);
      if (catalog) {
        const caseEntry = catalog.cases?.find(candidate => candidate.case_id === slot.case_id && candidate.case_version === slot.case_version);
        if (!caseEntry || caseEntry.fixture?.workspace_fixture_sha256 !== slot.workspace_fixture_sha256) {
          errors.push(`coverage:${slot.coverage_slot_id}:catalog-case-binding-mismatch`);
        }
      }
    }
    const ordered = [...orders].sort((left, right) => left - right);
    if (ordered.some((value, index) => value !== index + 1)) errors.push('plan.slots:global-order-must-be-contiguous');
    if (profile) {
      if (profile.profile_sha256 !== qualificationProfileHash(profile)) errors.push('profile.profile_sha256:mismatch');
      const minimum = profile.qualification_plan_policy?.minimum_coverage_slots;
      if (!Number.isSafeInteger(minimum) || plan.coverage_slots.length < minimum) errors.push('plan.coverage_slots:below-profile-minimum');
      for (const requiredCase of profile.required_cases ?? []) {
        if (!plan.coverage_slots.some(slot => slot.case_id === requiredCase.case_id && slot.case_version === requiredCase.case_version)) {
          errors.push(`plan.coverage_slots:missing-required-case-${requiredCase.case_id}`);
        }
      }
      if (profile.catalog_binding?.catalog_sha256 !== plan.catalog_sha256
        || (catalog && profile.catalog_binding?.catalog_id !== catalog.catalog_id)
        || (catalog && profile.catalog_binding?.catalog_version !== catalog.catalog_version)) {
        errors.push('profile.catalog_binding:mismatch');
      }
      if (registry && profile.key_registry_binding
        && (profile.key_registry_binding.registry_id !== registry.registry_id
          || profile.key_registry_binding.registry_version !== registry.registry_version
          || profile.key_registry_binding.registry_sha256 !== registry.registry_sha256)) {
        errors.push('profile.key_registry_binding:mismatch');
      }
    }
    if (catalog) {
      if (catalog.catalog_sha256 !== goldenCaseCatalogHash(catalog)) errors.push('catalog.catalog_sha256:mismatch');
      const catalogIdentities = new Set();
      for (const caseEntry of catalog.cases ?? []) {
        const identity = `${caseEntry.case_id}@${caseEntry.case_version}`;
        if (catalogIdentities.has(identity)) errors.push(`catalog.cases:duplicate-${identity}`);
        catalogIdentities.add(identity);
        if (caseEntry.case_sha256 !== goldenCaseHash(caseEntry)) errors.push(`catalog.cases:${identity}:hash-mismatch`);
      }
      for (const requiredCase of profile?.required_cases ?? []) {
        const approved = catalog.cases?.find(caseEntry => caseEntry.case_id === requiredCase.case_id
          && caseEntry.case_version === requiredCase.case_version);
        if (!approved
          || approved.case_sha256 !== requiredCase.case_sha256
          || approved.category !== requiredCase.category) {
          errors.push(`profile.required_cases:${requiredCase.case_id}:catalog-binding-mismatch`);
        }
      }
    }
    if (seedReveal !== undefined && hashText(seedReveal) !== plan.randomization?.seed_commitment_sha256) errors.push('plan.randomization:seed-commitment-mismatch');
    const calculated = qualificationPlanHash(plan);
    if (calculated !== plan.qualification_plan_sha256) errors.push('plan.qualification_plan_sha256:mismatch');
    if (registry) verifyProtocolSignature({
      domain: 'devseek/qualification-plan-signature/v1',
      purpose: 'qualification-plan',
      payload: planSignaturePayload(plan),
      attestation: plan.plan_attestation,
      registry,
      now: now ?? plan.created_at,
    });
    if (now !== undefined) {
      const epoch = trustedEpoch(now);
      if (epoch < validFrom || epoch >= expires) errors.push('plan:not-currently-valid');
    }
  } catch (error) {
    errors.push(`plan:${error.code ?? error.message}`);
  }
  return errors.length ? invalid('PLAN_INVALID', errors) : { ok: true, errors: [], summary: { plan_sha256: plan.qualification_plan_sha256 } };
}

export function createSignedEvent(eventInput, { signer, registry }) {
  const event = structuredClone(eventInput);
  event.key_registry_sha256 = registry.registry_sha256;
  event.event_sha256 = qualificationEventHash(event);
  const purpose = eventPurpose(event.event_type);
  event.event_attestation = signProtocolPayload({
    domain: 'devseek/qualification-event-signature/v1',
    purpose,
    payload: eventSignaturePayload(event),
    signer,
    keyRegistrySha256: registry.registry_sha256,
  });
  event.event_sha256 = qualificationEventHash(event);
  return event;
}

export function verifyQualificationEvent(event, { registry, now, priorEvent = undefined, plan = undefined }) {
  if (!isObject(event)) throw new QualificationProtocolError('EVENT_INVALID');
  validateProtocolHeaderOrThrow(event);
  if (event.schema_version !== 'devseek.qualification-event/v1') throw new QualificationProtocolError('EVENT_SCHEMA_UNSUPPORTED');
  if (!['plan', 'session', 'attempt'].includes(event.stream_kind)) throw new QualificationProtocolError('EVENT_STREAM_KIND_INVALID');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new QualificationProtocolError('EVENT_SEQUENCE_INVALID');
  if (!canonicalTimestamp(event.occurred_at) || !canonicalTimestamp(event.recorded_at)) throw new QualificationProtocolError('EVENT_TIME_NONCANONICAL');
  const occurredEpoch = Date.parse(event.occurred_at);
  const recordedEpoch = Date.parse(event.recorded_at);
  const verificationEpoch = trustedEpoch(now);
  if (occurredEpoch > recordedEpoch || recordedEpoch > verificationEpoch) throw new QualificationProtocolError('EVENT_TIME_INVALID');
  if (event.event_sha256 !== qualificationEventHash(event)) throw new QualificationProtocolError('EVENT_HASH_MISMATCH');
  if (event.key_registry_sha256 !== registry.registry_sha256) throw new QualificationProtocolError('EVENT_KEY_REGISTRY_MISMATCH');
  if (event.actor_id !== event.event_attestation?.signer_identity) throw new QualificationProtocolError('EVENT_ACTOR_IDENTITY_MISMATCH');
  if (priorEvent) {
    if (event.sequence !== priorEvent.sequence + 1) throw new QualificationProtocolError('EVENT_SEQUENCE_CONFLICT');
    if (event.previous_event_sha256 !== priorEvent.event_sha256) throw new QualificationProtocolError('EVENT_CHAIN_MISMATCH');
    if (event.stream_kind !== priorEvent.stream_kind || event.correlation_id !== priorEvent.correlation_id) throw new QualificationProtocolError('EVENT_STREAM_BINDING_MISMATCH');
    if (recordedEpoch < Date.parse(priorEvent.recorded_at)) throw new QualificationProtocolError('EVENT_TIME_NONMONOTONIC');
    if (TERMINAL_EVENTS.has(priorEvent.event_type)) throw new QualificationProtocolError('EVENT_STREAM_SEALED');
    if (!(TRANSITIONS.get(priorEvent.event_type)?.has(event.event_type))) throw new QualificationProtocolError('EVENT_TRANSITION_INVALID');
  } else {
    if (event.sequence !== 1 || event.previous_event_sha256 !== null) throw new QualificationProtocolError('EVENT_GENESIS_INVALID');
    if (event.event_type !== FIRST_EVENT[event.stream_kind]) throw new QualificationProtocolError('EVENT_FIRST_TYPE_INVALID');
  }
  if (plan) {
    if (event.qualification_plan_sha256 !== plan.qualification_plan_sha256) throw new QualificationProtocolError('EVENT_PLAN_BINDING_MISMATCH');
    if (event.candidate_identity_sha256 !== plan.candidate_identity_sha256) throw new QualificationProtocolError('EVENT_CANDIDATE_BINDING_MISMATCH');
    if (recordedEpoch < Date.parse(plan.valid_from) || recordedEpoch >= Date.parse(plan.expires_at)) throw new QualificationProtocolError('EVENT_OUTSIDE_PLAN_WINDOW');
  }
  const purpose = eventPurpose(event.event_type);
  verifyProtocolSignature({
    domain: 'devseek/qualification-event-signature/v1',
    purpose,
    payload: eventSignaturePayload(event),
    attestation: event.event_attestation,
    registry,
    now,
  });
  assertRuntimeSchema('event', event, 'EVENT_SCHEMA_INVALID');
  return true;
}

export function atomicCompareAndCreate(filePath, value) {
  const directory = path.dirname(filePath);
  durableMkdir(directory);
  const temp = `${filePath}.candidate-${process.pid}-${crypto.randomUUID()}`;
  const payload = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(temp, filePath);
    fs.unlinkSync(temp);
    fsyncDirectory(directory);
    return { created: true };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch {}
    if (error.code === 'EEXIST') {
      // A competing writer may have linked the winner but not yet synced the
      // directory entry. Do not acknowledge that winner before this process
      // has also issued the durability barrier.
      fsyncDirectory(directory);
      return { created: false };
    }
    throw error;
  }
}

export class LocalQualificationProtocolStore {
  constructor({
    rootDir,
    registry,
    now,
    storeSigner,
    guardSigner,
    approvedProfile,
    approvedCatalog,
    governanceMode = 'audited-local-source',
  }) {
    this.rootDir = path.resolve(rootDir);
    this.registry = registry;
    this.now = now ?? (() => new Date());
    this.storeSigner = storeSigner;
    this.guardSigner = guardSigner;
    const registryResult = validateKeyRegistry(registry);
    if (!registryResult.ok) throw new QualificationProtocolError('KEY_REGISTRY_INVALID', registryResult.errors.join(';'));
    let trustedProfile = approvedProfile;
    let trustedCatalog = approvedCatalog;
    if (governanceMode === 'audited-local-source') {
      const audited = loadAuditedLocalGovernance(registry);
      if (approvedProfile && canonicalJson(approvedProfile) !== canonicalJson(audited.profile)) {
        throw new QualificationProtocolError('APPROVED_PROFILE_SOURCE_MISMATCH');
      }
      if (approvedCatalog && canonicalJson(approvedCatalog) !== canonicalJson(audited.catalog)) {
        throw new QualificationProtocolError('APPROVED_CATALOG_SOURCE_MISMATCH');
      }
      trustedProfile = audited.profile;
      trustedCatalog = audited.catalog;
    }
    validateApprovedGovernanceSources({
      profile: trustedProfile,
      catalog: trustedCatalog,
      registry,
      governanceMode,
    });
    this.approvedProfile = structuredClone(trustedProfile);
    this.approvedCatalog = structuredClone(trustedCatalog);
    this.governanceMode = governanceMode;
    durableMkdir(this.rootDir);
    const governanceAnchor = {
      schema_version: 'devseek.qualification-governance-anchor/v1',
      governance_mode: governanceMode,
      profile_id: trustedProfile.profile_id,
      profile_sha256: trustedProfile.profile_sha256,
      catalog_id: trustedCatalog.catalog_id,
      catalog_version: trustedCatalog.catalog_version,
      catalog_sha256: trustedCatalog.catalog_sha256,
      key_registry_sha256: registry.registry_sha256,
      qualification_eligible: false,
    };
    const anchorPath = path.join(this.rootDir, 'governance-anchor.json');
    const anchorWrite = atomicCompareAndCreate(anchorPath, governanceAnchor);
    if (!anchorWrite.created && canonicalJson(readJson(anchorPath)) !== canonicalJson(governanceAnchor)) {
      throw new QualificationProtocolError('GOVERNANCE_ANCHOR_CONFLICT');
    }
  }

  registerPlan(plan, { seedReveal, registrationEvent, profile, catalog }) {
    const now = this.trustedNow();
    if (profile && canonicalJson(profile) !== canonicalJson(this.approvedProfile)) {
      throw new QualificationProtocolError('PLAN_PROFILE_NOT_APPROVED');
    }
    if (catalog && canonicalJson(catalog) !== canonicalJson(this.approvedCatalog)) {
      throw new QualificationProtocolError('PLAN_CATALOG_NOT_APPROVED');
    }
    const validation = validateQualificationPlan(plan, {
      registry: this.registry,
      profile: this.approvedProfile,
      catalog: this.approvedCatalog,
      seedReveal,
      now,
    });
    if (!validation.ok) throw new QualificationProtocolError('PLAN_INVALID', validation.errors.join(';'));
    if (registrationEvent?.stream_kind !== 'plan'
      || registrationEvent?.correlation_id !== plan.qualification_campaign_id
      || registrationEvent?.event_type !== 'QualificationPlanRegistered') {
      throw new QualificationProtocolError('PLAN_REGISTRATION_EVENT_BINDING_MISMATCH');
    }
    const planPath = this.planPath(plan.qualification_plan_sha256);
    const planWrite = atomicCompareAndCreate(planPath, plan);
    if (!planWrite.created) {
      const existing = readJson(planPath);
      if (canonicalJson(existing) !== canonicalJson(plan)) throw new QualificationProtocolError('PLAN_IDENTITY_CONFLICT');
    }
    const append = this.compareAndAppend({
      plan,
      event: registrationEvent,
      expectedSequence: 1,
      expectedHeadSha256: null,
      allowPlanRegistration: true,
    });
    const receipt = this.ensureStoreReceipt('plan-registration', {
      qualification_plan_sha256: plan.qualification_plan_sha256,
      event_sha256: registrationEvent.event_sha256,
      stream_kind: 'plan',
      correlation_id: registrationEvent.correlation_id,
      object_version: 1,
      previous_head_sha256: null,
      new_head_sha256: registrationEvent.event_sha256,
    }, now, `qsr-plan-${plan.qualification_plan_sha256}`);
    return { status: planWrite.created ? 'registered' : 'already-registered', event: append, receipt };
  }

  compareAndAppend({ plan, event, expectedSequence, expectedHeadSha256, allowPlanRegistration = false }) {
    const now = this.trustedNow();
    if (!allowPlanRegistration) this.assertRegisteredPlan(plan);
    if (allowPlanRegistration && (event.stream_kind !== 'plan' || event.event_type !== 'QualificationPlanRegistered')) {
      throw new QualificationProtocolError('PLAN_REGISTRATION_EVENT_BINDING_MISMATCH');
    }
    const stream = this.readStream(event.stream_kind, event.correlation_id, { plan, allowIncompleteReceipt: false });
    const prior = stream.events.at(-1);
    const actualHead = prior?.event_sha256 ?? null;
    const existing = stream.events.find(item => item.event_id === event.event_id);
    if (existing) {
      if (existing.event_sha256 !== event.event_sha256) throw new QualificationProtocolError('EVENT_ID_CONFLICT');
      return { status: 'already-committed', event: existing, receipt: this.readEventReceipt(existing.event_sha256) };
    }
    if (expectedSequence !== stream.events.length + 1 || event.sequence !== expectedSequence) throw new QualificationProtocolError('EVENT_SEQUENCE_CONFLICT');
    if (expectedHeadSha256 !== actualHead) throw new QualificationProtocolError('EVENT_HEAD_CONFLICT');
    verifyQualificationEvent(event, { registry: this.registry, now, priorEvent: prior, plan });
    // Persist the signed receipt first. An orphan receipt is harmless and lets a
    // retry finish a commit after a crash; the inverse ordering can expose an
    // event without the receipt required to verify it.
    const receipt = this.ensureStoreReceipt('event-append', {
      qualification_plan_sha256: plan.qualification_plan_sha256,
      event_sha256: event.event_sha256,
      stream_kind: event.stream_kind,
      correlation_id: event.correlation_id,
      object_version: event.sequence,
      previous_head_sha256: event.previous_event_sha256,
      new_head_sha256: event.event_sha256,
    }, now, `qsr-event-${event.event_sha256}`);
    const eventPath = this.eventPath(event.stream_kind, event.correlation_id, event.sequence);
    const committed = atomicCompareAndCreate(eventPath, event);
    if (!committed.created) {
      const raceWinner = readJson(eventPath);
      if (raceWinner.event_sha256 === event.event_sha256) return { status: 'already-committed', event: raceWinner, receipt: this.readEventReceipt(raceWinner.event_sha256) };
      throw new QualificationProtocolError('EVENT_HEAD_CONFLICT');
    }
    return { status: 'committed', event, receipt };
  }

  readStream(streamKind, correlationId, { plan = undefined, allowIncompleteReceipt = false } = {}) {
    if (!['plan', 'session', 'attempt'].includes(streamKind)) throw new QualificationProtocolError('EVENT_STREAM_KIND_INVALID');
    if (!SAFE_ID_RE.test(correlationId ?? '')) throw new QualificationProtocolError('EVENT_CORRELATION_ID_INVALID');
    const dir = this.streamDir(streamKind, correlationId);
    if (!fs.existsSync(dir)) return { events: [], head_sha256: null };
    const files = fs.readdirSync(dir).filter(name => /^\d{10}\.json$/u.test(name)).sort();
    const events = [];
    for (const [index, name] of files.entries()) {
      const event = readJson(path.join(dir, name));
      if (event.stream_kind !== streamKind || event.correlation_id !== correlationId) {
        throw new QualificationProtocolError('EVENT_DIRECTORY_BINDING_MISMATCH');
      }
      if (event.sequence !== index + 1) throw new QualificationProtocolError('EVENT_STREAM_GAP');
      const receipt = allowIncompleteReceipt ? undefined : this.readEventReceipt(event.event_sha256);
      const verificationTime = receipt?.trusted_recorded_at ?? this.peekNow();
      verifyQualificationEvent(event, { registry: this.registry, now: verificationTime, priorEvent: events.at(-1), plan });
      if (!allowIncompleteReceipt) {
        this.verifyStoredReceipt(receipt, 'event-append', { now: receipt.trusted_recorded_at });
        if (receipt.event_sha256 !== event.event_sha256
          || receipt.new_head_sha256 !== event.event_sha256
          || receipt.previous_head_sha256 !== event.previous_event_sha256
          || receipt.object_version !== event.sequence
          || receipt.stream_kind !== event.stream_kind
          || receipt.correlation_id !== event.correlation_id
          || receipt.qualification_plan_sha256 !== event.qualification_plan_sha256) {
          throw new QualificationProtocolError('STORE_RECEIPT_EVENT_BINDING_MISMATCH');
        }
      }
      events.push(event);
    }
    return { events, head_sha256: events.at(-1)?.event_sha256 ?? null };
  }

  reserveSlot({ plan, slotKind, slotId, attemptRole, ownerCorrelationId, adjudicationEvent = undefined }) {
    const now = this.trustedNow();
    this.assertRegisteredPlan(plan);
    if (!['preflight', 'coverage'].includes(slotKind)) throw new QualificationProtocolError('SLOT_KIND_INVALID');
    if (!SAFE_ID_RE.test(ownerCorrelationId ?? '')) throw new QualificationProtocolError('SLOT_OWNER_INVALID');
    const descriptor = findSlot(plan, slotKind, slotId, attemptRole);
    assertWindowContains(descriptor.window, now, 'SLOT_WINDOW_CLOSED');
    this.assertPriorOrdersComplete(plan, descriptor.order);
    const finalDispositionPath = this.dispositionPath(plan.qualification_plan_sha256, descriptor.order);
    if (fs.existsSync(finalDispositionPath)) throw new QualificationProtocolError('SLOT_ALREADY_FINALIZED');
    if (attemptRole === 'adjudicated-infra-retry') {
      this.assertValidRetryAdjudication(plan, descriptor, adjudicationEvent, now, { slotKind, slotId });
      if (slotKind === 'coverage') this.assertCoverageRetryEligible(plan, descriptor, slotId);
    }
    const key = this.slotReservationKey(plan, slotKind, slotId, attemptRole);
    const reservation = {
      schema_version: 'devseek.qualification-slot-reservation/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      slot_consumption_id: `slot-${key}`,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      candidate_identity_sha256: plan.candidate_identity_sha256,
      slot_kind: slotKind,
      slot_id: slotId,
      slot_sha256: descriptor.hash,
      attempt_role: attemptRole,
      owner_correlation_id: ownerCorrelationId,
      global_slot_order: descriptor.order,
      reserved_at: now.toISOString(),
      reservation_sha256: null,
      attestation: null,
    };
    this.signStoreState(reservation, 'slot-reservation', 'reservation_sha256');
    const recordPath = path.join(this.rootDir, 'slots', `${key}.json`);
    const claimed = atomicCompareAndCreate(recordPath, reservation);
    if (!claimed.created) {
      const existing = readJson(recordPath);
      if (existing.owner_correlation_id === ownerCorrelationId
        && existing.qualification_plan_sha256 === plan.qualification_plan_sha256
        && existing.candidate_identity_sha256 === plan.candidate_identity_sha256
        && existing.slot_sha256 === descriptor.hash
        && existing.attempt_role === attemptRole
        && this.verifyStoreState(existing, 'slot-reservation', 'reservation_sha256')) {
        return { status: 'already-reserved', reservation: existing };
      }
      throw new QualificationProtocolError('SLOT_ALREADY_CONSUMED');
    }
    return { status: 'reserved', reservation };
  }

  completeSlot({ plan, reservation, terminalEvent }) {
    const now = this.trustedNow();
    if (terminalEvent.qualification_plan_sha256 !== plan.qualification_plan_sha256) throw new QualificationProtocolError('SLOT_TERMINAL_PLAN_MISMATCH');
    const descriptor = findSlot(plan, reservation.slot_kind, reservation.slot_id, reservation.attempt_role);
    this.assertPersistedReservation(plan, descriptor, reservation, terminalEvent.correlation_id);
    const stream = this.readStream(terminalEvent.stream_kind, terminalEvent.correlation_id, { plan });
    if (stream.head_sha256 !== terminalEvent.event_sha256) throw new QualificationProtocolError('SLOT_TERMINAL_HEAD_MISMATCH');
    const allowed = reservation.slot_kind === 'preflight'
      ? new Set(['QualificationSessionReady', 'QualificationSessionBlocked', 'SessionProductFailure'])
      : new Set(['AttemptTerminated']);
    if (!allowed.has(terminalEvent.event_type)) throw new QualificationProtocolError('SLOT_TERMINAL_TYPE_INVALID');
    if (reservation.slot_kind === 'coverage' && reservation.attempt_role === 'primary') {
      const coverageSlot = plan.coverage_slots.find(slot => slot.coverage_slot_id === reservation.slot_id);
      const hasRetry = coverageSlot?.attempt_windows?.some(window => window.attempt_role === 'adjudicated-infra-retry');
      if (hasRetry && ['environment', 'test-infra'].includes(terminalEvent.payload?.failure_class)) {
        return this.recordCoverageRetryEligibility({ plan, reservation, terminalEvent, now });
      }
    }
    if (reservation.slot_kind === 'coverage' && reservation.attempt_role === 'adjudicated-infra-retry') {
      this.assertCoverageRetryEligible(plan, descriptor, reservation.slot_id);
    }
    const disposition = {
      schema_version: 'devseek.qualification-slot-disposition/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      slot_consumption_id: reservation.slot_consumption_id,
      global_slot_order: reservation.global_slot_order,
      terminal_event_sha256: terminalEvent.event_sha256,
      disposition: terminalEvent.event_type,
      trusted_recorded_at: now.toISOString(),
      disposition_sha256: null,
      attestation: null,
    };
    this.signStoreState(disposition, 'slot-disposition', 'disposition_sha256');
    const result = atomicCompareAndCreate(this.dispositionPath(plan.qualification_plan_sha256, reservation.global_slot_order), disposition);
    if (!result.created) {
      const existing = readJson(this.dispositionPath(plan.qualification_plan_sha256, reservation.global_slot_order));
      this.verifyStoreState(existing, 'slot-disposition', 'disposition_sha256');
      if (existing.slot_consumption_id === disposition.slot_consumption_id
        && existing.terminal_event_sha256 === disposition.terminal_event_sha256
        && existing.disposition === disposition.disposition) return existing;
      throw new QualificationProtocolError('SLOT_DISPOSITION_CONFLICT');
    }
    return disposition;
  }

  skipSlotBranch({ plan, slotKind, slotId, attemptRole, predicateEvent, skipEvent }) {
    const now = this.trustedNow();
    this.assertRegisteredPlan(plan);
    const descriptor = findSlot(plan, slotKind, slotId, attemptRole);
    if (descriptor.retryOf === null) throw new QualificationProtocolError('SLOT_BRANCH_SKIP_NOT_CONDITIONAL');
    this.assertPriorOrdersComplete(plan, descriptor.order);
    const stream = this.readStream(skipEvent.stream_kind, skipEvent.correlation_id, { plan });
    if ((slotKind === 'preflight' && predicateEvent.event_type !== 'QualificationSessionReady')
      || stream.head_sha256 !== skipEvent.event_sha256
      || skipEvent.event_type !== 'SlotBranchSkipped'
      || skipEvent.payload?.skipped_slot_id !== slotId
      || skipEvent.payload?.predicate_event_sha256 !== predicateEvent.event_sha256
      || !SAFE_ID_RE.test(skipEvent.payload?.reason_code ?? '')
      || !stream.events.some(event => event.event_sha256 === predicateEvent.event_sha256)) {
      throw new QualificationProtocolError('SLOT_BRANCH_SKIP_EVIDENCE_INVALID');
    }
    const disposition = {
      schema_version: 'devseek.qualification-slot-disposition/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      slot_consumption_id: `slot-skip-${sha256Object({
        plan: plan.qualification_plan_sha256,
        slotId,
        attemptRole,
        predicate: predicateEvent.event_sha256,
      })}`,
      global_slot_order: descriptor.order,
      terminal_event_sha256: skipEvent.event_sha256,
      disposition: 'SlotBranchSkipped',
      trusted_recorded_at: now.toISOString(),
      disposition_sha256: null,
      attestation: null,
    };
    this.signStoreState(disposition, 'slot-disposition', 'disposition_sha256');
    const dispositionPath = this.dispositionPath(plan.qualification_plan_sha256, descriptor.order);
    const created = atomicCompareAndCreate(dispositionPath, disposition);
    if (!created.created) {
      const existing = readJson(dispositionPath);
      this.verifyStoreState(existing, 'slot-disposition', 'disposition_sha256');
      if (existing.terminal_event_sha256 === skipEvent.event_sha256 && existing.disposition === 'SlotBranchSkipped') return existing;
      throw new QualificationProtocolError('SLOT_DISPOSITION_CONFLICT');
    }
    return disposition;
  }

  authorizeExternalAction({ plan, reservation, streamKind, correlationId, action, ttlMs = 30_000 }) {
    const now = this.trustedNow();
    this.assertRegisteredPlan(plan);
    const descriptor = findSlot(plan, reservation.slot_kind, reservation.slot_id, reservation.attempt_role);
    this.assertPersistedReservation(plan, descriptor, reservation, correlationId);
    assertWindowContains(descriptor.window, now, 'ACTION_WINDOW_CLOSED');
    this.assertPriorOrdersComplete(plan, descriptor.order);
    const stream = this.readStream(streamKind, correlationId, { plan });
    if (reservation.owner_correlation_id !== correlationId) throw new QualificationProtocolError('ACTION_RESERVATION_OWNER_MISMATCH');
    if (!descriptor.allowedActions.some(candidate => candidate.action_type === action.action_type && candidate.destination === action.destination)) {
      throw new QualificationProtocolError('ACTION_NOT_PLANNED');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30_000) throw new QualificationProtocolError('ACTION_RECEIPT_TTL_INVALID');
    const receiptId = `qar-${sha256Object({
      qualification_plan_sha256: plan.qualification_plan_sha256,
      slot_consumption_id: reservation.slot_consumption_id,
      stream_kind: streamKind,
      correlation_id: correlationId,
      action_id: action.action_id,
      action_ordinal: action.action_ordinal,
    })}`;
    const existingReceiptPath = this.receiptPath(receiptId);
    if (fs.existsSync(existingReceiptPath)) {
      const existing = readJson(existingReceiptPath);
      this.verifyActionReceipt(existing, { plan, action, now });
      if (existing.slot_consumption_id !== reservation.slot_consumption_id
        || existing.stream_kind !== streamKind
        || existing.correlation_id !== correlationId) {
        throw new QualificationProtocolError('ACTION_AUTHORIZATION_ID_CONFLICT');
      }
      const committedAuthorization = stream.events.find(event => event.event_sha256 === existing.authorization_event_sha256);
      if (committedAuthorization) {
        if (committedAuthorization.event_type !== 'ExternalActionAuthorized'
          || committedAuthorization.payload?.slot_consumption_id !== reservation.slot_consumption_id) {
          throw new QualificationProtocolError('ACTION_AUTHORIZATION_EVENT_CONFLICT');
        }
        return existing;
      }
      // A crash may leave the durable receipt before the event CAS. Rebuild the
      // exact deterministic event from the receipt time, prove its hash, then
      // finish the append. An orphan receipt is never executable because the
      // execution boundary requires this event to be the persisted stream head.
      assertActionState(streamKind, stream.events.at(-1));
      const recoveredEvent = this.createGuardActionEvent({
        plan,
        reservation,
        streamKind,
        correlationId,
        action,
        eventType: 'ExternalActionAuthorized',
        priorEvent: stream.events.at(-1),
        now: new Date(existing.issued_at),
      });
      if (recoveredEvent.event_sha256 !== existing.authorization_event_sha256) {
        throw new QualificationProtocolError('ACTION_AUTHORIZATION_EVENT_HASH_MISMATCH');
      }
      this.compareAndAppend({
        plan,
        event: recoveredEvent,
        expectedSequence: recoveredEvent.sequence,
        expectedHeadSha256: recoveredEvent.previous_event_sha256,
      });
      return existing;
    }
    assertActionState(streamKind, stream.events.at(-1));
    const authorizationEvent = this.createGuardActionEvent({
      plan,
      reservation,
      streamKind,
      correlationId,
      action,
      eventType: 'ExternalActionAuthorized',
      priorEvent: stream.events.at(-1),
      now,
    });
    const receipt = {
      schema_version: 'devseek.qualification-receipt/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      receipt_id: receiptId,
      receipt_type: 'external-action-authorization',
      qualification_plan_sha256: plan.qualification_plan_sha256,
      candidate_identity_sha256: plan.candidate_identity_sha256,
      slot_consumption_id: reservation.slot_consumption_id,
      stream_kind: streamKind,
      correlation_id: correlationId,
      stream_head_sha256: authorizationEvent.event_sha256,
      authorization_event_sha256: authorizationEvent.event_sha256,
      action_id: action.action_id,
      action_ordinal: action.action_ordinal,
      action_type: action.action_type,
      destination: action.destination,
      nonce: action.nonce,
      issued_at: now.toISOString(),
      expires_at: new Date(Math.min(
        now.getTime() + ttlMs,
        Date.parse(descriptor.window[1]),
        Date.parse(plan.expires_at),
      )).toISOString(),
      one_time: true,
      receipt_sha256: null,
      attestation: null,
    };
    receipt.receipt_sha256 = qualificationReceiptHash(receipt);
    receipt.attestation = signProtocolPayload({
      domain: 'devseek/qualification-action-receipt/v1',
      purpose: 'action-guard',
      payload: actionReceiptSignaturePayload(receipt),
      signer: this.guardSigner,
      keyRegistrySha256: this.registry.registry_sha256,
    });
    receipt.receipt_sha256 = qualificationReceiptHash(receipt);
    // Receipt first, event second: a crash can only leave an inert orphan
    // receipt, and the retry path above deterministically completes the event.
    this.persistReceipt(receipt);
    this.compareAndAppend({
      plan,
      event: authorizationEvent,
      expectedSequence: authorizationEvent.sequence,
      expectedHeadSha256: authorizationEvent.previous_event_sha256,
    });
    return receipt;
  }

  executeAuthorizedExternalAction({ plan, receipt, action }, callback) {
    const now = this.trustedNow();
    this.verifyActionReceipt(receipt, { plan, action, now });
    const reservation = this.readReservationByConsumption(receipt.slot_consumption_id);
    if (reservation.qualification_plan_sha256 !== plan.qualification_plan_sha256
      || reservation.candidate_identity_sha256 !== plan.candidate_identity_sha256
      || reservation.owner_correlation_id !== receipt.correlation_id) {
      throw new QualificationProtocolError('ACTION_RESERVATION_INVALID');
    }
    const descriptor = findSlot(plan, reservation.slot_kind, reservation.slot_id, reservation.attempt_role);
    this.assertPersistedReservation(plan, descriptor, reservation, receipt.correlation_id);
    assertWindowContains(descriptor.window, now, 'ACTION_WINDOW_CLOSED');
    const consumedPath = path.join(this.rootDir, 'consumed-actions', `${hashText(receipt.receipt_id)}.json`);
    if (fs.existsSync(consumedPath)) throw new QualificationProtocolError('ACTION_RECEIPT_ALREADY_CONSUMED');
    const stream = this.readStream(receipt.stream_kind, receipt.correlation_id, { plan });
    if (stream.head_sha256 !== receipt.stream_head_sha256) throw new QualificationProtocolError('ACTION_RECEIPT_STALE_HEAD');
    const consumed = atomicCompareAndCreate(consumedPath, {
      receipt_id: receipt.receipt_id,
      receipt_sha256: receipt.receipt_sha256,
      consumed_at: now.toISOString(),
    });
    if (!consumed.created) throw new QualificationProtocolError('ACTION_RECEIPT_ALREADY_CONSUMED');
    const startedEvent = this.createGuardActionEvent({
      plan,
      reservation: { slot_consumption_id: receipt.slot_consumption_id },
      streamKind: receipt.stream_kind,
      correlationId: receipt.correlation_id,
      action,
      eventType: 'ExternalActionStarted',
      priorEvent: stream.events.at(-1),
      now,
      receiptSha256: receipt.receipt_sha256,
    });
    this.compareAndAppend({
      plan,
      event: startedEvent,
      expectedSequence: startedEvent.sequence,
      expectedHeadSha256: startedEvent.previous_event_sha256,
    });
    try {
      const result = callback();
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).catch(error => {
          throw new QualificationProtocolError('ACTION_DISPATCH_UNKNOWN', 'Receipt was consumed before the external action failed or became unknown', { cause: error });
        });
      }
      return result;
    } catch (error) {
      throw new QualificationProtocolError('ACTION_DISPATCH_UNKNOWN', 'Receipt was consumed before the external action failed or became unknown', { cause: error });
    }
  }

  verifyActionReceipt(receipt, { plan, action, now }) {
    validateProtocolHeaderOrThrow(receipt);
    if (receipt.schema_version !== 'devseek.qualification-receipt/v1'
      || receipt.receipt_type !== 'external-action-authorization'
      || receipt.one_time !== true
      || !['session', 'attempt'].includes(receipt.stream_kind)
      || !canonicalTimestamp(receipt.issued_at)
      || !canonicalTimestamp(receipt.expires_at)) {
      throw new QualificationProtocolError('ACTION_RECEIPT_CONTRACT_INVALID');
    }
    if (receipt.receipt_sha256 !== qualificationReceiptHash(receipt)) throw new QualificationProtocolError('ACTION_RECEIPT_HASH_MISMATCH');
    if (receipt.qualification_plan_sha256 !== plan.qualification_plan_sha256 || receipt.candidate_identity_sha256 !== plan.candidate_identity_sha256) {
      throw new QualificationProtocolError('ACTION_RECEIPT_PLAN_MISMATCH');
    }
    if (receipt.authorization_event_sha256 !== receipt.stream_head_sha256
      || Date.parse(receipt.issued_at) >= Date.parse(receipt.expires_at)
      || Date.parse(receipt.expires_at) - Date.parse(receipt.issued_at) > 30_000) {
      throw new QualificationProtocolError('ACTION_RECEIPT_CONTRACT_INVALID');
    }
    for (const field of ['action_id', 'action_ordinal', 'action_type', 'destination', 'nonce']) {
      if (receipt[field] !== action[field]) throw new QualificationProtocolError('ACTION_RECEIPT_BINDING_MISMATCH');
    }
    if (now.getTime() < Date.parse(receipt.issued_at) || now.getTime() >= Date.parse(receipt.expires_at)) throw new QualificationProtocolError('ACTION_RECEIPT_EXPIRED');
    verifyProtocolSignature({
      domain: 'devseek/qualification-action-receipt/v1',
      purpose: 'action-guard',
      payload: actionReceiptSignaturePayload(receipt),
      attestation: receipt.attestation,
      registry: this.registry,
      now,
    });
    assertRuntimeSchema('receipt', receipt, 'ACTION_RECEIPT_SCHEMA_INVALID');
  }

  createGuardActionEvent({
    plan,
    reservation,
    streamKind,
    correlationId,
    action,
    eventType,
    priorEvent,
    now,
    receiptSha256 = null,
  }) {
    return createSignedEvent({
      schema_version: 'devseek.qualification-event/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      event_id: `qae-${sha256Object({
        eventType,
        qualification_plan_sha256: plan.qualification_plan_sha256,
        slot_consumption_id: reservation.slot_consumption_id,
        correlationId,
        action_id: action.action_id,
        action_ordinal: action.action_ordinal,
      })}`,
      event_type: eventType,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      candidate_identity_sha256: plan.candidate_identity_sha256,
      stream_kind: streamKind,
      correlation_id: correlationId,
      sequence: (priorEvent?.sequence ?? 0) + 1,
      previous_event_sha256: priorEvent?.event_sha256 ?? null,
      occurred_at: now.toISOString(),
      recorded_at: now.toISOString(),
      actor_id: this.guardSigner.identity,
      payload: {
        slot_consumption_id: reservation.slot_consumption_id,
        action_id: action.action_id,
        action_ordinal: action.action_ordinal,
        action_type: action.action_type,
        destination: action.destination,
        nonce: action.nonce,
        authorization_receipt_sha256: receiptSha256,
      },
      key_registry_sha256: this.registry.registry_sha256,
      event_sha256: null,
      event_attestation: null,
    }, { signer: this.guardSigner, registry: this.registry });
  }

  assertRegisteredPlan(plan) {
    const stored = readJson(this.planPath(plan.qualification_plan_sha256));
    if (canonicalJson(stored) !== canonicalJson(plan)) throw new QualificationProtocolError('PLAN_NOT_REGISTERED');
    const stream = this.readStream('plan', plan.qualification_campaign_id, { plan });
    if (stream.events[0]?.event_type !== 'QualificationPlanRegistered') throw new QualificationProtocolError('PLAN_NOT_REGISTERED');
  }

  assertPriorOrdersComplete(plan, order) {
    for (const prior of allPlanOrders(plan).filter(value => value < order)) {
      const dispositionPath = this.dispositionPath(plan.qualification_plan_sha256, prior);
      if (!fs.existsSync(dispositionPath)) throw new QualificationProtocolError('GLOBAL_SLOT_ORDER_BLOCKED');
      const disposition = readJson(dispositionPath);
      this.verifyStoreState(disposition, 'slot-disposition', 'disposition_sha256');
      if (disposition.qualification_plan_sha256 !== plan.qualification_plan_sha256
        || disposition.global_slot_order !== prior) throw new QualificationProtocolError('SLOT_DISPOSITION_BINDING_MISMATCH');
    }
  }

  assertValidRetryAdjudication(plan, descriptor, event, now, { slotKind, slotId }) {
    if (!event || event.event_type !== 'InfraAdjudicated') throw new QualificationProtocolError('RETRY_ADJUDICATION_REQUIRED');
    // A retry decision is authoritative only after the complete adjudication
    // stream and its durable store receipts have been replayed. Verifying this
    // non-genesis event in isolation would both reject every valid decision and
    // make it possible for a caller to present an uncommitted signed object.
    const stream = this.readStream(event.stream_kind, event.correlation_id, { plan });
    if (stream.head_sha256 !== event.event_sha256) throw new QualificationProtocolError('RETRY_ADJUDICATION_NOT_COMMITTED');
    if (!['environment', 'test-infra'].includes(event.payload?.failure_class)) throw new QualificationProtocolError('RETRY_FAILURE_CLASS_FORBIDDEN');
    const failureEvent = stream.events.at(-2);
    if (slotKind === 'preflight') {
      if (event.payload?.original_slot_id !== descriptor.retryOf
        || !failureEvent
        || failureEvent.event_type !== 'QualificationSessionBlocked'
        || event.payload?.original_failure_event_sha256 !== failureEvent.event_sha256
        || failureEvent.payload?.failure_class !== event.payload.failure_class) {
        throw new QualificationProtocolError('RETRY_ADJUDICATION_BINDING_MISMATCH');
      }
    } else {
      const eligibility = this.readCoverageRetryEligibility(plan, descriptor.order);
      if (event.payload?.original_slot_id !== slotId
        || event.payload?.original_attempt_role !== 'primary'
        || event.payload?.original_failure_event_sha256 !== eligibility.terminal_event_sha256
        || event.payload?.failure_class !== eligibility.failure_class) {
        throw new QualificationProtocolError('RETRY_ADJUDICATION_BINDING_MISMATCH');
      }
    }
    if (!SHA256_RE.test(event.payload?.adjudication_evidence_sha256 ?? '')
      || !SAFE_ID_RE.test(event.payload?.reason_code ?? '')) {
      throw new QualificationProtocolError('RETRY_ADJUDICATION_BINDING_MISMATCH');
    }
    const adjudicationAge = now.getTime() - Date.parse(event.recorded_at);
    if (!Number.isFinite(adjudicationAge) || adjudicationAge < 0 || adjudicationAge > 86_400_000) {
      throw new QualificationProtocolError('RETRY_ADJUDICATION_EXPIRED');
    }
  }

  recordCoverageRetryEligibility({ plan, reservation, terminalEvent, now }) {
    const eligibility = {
      schema_version: 'devseek.qualification-slot-branch/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      qualification_plan_sha256: plan.qualification_plan_sha256,
      slot_consumption_id: reservation.slot_consumption_id,
      slot_id: reservation.slot_id,
      global_slot_order: reservation.global_slot_order,
      branch_state: 'infra-failed-awaiting-adjudicated-retry',
      failure_class: terminalEvent.payload.failure_class,
      terminal_event_sha256: terminalEvent.event_sha256,
      trusted_recorded_at: now.toISOString(),
      branch_sha256: null,
      attestation: null,
    };
    this.signStoreState(eligibility, 'slot-branch', 'branch_sha256');
    const branchPath = this.coverageBranchPath(plan.qualification_plan_sha256, reservation.global_slot_order);
    const created = atomicCompareAndCreate(branchPath, eligibility);
    if (!created.created) {
      const existing = this.readCoverageRetryEligibility(plan, reservation.global_slot_order);
      if (existing.slot_consumption_id === eligibility.slot_consumption_id
        && existing.terminal_event_sha256 === eligibility.terminal_event_sha256) return existing;
      throw new QualificationProtocolError('SLOT_BRANCH_STATE_CONFLICT');
    }
    return eligibility;
  }

  readCoverageRetryEligibility(plan, order) {
    const branch = readJson(this.coverageBranchPath(plan.qualification_plan_sha256, order));
    this.verifyStoreState(branch, 'slot-branch', 'branch_sha256');
    if (branch.qualification_plan_sha256 !== plan.qualification_plan_sha256
      || branch.global_slot_order !== order
      || branch.branch_state !== 'infra-failed-awaiting-adjudicated-retry') {
      throw new QualificationProtocolError('SLOT_BRANCH_STATE_INVALID');
    }
    return branch;
  }

  assertCoverageRetryEligible(plan, descriptor, slotId) {
    const branch = this.readCoverageRetryEligibility(plan, descriptor.order);
    if (branch.slot_id !== slotId) throw new QualificationProtocolError('SLOT_BRANCH_STATE_INVALID');
    return branch;
  }

  assertPersistedReservation(plan, descriptor, reservation, ownerCorrelationId) {
    const expectedKey = this.slotReservationKey(
      plan,
      reservation.slot_kind,
      reservation.slot_id,
      reservation.attempt_role,
    );
    const stored = readJson(path.join(this.rootDir, 'slots', `${expectedKey}.json`));
    if (canonicalJson(stored) !== canonicalJson(reservation)
      || reservation.qualification_plan_sha256 !== plan.qualification_plan_sha256
      || reservation.candidate_identity_sha256 !== plan.candidate_identity_sha256
      || reservation.slot_sha256 !== descriptor.hash
      || reservation.global_slot_order !== descriptor.order
      || reservation.owner_correlation_id !== ownerCorrelationId) {
      throw new QualificationProtocolError('ACTION_RESERVATION_INVALID');
    }
    this.verifyStoreState(reservation, 'slot-reservation', 'reservation_sha256');
  }

  readReservationByConsumption(slotConsumptionId) {
    const slotsDir = path.join(this.rootDir, 'slots');
    if (!fs.existsSync(slotsDir)) throw new QualificationProtocolError('ACTION_RESERVATION_INVALID');
    const matches = [];
    for (const name of fs.readdirSync(slotsDir).filter(candidate => /^[a-f0-9]{64}\.json$/u.test(candidate))) {
      const reservation = readJson(path.join(slotsDir, name));
      if (reservation.slot_consumption_id === slotConsumptionId) matches.push(reservation);
    }
    if (matches.length !== 1) throw new QualificationProtocolError('ACTION_RESERVATION_INVALID');
    this.verifyStoreState(matches[0], 'slot-reservation', 'reservation_sha256');
    return matches[0];
  }

  signStoreState(record, stateType, hashField) {
    record[hashField] = storeStateHash(record, hashField);
    record.attestation = signProtocolPayload({
      domain: 'devseek/qualification-store-state/v1',
      purpose: 'store-receipt',
      payload: storeStateSignaturePayload(record, stateType, hashField),
      signer: this.storeSigner,
      keyRegistrySha256: this.registry.registry_sha256,
    });
    return record;
  }

  verifyStoreState(record, stateType, hashField) {
    validateProtocolHeaderOrThrow(record);
    if (record[hashField] !== storeStateHash(record, hashField)) throw new QualificationProtocolError('STORE_STATE_HASH_MISMATCH');
    const trustedAt = record.trusted_recorded_at ?? record.reserved_at;
    if (!canonicalTimestamp(trustedAt)) throw new QualificationProtocolError('STORE_STATE_TIME_INVALID');
    verifyProtocolSignature({
      domain: 'devseek/qualification-store-state/v1',
      purpose: 'store-receipt',
      payload: storeStateSignaturePayload(record, stateType, hashField),
      attestation: record.attestation,
      registry: this.registry,
      now: trustedAt,
    });
    return true;
  }

  createStoreReceipt(receiptType, payload, now, receiptId = `qsr-${crypto.randomUUID()}`) {
    const receipt = {
      schema_version: 'devseek.qualification-receipt/v1',
      integrity: QUALIFICATION_PROTOCOL_INTEGRITY,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      receipt_id: receiptId,
      receipt_type: receiptType,
      ...payload,
      trusted_recorded_at: now.toISOString(),
      one_time: false,
      receipt_sha256: null,
      attestation: null,
    };
    receipt.receipt_sha256 = qualificationReceiptHash(receipt);
    receipt.attestation = signProtocolPayload({
      domain: 'devseek/qualification-store-receipt/v1',
      purpose: 'store-receipt',
      payload: storeReceiptSignaturePayload(receipt),
      signer: this.storeSigner,
      keyRegistrySha256: this.registry.registry_sha256,
    });
    receipt.receipt_sha256 = qualificationReceiptHash(receipt);
    return receipt;
  }

  ensureStoreReceipt(receiptType, payload, now, receiptId) {
    const receiptPath = this.receiptPath(receiptId);
    if (fs.existsSync(receiptPath)) {
      const existing = readJson(receiptPath);
      this.verifyStoredReceipt(existing, receiptType);
      for (const [key, value] of Object.entries(payload)) {
        if (canonicalJson(existing[key]) !== canonicalJson(value)) {
          throw new QualificationProtocolError('STORE_RECEIPT_IDENTITY_CONFLICT');
        }
      }
      return existing;
    }
    const candidate = this.createStoreReceipt(receiptType, payload, now, receiptId);
    const created = atomicCompareAndCreate(receiptPath, candidate);
    if (!created.created) return this.ensureStoreReceipt(receiptType, payload, now, receiptId);
    this.recordHighWater(candidate.trusted_recorded_at, candidate.receipt_id);
    return candidate;
  }

  persistReceipt(receipt) {
    const result = atomicCompareAndCreate(this.receiptPath(receipt.receipt_id), receipt);
    if (!result.created) {
      const existing = readJson(this.receiptPath(receipt.receipt_id));
      if (existing.receipt_sha256 !== receipt.receipt_sha256) throw new QualificationProtocolError('RECEIPT_ID_CONFLICT');
    }
    this.recordHighWater(receipt.trusted_recorded_at ?? receipt.issued_at, receipt.receipt_id);
  }

  verifyStoredReceipt(receipt, expectedType, { now = undefined } = {}) {
    validateProtocolHeaderOrThrow(receipt);
    if (receipt.receipt_type !== expectedType) throw new QualificationProtocolError('STORE_RECEIPT_TYPE_MISMATCH');
    if (!canonicalTimestamp(receipt.trusted_recorded_at) || receipt.one_time !== false) throw new QualificationProtocolError('STORE_RECEIPT_CONTRACT_INVALID');
    if (receipt.receipt_sha256 !== qualificationReceiptHash(receipt)) throw new QualificationProtocolError('STORE_RECEIPT_HASH_MISMATCH');
    verifyProtocolSignature({
      domain: 'devseek/qualification-store-receipt/v1',
      purpose: 'store-receipt',
      payload: storeReceiptSignaturePayload(receipt),
      attestation: receipt.attestation,
      registry: this.registry,
      now: now ?? this.peekNow(),
    });
    assertRuntimeSchema('receipt', receipt, 'STORE_RECEIPT_SCHEMA_INVALID');
  }

  readEventReceipt(eventSha256) {
    const receiptsDir = path.join(this.rootDir, 'receipts');
    if (!fs.existsSync(receiptsDir)) throw new QualificationProtocolError('STORE_RECEIPT_MISSING');
    const matches = [];
    for (const name of fs.readdirSync(receiptsDir).filter(candidate => /^[a-f0-9]{64}\.json$/u.test(candidate))) {
      const receipt = readJson(path.join(receiptsDir, name));
      if (receipt.receipt_type === 'event-append' && receipt.event_sha256 === eventSha256) matches.push(receipt);
    }
    if (matches.length === 0) throw new QualificationProtocolError('STORE_RECEIPT_MISSING');
    if (matches.length > 1) throw new QualificationProtocolError('STORE_RECEIPT_CONFLICT');
    return matches[0];
  }

  trustedNow() {
    const now = this.peekNow();
    const highWater = this.highWaterEpoch();
    if (highWater !== null && now.getTime() < highWater) throw new QualificationProtocolError('CLOCK_ROLLBACK');
    // Persist time before any caller can perform a state transition. A crash may
    // leave an unused marker, which is safe; it must never leave a committed
    // transition whose trusted time can later roll backwards unnoticed.
    this.recordHighWater(now.toISOString(), `trusted-clock-${now.toISOString()}`);
    return now;
  }

  peekNow() {
    const value = this.now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new QualificationProtocolError('TRUSTED_TIME_INVALID');
    return date;
  }

  recordHighWater(timestamp, receiptId) {
    const epoch = Date.parse(timestamp);
    const marker = path.join(this.rootDir, 'clock-high-water', `${String(epoch).padStart(16, '0')}-${hashText(receiptId)}.mark`);
    atomicCompareAndCreate(marker, `${timestamp}\n`);
  }

  highWaterEpoch() {
    const dir = path.join(this.rootDir, 'clock-high-water');
    if (!fs.existsSync(dir)) return null;
    const epochs = fs.readdirSync(dir).map(name => Number(name.slice(0, 16))).filter(Number.isFinite);
    return epochs.length ? Math.max(...epochs) : null;
  }

  planPath(planHash) { assertSha(planHash); return path.join(this.rootDir, 'plans', `${planHash}.json`); }
  slotReservationKey(plan, slotKind, slotId, attemptRole) {
    return sha256Object({ plan: plan.qualification_plan_sha256, slotKind, slotId, attemptRole });
  }
  streamDir(kind, correlationId) { return path.join(this.rootDir, 'streams', kind, sha256Object({ kind, correlationId })); }
  eventPath(kind, correlationId, sequence) { return path.join(this.streamDir(kind, correlationId), `${String(sequence).padStart(10, '0')}.json`); }
  receiptPath(receiptId) { return path.join(this.rootDir, 'receipts', `${hashText(receiptId)}.json`); }
  coverageBranchPath(planHash, order) {
    assertSha(planHash);
    if (!Number.isSafeInteger(order) || order < 1) throw new QualificationProtocolError('SLOT_ORDER_INVALID');
    return path.join(this.rootDir, 'slot-branches', planHash, `${String(order).padStart(10, '0')}.json`);
  }
  dispositionPath(planHash, order) {
    assertSha(planHash);
    if (!Number.isSafeInteger(order) || order < 1) throw new QualificationProtocolError('SLOT_ORDER_INVALID');
    return path.join(this.rootDir, 'slot-dispositions', planHash, `${String(order).padStart(10, '0')}.json`);
  }
}

export class GuardedQualificationActionAdapter {
  constructor({ store, dispatch }) {
    this.store = store;
    this.dispatch = dispatch;
  }

  execute({ plan, receipt, action }) {
    if (!receipt) throw new QualificationProtocolError('ACTION_RECEIPT_REQUIRED');
    return this.store.executeAuthorizedExternalAction({ plan, receipt, action }, () => this.dispatch(action));
  }
}

export function hydrateCandidate(candidate) {
  candidate.candidate_identity_sha256 = candidateIdentityHash(candidate);
  return candidate;
}

export function hydrateKeyRegistry(registry) {
  for (const entry of registry.keys ?? []) {
    entry.public_key_spki_sha256 = publicKeySpkiSha256(entry.public_key_spki_base64);
    entry.key_sha256 = keyEntryHash(entry);
  }
  registry.source_status = 'verified';
  registry.registry_sha256 = keyRegistryHash(registry);
  return registry;
}

export function hydrateGoldenCaseCatalog(catalog) {
  for (const entry of catalog.cases ?? []) {
    entry.fixture.input_sha256 = sha256Object({ fixture_id: entry.fixture.fixture_id, stimulus: entry.stimulus });
    entry.fixture.workspace_fixture_sha256 = sha256Object({ fixture_id: entry.fixture.fixture_id, workspace: 'empty-protocol-fixture/v1' });
    entry.executor_ref.contract_sha256 = sha256Object({
      source_ref: entry.executor_ref.source_ref,
      entrypoint: entry.executor_ref.entrypoint,
      source_content_sha256: entry.executor_ref.source_content_sha256,
    });
    for (const oracle of entry.oracle_refs) oracle.contract_sha256 = sha256Object({
      source_ref: oracle.source_ref,
      entrypoint: oracle.entrypoint,
      expected_decision: oracle.expected_decision,
      source_content_sha256: oracle.source_content_sha256,
    });
    entry.case_sha256 = goldenCaseHash(entry);
  }
  catalog.source_status = 'verified';
  catalog.catalog_sha256 = goldenCaseCatalogHash(catalog);
  return catalog;
}

function validateProtocolHeader(value, at, errors) {
  if (!isObject(value.integrity)
    || value.integrity.hash_algorithm !== HASH_ALGORITHM
    || value.integrity.canonicalization_version !== CANONICALIZATION_VERSION
    || value.integrity.signature_algorithm !== SIGNATURE_ALGORITHM
    || Object.keys(value.integrity).length !== 3) errors.push(`${at}.integrity:unsupported`);
}

function validateProtocolHeaderOrThrow(value) {
  const errors = [];
  validateProtocolHeader(value, 'object', errors);
  if (errors.length) throw new QualificationProtocolError('INTEGRITY_CONTRACT_UNSUPPORTED');
  if (value.integrity_scope !== LOCAL_INTEGRITY_SCOPE || value.qualification_eligible !== false) {
    throw new QualificationProtocolError('LOCAL_PROTOCOL_SCOPE_REQUIRED');
  }
}

function validateSlotBase(slot, kind, ids, orders, validFrom, expires, errors) {
  const id = kind === 'preflight' ? slot.preflight_slot_id : slot.coverage_slot_id;
  if (!SAFE_ID_RE.test(id ?? '')) errors.push(`${kind}:invalid-id`);
  if (ids.has(id)) errors.push(`${kind}:${id}:duplicate-id`);
  ids.add(id);
  if (!Number.isSafeInteger(slot.order) || slot.order < 1) errors.push(`${kind}:${id}:invalid-order`);
  if (orders.has(slot.order)) errors.push(`${kind}:${id}:duplicate-order`);
  orders.add(slot.order);
  validateWindow(slot.scheduled_window, validFrom, expires, `${kind}:${id}`, errors);
}

function validateAllowedActions(actions, at, errors) {
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push(`${at}:allowed-actions-required`);
    return;
  }
  const identities = new Set();
  for (const action of actions) {
    if (!isObject(action) || !SAFE_ID_RE.test(action.action_type ?? '') || typeof action.destination !== 'string' || action.destination.length === 0) {
      errors.push(`${at}:allowed-action-invalid`);
      continue;
    }
    const identity = `${action.action_type}\u0000${action.destination}`;
    if (identities.has(identity)) errors.push(`${at}:allowed-action-duplicate`);
    identities.add(identity);
  }
}

function validateCandidateShape(candidate, errors) {
  if (!isObject(candidate)
    || candidate.schema_version !== 'devseek.candidate-identity/v1'
    || candidate.integrity_scope !== LOCAL_INTEGRITY_SCOPE
    || candidate.qualification_eligible !== false
    || typeof candidate.candidate_id !== 'string'
    || !Number.isSafeInteger(candidate.candidate_version)
    || candidate.candidate_version < 1) {
    errors.push('plan.candidate_identity:invalid');
    return;
  }
  validateProtocolHeader(candidate, 'plan.candidate_identity', errors);
  const shaValues = [
    candidate.source?.source_tree_sha256,
    candidate.artifacts?.installed_artifact_sha256,
    candidate.artifacts?.extension_artifact_sha256,
    candidate.artifacts?.bridge_artifact_sha256,
    candidate.artifacts?.packaging_metadata_sha256,
    candidate.provider_connector?.provider_connector_sha256,
    candidate.execution_inputs?.prompt_bundle_sha256,
    candidate.execution_inputs?.runtime_config_sha256,
    candidate.execution_inputs?.environment_fingerprint_sha256,
    candidate.execution_inputs?.runner_image_sha256,
    candidate.execution_inputs?.toolchain_lock_sha256,
    candidate.dependency_snapshot_sha256,
  ];
  if (shaValues.some(value => !SHA256_RE.test(value ?? ''))) errors.push('plan.candidate_identity:required-hash-missing');
  if (!candidate.source?.repository_id
    || !/^[a-f0-9]{7,64}$/u.test(candidate.source?.git_commit ?? '')
    || !['clean', 'dirty'].includes(candidate.source?.worktree_state)
    || !candidate.provider_connector?.provider_product
    || !candidate.provider_connector?.provider_model
    || !candidate.provider_connector?.provider_mode
    || !candidate.execution_inputs?.platform_profile) errors.push('plan.candidate_identity:required-identity-missing');
}

function validateWindow(window, validFrom, expires, at, errors) {
  if (!Array.isArray(window) || window.length !== 2 || !canonicalTimestamp(window[0]) || !canonicalTimestamp(window[1])) {
    errors.push(`${at}:invalid-window`);
    return;
  }
  const start = Date.parse(window[0]);
  const end = Date.parse(window[1]);
  if (!(validFrom <= start && start < end && end <= expires)) errors.push(`${at}:window-outside-plan`);
}

function buildRuntimeSchemaValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const fileName of Object.values(SCHEMA_FILES)) {
    const schema = JSON.parse(fs.readFileSync(path.join(PROCESS_DIR, fileName), 'utf8'));
    ajv.addSchema(schema);
  }
  const validators = {};
  for (const [name, schemaId] of Object.entries(SCHEMA_IDS)) {
    const validate = ajv.getSchema(schemaId);
    if (!validate) throw new Error(`qualification-runtime-schema-unresolved:${schemaId}`);
    validators[name] = validate;
  }
  return Object.freeze(validators);
}

function runtimeSchemaErrors(schemaName, value, at = schemaName) {
  const validate = RUNTIME_SCHEMAS[schemaName];
  if (!validate) throw new QualificationProtocolError('RUNTIME_SCHEMA_UNKNOWN', schemaName);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => `${at}${error.instancePath || '/'}:${error.keyword}`);
}

function assertRuntimeSchema(schemaName, value, code) {
  const errors = runtimeSchemaErrors(schemaName, value);
  if (errors.length > 0) throw new QualificationProtocolError(code, errors.join(';'), errors);
}

function validateApprovedGovernanceSources({ profile, catalog, registry, governanceMode }) {
  if (!['audited-local-source', 'deterministic-test-only'].includes(governanceMode)) {
    throw new QualificationProtocolError('GOVERNANCE_MODE_INVALID');
  }
  if (!isObject(profile) || !isObject(catalog)) {
    throw new QualificationProtocolError('APPROVED_GOVERNANCE_SOURCES_REQUIRED');
  }
  if (governanceMode === 'audited-local-source') {
    assertRuntimeSchema('catalog', catalog, 'CATALOG_SCHEMA_INVALID');
    assertRuntimeSchema('profile', profile, 'PROFILE_SCHEMA_INVALID');
  }
  const errors = [];
  if (!SAFE_ID_RE.test(profile.profile_id ?? '') || !Number.isSafeInteger(profile.profile_version) || profile.profile_version < 1) {
    errors.push('profile:identity-invalid');
  }
  if (profile.profile_sha256 !== qualificationProfileHash(profile)) errors.push('profile:hash-mismatch');
  if (!SAFE_ID_RE.test(catalog.catalog_id ?? '') || !Number.isSafeInteger(catalog.catalog_version) || catalog.catalog_version < 1) {
    errors.push('catalog:identity-invalid');
  }
  if (!Array.isArray(catalog.cases) || catalog.cases.length === 0) errors.push('catalog:cases-required');
  if (catalog.catalog_sha256 !== goldenCaseCatalogHash(catalog)) errors.push('catalog:hash-mismatch');
  if (profile.catalog_binding?.catalog_id !== catalog.catalog_id
    || profile.catalog_binding?.catalog_version !== catalog.catalog_version
    || profile.catalog_binding?.catalog_sha256 !== catalog.catalog_sha256) {
    errors.push('profile:catalog-binding-mismatch');
  }
  if (!Number.isSafeInteger(profile.qualification_plan_policy?.minimum_coverage_slots)
    || profile.qualification_plan_policy.minimum_coverage_slots < 1) {
    errors.push('profile:minimum-coverage-invalid');
  }
  if (!Array.isArray(profile.required_cases) || profile.required_cases.length === 0) errors.push('profile:required-cases-empty');
  for (const requiredCase of profile.required_cases ?? []) {
    const approved = catalog.cases?.find(caseEntry => caseEntry.case_id === requiredCase.case_id
      && caseEntry.case_version === requiredCase.case_version);
    if (!approved || approved.case_sha256 !== requiredCase.case_sha256 || approved.category !== requiredCase.category) {
      errors.push(`profile:required-case-not-approved-${requiredCase.case_id}`);
    }
  }
  if (profile.key_registry_binding
    && (profile.key_registry_binding.registry_id !== registry.registry_id
      || profile.key_registry_binding.registry_version !== registry.registry_version
      || profile.key_registry_binding.registry_sha256 !== registry.registry_sha256)) {
    errors.push('profile:key-registry-binding-mismatch');
  }
  if (errors.length > 0) throw new QualificationProtocolError('APPROVED_GOVERNANCE_INVALID', errors.join(';'), errors);
}

function loadAuditedLocalGovernance(registry) {
  const catalog = JSON.parse(fs.readFileSync(path.join(PROCESS_DIR, 'devseek-golden-case-catalog.json'), 'utf8'));
  const profileDocument = JSON.parse(fs.readFileSync(path.join(PROCESS_DIR, 'devseek-qualification-profiles.json'), 'utf8'));
  const profile = profileDocument.profiles?.find(candidate => candidate.profile_id === AUDITED_LOCAL_GOVERNANCE.profile_id);
  if (!profile) throw new QualificationProtocolError('AUDITED_PROFILE_MISSING');
  const mismatches = [];
  if (profile.profile_sha256 !== AUDITED_LOCAL_GOVERNANCE.profile_sha256) mismatches.push('profile-sha256');
  if (catalog.catalog_id !== AUDITED_LOCAL_GOVERNANCE.catalog_id
    || catalog.catalog_sha256 !== AUDITED_LOCAL_GOVERNANCE.catalog_sha256) mismatches.push('catalog-identity');
  if (registry.registry_id !== AUDITED_LOCAL_GOVERNANCE.key_registry_id
    || registry.registry_sha256 !== AUDITED_LOCAL_GOVERNANCE.key_registry_sha256) mismatches.push('key-registry-identity');
  if (mismatches.length > 0) {
    throw new QualificationProtocolError('AUDITED_GOVERNANCE_DIGEST_MISMATCH', mismatches.join(';'), mismatches);
  }
  return { profile, catalog };
}

function planSignaturePayload(plan) {
  return {
    schema_version: plan.schema_version,
    qualification_campaign_id: plan.qualification_campaign_id,
    qualification_plan_id: plan.qualification_plan_id,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    candidate_identity_sha256: plan.candidate_identity_sha256,
    profile_sha256: plan.profile_sha256,
    key_registry_sha256: plan.key_registry_sha256,
    created_at: plan.created_at,
  };
}

function eventSignaturePayload(event) {
  return {
    schema_version: event.schema_version,
    qualification_plan_sha256: event.qualification_plan_sha256,
    candidate_identity_sha256: event.candidate_identity_sha256,
    stream_kind: event.stream_kind,
    correlation_id: event.correlation_id,
    event_type: event.event_type,
    sequence: event.sequence,
    previous_event_sha256: event.previous_event_sha256,
    event_sha256: event.event_sha256,
    key_registry_sha256: event.key_registry_sha256,
  };
}

function storeReceiptSignaturePayload(receipt) {
  return {
    receipt_id: receipt.receipt_id,
    receipt_type: receipt.receipt_type,
    receipt_sha256: receipt.receipt_sha256,
    qualification_plan_sha256: receipt.qualification_plan_sha256,
    trusted_recorded_at: receipt.trusted_recorded_at,
    new_head_sha256: receipt.new_head_sha256,
  };
}

function actionReceiptSignaturePayload(receipt) {
  return {
    receipt_id: receipt.receipt_id,
    receipt_type: receipt.receipt_type,
    receipt_sha256: receipt.receipt_sha256,
    qualification_plan_sha256: receipt.qualification_plan_sha256,
    candidate_identity_sha256: receipt.candidate_identity_sha256,
    slot_consumption_id: receipt.slot_consumption_id,
    stream_kind: receipt.stream_kind,
    correlation_id: receipt.correlation_id,
    stream_head_sha256: receipt.stream_head_sha256,
    authorization_event_sha256: receipt.authorization_event_sha256,
    action_id: receipt.action_id,
    action_ordinal: receipt.action_ordinal,
    action_type: receipt.action_type,
    destination: receipt.destination,
    nonce: receipt.nonce,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
  };
}

function storeStateHash(record, hashField) {
  const copy = structuredClone(record);
  delete copy[hashField];
  delete copy.attestation;
  return sha256Object(copy);
}

function storeStateSignaturePayload(record, stateType, hashField) {
  return {
    state_type: stateType,
    state_sha256: record[hashField],
    qualification_plan_sha256: record.qualification_plan_sha256,
    slot_consumption_id: record.slot_consumption_id,
    global_slot_order: record.global_slot_order,
    trusted_recorded_at: record.trusted_recorded_at ?? record.reserved_at,
  };
}

function signatureMaterial({ algorithm, domain, purpose, payload, keyRegistrySha256, keyId, signerIdentity }) {
  if (!SAFE_ID_RE.test(domain)) throw new QualificationProtocolError('SIGNATURE_DOMAIN_INVALID');
  assertPurpose(purpose);
  assertSha(keyRegistrySha256);
  if (algorithm !== SIGNATURE_ALGORITHM || !SAFE_ID_RE.test(keyId ?? '') || !SAFE_ID_RE.test(signerIdentity ?? '')) {
    throw new QualificationProtocolError('SIGNATURE_PROTECTED_HEADER_INVALID');
  }
  return {
    algorithm,
    domain,
    purpose,
    key_id: keyId,
    signer_identity: signerIdentity,
    key_registry_sha256: keyRegistrySha256,
    payload,
  };
}

function eventPurpose(eventType) {
  return EVENT_PURPOSE.get(eventType) ?? 'runner-event';
}

function assertPurpose(purpose) {
  if (!PURPOSES.has(purpose)) throw new QualificationProtocolError('SIGNATURE_PURPOSE_UNSUPPORTED');
}

function strictBase64Decode(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new QualificationProtocolError('BASE64_NONCANONICAL');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value) throw new QualificationProtocolError('BASE64_NONCANONICAL');
  return buffer;
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && CANONICAL_TIME_RE.test(value) && new Date(value).toISOString() === value;
}

function trustedEpoch(value) {
  const epoch = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(epoch)) throw new QualificationProtocolError('TRUSTED_TIME_INVALID');
  return epoch;
}

function findSlot(plan, slotKind, slotId, attemptRole) {
  if (slotKind === 'preflight') {
    const slot = plan.preflight_slots.find(candidate => candidate.preflight_slot_id === slotId);
    if (!slot) throw new QualificationProtocolError('SLOT_NOT_PLANNED');
    const plannedRole = slot.retry_of_preflight_slot_id === null ? 'original' : 'adjudicated-infra-retry';
    if (attemptRole !== plannedRole) throw new QualificationProtocolError('ATTEMPT_ROLE_NOT_PLANNED');
    return {
      order: slot.order,
      hash: slot.preflight_slot_sha256,
      window: slot.scheduled_window,
      retryOf: slot.retry_of_preflight_slot_id,
      attemptRole: plannedRole,
      allowedActions: slot.allowed_actions,
    };
  }
  const slot = plan.coverage_slots.find(candidate => candidate.coverage_slot_id === slotId);
  if (!slot) throw new QualificationProtocolError('SLOT_NOT_PLANNED');
  const attempt = slot.attempt_windows.find(candidate => candidate.attempt_role === attemptRole);
  if (!attempt) throw new QualificationProtocolError('ATTEMPT_ROLE_NOT_PLANNED');
  return {
    order: slot.order,
    hash: slot.coverage_slot_sha256,
    window: attempt.scheduled_window,
    retryOf: attempt.retry_of_attempt_role ?? null,
    attemptRole: attempt.attempt_role,
    allowedActions: attempt.allowed_actions,
  };
}

function assertWindowContains(window, now, code) {
  const epoch = now.getTime();
  if (!(Date.parse(window[0]) <= epoch && epoch < Date.parse(window[1]))) throw new QualificationProtocolError(code);
}

function allPlanOrders(plan) {
  return [...new Set([
    ...plan.preflight_slots.map(slot => slot.order),
    ...plan.coverage_slots.map(slot => slot.order),
  ])].sort((a, b) => a - b);
}

function assertActionState(streamKind, event) {
  if (!event) throw new QualificationProtocolError('ACTION_STREAM_NOT_REGISTERED');
  const allowed = streamKind === 'session'
    ? new Set(['QualificationSessionRegistered', 'PreflightAttemptStarted', 'ExternalActionStarted', 'RunObserved'])
    : new Set(['AttemptStarted', 'ExternalActionStarted', 'RunObserved']);
  if (!allowed.has(event.event_type)) throw new QualificationProtocolError('ACTION_STREAM_STATE_INVALID');
}

function assertSha(value) {
  if (!SHA256_RE.test(value ?? '')) throw new QualificationProtocolError('SHA256_INVALID');
}

function withoutKeys(value, keys) {
  const copy = structuredClone(value);
  for (const key of keys) delete copy[key];
  return copy;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(code, errors) {
  return { ok: false, code, errors, summary: {} };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new QualificationProtocolError('PERSISTED_RECORD_MISSING', filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fsyncDirectory(directoryPath) {
  let directory;
  try {
    directory = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(directory);
  } finally {
    if (directory !== undefined) fs.closeSync(directory);
  }
}

function durableMkdir(directoryPath) {
  const missing = [];
  let current = path.resolve(directoryPath);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fs.mkdirSync(directoryPath, { recursive: true });
  for (const created of missing.reverse()) {
    fsyncDirectory(created);
    const parent = path.dirname(created);
    if (parent !== created) fsyncDirectory(parent);
  }
}
