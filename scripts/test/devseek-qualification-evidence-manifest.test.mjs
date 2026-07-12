import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AGGREGATOR_POLICY_SCHEMA_VERSION,
  GENESIS_RETENTION_EXPECTED_ANCHOR,
  G0C_INTEGRITY,
  G0C_LOCAL_INTEGRITY_SCOPE,
  ImmutableQualificationManifestStore,
  QualificationEvidenceError,
  aggregateQualificationEvidence,
  aggregatorPolicyHash,
  aggregatorSignerKeyHash,
  createQualificationRetentionLock,
  currentQualificationState,
  hydrateAggregatorPolicy,
  qualificationEvidenceManifestHash,
  qualificationRetentionLockHash,
  validateAggregatorPolicy,
  verifyQualificationEvidenceManifest,
} from '../lib/devseek-qualification-evidence-manifest.mjs';
import {
  LOCAL_INTEGRITY_SCOPE,
  QUALIFICATION_PROTOCOL_INTEGRITY,
  createSignedEvent,
  createSignedPlan,
  hydrateKeyRegistry,
  qualificationProfileHash,
  qualificationReceiptHash,
  signProtocolPayload,
} from '../lib/devseek-qualification-protocol.mjs';
import { canonicalJson, sha256Object } from '../lib/devseek-capability-ledger.mjs';

const NOW = '2026-07-12T08:00:00.000Z';
const GENERATED = '2026-07-12T08:10:00.000Z';
const EXPIRES = '2026-07-12T09:30:00.000Z';
const RETAIN_UNTIL = '2026-07-13T08:10:00.000Z';
const PLAN_START = '2026-07-12T07:00:00.000Z';
const PLAN_END = '2026-07-12T10:00:00.000Z';
const WINDOW = ['2026-07-12T07:30:00.000Z', '2026-07-12T09:30:00.000Z'];
const STORE_COMPONENTS = Object.freeze(['manifests', 'locks', 'ids', 'records']);

function digest(label) {
  return sha256Object({ fixture: `g0c:${label}` });
}

function protocolHeader(schemaVersion) {
  return {
    schema_version: schemaVersion,
    integrity: { ...QUALIFICATION_PROTOCOL_INTEGRITY },
    integrity_scope: LOCAL_INTEGRITY_SCOPE,
    qualification_eligible: false,
  };
}

function generatedSigner(purpose, ordinal, kind = 'qualification') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const keyId = `g0c-${kind}-${purpose}-${ordinal}`;
  const identity = `fixture/g0c/${kind}/${purpose}/${ordinal}`;
  return {
    signer: { keyId, identity, privateKey },
    qualificationEntry: {
      key_id: keyId,
      algorithm: 'ed25519',
      public_key_encoding: 'spki-der-base64',
      public_key_spki_base64: der.toString('base64'),
      public_key_spki_sha256: null,
      trust_scope: 'deterministic-test-only',
      identity,
      purposes: [purpose],
      status: 'test-only',
      valid_from: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      private_key_material_prohibited: true,
      integrity_scope: LOCAL_INTEGRITY_SCOPE,
      qualification_eligible: false,
      key_sha256: null,
    },
    aggregatorEntry: {
      key_id: keyId,
      identity,
      purpose,
      algorithm: 'ed25519',
      public_key_encoding: 'spki-der-base64',
      public_key_spki_base64: der.toString('base64'),
      public_key_spki_sha256: crypto.createHash('sha256').update(der).digest('hex'),
      valid_from: '2026-07-01T00:00:00.000Z',
      expires_at: '2026-08-01T00:00:00.000Z',
      status: 'test-only',
      key_sha256: null,
    },
  };
}

function makeQualificationIdentity() {
  const purposes = [
    'qualification-plan', 'runner-event', 'oracle-classification',
    'infra-adjudication', 'store-receipt', 'action-guard',
  ];
  const generated = Object.fromEntries(purposes.map((purpose, index) => [purpose, generatedSigner(purpose, index + 1)]));
  const registry = hydrateKeyRegistry({
    ...protocolHeader('devseek.qualification-key-registry/v1'),
    source_status: 'draft',
    registry_id: 'g0c-fixture-key-registry',
    registry_version: 1,
    keys: purposes.map(purpose => generated[purpose].qualificationEntry),
    registry_sha256: null,
  });
  return {
    registry,
    signers: Object.fromEntries(purposes.map(purpose => [purpose, generated[purpose].signer])),
  };
}

function makeProfileAndCatalog(identity) {
  const catalog = JSON.parse(fs.readFileSync('docs/process/devseek-golden-case-catalog.json', 'utf8'));
  const sourceProfile = JSON.parse(fs.readFileSync('docs/process/devseek-qualification-profiles.json', 'utf8')).profiles[0];
  const caseEntry = catalog.cases[0];
  const profile = structuredClone(sourceProfile);
  profile.profile_id = 'G0C-FIXTURE-PROFILE';
  profile.profile_version = 1;
  profile.title = 'G0-C deterministic evidence manifest fixture';
  profile.key_registry_binding = {
    registry_id: identity.registry.registry_id,
    registry_version: identity.registry.registry_version,
    registry_sha256: identity.registry.registry_sha256,
    purpose_keys: Object.fromEntries(Object.entries(profile.key_registry_binding.purpose_keys)
      .map(([purpose]) => [purpose, [identity.signers[purpose].keyId]])),
  };
  profile.profile_sha256 = null;
  profile.profile_sha256 = qualificationProfileHash(profile);
  return { profile, catalog, caseEntry };
}

function makePlan(identity, sources, { withRetry = false } = {}) {
  const candidate = {
    ...protocolHeader('devseek.candidate-identity/v1'),
    candidate_id: 'candidate-g0c-fixture',
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
      provider_mode: 'controlled-replay',
      provider_connector_sha256: digest('provider-connector'),
      provider_page_fingerprint: digest('provider-page'),
      provider_dom_fingerprint: digest('provider-dom'),
    },
    execution_inputs: {
      prompt_bundle_sha256: digest('prompt-bundle'),
      runtime_config_sha256: digest('runtime-config'),
      environment_fingerprint_sha256: digest('environment'),
      platform_profile: 'linux-x64-v1',
      runner_image_sha256: digest('runner-image'),
      toolchain_lock_sha256: digest('toolchain-lock'),
    },
    dependency_snapshot_sha256: digest('dependency-snapshot'),
    candidate_identity_sha256: null,
  };
  const attemptWindows = [{
    attempt_role: 'primary',
    eligible_preflight_slot_id: 'preflight-primary',
    scheduled_window: WINDOW,
    retry_of_attempt_role: null,
    allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
  }];
  if (withRetry) attemptWindows.push({
    attempt_role: 'adjudicated-infra-retry',
    eligible_preflight_slot_id: 'preflight-primary',
    scheduled_window: WINDOW,
    retry_of_attempt_role: 'primary',
    allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
  });
  const coverageSlots = Array.from({ length: 1000 }, (_, index) => {
    const caseEntry = sources.catalog.cases[index % sources.catalog.cases.length];
    return {
      coverage_slot_id: index === 0 ? 'coverage-g0c' : `coverage-other-${String(index).padStart(4, '0')}`,
      coverage_slot_sha256: null,
      order: index + (withRetry ? 3 : 2),
      scheduled_window: WINDOW,
      capability_id: index === 0 ? 'C0-QUALIFICATION-AGGREGATOR' : 'C0-PREREGISTRATION-PLAN',
      case_id: caseEntry.case_id,
      case_version: caseEntry.case_version,
      hidden_variant_id: caseEntry.fixture.hidden_variant_id,
      workspace_fixture_sha256: caseEntry.fixture.workspace_fixture_sha256,
      surface: index === 0 ? 'vscode' : 'local-node-test',
      stage: 'T0',
      attempt_windows: index === 0 ? attemptWindows : [attemptWindows[0]],
    };
  });
  return createSignedPlan({
    ...protocolHeader('devseek.qualification-plan/v1'),
    qualification_campaign_id: 'campaign-g0c-fixture',
    qualification_plan_id: 'plan-g0c-fixture',
    profile_id: sources.profile.profile_id,
    created_at: NOW,
    candidate_identity: candidate,
    candidate_identity_sha256: null,
    profile_sha256: sources.profile.profile_sha256,
    catalog_sha256: sources.catalog.catalog_sha256,
    key_registry_sha256: null,
    oracle_bundle_sha256: digest('oracle-bundle'),
    corpus_sha256: digest('corpus'),
    metric_and_statistical_plan_sha256: digest('metric-plan'),
    competitor_identity_set_sha256: null,
    randomization: {
      algorithm: 'sha256-counter-v1',
      seed_commitment_sha256: digest('seed'),
      seed_reveal_encrypted_ref: 'secrets://fixture/g0c-seed',
      reveal_after_event: 'QualificationPlanRegistered',
      commitment_verification_required: true,
    },
    preflight_slots: [{
      preflight_slot_id: 'preflight-primary',
      preflight_slot_sha256: null,
      order: 1,
      scheduled_window: WINDOW,
      requested_ready_ttl: 'PT1H',
      retry_of_preflight_slot_id: null,
      allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
    }, ...(withRetry ? [{
      preflight_slot_id: 'preflight-adjudication',
      preflight_slot_sha256: null,
      order: 2,
      scheduled_window: WINDOW,
      requested_ready_ttl: 'PT1H',
      retry_of_preflight_slot_id: 'preflight-primary',
      allowed_actions: [{ action_type: 'deepseek-web-turn', destination: 'https://chat.deepseek.com' }],
    }] : [])],
    coverage_slots: coverageSlots,
    budgets: {
      maximum_preflight_slots: withRetry ? 2 : 1,
      maximum_primary_attempts_per_coverage_slot: 1,
      maximum_adjudicated_infra_retry_attempts_per_coverage_slot: withRetry ? 1 : 0,
      maximum_total_attempts_per_coverage_slot: withRetry ? 2 : 1,
      wall_time_seconds: 3600,
      tool_calls: 100,
      tokens: 100000,
    },
    execution_environment_sha256: digest('execution-environment'),
    valid_from: PLAN_START,
    expires_at: PLAN_END,
    qualification_plan_sha256: null,
    plan_attestation: null,
  }, {
    signer: identity.signers['qualification-plan'],
    registry: identity.registry,
  });
}

function makeEvent(identity, plan, streamKind, correlationId, eventType, prior, payload) {
  const purpose = eventType === 'QualificationPlanRegistered' ? 'qualification-plan'
    : eventType === 'OracleClassified' ? 'oracle-classification'
      : eventType === 'InfraAdjudicated' ? 'infra-adjudication'
        : ['ExternalActionAuthorized', 'ExternalActionStarted'].includes(eventType) ? 'action-guard' : 'runner-event';
  return createSignedEvent({
    ...protocolHeader('devseek.qualification-event/v1'),
    event_id: `${correlationId}-${String((prior?.sequence ?? 0) + 1).padStart(2, '0')}-${eventType}`,
    event_type: eventType,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    candidate_identity_sha256: plan.candidate_identity_sha256,
    stream_kind: streamKind,
    correlation_id: correlationId,
    sequence: (prior?.sequence ?? 0) + 1,
    previous_event_sha256: prior?.event_sha256 ?? null,
    occurred_at: NOW,
    recorded_at: NOW,
    actor_id: identity.signers[purpose].identity,
    payload,
    key_registry_sha256: identity.registry.registry_sha256,
    event_sha256: null,
    event_attestation: null,
  }, { signer: identity.signers[purpose], registry: identity.registry });
}

function makeReceipt(identity, plan, event) {
  const receipt = {
    ...protocolHeader('devseek.qualification-receipt/v1'),
    receipt_id: `receipt-${event.event_id}`,
    receipt_type: event.event_type === 'QualificationPlanRegistered' ? 'plan-registration' : 'event-append',
    qualification_plan_sha256: plan.qualification_plan_sha256,
    event_sha256: event.event_sha256,
    stream_kind: event.stream_kind,
    correlation_id: event.correlation_id,
    object_version: event.sequence,
    previous_head_sha256: event.previous_event_sha256,
    new_head_sha256: event.event_sha256,
    trusted_recorded_at: NOW,
    one_time: false,
    receipt_sha256: null,
    attestation: null,
  };
  receipt.receipt_sha256 = qualificationReceiptHash(receipt);
  receipt.attestation = signProtocolPayload({
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
    signer: identity.signers['store-receipt'],
    keyRegistrySha256: identity.registry.registry_sha256,
  });
  return receipt;
}

function makeStream(identity, plan, streamKind, correlationId, steps) {
  const events = [];
  for (const step of steps) {
    events.push(makeEvent(identity, plan, streamKind, correlationId, step.type, events.at(-1), step.payload));
  }
  return { stream_kind: streamKind, correlation_id: correlationId, events, receipts: events.map(event => makeReceipt(identity, plan, event)) };
}

function makeAggregatorPolicy(plan, signerSet) {
  const policy = {
    schema_version: AGGREGATOR_POLICY_SCHEMA_VERSION,
    integrity: { ...G0C_INTEGRITY },
    integrity_scope: G0C_LOCAL_INTEGRITY_SCOPE,
    qualification_eligible: false,
    policy_id: 'g0c-fixture-aggregator-policy',
    policy_version: 1,
    source_status: 'test-fixture',
    maximum_manifest_ttl_seconds: 7200,
    manifest_signers: [signerSet.manifest.aggregatorEntry],
    retention_signers: [signerSet.retention.aggregatorEntry],
    identity_separation: {
      manifest_and_retention_must_differ: true,
      must_differ_from_plan_and_event_actors: true,
      key_material_reuse_forbidden: true,
      purpose_separation_required: true,
    },
    retention_policy: {
      storage_class: 'append-only-local-cas',
      minimum_retention_seconds: 86400,
      independent_expected_anchor_required: true,
      immutable_manifest_id_binding_required: true,
      supersession_chain_required: true,
    },
    claim_rules: [{
      rule_id: 'g0c-fixture-exact-tuple',
      capability_id: 'C0-QUALIFICATION-AGGREGATOR',
      profile_id: plan.profile_id,
      profile_sha256: plan.profile_sha256,
      claim_scope: 'gate0-local-conformance',
      surface: 'vscode',
      provider: 'controlled-replay',
      platform_profile: 'linux-x64-v1',
      requested_level: 'L2',
      awarded_level: 'L2',
      required_coverage_slot_ids: ['coverage-g0c'],
      minimum_numerator: 1,
      minimum_denominator: 1,
      minimum_rate: 1,
      maximum_product_miss: 0,
      veto_forbidden: true,
      dependencies: [],
    }],
    policy_sha256: null,
  };
  return hydrateAggregatorPolicy(policy);
}

function buildFixture({ outcome = 'pass', withRetry = false, sessionMode = 'ready' } = {}) {
  const identity = makeQualificationIdentity();
  const sources = makeProfileAndCatalog(identity);
  const plan = makePlan(identity, sources, { withRetry });
  const signerSet = {
    manifest: generatedSigner('qualification-manifest', 1, 'aggregator'),
    retention: generatedSigner('retention-lock', 2, 'aggregator'),
  };
  const policy = makeAggregatorPolicy(plan, signerSet);
  const campaign = makeStream(identity, plan, 'plan', plan.qualification_campaign_id, [{
    type: 'QualificationPlanRegistered', payload: { qualification_plan_sha256: plan.qualification_plan_sha256 },
  }]);
  const sessionSteps = sessionMode === 'connector-failure' ? [
    { type: 'QualificationSessionRegistered', payload: { preflight_slot_id: 'preflight-primary' } },
    { type: 'PreflightAttemptStarted', payload: { phase: 'preflight' } },
    { type: 'PreflightObserved', payload: { ready: false } },
    { type: 'PreflightClassified', payload: { decision: 'product-failure' } },
    { type: 'SessionProductFailure', payload: { failure_class: 'connector', reason_code: 'connector-unavailable' } },
  ] : sessionMode === 'blocked-ready' ? [
    { type: 'QualificationSessionRegistered', payload: { preflight_slot_id: 'preflight-primary' } },
    { type: 'PreflightAttemptStarted', payload: { phase: 'preflight' } },
    { type: 'PreflightObserved', payload: { ready: false } },
    { type: 'PreflightClassified', payload: { decision: 'blocked' } },
    { type: 'QualificationSessionReady', payload: { ready_until: PLAN_END } },
  ] : [
    { type: 'QualificationSessionRegistered', payload: { preflight_slot_id: 'preflight-primary' } },
    { type: 'PreflightAttemptStarted', payload: { phase: 'preflight' } },
    { type: 'PreflightObserved', payload: { ready: true } },
    { type: 'PreflightClassified', payload: { decision: 'ready' } },
    { type: 'QualificationSessionReady', payload: { ready_until: PLAN_END } },
  ];
  const session = sessionMode === 'missing' ? null
    : makeStream(identity, plan, 'session', `session-g0c-${sessionMode}`, sessionSteps);
  const primaryOutcome = withRetry ? 'infra-invalid' : outcome;
  const primaryPayload = primaryOutcome === 'pass' ? { decision: 'pass' }
    : primaryOutcome === 'product-miss' ? { decision: 'product-miss', failure_class: 'agent' }
      : primaryOutcome === 'veto' ? { decision: 'veto', reason_code: 'unsafe-side-effect' }
        : { decision: 'infra-invalid', failure_class: 'test-infra' };
  const primaryStart = session ? {
    coverage_slot_id: 'coverage-g0c',
    coverage_slot_sha256: plan.coverage_slots[0].coverage_slot_sha256,
    qualification_session_id: session.correlation_id,
    preflight_slot_id: 'preflight-primary',
    preflight_slot_sha256: plan.preflight_slots[0].preflight_slot_sha256,
    attempt_role: 'primary',
  } : null;
  const primaryEvents = [
    { type: 'AttemptRegistered', payload: primaryStart },
    { type: 'AttemptStarted', payload: { started: true } },
    { type: 'ExternalActionAuthorized', payload: { action_id: 'action-primary' } },
    { type: 'ExternalActionStarted', payload: { action_id: 'action-primary' } },
    { type: 'RunObserved', payload: { run_evidence_auxiliary: false } },
    { type: 'OracleClassified', payload: primaryPayload },
  ];
  const attemptAllowed = sessionMode === 'ready' || sessionMode === 'blocked-ready';
  const primary = attemptAllowed
    ? makeStream(identity, plan, 'attempt', 'attempt-g0c-primary', primaryEvents)
    : null;
  const primaryOracle = primary?.events.at(-1) ?? null;
  if (primary) {
    primary.events.push(makeEvent(identity, plan, 'attempt', primary.correlation_id, 'AttemptTerminated', primaryOracle, {
      oracle_event_sha256: primaryOracle.event_sha256,
      product_terminal_state: 'settled',
    }));
    primary.receipts.push(makeReceipt(identity, plan, primary.events.at(-1)));
  }
  const streams = [campaign, ...(session ? [session] : []), ...(primary ? [primary] : [])];
  if (withRetry) {
    if (!primaryOracle || sessionMode !== 'ready') throw new Error('withRetry requires a ready primary session');
    const adjudication = makeStream(identity, plan, 'session', 'session-g0c-adjudication', [
      { type: 'QualificationSessionRegistered', payload: { preflight_slot_id: 'preflight-adjudication' } },
      { type: 'PreflightAttemptStarted', payload: { phase: 'preflight' } },
      { type: 'PreflightObserved', payload: { ready: false } },
      { type: 'PreflightClassified', payload: { decision: 'blocked' } },
      { type: 'QualificationSessionBlocked', payload: { failure_class: 'test-infra' } },
      { type: 'InfraAdjudicated', payload: {
        failure_class: 'test-infra',
        original_slot_id: 'coverage-g0c',
        original_attempt_role: 'primary',
        original_failure_event_sha256: primaryOracle.event_sha256,
        adjudication_evidence_sha256: digest('infra-adjudication'),
        reason_code: 'fixture-runner-failure',
      } },
    ]);
    const adjudicationEvent = adjudication.events.at(-1);
    const retry = makeStream(identity, plan, 'attempt', 'attempt-g0c-retry', [
      { type: 'AttemptRegistered', payload: {
        ...primaryStart,
        attempt_role: 'adjudicated-infra-retry',
        infra_adjudication_event_sha256: adjudicationEvent.event_sha256,
      } },
      { type: 'AttemptStarted', payload: { started: true } },
      { type: 'ExternalActionAuthorized', payload: { action_id: 'action-retry' } },
      { type: 'ExternalActionStarted', payload: { action_id: 'action-retry' } },
      { type: 'RunObserved', payload: { run_evidence_auxiliary: false } },
      { type: 'OracleClassified', payload: { decision: 'pass' } },
    ]);
    const retryOracle = retry.events.at(-1);
    retry.events.push(makeEvent(identity, plan, 'attempt', retry.correlation_id, 'AttemptTerminated', retryOracle, {
      oracle_event_sha256: retryOracle.event_sha256,
      product_terminal_state: 'settled',
    }));
    retry.receipts.push(makeReceipt(identity, plan, retry.events.at(-1)));
    streams.push(adjudication, retry);
  }
  const frozenEvidence = {
    plan,
    profile: sources.profile,
    catalog: sources.catalog,
    key_registry: identity.registry,
    event_streams: streams,
    run_evidence_auxiliary: [],
    dependency_manifests: [],
  };
  const manifest = aggregateQualificationEvidence({
    manifestId: `manifest-g0c-${outcome}-${withRetry ? 'retry' : 'primary'}`,
    generatedAt: GENERATED,
    expiresAt: EXPIRES,
    frozenEvidence,
    aggregationPolicy: policy,
    manifestSigner: signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  });
  const lock = createQualificationRetentionLock({
    manifest,
    aggregationPolicy: policy,
    retentionSigner: signerSet.retention.signer,
    retainedAt: GENERATED,
    retainUntil: RETAIN_UNTIL,
  });
  return {
    identity, plan, policy, signerSet, frozenEvidence, manifest, lock,
    currentState: currentQualificationState(frozenEvidence),
  };
}

function verifyFixture(fixture, overrides = {}) {
  return verifyQualificationEvidenceManifest({
    manifest: Object.hasOwn(overrides, 'manifest') ? overrides.manifest : fixture.manifest,
    retentionLock: Object.hasOwn(overrides, 'lock') ? overrides.lock : fixture.lock,
    frozenEvidence: Object.hasOwn(overrides, 'frozenEvidence') ? overrides.frozenEvidence : fixture.frozenEvidence,
    aggregationPolicy: Object.hasOwn(overrides, 'policy') ? overrides.policy : fixture.policy,
    currentState: Object.hasOwn(overrides, 'currentState') ? overrides.currentState : fixture.currentState,
    now: overrides.now ?? '2026-07-12T08:20:00.000Z',
    governanceMode: overrides.governanceMode ?? 'deterministic-test-only',
  });
}

function assertCode(fn, code) {
  assert.throws(fn, error => error instanceof QualificationEvidenceError && error.code === code);
}

function resignManifest(manifest, fixture) {
  manifest.manifest_attestation = null;
  manifest.evidence_manifest_sha256 = qualificationEvidenceManifestHash(manifest);
  const payload = {
    schema_version: manifest.schema_version,
    manifest_id: manifest.manifest_id,
    evidence_manifest_sha256: manifest.evidence_manifest_sha256,
    candidate_identity_sha256: manifest.frozen_identity.candidate_identity_sha256,
    qualification_plan_sha256: manifest.frozen_identity.qualification_plan_sha256,
    profile_sha256: manifest.frozen_identity.profile_sha256,
    generated_at: manifest.generated_at,
    expires_at: manifest.validity.expires_at,
  };
  const entry = fixture.policy.manifest_signers[0];
  const material = {
    algorithm: 'ed25519',
    domain: 'devseek/qualification-evidence-manifest-signature/v1',
    purpose: 'qualification-manifest',
    key_id: entry.key_id,
    signer_identity: entry.identity,
    aggregation_policy_sha256: fixture.policy.policy_sha256,
    payload,
  };
  manifest.manifest_attestation = {
    algorithm: 'ed25519',
    key_id: entry.key_id,
    signer_identity: entry.identity,
    purpose: 'qualification-manifest',
    aggregation_policy_sha256: fixture.policy.policy_sha256,
    signed_payload_sha256: sha256Object(material),
    signature_base64: crypto.sign(null, Buffer.from(canonicalJson(material), 'utf8'), fixture.signerSet.manifest.signer.privateKey).toString('base64'),
  };
  return manifest;
}

function resignRetentionLock(lock, fixture) {
  lock.lock_attestation = null;
  lock.lock_sha256 = qualificationRetentionLockHash(lock);
  const payload = {
    schema_version: lock.schema_version,
    lock_id: lock.lock_id,
    lock_sha256: lock.lock_sha256,
    manifest_id: lock.manifest_id,
    evidence_manifest_sha256: lock.evidence_manifest_sha256,
    retained_at: lock.retained_at,
    retain_until: lock.retain_until,
    previous_lock_sha256: lock.previous_lock_sha256,
  };
  const entry = fixture.policy.retention_signers[0];
  const material = {
    algorithm: 'ed25519',
    domain: 'devseek/qualification-retention-lock-signature/v1',
    purpose: 'retention-lock',
    key_id: entry.key_id,
    signer_identity: entry.identity,
    aggregation_policy_sha256: fixture.policy.policy_sha256,
    payload,
  };
  lock.lock_attestation = {
    algorithm: 'ed25519',
    key_id: entry.key_id,
    signer_identity: entry.identity,
    purpose: 'retention-lock',
    aggregation_policy_sha256: fixture.policy.policy_sha256,
    signed_payload_sha256: sha256Object(material),
    signature_base64: crypto.sign(null, Buffer.from(canonicalJson(material), 'utf8'), fixture.signerSet.retention.signer.privateKey).toString('base64'),
  };
  lock.lock_sha256 = qualificationRetentionLockHash(lock);
  return lock;
}

function makeSealedRunEvidence() {
  const event = {
    protocol: 'devseek.run-evidence-event/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: 'run-g0c-auxiliary',
    sequence: 1,
    previous_event_sha256: null,
    type: 'run.opened',
    surface: 'vscode',
    idempotency_key: 'run-g0c-open',
    idempotency_fingerprint_sha256: digest('run-idempotency'),
    occurred_at: NOW,
    payload: {
      _devseek_run_evidence_authority: {
        protocol: 'devseek.product-run-evidence-authority/v1',
        owner_token_sha256: digest('run-owner-token'),
        participant_token_sha256: digest('run-participant-token'),
      },
    },
    event_sha256: null,
  };
  event.event_sha256 = sha256Object(Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'event_sha256')));
  const receipt = {
    protocol: 'devseek.run-evidence-receipt/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: event.run_id,
    sequence: 1,
    event_sha256: event.event_sha256,
    previous_event_sha256: null,
    idempotency_key: event.idempotency_key,
    committed_at: NOW,
    receipt_sha256: null,
  };
  receipt.receipt_sha256 = sha256Object(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receipt_sha256')));
  const eventRecordBase = {
    protocol: 'devseek.run-evidence-record/v1', record_kind: 'event', slot_sequence: 1,
    previous_record_sha256: null, event, receipt,
  };
  const eventRecordSha256 = sha256Object(eventRecordBase);
  const seal = {
    protocol: 'devseek.run-evidence-seal/v1',
    integrity_scope: 'product-run-diagnostics',
    qualification_eligible: false,
    run_id: event.run_id,
    slot_sequence: 2,
    event_count: 1,
    final_event_sha256: event.event_sha256,
    final_record_sha256: eventRecordSha256,
    idempotency_key: 'run-g0c-seal',
    idempotency_fingerprint_sha256: digest('seal-idempotency'),
    reason: 'fixture-complete',
    sealed_at: GENERATED,
    seal_sha256: null,
  };
  seal.seal_sha256 = sha256Object(Object.fromEntries(Object.entries(seal).filter(([key]) => key !== 'seal_sha256')));
  const sealRecordBase = {
    protocol: 'devseek.run-evidence-record/v1', record_kind: 'seal', slot_sequence: 2,
    previous_record_sha256: eventRecordSha256, seal,
  };
  const snapshot = {
    runId: event.run_id,
    integrityScope: 'product-run-diagnostics',
    qualificationEligible: false,
    records: [{
      slotSequence: 1, previousRecordSha256: null, event, receipt, recordSha256: eventRecordSha256,
    }],
    seal: {
      slotSequence: 2,
      previousRecordSha256: eventRecordSha256,
      seal,
      recordSha256: sha256Object(sealRecordBase),
    },
    head: {
      runId: event.run_id, sequence: 1, eventSha256: event.event_sha256,
      recordSha256: eventRecordSha256, sealed: true, sealSha256: seal.seal_sha256,
    },
  };
  return {
    snapshot,
    expected_anchor: {
      eventCount: 1,
      finalEventSha256: event.event_sha256,
      finalRecordSha256: eventRecordSha256,
      sealSha256: seal.seal_sha256,
    },
  };
}

test('independent aggregation freezes all slots/attempts, conserves denominator, and derives only an exact-tuple candidate', () => {
  const fixture = buildFixture();
  const result = verifyFixture(fixture);
  assert.equal(result.valid, true);
  assert.equal(result.qualification_eligible, false, 'local conformance cannot become a real qualification claim');
  assert.equal(result.qualification_claims.length, 0, 'an ineligible verifier result cannot expose qualification claims');
  assert.equal(fixture.manifest.qualification_claims.length, 0);
  assert.equal(fixture.manifest.claim_candidates.length, 1, 'fixture exercises exact-tuple candidate derivation without claiming qualification');
  assert.deepEqual(fixture.manifest.slot_accounting, {
    planned_coverage_slot_count: 1000,
    uniquely_consumed_slot_count: 1,
    passed_slot_count: 1,
    product_miss_slot_count: 0,
    infra_invalid_slot_count: 0,
    unclassified_slot_count: 0,
    unconsumed_or_blocked_slot_count: 999,
    duplicate_or_invalid_attempt_count: 0,
    denominator_policy: 'all-preregistered-and-classifiable',
    denominator_count: 1,
    numerator_count: 1,
    excluded_from_denominator: fixture.manifest.slot_accounting.excluded_from_denominator,
  });
  assert.equal(fixture.manifest.slot_accounting.excluded_from_denominator.length, 999);
  assert.equal(fixture.manifest.planned_slot_bindings.coverage.length, fixture.plan.coverage_slots.length);
});

test('a valid infra retry preserves the failed primary attempt instead of last-pass overwrite', () => {
  const fixture = buildFixture({ withRetry: true });
  assert.equal(verifyFixture(fixture).valid, true);
  assert.deepEqual(fixture.manifest.attempt_slot_bindings.map(binding => binding.attempt_role).sort(), [
    'adjudicated-infra-retry', 'primary',
  ]);
  assert.equal(fixture.manifest.slot_accounting.passed_slot_count, 1);
  const rewritten = structuredClone(fixture.manifest);
  rewritten.attempt_slot_bindings = rewritten.attempt_slot_bindings.filter(binding => binding.attempt_role !== 'primary');
  resignManifest(rewritten, fixture);
  assertCode(() => verifyFixture(fixture, { manifest: rewritten }), 'RETENTION_LOCK_BINDING_MISMATCH');
});

test('preflight/session semantic failures are explicit claim vetoes, including product connector failure, blocked+Ready, and missing preflight', () => {
  const connectorFailure = buildFixture({ sessionMode: 'connector-failure' });
  assert.equal(verifyFixture(connectorFailure).valid, true);
  assert.equal(connectorFailure.manifest.failures_and_vetoes.session_failures.length, 1);
  assert.equal(connectorFailure.manifest.failures_and_vetoes.session_failures[0].failure_class, 'connector');
  assert.equal(connectorFailure.manifest.failures_and_vetoes.preflight_vetoes[0].reason_code, 'preflight-connector-failure');
  assert.equal(connectorFailure.manifest.failures_and_vetoes.veto_count, 1);
  assert.equal(connectorFailure.manifest.qualification_claims.length, 0);

  const blockedReady = buildFixture({ sessionMode: 'blocked-ready' });
  assert.equal(verifyFixture(blockedReady).valid, true);
  assert.equal(blockedReady.manifest.planned_slot_bindings.preflight[0].status, 'invalid');
  assert.equal(blockedReady.manifest.failures_and_vetoes.preflight_vetoes[0].reason_code, 'preflight-blocked-ready-conflict');
  assert.equal(blockedReady.manifest.failures_and_vetoes.veto_count, 1);
  assert.equal(blockedReady.manifest.qualification_claims.length, 0);

  const missing = buildFixture({ sessionMode: 'missing' });
  assert.equal(verifyFixture(missing).valid, true);
  assert.equal(missing.manifest.planned_slot_bindings.preflight[0].status, 'unconsumed');
  assert.equal(missing.manifest.failures_and_vetoes.preflight_vetoes[0].reason_code, 'planned-preflight-unconsumed');
  assert.equal(missing.manifest.failures_and_vetoes.veto_count, 1);
  assert.equal(missing.manifest.qualification_claims.length, 0);
});

test('allowlisted signer cannot omit a signed failure or invent a cross-tuple claim', () => {
  const failure = buildFixture({ outcome: 'product-miss' });
  assert.equal(failure.manifest.qualification_claims.length, 0);
  const omitted = structuredClone(failure.manifest);
  omitted.failures_and_vetoes.failures = [];
  resignManifest(omitted, failure);
  const replacementLock = createQualificationRetentionLock({
    manifest: omitted,
    aggregationPolicy: failure.policy,
    retentionSigner: failure.signerSet.retention.signer,
    retainedAt: GENERATED,
    retainUntil: RETAIN_UNTIL,
  });
  assertCode(() => verifyFixture(failure, { manifest: omitted, lock: replacementLock }), 'MANIFEST_DERIVATION_MISMATCH');

  const pass = buildFixture();
  const crossTuple = structuredClone(pass.manifest);
  crossTuple.claim_candidates[0].surface = 'cli';
  resignManifest(crossTuple, pass);
  const crossTupleLock = createQualificationRetentionLock({
    manifest: crossTuple,
    aggregationPolicy: pass.policy,
    retentionSigner: pass.signerSet.retention.signer,
    retainedAt: GENERATED,
    retainUntil: RETAIN_UNTIL,
  });
  assertCode(() => verifyFixture(pass, { manifest: crossTuple, lock: crossTupleLock }), 'MANIFEST_DERIVATION_MISMATCH');
});

test('forged signature and signer-purpose/key-material reuse fail closed', () => {
  const fixture = buildFixture();
  const forged = structuredClone(fixture.manifest);
  const signature = Buffer.from(forged.manifest_attestation.signature_base64, 'base64');
  signature[0] ^= 1;
  forged.manifest_attestation.signature_base64 = signature.toString('base64');
  assertCode(() => verifyFixture(fixture, { manifest: forged }), 'AGGREGATOR_SIGNATURE_INVALID');

  const reused = structuredClone(fixture.policy);
  reused.retention_signers[0].public_key_spki_base64 = reused.manifest_signers[0].public_key_spki_base64;
  reused.retention_signers[0].public_key_spki_sha256 = reused.manifest_signers[0].public_key_spki_sha256;
  reused.retention_signers[0].key_sha256 = aggregatorSignerKeyHash(reused.retention_signers[0]);
  reused.policy_sha256 = aggregatorPolicyHash(reused);
  assertCode(() => validateAggregatorPolicy(reused), 'AGGREGATOR_KEY_MATERIAL_REUSED');
});

test('audited mode rejects fresh-root TOFU policy replacement', () => {
  const fixture = buildFixture();
  assertCode(() => verifyFixture(fixture, { governanceMode: 'audited-local' }), 'AUDITED_AGGREGATOR_POLICY_DIGEST_MISMATCH');
  const repositoryPolicy = JSON.parse(fs.readFileSync('docs/process/devseek-qualification-aggregator-policy.json', 'utf8'));
  assert.equal(validateAggregatorPolicy(repositoryPolicy, { audited: true, now: NOW }), true);
});

test('governance modes are closed and protected qualification fails without audited trust, active non-test keys, and external retention', () => {
  const fixture = buildFixture();
  assertCode(() => verifyFixture(fixture, { governanceMode: 'permissive' }), 'GOVERNANCE_MODE_UNSUPPORTED');

  const nonFixture = structuredClone(fixture.policy);
  nonFixture.source_status = 'verified';
  nonFixture.policy_sha256 = aggregatorPolicyHash(nonFixture);
  assertCode(() => verifyFixture(fixture, {
    policy: nonFixture,
    governanceMode: 'deterministic-test-only',
  }), 'DETERMINISTIC_GOVERNANCE_BOUNDARY_INVALID');

  const protectedPolicy = structuredClone(fixture.policy);
  protectedPolicy.integrity_scope = 'protected-qualification';
  protectedPolicy.qualification_eligible = true;
  protectedPolicy.source_status = 'verified';
  protectedPolicy.retention_policy.storage_class = 'retention-lock-or-worm';
  for (const entry of [...protectedPolicy.manifest_signers, ...protectedPolicy.retention_signers]) {
    entry.status = 'active';
    entry.key_sha256 = aggregatorSignerKeyHash(entry);
  }
  protectedPolicy.policy_sha256 = aggregatorPolicyHash(protectedPolicy);
  assertCode(() => validateAggregatorPolicy(protectedPolicy, { now: NOW }), 'PROTECTED_QUALIFICATION_TRUST_NOT_CONFIGURED');
});

test('manifest and retention scope/eligibility are independently bound, and local candidates never become claims or dependencies', () => {
  const fixture = buildFixture();
  assert.equal(fixture.manifest.integrity_scope, fixture.policy.integrity_scope);
  assert.equal(fixture.manifest.qualification_eligible, false);
  assert.equal(fixture.manifest.qualification_claims.length, 0);
  assert.equal(fixture.manifest.claim_candidates.length, 1);

  const forgedScope = structuredClone(fixture.manifest);
  forgedScope.integrity_scope = 'protected-qualification';
  resignManifest(forgedScope, fixture);
  assertCode(() => verifyFixture(fixture, { manifest: forgedScope }), 'MANIFEST_POLICY_BINDING_MISMATCH');

  const forgedEligibility = structuredClone(fixture.manifest);
  forgedEligibility.qualification_eligible = true;
  resignManifest(forgedEligibility, fixture);
  assertCode(() => verifyFixture(fixture, { manifest: forgedEligibility }), 'EVIDENCE_MANIFEST_SCHEMA_INVALID');

  const forgedLock = structuredClone(fixture.lock);
  forgedLock.integrity_scope = 'protected-qualification';
  forgedLock.storage_class = 'retention-lock-or-worm';
  forgedLock.qualification_eligible = true;
  resignRetentionLock(forgedLock, fixture);
  assertCode(() => verifyFixture(fixture, { lock: forgedLock }), 'RETENTION_LOCK_BINDING_MISMATCH');

  const outer = buildFixture();
  const dependency = buildFixture();
  const frozenEvidence = structuredClone(outer.frozenEvidence);
  frozenEvidence.dependency_manifests = [{
    manifest: dependency.manifest,
    retention_lock: dependency.lock,
    frozen_evidence: dependency.frozenEvidence,
    aggregation_policy: dependency.policy,
    current_state: dependency.currentState,
    governance_mode: 'deterministic-test-only',
  }];
  assertCode(() => verifyFixture(outer, { frozenEvidence }), 'DEPENDENCY_MANIFEST_NOT_QUALIFICATION_ELIGIBLE');
});

test('policy, manifest, and retention times are canonical and obey TTL, plan, sequencing, and minimum retention bounds', () => {
  const fixture = buildFixture();

  const invalidPolicyTime = structuredClone(fixture.policy);
  invalidPolicyTime.manifest_signers[0].valid_from = '2026-13-01T00:00:00.000Z';
  invalidPolicyTime.manifest_signers[0].key_sha256 = aggregatorSignerKeyHash(invalidPolicyTime.manifest_signers[0]);
  invalidPolicyTime.policy_sha256 = aggregatorPolicyHash(invalidPolicyTime);
  assertCode(() => validateAggregatorPolicy(invalidPolicyTime), 'AGGREGATOR_POLICY_SCHEMA_INVALID');

  const missingMaximumTtl = structuredClone(fixture.policy);
  delete missingMaximumTtl.maximum_manifest_ttl_seconds;
  missingMaximumTtl.policy_sha256 = aggregatorPolicyHash(missingMaximumTtl);
  assertCode(() => validateAggregatorPolicy(missingMaximumTtl), 'AGGREGATOR_POLICY_SCHEMA_INVALID');

  const shortTtlPolicy = structuredClone(fixture.policy);
  shortTtlPolicy.maximum_manifest_ttl_seconds = 60;
  shortTtlPolicy.policy_sha256 = aggregatorPolicyHash(shortTtlPolicy);
  assertCode(() => aggregateQualificationEvidence({
    manifestId: 'manifest-over-maximum-ttl',
    generatedAt: GENERATED,
    expiresAt: EXPIRES,
    frozenEvidence: fixture.frozenEvidence,
    aggregationPolicy: shortTtlPolicy,
    manifestSigner: fixture.signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  }), 'MANIFEST_MAXIMUM_TTL_EXCEEDED');

  assertCode(() => aggregateQualificationEvidence({
    manifestId: 'manifest-extended-after-plan',
    generatedAt: GENERATED,
    expiresAt: '2026-07-12T10:01:00.000Z',
    frozenEvidence: fixture.frozenEvidence,
    aggregationPolicy: fixture.policy,
    manifestSigner: fixture.signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  }), 'MANIFEST_EXPIRES_AFTER_PLAN');

  const invalidManifestTime = structuredClone(fixture.manifest);
  invalidManifestTime.generated_at = '2026-13-12T08:10:00.000Z';
  invalidManifestTime.validity.valid_from = invalidManifestTime.generated_at;
  resignManifest(invalidManifestTime, fixture);
  assertCode(() => verifyFixture(fixture, { manifest: invalidManifestTime }), 'EVIDENCE_MANIFEST_SCHEMA_INVALID');

  const shiftedValidFrom = structuredClone(fixture.manifest);
  shiftedValidFrom.validity.valid_from = '2026-07-12T08:11:00.000Z';
  resignManifest(shiftedValidFrom, fixture);
  assertCode(() => verifyFixture(fixture, { manifest: shiftedValidFrom }), 'MANIFEST_VALID_FROM_MUST_EQUAL_GENERATED_AT');

  assertCode(() => createQualificationRetentionLock({
    manifest: fixture.manifest,
    aggregationPolicy: fixture.policy,
    retentionSigner: fixture.signerSet.retention.signer,
    retainedAt: GENERATED,
    retainUntil: '2026-07-13T08:09:59.000Z',
  }), 'RETENTION_PERIOD_TOO_SHORT');

  const futureLock = createQualificationRetentionLock({
    manifest: fixture.manifest,
    aggregationPolicy: fixture.policy,
    retentionSigner: fixture.signerSet.retention.signer,
    retainedAt: '2026-07-12T08:30:00.000Z',
    retainUntil: '2026-07-13T08:30:00.000Z',
  });
  assertCode(() => verifyFixture(fixture, { lock: futureLock }), 'RETENTION_LOCK_FROM_FUTURE');

  const invalidLockTime = structuredClone(fixture.lock);
  invalidLockTime.retain_until = '2026-13-13T08:10:00.000Z';
  assertCode(() => verifyFixture(fixture, { lock: invalidLockTime }), 'RETENTION_LOCK_SCHEMA_INVALID');
});

test('candidate, dependency, provider, surface, platform, environment, and event-head changes invalidate the manifest', async t => {
  const fixture = buildFixture();
  const fields = [
    'candidate_identity_sha256', 'source_tree_sha256', 'installed_artifact_sha256', 'bridge_artifact_sha256',
    'dependency_snapshot_sha256', 'provider_connector_sha256', 'execution_environment_sha256',
  ];
  for (const field of fields) await t.test(field, () => {
    const currentState = structuredClone(fixture.currentState);
    currentState[field] = digest(`changed-${field}`);
    assertCode(() => verifyFixture(fixture, { currentState }), 'CURRENT_STATE_REQUIRED_OR_MISMATCH');
  });
  for (const [field, value] of [['provider', 'live-provider'], ['platform_profile', 'windows-x64-v1']]) await t.test(field, () => {
    const currentState = structuredClone(fixture.currentState);
    currentState[field] = value;
    assertCode(() => verifyFixture(fixture, { currentState }), 'CURRENT_STATE_REQUIRED_OR_MISMATCH');
  });
  await t.test('surface', () => {
    const currentState = structuredClone(fixture.currentState);
    currentState.surfaces = ['cli'];
    assertCode(() => verifyFixture(fixture, { currentState }), 'CURRENT_STATE_REQUIRED_OR_MISMATCH');
  });
  await t.test('event-head', () => {
    const currentState = structuredClone(fixture.currentState);
    currentState.event_stream_heads.attempts[0].event_sha256 = digest('advanced-head');
    assertCode(() => verifyFixture(fixture, { currentState }), 'CURRENT_STATE_REQUIRED_OR_MISMATCH');
  });
});

test('expired manifests, revoked signers, and retention loss invalidate every claim', () => {
  const fixture = buildFixture();
  assertCode(() => verifyFixture(fixture, { now: EXPIRES }), 'MANIFEST_EXPIRED');
  const revokedPolicy = structuredClone(fixture.policy);
  revokedPolicy.manifest_signers[0].status = 'revoked';
  revokedPolicy.manifest_signers[0].key_sha256 = aggregatorSignerKeyHash(revokedPolicy.manifest_signers[0]);
  revokedPolicy.policy_sha256 = aggregatorPolicyHash(revokedPolicy);
  assertCode(() => validateAggregatorPolicy(revokedPolicy, { now: GENERATED }), 'AGGREGATOR_SIGNER_REVOKED_OR_INACTIVE');
  assertCode(() => verifyFixture(fixture, { lock: null }), 'RETENTION_LOCK_SCHEMA_INVALID');
});

test('recursive dependency current validity uses top-level now, not the dependency historical generated_at', () => {
  const outer = buildFixture();
  const dependency = buildFixture();
  const dependencyManifest = aggregateQualificationEvidence({
    manifestId: 'manifest-g0c-dependency-short-lived',
    generatedAt: GENERATED,
    expiresAt: '2026-07-12T08:15:00.000Z',
    frozenEvidence: dependency.frozenEvidence,
    aggregationPolicy: dependency.policy,
    manifestSigner: dependency.signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  });
  const dependencyLock = createQualificationRetentionLock({
    manifest: dependencyManifest,
    aggregationPolicy: dependency.policy,
    retentionSigner: dependency.signerSet.retention.signer,
    retainedAt: GENERATED,
    retainUntil: RETAIN_UNTIL,
  });
  const frozenEvidence = structuredClone(outer.frozenEvidence);
  frozenEvidence.dependency_manifests = [{
    manifest: dependencyManifest,
    retention_lock: dependencyLock,
    frozen_evidence: dependency.frozenEvidence,
    aggregation_policy: dependency.policy,
    current_state: dependency.currentState,
    governance_mode: 'deterministic-test-only',
  }];
  assertCode(() => verifyFixture(outer, {
    frozenEvidence,
    now: '2026-07-12T08:20:00.000Z',
  }), 'MANIFEST_EXPIRED');
});

test('product Run Evidence is auxiliary-only and cannot enter without a sealed independent anchor', () => {
  const fixture = buildFixture();
  const withSealedAuxiliary = structuredClone(fixture.frozenEvidence);
  withSealedAuxiliary.run_evidence_auxiliary = [makeSealedRunEvidence()];
  const auxiliaryManifest = aggregateQualificationEvidence({
    manifestId: 'manifest-sealed-run-evidence',
    generatedAt: GENERATED,
    expiresAt: EXPIRES,
    frozenEvidence: withSealedAuxiliary,
    aggregationPolicy: fixture.policy,
    manifestSigner: fixture.signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  });
  assert.equal(auxiliaryManifest.run_evidence_auxiliary.length, 1);
  assert.equal(auxiliaryManifest.run_evidence_auxiliary[0].qualification_eligible, false);
  assert.equal(auxiliaryManifest.run_evidence_auxiliary[0].auxiliary_only, true);
  assert.equal(auxiliaryManifest.claim_candidates.length, fixture.manifest.claim_candidates.length);
  assert.equal(auxiliaryManifest.qualification_claims.length, 0);
  const frozenEvidence = structuredClone(fixture.frozenEvidence);
  frozenEvidence.run_evidence_auxiliary = [{
    snapshot: {
      runId: 'run-unsealed',
      integrityScope: 'product-run-diagnostics',
      qualificationEligible: false,
      records: [],
      seal: null,
      head: {
        runId: 'run-unsealed', sequence: 1, eventSha256: digest('event'),
        recordSha256: digest('record'), sealed: false,
      },
    },
    expected_anchor: {
      eventCount: 1, finalEventSha256: digest('event'), finalRecordSha256: digest('record'), sealSha256: digest('seal'),
    },
  }];
  assertCode(() => aggregateQualificationEvidence({
    manifestId: 'manifest-unsealed-run-evidence',
    generatedAt: GENERATED,
    expiresAt: EXPIRES,
    frozenEvidence,
    aggregationPolicy: fixture.policy,
    manifestSigner: fixture.signerSet.manifest.signer,
    governanceMode: 'deterministic-test-only',
  }), 'RUN_EVIDENCE_SNAPSHOT_SCHEMA_INVALID');
  assert.equal(fixture.manifest.run_evidence_auxiliary.length, 0);
  assert.equal(fixture.manifest.qualification_eligible, false);
});

test('immutable retention store detects re-sign/rebind, deletion, and replacement with an independent anchor', async t => {
  await t.test('manifest-id re-sign/rebind', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const first = store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    const replacement = aggregateQualificationEvidence({
      manifestId: fixture.manifest.manifest_id,
      generatedAt: '2026-07-12T08:11:00.000Z',
      expiresAt: EXPIRES,
      supersedesManifestSha256: fixture.manifest.evidence_manifest_sha256,
      frozenEvidence: fixture.frozenEvidence,
      aggregationPolicy: fixture.policy,
      manifestSigner: fixture.signerSet.manifest.signer,
      governanceMode: 'deterministic-test-only',
    });
    const replacementLock = createQualificationRetentionLock({
      manifest: replacement,
      aggregationPolicy: fixture.policy,
      retentionSigner: fixture.signerSet.retention.signer,
      retainedAt: '2026-07-12T08:11:00.000Z',
      retainUntil: '2026-07-13T08:11:00.000Z',
      previousLockSha256: first.final_lock_sha256,
    });
    assertCode(() => store.retain({
      manifest: replacement, retentionLock: replacementLock, aggregationPolicy: fixture.policy, expectedAnchor: first,
    }), 'MANIFEST_ID_REBIND_FORBIDDEN');
  });

  await t.test('delete', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const anchor = store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    fs.rmSync(path.join(rootDir, 'manifests', `${fixture.manifest.evidence_manifest_sha256}.json`));
    assertCode(() => store.audit({ aggregationPolicy: fixture.policy, expectedAnchor: anchor }), 'RETENTION_ARTIFACT_DELETED');
  });

  await t.test('replace', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const anchor = store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    const file = path.join(rootDir, 'manifests', `${fixture.manifest.evidence_manifest_sha256}.json`);
    const replaced = structuredClone(fixture.manifest);
    replaced.generated_at = '2026-07-12T08:11:00.000Z';
    fs.writeFileSync(file, `${JSON.stringify(replaced, null, 2)}\n`);
    assertCode(() => store.audit({ aggregationPolicy: fixture.policy, expectedAnchor: anchor }), 'RETAINED_MANIFEST_REPLACED');
  });

  await t.test('tail deletion cannot continue without an anchor or by replaying the genesis anchor', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    fs.rmSync(path.join(rootDir, 'records', '000000000001.json'));
    assertCode(() => store.audit({ aggregationPolicy: fixture.policy, expectedAnchor: null }), 'RETENTION_EXPECTED_ANCHOR_REQUIRED');
    assertCode(() => store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: null,
    }), 'RETENTION_EXPECTED_ANCHOR_REQUIRED');
    assertCode(() => store.audit({
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    }), 'RETENTION_GENESIS_ANCHOR_NOT_PRISTINE');
  });

  await t.test('post-construction directory and file symlink replacement fail nofollow/realpath checks', () => {
    const fixture = buildFixture();
    const directoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    const redirected = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-redirect-'));
    t.after(() => fs.rmSync(directoryRoot, { recursive: true, force: true }));
    t.after(() => fs.rmSync(redirected, { recursive: true, force: true }));
    const directoryStore = new ImmutableQualificationManifestStore({ rootDir: directoryRoot });
    fs.rmSync(path.join(directoryRoot, 'records'), { recursive: true });
    fs.symlinkSync(redirected, path.join(directoryRoot, 'records'), 'dir');
    assertCode(() => directoryStore.audit({
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    }), 'RETENTION_SYMLINK_PATH_FORBIDDEN');

    const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(fileRoot, { recursive: true, force: true }));
    const fileStore = new ImmutableQualificationManifestStore({ rootDir: fileRoot });
    const anchor = fileStore.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    const manifestPath = path.join(fileRoot, 'manifests', `${fixture.manifest.evidence_manifest_sha256}.json`);
    fs.rmSync(manifestPath);
    fs.symlinkSync(path.join(fileRoot, 'locks', `${fixture.lock.lock_sha256}.json`), manifestPath);
    assertCode(() => fileStore.audit({ aggregationPolicy: fixture.policy, expectedAnchor: anchor }), 'RETENTION_SYMLINK_PATH_FORBIDDEN');
  });

  await t.test('ordinary directory-tree reset and genesis replay fail pinned component identity', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    for (const component of ['manifests', 'locks', 'ids', 'records']) {
      fs.rmSync(path.join(rootDir, component), { recursive: true });
      fs.mkdirSync(path.join(rootDir, component), { mode: 0o700 });
    }
    assertCode(() => store.audit({
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    }), 'RETENTION_STORE_COMPONENT_SUBSTITUTED');
  });

  await t.test('operation-time ordinary component substitution is detected by the post-operation pin check', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const anchor = store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    const recordsDir = path.join(rootDir, 'records');
    const idsDir = path.join(rootDir, 'ids');
    const displacedIdsDir = path.join(rootDir, 'ids-displaced');
    const originalReaddirSync = fs.readdirSync;
    const recordsCapability = store.componentPins.find(pin => pin.component_name === 'records').capability_path;
    let substituted = false;
    fs.readdirSync = function interceptedReaddir(target, ...args) {
      const result = originalReaddirSync.call(fs, target, ...args);
      if (!substituted && (path.resolve(String(target)) === recordsDir || String(target) === recordsCapability)) {
        fs.renameSync(idsDir, displacedIdsDir);
        fs.mkdirSync(idsDir, { mode: 0o700 });
        substituted = true;
      }
      return result;
    };
    try {
      assertCode(() => store.audit({
        aggregationPolicy: fixture.policy,
        expectedAnchor: anchor,
      }), 'RETENTION_STORE_COMPONENT_SUBSTITUTED');
    } finally {
      fs.readdirSync = originalReaddirSync;
    }
    assert.equal(substituted, true);
  });

  await t.test('transient four-directory substitution cannot read an empty tree or replay genesis after namespace restoration', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const anchor = store.retain({
      manifest: fixture.manifest,
      retentionLock: fixture.lock,
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    });
    const originalReaddirSync = fs.readdirSync;
    const recordsCapability = store.componentPins.find(pin => pin.component_name === 'records').capability_path;
    const displaced = new Map(STORE_COMPONENTS.map(component => [component, path.join(rootDir, `${component}.pinned`)]));
    let substituted = false;
    let restored = false;
    let recordsReads = 0;
    const substitute = () => {
      for (const component of STORE_COMPONENTS) {
        fs.renameSync(path.join(rootDir, component), displaced.get(component));
        fs.mkdirSync(path.join(rootDir, component), { mode: 0o700 });
      }
      substituted = true;
    };
    const restore = () => {
      if (!substituted || restored) return;
      for (const component of STORE_COMPONENTS) {
        fs.rmSync(path.join(rootDir, component), { recursive: true, force: true });
        fs.renameSync(displaced.get(component), path.join(rootDir, component));
      }
      restored = true;
    };
    fs.readdirSync = function transientNamespaceAttack(target, ...args) {
      if (!substituted) substitute();
      const result = originalReaddirSync.call(fs, target, ...args);
      // A capability-relative reader sees the retained manifest immediately;
      // restore before its post-operation namespace check. A vulnerable
      // pathname reader sees only empty replacement directories and instead
      // reaches the second records read below before restoring.
      if (result.length > 0) restore();
      if ((path.resolve(String(target)) === path.join(rootDir, 'records')
        || String(target) === recordsCapability) && ++recordsReads === 2) restore();
      return result;
    };
    try {
      assertCode(() => store.audit({
        aggregationPolicy: fixture.policy,
        expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
      }), 'RETENTION_GENESIS_ANCHOR_NOT_PRISTINE');
    } finally {
      fs.readdirSync = originalReaddirSync;
      restore();
    }
    assert.equal(substituted, true);
    assert.equal(restored, true);
    assert.equal(store.audit({ aggregationPolicy: fixture.policy, expectedAnchor: anchor }).record_count, 1);
    store.close();
  });

  await t.test('close and dispose are idempotent, close all five pinned descriptors, and make operations fail closed', () => {
    const fixture = buildFixture();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    const descriptors = store.componentPins.map(pin => pin.descriptor);
    assert.equal(descriptors.length, 5);
    store.close();
    store.close();
    store.dispose();
    for (const descriptor of descriptors) {
      assert.throws(() => fs.fstatSync(descriptor), error => error?.code === 'EBADF');
    }
    assertCode(() => store.audit({
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    }), 'RETENTION_STORE_CLOSED');
    assertCode(() => store.retain({}), 'RETENTION_STORE_CLOSED');

    const disposed = new ImmutableQualificationManifestStore({
      rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-dispose-')),
    });
    const disposedRoot = disposed.rootDir;
    t.after(() => fs.rmSync(disposedRoot, { recursive: true, force: true }));
    disposed.dispose();
    disposed.dispose();
  });

  await t.test('store rejects group-or-other writable POSIX directories at construction and operation time', () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const fixture = buildFixture();
    const insecureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-insecure-'));
    t.after(() => fs.rmSync(insecureRoot, { recursive: true, force: true }));
    fs.chmodSync(insecureRoot, 0o777);
    assertCode(() => new ImmutableQualificationManifestStore({ rootDir: insecureRoot }),
      'RETENTION_STORE_PERMISSIONS_INSECURE');
    fs.chmodSync(insecureRoot, 0o700);

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-g0c-retention-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const store = new ImmutableQualificationManifestStore({ rootDir });
    fs.chmodSync(path.join(rootDir, 'records'), 0o733);
    assertCode(() => store.audit({
      aggregationPolicy: fixture.policy,
      expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
    }), 'RETENTION_STORE_PERMISSIONS_INSECURE');
    fs.chmodSync(path.join(rootDir, 'records'), 0o700);
    store.close();
  });
});
