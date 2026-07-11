import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  GuardedQualificationActionAdapter,
  LOCAL_INTEGRITY_SCOPE,
  LocalQualificationProtocolStore,
  QUALIFICATION_PROTOCOL_INTEGRITY,
  QualificationProtocolError,
  atomicCompareAndCreate,
  createSignedEvent,
  createSignedPlan,
  goldenCaseCatalogHash,
  goldenCaseHash,
  hashText,
  hydrateKeyRegistry,
  qualificationEventHash,
  qualificationPlanHash,
  qualificationProfileHash,
  qualificationReceiptHash,
  validateKeyRegistry,
  validateQualificationPlan,
  verifyQualificationEvent,
} from '../lib/devseek-qualification-protocol.mjs';
import { sha256Object } from '../lib/devseek-capability-ledger.mjs';

const execFile = promisify(execFileCallback);
const NOW = '2026-07-12T08:00:00.000Z';
const EARLIER = '2026-07-12T07:59:59.999Z';
const PLAN_START = '2026-07-12T07:00:00.000Z';
const PLAN_END = '2026-07-12T10:00:00.000Z';
const WINDOW = ['2026-07-12T07:30:00.000Z', '2026-07-12T09:30:00.000Z'];
const SEED_REVEAL = 'deterministic-g0b-seed-v1';

function protocolObject(schemaVersion) {
  return {
    schema_version: schemaVersion,
    integrity: { ...QUALIFICATION_PROTOCOL_INTEGRITY },
    integrity_scope: LOCAL_INTEGRITY_SCOPE,
    qualification_eligible: false,
  };
}

function generateSigner(purpose, ordinal) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyId = `test-${purpose}-${ordinal}`;
  const identity = `test/${purpose}/${ordinal}`;
  return {
    signer: { keyId, identity, privateKey },
    entry: {
      key_id: keyId,
      identity,
      algorithm: 'ed25519',
      public_key_encoding: 'spki-der-base64',
      public_key_spki_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      public_key_spki_sha256: null,
      trust_scope: 'deterministic-test-only',
      purposes: [purpose],
      valid_from: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      status: 'test-only',
      private_key_material_prohibited: true,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      key_sha256: null,
    },
  };
}

function makeQualificationSources() {
  const caseEntry = {
    case_id: 'G0B-P01',
    case_version: 1,
    category: 'protocol',
    fixture: {
      workspace_fixture_sha256: sha256Object({ fixture: 'workspace-fixture' }),
    },
    case_sha256: null,
  };
  caseEntry.case_sha256 = goldenCaseHash(caseEntry);
  const catalog = {
    catalog_id: 'g0b-test-catalog',
    catalog_version: 1,
    source_status: 'test-fixture',
    cases: [caseEntry],
    catalog_sha256: null,
  };
  catalog.catalog_sha256 = goldenCaseCatalogHash(catalog);
  const profile = {
    profile_id: 'g0b-local-protocol-profile',
    profile_version: 1,
    catalog_binding: {
      catalog_id: catalog.catalog_id,
      catalog_version: catalog.catalog_version,
      catalog_sha256: catalog.catalog_sha256,
    },
    required_cases: [{
      case_id: caseEntry.case_id,
      case_version: caseEntry.case_version,
      case_sha256: caseEntry.case_sha256,
      category: caseEntry.category,
    }],
    qualification_plan_policy: { minimum_coverage_slots: 1 },
    profile_sha256: null,
  };
  profile.profile_sha256 = qualificationProfileHash(profile);
  return { catalog, profile };
}

function makeIdentity() {
  const purposes = [
    'qualification-plan',
    'runner-event',
    'oracle-classification',
    'infra-adjudication',
    'store-receipt',
    'action-guard',
  ];
  const generated = Object.fromEntries(purposes.map((purpose, index) => [purpose, generateSigner(purpose, index + 1)]));
  const registry = hydrateKeyRegistry({
    ...protocolObject('devseek.qualification-key-registry/v1'),
    registry_id: 'test-g0b-key-registry-v1',
    registry_version: 1,
    source_status: 'draft',
    registry_sha256: null,
    keys: purposes.map(purpose => generated[purpose].entry),
  });
  return {
    registry,
    signers: Object.fromEntries(purposes.map(purpose => [purpose, generated[purpose].signer])),
  };
}

function makePlan(identity, overrides = {}) {
  const digest = label => sha256Object({ fixture: label });
  const { catalog, profile } = makeQualificationSources();
  const candidate = {
    ...protocolObject('devseek.candidate-identity/v1'),
    candidate_id: 'candidate-g0b-test',
    candidate_version: 1,
    source: {
      repository_id: 'devseek_netai',
      git_commit: 'deadbee',
      worktree_state: 'clean',
      source_tree_sha256: digest('source-tree'),
      submodule_state_sha256: null,
    },
    artifacts: {
      installed_artifact_sha256: digest('installed-artifact'),
      extension_artifact_sha256: digest('extension-artifact'),
      bridge_artifact_sha256: digest('bridge-artifact'),
      cli_artifact_sha256: digest('cli-artifact'),
      packaging_metadata_sha256: digest('packaging-metadata'),
    },
    provider_connector: {
      provider_product: 'deepseek-web',
      provider_model: 'fixture-model',
      provider_mode: 'deterministic-fixture',
      provider_connector_sha256: digest('provider-connector'),
      provider_page_fingerprint: digest('provider-page'),
      provider_dom_fingerprint: digest('provider-dom'),
    },
    execution_inputs: {
      prompt_bundle_sha256: digest('prompt-bundle'),
      runtime_config_sha256: digest('runtime-config'),
      environment_fingerprint_sha256: digest('environment'),
      platform_profile: 'linux-x64-fixture',
      runner_image_sha256: digest('runner-image'),
      toolchain_lock_sha256: digest('toolchain-lock'),
    },
    dependency_snapshot_sha256: digest('dependency-snapshot'),
    candidate_identity_sha256: null,
  };
  const planInput = {
    ...protocolObject('devseek.qualification-plan/v1'),
    qualification_campaign_id: 'campaign-g0b-test',
    qualification_plan_id: 'plan-g0b-test',
    candidate_identity: candidate,
    candidate_identity_sha256: null,
    profile_id: 'g0b-local-protocol-profile',
    profile_sha256: profile.profile_sha256,
    catalog_sha256: catalog.catalog_sha256,
    key_registry_sha256: null,
    oracle_bundle_sha256: digest('oracle-bundle'),
    corpus_sha256: digest('corpus'),
    metric_and_statistical_plan_sha256: digest('metric-plan'),
    competitor_identity_set_sha256: null,
    created_at: NOW,
    valid_from: PLAN_START,
    expires_at: PLAN_END,
    randomization: {
      algorithm: 'sha256-counter-v1',
      seed_commitment_sha256: hashText(SEED_REVEAL),
      seed_reveal_encrypted_ref: 'secrets://fixture/g0b-seed',
      reveal_after_event: 'QualificationPlanRegistered',
      commitment_verification_required: true,
    },
    preflight_slots: [
      {
        preflight_slot_id: 'preflight-original',
        order: 1,
        scheduled_window: WINDOW,
        retry_of_preflight_slot_id: null,
        requested_ready_ttl: 'PT1H',
        allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
        preflight_slot_sha256: null,
      },
      {
        preflight_slot_id: 'preflight-infra-retry',
        order: 2,
        scheduled_window: WINDOW,
        retry_of_preflight_slot_id: 'preflight-original',
        requested_ready_ttl: 'PT1H',
        allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
        preflight_slot_sha256: null,
      },
    ],
    coverage_slots: [
      {
        coverage_slot_id: 'coverage-primary',
        order: 3,
        scheduled_window: WINDOW,
        capability_id: 'C0-PREREGISTRATION-PLAN',
        case_id: 'G0B-P01',
        case_version: 1,
        hidden_variant_id: 'local-visible-v1',
        workspace_fixture_sha256: digest('workspace-fixture'),
        surface: 'local-node-test',
        stage: 'T0',
        attempt_windows: [{
          attempt_role: 'primary',
          eligible_preflight_slot_id: 'preflight-original',
          scheduled_window: WINDOW,
          retry_of_attempt_role: null,
          allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
        }],
        coverage_slot_sha256: null,
      },
    ],
    budgets: {
      maximum_preflight_slots: 2,
      maximum_primary_attempts_per_coverage_slot: 1,
      maximum_adjudicated_infra_retry_attempts_per_coverage_slot: 1,
      maximum_total_attempts_per_coverage_slot: 2,
      wall_time_seconds: 3600,
      tool_calls: 100,
      tokens: 100000,
    },
    execution_environment_sha256: digest('execution-environment'),
    plan_attestation: null,
    qualification_plan_sha256: null,
    ...overrides,
  };
  return createSignedPlan(planInput, {
    signer: identity.signers['qualification-plan'],
    registry: identity.registry,
  });
}

function makeEvent(identity, plan, {
  eventId,
  eventType,
  streamKind,
  correlationId,
  sequence = 1,
  previousEvent = null,
  payload = { protocol_marker: eventType },
  signerPurpose,
  occurredAt = NOW,
  recordedAt = NOW,
}) {
  const purpose = signerPurpose ?? (
    eventType === 'QualificationPlanRegistered'
      ? 'qualification-plan'
      : eventType === 'InfraAdjudicated'
        ? 'infra-adjudication'
        : eventType === 'OracleClassified'
          ? 'oracle-classification'
          : 'runner-event'
  );
  return createSignedEvent({
    ...protocolObject('devseek.qualification-event/v1'),
    event_id: eventId,
    event_type: eventType,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    candidate_identity_sha256: plan.candidate_identity_sha256,
    stream_kind: streamKind,
    correlation_id: correlationId,
    sequence,
    previous_event_sha256: previousEvent?.event_sha256 ?? null,
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    actor_id: identity.signers[purpose].identity,
    payload,
    event_attestation: null,
    event_sha256: null,
  }, {
    signer: identity.signers[purpose],
    registry: identity.registry,
  });
}

function corruptBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  bytes[0] ^= 0x01;
  return bytes.toString('base64');
}

function assertProtocolCode(fn, code) {
  assert.throws(fn, error => error instanceof QualificationProtocolError && error.code === code);
}

function tempStore(t, identity, mutableClock = { value: NOW }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0b-protocol-'));
  const { profile, catalog } = makeQualificationSources();
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return {
    rootDir,
    clock: mutableClock,
    store: new LocalQualificationProtocolStore({
      rootDir,
      registry: identity.registry,
      now: () => new Date(mutableClock.value),
      storeSigner: identity.signers['store-receipt'],
      guardSigner: identity.signers['action-guard'],
      approvedProfile: profile,
      approvedCatalog: catalog,
      governanceMode: 'deterministic-test-only',
    }),
  };
}

function registrationEvent(identity, plan) {
  return makeEvent(identity, plan, {
    eventId: 'event-plan-registered',
    eventType: 'QualificationPlanRegistered',
    streamKind: 'plan',
    correlationId: plan.qualification_campaign_id,
    payload: { qualification_plan_sha256: plan.qualification_plan_sha256 },
  });
}

function registerPlan(store, identity, plan) {
  const { profile, catalog } = makeQualificationSources();
  return store.registerPlan(plan, {
    seedReveal: SEED_REVEAL,
    registrationEvent: registrationEvent(identity, plan),
    profile,
    catalog,
  });
}

function appendEvent(store, plan, event, previousEvent = null) {
  return store.compareAndAppend({
    plan,
    event,
    expectedSequence: previousEvent ? previousEvent.sequence + 1 : 1,
    expectedHeadSha256: previousEvent?.event_sha256 ?? null,
  });
}

function appendSessionChain(store, identity, plan, correlationId, eventTypes, payloadByType = {}) {
  const events = [];
  for (const [index, eventType] of eventTypes.entries()) {
    const previousEvent = events.at(-1) ?? null;
    const event = makeEvent(identity, plan, {
      eventId: `${correlationId}-${String(index + 1).padStart(2, '0')}-${eventType}`,
      eventType,
      streamKind: 'session',
      correlationId,
      sequence: index + 1,
      previousEvent,
      payload: payloadByType[eventType] ?? { protocol_marker: eventType },
    });
    appendEvent(store, plan, event, previousEvent);
    events.push(event);
  }
  return events;
}

function appendAttemptChain(store, identity, plan, correlationId, eventTypes, payloadByType = {}) {
  const events = [];
  for (const [index, eventType] of eventTypes.entries()) {
    const previousEvent = events.at(-1) ?? null;
    const event = makeEvent(identity, plan, {
      eventId: `${correlationId}-${String(index + 1).padStart(2, '0')}-${eventType}`,
      eventType,
      streamKind: 'attempt',
      correlationId,
      sequence: index + 1,
      previousEvent,
      payload: payloadByType[eventType] ?? { protocol_marker: eventType },
    });
    appendEvent(store, plan, event, previousEvent);
    events.push(event);
  }
  return events;
}

function resignPlan(identity, plan, mutate) {
  const input = structuredClone(plan);
  input.plan_attestation = null;
  input.qualification_plan_sha256 = null;
  mutate(input);
  return createSignedPlan(input, {
    signer: identity.signers['qualification-plan'],
    registry: identity.registry,
  });
}

function baseAction(overrides = {}) {
  return {
    action_id: 'action-g0b-1',
    action_ordinal: 1,
    action_type: 'deepseek-web-turn',
    destination: 'https://chat.deepseek.com',
    nonce: 'nonce-g0b-00000001',
    ...overrides,
  };
}

function compileProtocolSchemas() {
  const readSchema = name => JSON.parse(fs.readFileSync(path.resolve('docs/process', name), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(readSchema('devseek-candidate-identity.schema.json'));
  return {
    registry: ajv.compile(readSchema('devseek-qualification-key-registry.schema.json')),
    plan: ajv.compile(readSchema('devseek-qualification-plan.schema.json')),
    event: ajv.compile(readSchema('devseek-qualification-event.schema.json')),
    receipt: ajv.compile(readSchema('devseek-qualification-receipt.schema.json')),
  };
}

test('runtime plan, event, and receipt factories conform to the checked machine schemas', t => {
  const validators = compileProtocolSchemas();
  const identity = makeIdentity();
  assert.equal(validators.registry(identity.registry), true, JSON.stringify(validators.registry.errors));
  const plan = makePlan(identity);
  assert.equal(validators.plan(plan), true, JSON.stringify(validators.plan.errors));
  const registeredEvent = registrationEvent(identity, plan);
  assert.equal(validators.event(registeredEvent), true, JSON.stringify(validators.event.errors));

  const { store } = tempStore(t, identity);
  const registration = registerPlan(store, identity, plan);
  assert.equal(validators.receipt(registration.receipt), true, JSON.stringify(validators.receipt.errors));
  const reservation = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-schema',
  }).reservation;
  const session = makeEvent(identity, plan, {
    eventId: 'session-schema-registered',
    eventType: 'QualificationSessionRegistered',
    streamKind: 'session',
    correlationId: 'session-schema',
  });
  appendEvent(store, plan, session);
  const action = baseAction({ action_id: 'action-schema', nonce: 'nonce-schema-0001' });
  const receipt = store.authorizeExternalAction({
    plan,
    reservation,
    streamKind: 'session',
    correlationId: 'session-schema',
    action,
  });
  assert.equal(validators.receipt(receipt), true, JSON.stringify(validators.receipt.errors));
  const authorizationEvent = store.readStream('session', 'session-schema', { plan }).events.at(-1);
  assert.equal(validators.event(authorizationEvent), true, JSON.stringify(validators.event.errors));
});

test('purpose-separated Ed25519 registry and signed plan fail closed on tamper, wrong purpose, and unknown algorithm', () => {
  const identity = makeIdentity();
  const sources = makeQualificationSources();
  const registryResult = validateKeyRegistry(identity.registry, { now: NOW });
  assert.equal(registryResult.ok, true, registryResult.errors.join(';'));
  assert.equal(new Set(identity.registry.keys.map(key => key.key_id)).size, 6);
  assert.equal(new Set(identity.registry.keys.map(key => key.identity)).size, 6);
  assert.equal(identity.registry.keys.every(key => key.purposes.length === 1), true);

  const plan = makePlan(identity);
  const valid = validateQualificationPlan(plan, {
    registry: identity.registry,
    ...sources,
    seedReveal: SEED_REVEAL,
    now: NOW,
  });
  assert.equal(valid.ok, true, valid.errors.join(';'));
  assert.equal(plan.qualification_plan_sha256, qualificationPlanHash(plan));

  const payloadTamper = structuredClone(plan);
  payloadTamper.qualification_campaign_id = 'campaign-attacker';
  assert.equal(validateQualificationPlan(payloadTamper, { registry: identity.registry, seedReveal: SEED_REVEAL, now: NOW }).ok, false);

  const signatureTamper = structuredClone(plan);
  signatureTamper.plan_attestation.signature_base64 = corruptBase64(signatureTamper.plan_attestation.signature_base64);
  assert.equal(validateQualificationPlan(signatureTamper, { registry: identity.registry, seedReveal: SEED_REVEAL, now: NOW }).ok, false);

  const unknownAlgorithm = structuredClone(plan);
  unknownAlgorithm.plan_attestation.algorithm = 'ed448';
  const algorithmResult = validateQualificationPlan(unknownAlgorithm, { registry: identity.registry, seedReveal: SEED_REVEAL, now: NOW });
  assert.equal(algorithmResult.ok, false);
  assert.match(algorithmResult.errors.join(';'), /ALGORITHM_UNSUPPORTED/u);

  const wrongPurpose = createSignedPlan({
    ...structuredClone(plan),
    plan_attestation: null,
    qualification_plan_sha256: null,
  }, {
    signer: identity.signers['runner-event'],
    registry: identity.registry,
  });
  const wrongPurposeResult = validateQualificationPlan(wrongPurpose, { registry: identity.registry, seedReveal: SEED_REVEAL, now: NOW });
  assert.equal(wrongPurposeResult.ok, false);
  assert.match(wrongPurposeResult.errors.join(';'), /KEY_PURPOSE_MISMATCH/u);
});

test('plan completeness rejects zero, 999, missing-case, and duplicate-role plans while accepting the 1000 boundary', () => {
  const identity = makeIdentity();
  const sources = makeQualificationSources();
  const zero = resignPlan(identity, makePlan(identity), input => { input.coverage_slots = []; });
  assert.equal(validateQualificationPlan(zero, {
    registry: identity.registry,
    ...sources,
    seedReveal: SEED_REVEAL,
    now: NOW,
  }).ok, false);

  const profile1000 = structuredClone(sources.profile);
  profile1000.qualification_plan_policy.minimum_coverage_slots = 1000;
  profile1000.profile_sha256 = qualificationProfileHash(profile1000);
  const makeBoundaryPlan = count => resignPlan(identity, makePlan(identity), input => {
    input.profile_sha256 = profile1000.profile_sha256;
    const template = input.coverage_slots[0];
    input.coverage_slots = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(template),
      coverage_slot_id: `coverage-${String(index + 1).padStart(4, '0')}`,
      order: input.preflight_slots.length + index + 1,
      coverage_slot_sha256: null,
    }));
  });
  assert.equal(validateQualificationPlan(makeBoundaryPlan(999), {
    registry: identity.registry,
    profile: profile1000,
    catalog: sources.catalog,
    seedReveal: SEED_REVEAL,
    now: NOW,
  }).ok, false);
  const boundaryResult = validateQualificationPlan(makeBoundaryPlan(1000), {
    registry: identity.registry,
    profile: profile1000,
    catalog: sources.catalog,
    seedReveal: SEED_REVEAL,
    now: NOW,
  });
  assert.equal(boundaryResult.ok, true, boundaryResult.errors.join(';'));

  const missingCaseProfile = structuredClone(sources.profile);
  missingCaseProfile.required_cases.push({
    case_id: 'G0B-MISSING',
    case_version: 1,
    case_sha256: sha256Object({ missing: true }),
    category: 'attack',
  });
  missingCaseProfile.profile_sha256 = qualificationProfileHash(missingCaseProfile);
  const missingCasePlan = resignPlan(identity, makePlan(identity), input => {
    input.profile_sha256 = missingCaseProfile.profile_sha256;
  });
  assert.equal(validateQualificationPlan(missingCasePlan, {
    registry: identity.registry,
    profile: missingCaseProfile,
    catalog: sources.catalog,
    seedReveal: SEED_REVEAL,
    now: NOW,
  }).ok, false);

  const duplicateRole = resignPlan(identity, makePlan(identity), input => {
    input.coverage_slots[0].attempt_windows.push(structuredClone(input.coverage_slots[0].attempt_windows[0]));
  });
  assert.equal(validateQualificationPlan(duplicateRole, {
    registry: identity.registry,
    ...sources,
    seedReveal: SEED_REVEAL,
    now: NOW,
  }).ok, false);
});

test('runtime trust anchor rejects substituted governance and schema-invalid signed objects', t => {
  const identity = makeIdentity();
  const approved = makeQualificationSources();
  const plan = makePlan(identity);
  const { store } = tempStore(t, identity);

  const attackerProfile = structuredClone(approved.profile);
  attackerProfile.profile_id = 'attacker-one-slot-profile';
  attackerProfile.required_cases = [];
  attackerProfile.profile_sha256 = qualificationProfileHash(attackerProfile);
  const attackerPlan = makePlan(identity, {
    profile_id: attackerProfile.profile_id,
    profile_sha256: attackerProfile.profile_sha256,
  });
  assertProtocolCode(() => store.registerPlan(attackerPlan, {
    seedReveal: SEED_REVEAL,
    registrationEvent: registrationEvent(identity, attackerPlan),
    profile: attackerProfile,
    catalog: approved.catalog,
  }), 'PLAN_PROFILE_NOT_APPROVED');

  const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0b-fresh-root-'));
  t.after(() => fs.rmSync(freshRoot, { recursive: true, force: true }));
  assertProtocolCode(() => new LocalQualificationProtocolStore({
    rootDir: freshRoot,
    registry: identity.registry,
    now: () => new Date(NOW),
    storeSigner: identity.signers['store-receipt'],
    guardSigner: identity.signers['action-guard'],
    approvedProfile: attackerProfile,
    approvedCatalog: approved.catalog,
  }), 'AUDITED_GOVERNANCE_DIGEST_MISMATCH');

  const invalidBudgetPlan = makePlan(identity, {
    budgets: {
      maximum_preflight_slots: 2,
      maximum_primary_attempts_per_coverage_slot: 1,
      maximum_adjudicated_infra_retry_attempts_per_coverage_slot: 1,
      maximum_total_attempts_per_coverage_slot: 2,
      wall_time_seconds: 0,
      tool_calls: 0,
      tokens: 0,
    },
  });
  assert.equal(validateQualificationPlan(invalidBudgetPlan, {
    registry: identity.registry,
    ...approved,
    seedReveal: SEED_REVEAL,
    now: NOW,
  }).ok, false);

  const emptyPayload = makeEvent(identity, plan, {
    eventId: 'schema-invalid-empty-payload',
    eventType: 'QualificationPlanRegistered',
    streamKind: 'plan',
    correlationId: plan.qualification_campaign_id,
    payload: {},
  });
  assertProtocolCode(
    () => verifyQualificationEvent(emptyPayload, { registry: identity.registry, now: NOW, plan }),
    'EVENT_SCHEMA_INVALID',
  );

  const actorSpoof = createSignedEvent({
    ...registrationEvent(identity, plan),
    actor_id: 'attacker/claimed-actor',
    event_sha256: null,
    event_attestation: null,
  }, {
    signer: identity.signers['qualification-plan'],
    registry: identity.registry,
  });
  assertProtocolCode(
    () => verifyQualificationEvent(actorSpoof, { registry: identity.registry, now: NOW, plan }),
    'EVENT_ACTOR_IDENTITY_MISMATCH',
  );
});

test('signed event verification binds hash, chain, signature purpose, algorithm, plan, and candidate', () => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const event = registrationEvent(identity, plan);
  assert.equal(verifyQualificationEvent(event, { registry: identity.registry, now: NOW, plan }), true);
  assert.equal(event.event_sha256, qualificationEventHash(event));

  const payloadTamper = structuredClone(event);
  payloadTamper.payload.injected = true;
  assertProtocolCode(
    () => verifyQualificationEvent(payloadTamper, { registry: identity.registry, now: NOW, plan }),
    'EVENT_HASH_MISMATCH',
  );

  const signatureTamper = structuredClone(event);
  signatureTamper.event_attestation.signature_base64 = corruptBase64(signatureTamper.event_attestation.signature_base64);
  assertProtocolCode(
    () => verifyQualificationEvent(signatureTamper, { registry: identity.registry, now: NOW, plan }),
    'SIGNATURE_INVALID',
  );

  const unknownAlgorithm = structuredClone(event);
  unknownAlgorithm.event_attestation.algorithm = 'rsa-pss-sha256';
  assertProtocolCode(
    () => verifyQualificationEvent(unknownAlgorithm, { registry: identity.registry, now: NOW, plan }),
    'ALGORITHM_UNSUPPORTED',
  );

  const wrongPurpose = makeEvent(identity, plan, {
    eventId: 'event-plan-wrong-purpose',
    eventType: 'QualificationPlanRegistered',
    streamKind: 'plan',
    correlationId: plan.qualification_campaign_id,
    signerPurpose: 'runner-event',
  });
  assertProtocolCode(
    () => verifyQualificationEvent(wrongPurpose, { registry: identity.registry, now: NOW, plan }),
    'KEY_PURPOSE_MISMATCH',
  );

  const wrongCandidate = structuredClone(event);
  wrongCandidate.candidate_identity_sha256 = sha256Object({ attacker: true });
  assertProtocolCode(
    () => verifyQualificationEvent(wrongCandidate, { registry: identity.registry, now: NOW, plan }),
    'EVENT_HASH_MISMATCH',
  );
});

test('store CAS append is durable, receipt-verified, idempotent for identical events, and rejects identity/head conflicts', t => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const { store } = tempStore(t, identity);
  const event = registrationEvent(identity, plan);
  const sources = makeQualificationSources();
  const first = store.registerPlan(plan, {
    seedReveal: SEED_REVEAL,
    registrationEvent: event,
    ...sources,
  });
  assert.equal(first.status, 'registered');
  assert.equal(first.event.status, 'committed');
  assert.equal(first.receipt.receipt_sha256, qualificationReceiptHash(first.receipt));
  store.verifyStoredReceipt(first.receipt, 'plan-registration');

  const repeated = store.registerPlan(plan, {
    seedReveal: SEED_REVEAL,
    registrationEvent: event,
    ...sources,
  });
  assert.equal(repeated.status, 'already-registered');
  assert.equal(repeated.event.status, 'already-committed');

  const session = makeEvent(identity, plan, {
    eventId: 'event-session-genesis',
    eventType: 'QualificationSessionRegistered',
    streamKind: 'session',
    correlationId: 'session-cas',
  });
  const append = appendEvent(store, plan, session);
  assert.equal(append.status, 'committed');
  store.verifyStoredReceipt(append.receipt, 'event-append');
  assert.equal(append.receipt.receipt_sha256, qualificationReceiptHash(append.receipt));
  assert.equal(appendEvent(store, plan, session).status, 'already-committed');
  const replayDir = store.streamDir('session', 'session-replayed');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.copyFileSync(
    store.eventPath('session', 'session-cas', 1),
    store.eventPath('session', 'session-replayed', 1),
  );
  assertProtocolCode(() => store.readStream('session', 'session-replayed', { plan }), 'EVENT_DIRECTORY_BINDING_MISMATCH');
  assertProtocolCode(() => store.readStream('../../escape', 'session-cas', { plan }), 'EVENT_STREAM_KIND_INVALID');

  const identityConflict = makeEvent(identity, plan, {
    eventId: session.event_id,
    eventType: 'QualificationSessionRegistered',
    streamKind: 'session',
    correlationId: 'session-cas',
    payload: { conflicting: true },
  });
  assertProtocolCode(() => appendEvent(store, plan, identityConflict), 'EVENT_ID_CONFLICT');

  const next = makeEvent(identity, plan, {
    eventId: 'event-session-started',
    eventType: 'PreflightAttemptStarted',
    streamKind: 'session',
    correlationId: 'session-cas',
    sequence: 2,
    previousEvent: session,
  });
  assertProtocolCode(() => store.compareAndAppend({
    plan,
    event: next,
    expectedSequence: 2,
    expectedHeadSha256: sha256Object({ wrong: 'head' }),
  }), 'EVENT_HEAD_CONFLICT');

  const receiptSignatureTamper = structuredClone(append.receipt);
  receiptSignatureTamper.attestation.signature_base64 = corruptBase64(receiptSignatureTamper.attestation.signature_base64);
  assertProtocolCode(() => store.verifyStoredReceipt(receiptSignatureTamper, 'event-append'), 'SIGNATURE_INVALID');
  const receiptAlgorithmTamper = structuredClone(append.receipt);
  receiptAlgorithmTamper.attestation.algorithm = 'unknown';
  assertProtocolCode(() => store.verifyStoredReceipt(receiptAlgorithmTamper, 'event-append'), 'ALGORITHM_UNSUPPORTED');
  const receiptPurposeTamper = structuredClone(append.receipt);
  receiptPurposeTamper.attestation.purpose = 'runner-event';
  assertProtocolCode(() => store.verifyStoredReceipt(receiptPurposeTamper, 'event-append'), 'SIGNATURE_PURPOSE_MISMATCH');
});

test('global slot order, reservation CAS, and signed infra retry adjudication are fail-closed', t => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const { store } = tempStore(t, identity);
  registerPlan(store, identity, plan);

  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'primary',
    ownerCorrelationId: 'attempt-too-early',
  }), 'GLOBAL_SLOT_ORDER_BLOCKED');
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-infra-retry',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'session-retry',
  }), 'GLOBAL_SLOT_ORDER_BLOCKED');

  const original = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-original',
  });
  assert.equal(original.status, 'reserved');
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'attacker-alternate-role',
    ownerCorrelationId: 'session-original',
  }), 'ATTEMPT_ROLE_NOT_PLANNED');
  assert.equal(store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-original',
  }).status, 'already-reserved');
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-racer',
  }), 'SLOT_ALREADY_CONSUMED');

  const originalEvents = appendSessionChain(store, identity, plan, 'session-original', [
    'QualificationSessionRegistered',
    'PreflightAttemptStarted',
    'PreflightObserved',
    'PreflightClassified',
    'QualificationSessionBlocked',
  ], {
    QualificationSessionBlocked: {
      failure_class: 'test-infra',
      reason_code: 'fixture-unavailable',
    },
  });
  store.completeSlot({ plan, reservation: original.reservation, terminalEvent: originalEvents.at(-1) });

  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-infra-retry',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'session-retry',
  }), 'RETRY_ADJUDICATION_REQUIRED');

  const failureEvent = originalEvents.at(-1);
  const adjudication = makeEvent(identity, plan, {
    eventId: 'session-original-infra-adjudicated',
    eventType: 'InfraAdjudicated',
    streamKind: 'session',
    correlationId: 'session-original',
    sequence: failureEvent.sequence + 1,
    previousEvent: failureEvent,
    payload: {
      failure_class: 'test-infra',
      original_slot_id: 'preflight-original',
      original_failure_event_sha256: failureEvent.event_sha256,
      adjudication_evidence_sha256: sha256Object({ fixture: 'g0b-test-infra-evidence' }),
      reason_code: 'fixture-unavailable',
    },
  });
  appendEvent(store, plan, adjudication, failureEvent);
  const retry = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-infra-retry',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'session-retry',
    adjudicationEvent: adjudication,
  });
  assert.equal(retry.status, 'reserved');

  const retryEvents = appendSessionChain(store, identity, plan, 'session-retry', [
    'QualificationSessionRegistered',
    'PreflightAttemptStarted',
    'PreflightObserved',
    'PreflightClassified',
    'QualificationSessionReady',
  ]);
  store.completeSlot({ plan, reservation: retry.reservation, terminalEvent: retryEvents.at(-1) });
  const coverage = store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'primary',
    ownerCorrelationId: 'attempt-primary',
  });
  assert.equal(coverage.status, 'reserved');
});

test('coverage retry is a signed aggregate state machine and cannot run beside or after a finalized primary', t => {
  const identity = makeIdentity();
  const plan = resignPlan(identity, makePlan(identity), input => {
    input.preflight_slots = [input.preflight_slots[0]];
    input.coverage_slots[0].order = 2;
    input.coverage_slots[0].attempt_windows.push({
      attempt_role: 'adjudicated-infra-retry',
      eligible_preflight_slot_id: 'preflight-original',
      scheduled_window: WINDOW,
      retry_of_attempt_role: 'primary',
      allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
    });
    input.budgets.maximum_preflight_slots = 1;
  });
  const { store } = tempStore(t, identity);
  registerPlan(store, identity, plan);

  const preflightReservation = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-coverage-preflight',
  }).reservation;
  const preflight = appendSessionChain(store, identity, plan, 'session-coverage-preflight', [
    'QualificationSessionRegistered',
    'PreflightAttemptStarted',
    'PreflightObserved',
    'PreflightClassified',
    'QualificationSessionReady',
  ]);
  store.completeSlot({ plan, reservation: preflightReservation, terminalEvent: preflight.at(-1) });

  const primaryReservation = store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'primary',
    ownerCorrelationId: 'attempt-coverage-primary',
  }).reservation;
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'attempt-coverage-retry',
  }), 'RETRY_ADJUDICATION_REQUIRED');

  const primary = appendAttemptChain(store, identity, plan, 'attempt-coverage-primary', [
    'AttemptRegistered',
    'AttemptStarted',
    'AttemptAbandoned',
    'OracleClassified',
    'AttemptTerminated',
  ], {
    AttemptTerminated: {
      failure_class: 'test-infra',
      reason_code: 'runner-crash',
    },
  });
  const eligibility = store.completeSlot({
    plan,
    reservation: primaryReservation,
    terminalEvent: primary.at(-1),
  });
  assert.equal(eligibility.branch_state, 'infra-failed-awaiting-adjudicated-retry');

  const adjudicationChain = appendSessionChain(store, identity, plan, 'session-coverage-adjudication', [
    'QualificationSessionRegistered',
    'PreflightAttemptStarted',
    'PreflightObserved',
    'PreflightClassified',
    'QualificationSessionBlocked',
  ], {
    QualificationSessionBlocked: {
      failure_class: 'test-infra',
      reason_code: 'runner-crash',
    },
  });
  const adjudicationPrior = adjudicationChain.at(-1);
  const adjudication = makeEvent(identity, plan, {
    eventId: 'coverage-retry-adjudicated',
    eventType: 'InfraAdjudicated',
    streamKind: 'session',
    correlationId: 'session-coverage-adjudication',
    sequence: adjudicationPrior.sequence + 1,
    previousEvent: adjudicationPrior,
    payload: {
      failure_class: 'test-infra',
      original_slot_id: 'coverage-primary',
      original_attempt_role: 'primary',
      original_failure_event_sha256: primary.at(-1).event_sha256,
      adjudication_evidence_sha256: sha256Object({ evidence: 'coverage-retry' }),
      reason_code: 'runner-crash',
    },
  });
  appendEvent(store, plan, adjudication, adjudicationPrior);

  const retryReservation = store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'attempt-coverage-retry',
    adjudicationEvent: adjudication,
  }).reservation;
  const retry = appendAttemptChain(store, identity, plan, 'attempt-coverage-retry', [
    'AttemptRegistered',
    'AttemptStarted',
    'AttemptAbandoned',
    'OracleClassified',
    'AttemptTerminated',
  ], {
    AttemptTerminated: { outcome: 'pass' },
  });
  const finalDisposition = store.completeSlot({ plan, reservation: retryReservation, terminalEvent: retry.at(-1) });
  assert.equal(finalDisposition.disposition, 'AttemptTerminated');
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'primary',
    ownerCorrelationId: 'attempt-after-final',
  }), 'SLOT_ALREADY_FINALIZED');
});

test('a successful primary preflight closes its planned retry with an explicit signed branch-skip event', t => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const { store } = tempStore(t, identity);
  registerPlan(store, identity, plan);
  const reservation = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-branch-skip',
  }).reservation;
  const events = appendSessionChain(store, identity, plan, 'session-branch-skip', [
    'QualificationSessionRegistered',
    'PreflightAttemptStarted',
    'PreflightObserved',
    'PreflightClassified',
    'QualificationSessionReady',
  ]);
  const ready = events.at(-1);
  store.completeSlot({ plan, reservation, terminalEvent: ready });
  const skipped = makeEvent(identity, plan, {
    eventId: 'session-branch-skip-retry-skipped',
    eventType: 'SlotBranchSkipped',
    streamKind: 'session',
    correlationId: 'session-branch-skip',
    sequence: ready.sequence + 1,
    previousEvent: ready,
    payload: {
      skipped_slot_id: 'preflight-infra-retry',
      predicate_event_sha256: ready.event_sha256,
      reason_code: 'primary-ready',
    },
  });
  appendEvent(store, plan, skipped, ready);
  const disposition = store.skipSlotBranch({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-infra-retry',
    attemptRole: 'adjudicated-infra-retry',
    predicateEvent: ready,
    skipEvent: skipped,
  });
  assert.equal(disposition.disposition, 'SlotBranchSkipped');
  assertProtocolCode(() => store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-infra-retry',
    attemptRole: 'adjudicated-infra-retry',
    ownerCorrelationId: 'session-should-not-run',
  }), 'SLOT_ALREADY_FINALIZED');
  assert.equal(store.reserveSlot({
    plan,
    slotKind: 'coverage',
    slotId: 'coverage-primary',
    attemptRole: 'primary',
    ownerCorrelationId: 'attempt-after-branch-skip',
  }).status, 'reserved');
});

test('guarded action receipt is bound, one-time, stale-head safe, and 1024 deterministic invalid traces dispatch zero actions', t => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const { store } = tempStore(t, identity);
  registerPlan(store, identity, plan);
  const reservation = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-action',
  }).reservation;
  const genesis = makeEvent(identity, plan, {
    eventId: 'session-action-registered',
    eventType: 'QualificationSessionRegistered',
    streamKind: 'session',
    correlationId: 'session-action',
  });
  appendEvent(store, plan, genesis);

  let dispatched = 0;
  const adapter = new GuardedQualificationActionAdapter({
    store,
    dispatch: action => {
      dispatched += 1;
      return `dispatched:${action.action_id}`;
    },
  });
  const action = baseAction();
  const staleReceipt = store.authorizeExternalAction({
    plan,
    reservation,
    streamKind: 'session',
    correlationId: 'session-action',
    action,
  });
  assert.equal(staleReceipt.receipt_sha256, qualificationReceiptHash(staleReceipt));

  // Simulate the only safe crash window: the authorization receipt is durable,
  // while neither the event nor its store receipt reached the append-only slot.
  fs.unlinkSync(store.eventPath('session', 'session-action', 2));
  fs.unlinkSync(store.receiptPath(`qsr-event-${staleReceipt.authorization_event_sha256}`));
  const recoveredReceipt = store.authorizeExternalAction({
    plan,
    reservation,
    streamKind: 'session',
    correlationId: 'session-action',
    action,
  });
  assert.equal(recoveredReceipt.receipt_sha256, staleReceipt.receipt_sha256);
  assert.equal(
    store.readStream('session', 'session-action', { plan }).events.at(-1).event_sha256,
    staleReceipt.authorization_event_sha256,
  );

  for (let index = 0; index < 1024; index += 1) {
    const field = ['action_id', 'action_ordinal', 'action_type', 'destination', 'nonce'][index % 5];
    const invalidAction = structuredClone(action);
    invalidAction[field] = field === 'action_ordinal' ? index + 2 : `${invalidAction[field]}#mutation-${index.toString(16).padStart(4, '0')}`;
    assertProtocolCode(
      () => adapter.execute({ plan, receipt: staleReceipt, action: invalidAction }),
      'ACTION_RECEIPT_BINDING_MISMATCH',
    );
  }
  assert.equal(dispatched, 0, 'universal invalid-trace oracle must observe zero external actions');

  const tamperedReceipt = structuredClone(staleReceipt);
  tamperedReceipt.attestation.signature_base64 = corruptBase64(tamperedReceipt.attestation.signature_base64);
  assertProtocolCode(() => adapter.execute({ plan, receipt: tamperedReceipt, action }), 'SIGNATURE_INVALID');
  assertProtocolCode(() => adapter.execute({ plan, receipt: null, action }), 'ACTION_RECEIPT_REQUIRED');
  assert.equal(dispatched, 0);

  const authorization = store.readStream('session', 'session-action', { plan }).events.at(-1);
  const started = makeEvent(identity, plan, {
    eventId: 'session-action-started',
    eventType: 'ExternalActionStarted',
    streamKind: 'session',
    correlationId: 'session-action',
    sequence: authorization.sequence + 1,
    previousEvent: authorization,
    signerPurpose: 'action-guard',
  });
  appendEvent(store, plan, started, authorization);
  assertProtocolCode(() => adapter.execute({ plan, receipt: staleReceipt, action }), 'ACTION_RECEIPT_STALE_HEAD');
  assert.equal(dispatched, 0);

  const currentAction = baseAction({
    action_id: 'action-g0b-2',
    action_ordinal: 2,
    nonce: 'nonce-g0b-00000002',
  });
  const currentReceipt = store.authorizeExternalAction({
    plan,
    reservation,
    streamKind: 'session',
    correlationId: 'session-action',
    action: currentAction,
  });
  for (let index = 0; index < 100; index += 1) {
    const repeatedAuthorization = store.authorizeExternalAction({
      plan,
      reservation,
      streamKind: 'session',
      correlationId: 'session-action',
      action: currentAction,
    });
    assert.equal(repeatedAuthorization.receipt_sha256, currentReceipt.receipt_sha256);
  }
  assert.equal(adapter.execute({ plan, receipt: currentReceipt, action: currentAction }), 'dispatched:action-g0b-2');
  assert.equal(dispatched, 1);
  assertProtocolCode(() => adapter.execute({ plan, receipt: currentReceipt, action: currentAction }), 'ACTION_RECEIPT_ALREADY_CONSUMED');
  assert.equal(dispatched, 1, 'receipt replay must not dispatch twice');
});

test('expired receipts and clock rollback fail before action callback', t => {
  const identity = makeIdentity();
  const plan = makePlan(identity);
  const clock = { value: NOW };
  const { store } = tempStore(t, identity, clock);
  registerPlan(store, identity, plan);
  const reservation = store.reserveSlot({
    plan,
    slotKind: 'preflight',
    slotId: 'preflight-original',
    attemptRole: 'original',
    ownerCorrelationId: 'session-time',
  }).reservation;
  const genesis = makeEvent(identity, plan, {
    eventId: 'session-time-registered',
    eventType: 'QualificationSessionRegistered',
    streamKind: 'session',
    correlationId: 'session-time',
  });
  appendEvent(store, plan, genesis);
  const action = baseAction({ action_id: 'action-time', nonce: 'nonce-time-0000001' });
  const receipt = store.authorizeExternalAction({
    plan,
    reservation,
    streamKind: 'session',
    correlationId: 'session-time',
    action,
    ttlMs: 1000,
  });
  let callbacks = 0;
  clock.value = '2026-07-12T08:00:01.000Z';
  assertProtocolCode(() => store.executeAuthorizedExternalAction({ plan, receipt, action }, () => { callbacks += 1; }), 'ACTION_RECEIPT_EXPIRED');
  assert.equal(callbacks, 0);

  clock.value = EARLIER;
  assertProtocolCode(() => store.executeAuthorizedExternalAction({ plan, receipt, action }, () => { callbacks += 1; }), 'CLOCK_ROLLBACK');
  assert.equal(callbacks, 0);
});

test('atomicCompareAndCreate has one winner across concurrent processes', async t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0b-cas-race-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const target = path.join(rootDir, 'race', 'winner.json');
  const moduleUrl = pathToFileURL(path.resolve('scripts/lib/devseek-qualification-protocol.mjs')).href;
  const childSource = `
    import { atomicCompareAndCreate } from ${JSON.stringify(moduleUrl)};
    const target = process.argv.at(-2);
    const contender = process.argv.at(-1);
    const result = atomicCompareAndCreate(target, { contender });
    process.stdout.write(JSON.stringify({ contender, ...result }));
  `;
  const contenders = Array.from({ length: 12 }, (_, index) => `contender-${String(index).padStart(2, '0')}`);
  const results = await Promise.all(contenders.map(async contender => {
    const { stdout } = await execFile(process.execPath, ['--input-type=module', '--eval', childSource, '--', target, contender]);
    return JSON.parse(stdout);
  }));
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results.filter(result => !result.created).length, contenders.length - 1);
  const persisted = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(contenders.includes(persisted.contender), true);
  assert.equal(results.find(result => result.created).contender, persisted.contender);

  assert.deepEqual(atomicCompareAndCreate(target, { contender: 'late' }), { created: false });
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).contender, persisted.contender);
});
