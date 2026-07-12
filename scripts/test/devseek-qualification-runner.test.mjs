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
  aggregatorSignerKeyHash,
  hydrateAggregatorPolicy,
} from '../lib/devseek-qualification-evidence-manifest.mjs';
import {
  LOCAL_INTEGRITY_SCOPE,
  LocalQualificationProtocolStore,
  QUALIFICATION_PROTOCOL_INTEGRITY,
  createSignedEvent,
  createSignedPlan,
  hashText,
  hydrateKeyRegistry,
  qualificationProfileHash,
} from '../lib/devseek-qualification-protocol.mjs';
import {
  createIndependentG0CReader,
  createQualificationRunner,
} from '../lib/devseek-qualification-runner.mjs';
import { sha256Object } from '../lib/devseek-capability-ledger.mjs';
import {
  checkQualificationRunnerWiring,
  findForbiddenQualificationAuthorityImports,
} from '../devseek-qualification-runner-check.mjs';

const NOW = '2026-07-12T08:00:00.000Z';
const GENERATED = '2026-07-12T08:05:00.000Z';
const VERIFY_AT = '2026-07-12T08:10:00.000Z';
const MANIFEST_EXPIRES = '2026-07-12T09:00:00.000Z';
const RETAIN_UNTIL = '2026-07-13T08:05:00.000Z';
const PLAN_START = '2026-07-12T07:00:00.000Z';
const PLAN_END = '2026-07-12T10:00:00.000Z';
const WINDOW = ['2026-07-12T07:30:00.000Z', '2026-07-12T09:30:00.000Z'];
const SEED_REVEAL = 'runner-wiring-deterministic-seed-v1';

test('runner inventory separates catalog metadata from one executable local composition root', () => {
  const result = checkQualificationRunnerWiring();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.summary.declared_runner_entries, 1);
  assert.equal(result.summary.declared_runner_inventory_coverage, 1);
  assert.equal(result.summary.catalog_executor_inventory_coverage, 1);
  assert.equal(result.summary.unique_composition_roots, 1);
  assert.equal(result.summary.qualification_eligible, false);
  assert.equal(result.summary.forbidden_authority_imports, 0);
});

test('restricted entrypoint scan rejects a future unregistered authority import', () => {
  const violations = findForbiddenQualificationAuthorityImports([{
    source_ref: 'packages/cli/src/future-qualification-bypass.ts',
    source: "import { LocalQualificationProtocolStore } from '../../../scripts/lib/devseek-qualification-protocol.mjs';",
  }]);
  assert.deepEqual(violations, [
    'forbidden-qualification-authority-import:packages/cli/src/future-qualification-bypass.ts',
  ]);
});

test('composition root rejects a string-only spoof of the independent G0-C reader', t => {
  const fixture = makeFixture(t);
  assert.throws(() => createQualificationRunner({
    ...fixture.runnerOptions,
    evidenceReader: {
      authority: 'devseek-g0c-independent-reader/v1',
      readAndVerify: () => ({ verification: { qualification_eligible: false, qualification_claims: [] } }),
    },
  }), { code: 'G0C_READER_AUTHORITY_REQUIRED' });
  assert.equal(fixture.externalActions.length, 0);
});

test('the single runner root reaches guard dispatch and the independent G0-C reader without creating a claim', async t => {
  const fixture = makeFixture(t);
  const result = await fixture.runner.runLocalSimulation(fixture.request);

  assert.equal(fixture.externalActions.length, 1);
  assert.deepEqual(result.dispatchResult, { accepted: true, action_id: fixture.request.action.action_id });
  assert.equal(result.compositionRoot, 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner');
  assert.equal(result.entrypoint, 'createQualificationRunner');
  assert.equal(result.evidence.verification.valid, true);
  assert.equal(result.evidence.verification.qualification_eligible, false);
  assert.deepEqual(result.evidence.verification.qualification_claims, []);
  assert.deepEqual(result.evidence.manifest.qualification_claims, []);
  assert.equal(result.evidence.retentionAudit.record_count, 1);

  const attempt = result.evidence.frozenEvidence.event_streams
    .find(stream => stream.stream_kind === 'attempt');
  assert.deepEqual(attempt.events.map(event => event.event_type), [
    'AttemptRegistered',
    'AttemptStarted',
    'ExternalActionAuthorized',
    'ExternalActionStarted',
    'RunObserved',
    'OracleClassified',
    'AttemptTerminated',
  ]);
  assert.equal(attempt.receipts.length, attempt.events.length);
  assert.equal(
    attempt.events.find(event => event.event_type === 'ExternalActionStarted')
      .payload.authorization_receipt_sha256,
    result.actionReceipt.receipt_sha256,
  );
  assert.equal(Object.hasOwn(fixture.runner, 'dispatch'), false);
});

test('missing or invalid plan/session/slot/receipt prerequisites dispatch zero external actions', async t => {
  await assertZeroActionFailure(t, fixture => ({ ...fixture.request, registrationEvent: null }), /RUN_REGISTRATIONEVENT_REQUIRED/);
  await assertZeroActionFailure(t, fixture => {
    const plan = structuredClone(fixture.request.plan);
    plan.candidate_identity.source.source_tree_sha256 = digest('mutated-source');
    return { ...fixture.request, plan };
  }, { code: 'PLAN_INVALID' });
  await assertZeroActionFailure(t, fixture => ({
    ...fixture.request,
    session: { ...fixture.request.session, preflightSlotId: 'missing-preflight' },
  }), /RUN_SESSION_ATTEMPT_BINDING_INVALID/);
  await assertZeroActionFailure(t, fixture => ({
    ...fixture.request,
    attempt: { ...fixture.request.attempt, coverageSlotId: 'missing-coverage' },
  }), /RUN_COVERAGE_SLOT_NOT_DECLARED/);

  const fixture = makeFixture(t, { omitAuthorizationReceipt: true });
  await assert.rejects(
    fixture.runner.runLocalSimulation(fixture.request),
    /ACTION_RECEIPT_REQUIRED/,
  );
  assert.equal(fixture.externalActions.length, 0);
});

test('G0-C reader rejects an ExternalActionStarted store receipt outside the authorization window', async t => {
  const fixture = makeFixture(t, { lateStartedStoreReceipt: true });
  await assert.rejects(
    fixture.runner.runLocalSimulation(fixture.request),
    { code: 'G0C_ACTION_STARTED_RECEIPT_OUTSIDE_AUTHORIZATION_WINDOW' },
  );
  assert.equal(fixture.externalActions.length, 1);
});

async function assertZeroActionFailure(t, mutate, expected) {
  const fixture = makeFixture(t);
  await assert.rejects(
    fixture.runner.runLocalSimulation(mutate(fixture)),
    expected,
  );
  assert.equal(fixture.externalActions.length, 0);
}

function makeFixture(t, { omitAuthorizationReceipt = false, lateStartedStoreReceipt = false } = {}) {
  const protocolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-runner-protocol-'));
  const manifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-runner-manifest-'));
  t.after(() => fs.rmSync(protocolRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(manifestRoot, { recursive: true, force: true }));

  const identity = makeQualificationIdentity();
  const sources = makeProfileAndCatalog(identity);
  const plan = makePlan(identity, sources);
  const store = new LocalQualificationProtocolStore({
    rootDir: protocolRoot,
    registry: identity.registry,
    now: () => new Date(NOW),
    storeSigner: identity.signers['store-receipt'],
    guardSigner: identity.signers['action-guard'],
    approvedProfile: sources.profile,
    approvedCatalog: sources.catalog,
    governanceMode: 'deterministic-test-only',
  });
  const protocolStore = omitAuthorizationReceipt || lateStartedStoreReceipt
    ? bindStoreFaults(store, { omitAuthorizationReceipt, lateStartedStoreReceipt }) : store;
  const manifestStore = new ImmutableQualificationManifestStore({ rootDir: manifestRoot });
  t.after(() => manifestStore.close());
  const aggregator = makeAggregatorConfiguration();
  const reader = createIndependentG0CReader({
    protocolStore,
    aggregationPolicy: aggregator.policy,
    manifestSigner: aggregator.manifest.signer,
    retentionSigner: aggregator.retention.signer,
    manifestStore,
    expectedAnchor: GENESIS_RETENTION_EXPECTED_ANCHOR,
  });
  const externalActions = [];
  const runnerOptions = {
    protocolStore,
    registry: identity.registry,
    runnerSigner: identity.signers['runner-event'],
    oracleSigner: identity.signers['oracle-classification'],
    dispatch: action => {
      externalActions.push(structuredClone(action));
      return { accepted: true, action_id: action.action_id };
    },
    evidenceReader: reader,
    now: () => new Date(NOW),
  };
  const runner = createQualificationRunner(runnerOptions);
  const registrationEvent = makeEvent(identity, plan, {
    eventType: 'QualificationPlanRegistered',
    streamKind: 'plan',
    correlationId: plan.qualification_campaign_id,
    payload: { qualification_plan_sha256: plan.qualification_plan_sha256 },
    signer: identity.signers['qualification-plan'],
  });
  return {
    runner,
    runnerOptions,
    externalActions,
    request: {
      plan,
      profile: sources.profile,
      catalog: sources.catalog,
      seedReveal: SEED_REVEAL,
      registrationEvent,
      session: {
        correlationId: 'session-runner-wiring-primary',
        preflightSlotId: 'preflight-runner-wiring',
        readyUntil: PLAN_END,
      },
      attempt: {
        correlationId: 'attempt-runner-wiring-primary',
        coverageSlotId: 'coverage-runner-wiring-primary',
        observation: { run_evidence_auxiliary: false },
        oracle: { decision: 'pass' },
      },
      action: {
        action_id: 'action-runner-wiring-primary',
        action_ordinal: 1,
        action_type: 'controlled-replay-turn',
        destination: 'fixture://qualification-runner',
        nonce: 'nonce-runner-wiring-0001',
      },
      manifest: {
        manifestId: 'manifest-runner-wiring-primary',
        generatedAt: GENERATED,
        expiresAt: MANIFEST_EXPIRES,
        retainedAt: GENERATED,
        retainUntil: RETAIN_UNTIL,
        verifyAt: VERIFY_AT,
      },
    },
  };
}

function bindStoreFaults(store, { omitAuthorizationReceipt, lateStartedStoreReceipt }) {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'authorizeExternalAction' && omitAuthorizationReceipt) return () => undefined;
      if (property === 'readEventReceipt' && lateStartedStoreReceipt) {
        return eventSha256 => {
          const receipt = target.readEventReceipt(eventSha256);
          if (receipt.stream_kind === 'attempt' && receipt.object_version === 4) {
            return { ...receipt, trusted_recorded_at: '2026-07-12T08:00:30.000Z' };
          }
          return receipt;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
  const keyId = `runner-${kind}-${purpose}-${ordinal}`;
  const identity = `fixture/runner/${kind}/${purpose}/${ordinal}`;
  return {
    signer: { keyId, identity, privateKey },
    qualificationEntry: {
      key_id: keyId,
      identity,
      algorithm: 'ed25519',
      public_key_encoding: 'spki-der-base64',
      public_key_spki_base64: der.toString('base64'),
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
    'qualification-plan',
    'runner-event',
    'oracle-classification',
    'infra-adjudication',
    'store-receipt',
    'action-guard',
  ];
  const generated = Object.fromEntries(purposes.map((purpose, index) => [purpose, generatedSigner(purpose, index + 1)]));
  const registry = hydrateKeyRegistry({
    ...protocolHeader('devseek.qualification-key-registry/v1'),
    source_status: 'draft',
    registry_id: 'runner-wiring-key-registry',
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
  const catalog = readJson('docs/process/devseek-golden-case-catalog.json');
  const profile = structuredClone(readJson('docs/process/devseek-qualification-profiles.json').profiles[0]);
  profile.profile_id = 'G0-RUNNER-WIRING-LOCAL-CONFORMANCE';
  profile.profile_version = 1;
  profile.title = 'G0 runner wiring deterministic local conformance';
  profile.key_registry_binding = {
    registry_id: identity.registry.registry_id,
    registry_version: identity.registry.registry_version,
    registry_sha256: identity.registry.registry_sha256,
    purpose_keys: Object.fromEntries(Object.keys(profile.key_registry_binding.purpose_keys)
      .map(purpose => [purpose, [identity.signers[purpose].keyId]])),
  };
  profile.profile_sha256 = null;
  profile.profile_sha256 = qualificationProfileHash(profile);
  return { profile, catalog };
}

function makePlan(identity, sources) {
  const candidate = {
    ...protocolHeader('devseek.candidate-identity/v1'),
    candidate_id: 'candidate-runner-wiring-fixture',
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
      provider_product: 'controlled-replay',
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
      platform_profile: 'linux-x64-fixture',
      runner_image_sha256: digest('runner-image'),
      toolchain_lock_sha256: digest('toolchain-lock'),
    },
    dependency_snapshot_sha256: digest('dependency-snapshot'),
    candidate_identity_sha256: null,
  };
  const action = { action_type: 'controlled-replay-turn', destination: 'fixture://qualification-runner' };
  const coverageSlots = Array.from({ length: 1000 }, (_, index) => {
    const catalogCase = sources.catalog.cases[index % sources.catalog.cases.length];
    return {
      coverage_slot_id: index === 0 ? 'coverage-runner-wiring-primary' : `coverage-runner-wiring-${String(index).padStart(4, '0')}`,
      coverage_slot_sha256: null,
      order: index + 2,
      scheduled_window: WINDOW,
      capability_id: 'C0-PREREGISTRATION-PLAN',
      case_id: catalogCase.case_id,
      case_version: catalogCase.case_version,
      hidden_variant_id: catalogCase.fixture.hidden_variant_id,
      workspace_fixture_sha256: catalogCase.fixture.workspace_fixture_sha256,
      surface: 'local-node-test',
      stage: 'T0',
      attempt_windows: [{
        attempt_role: 'primary',
        eligible_preflight_slot_id: 'preflight-runner-wiring',
        scheduled_window: WINDOW,
        retry_of_attempt_role: null,
        allowed_actions: [action],
      }],
    };
  });
  return createSignedPlan({
    ...protocolHeader('devseek.qualification-plan/v1'),
    qualification_campaign_id: 'campaign-runner-wiring-fixture',
    qualification_plan_id: 'plan-runner-wiring-fixture',
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
      seed_commitment_sha256: hashText(SEED_REVEAL),
      seed_reveal_encrypted_ref: 'secrets://fixture/runner-wiring-seed',
      reveal_after_event: 'QualificationPlanRegistered',
      commitment_verification_required: true,
    },
    preflight_slots: [{
      preflight_slot_id: 'preflight-runner-wiring',
      preflight_slot_sha256: null,
      order: 1,
      scheduled_window: WINDOW,
      requested_ready_ttl: 'PT1H',
      retry_of_preflight_slot_id: null,
      allowed_actions: [action],
    }],
    coverage_slots: coverageSlots,
    budgets: {
      maximum_preflight_slots: 1,
      maximum_primary_attempts_per_coverage_slot: 1,
      maximum_adjudicated_infra_retry_attempts_per_coverage_slot: 0,
      maximum_total_attempts_per_coverage_slot: 1,
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

function makeAggregatorConfiguration() {
  const manifest = generatedSigner('qualification-manifest', 1, 'aggregator');
  const retention = generatedSigner('retention-lock', 2, 'aggregator');
  manifest.aggregatorEntry.key_sha256 = aggregatorSignerKeyHash(manifest.aggregatorEntry);
  retention.aggregatorEntry.key_sha256 = aggregatorSignerKeyHash(retention.aggregatorEntry);
  const policy = hydrateAggregatorPolicy({
    schema_version: AGGREGATOR_POLICY_SCHEMA_VERSION,
    integrity: { ...G0C_INTEGRITY },
    integrity_scope: G0C_LOCAL_INTEGRITY_SCOPE,
    qualification_eligible: false,
    policy_id: 'runner-wiring-local-aggregation-policy',
    policy_version: 1,
    source_status: 'test-fixture',
    maximum_manifest_ttl_seconds: 7200,
    manifest_signers: [manifest.aggregatorEntry],
    retention_signers: [retention.aggregatorEntry],
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
    claim_rules: [],
    policy_sha256: null,
  });
  return { manifest, retention, policy };
}

function makeEvent(identity, plan, { eventType, streamKind, correlationId, payload, signer }) {
  return createSignedEvent({
    ...protocolHeader('devseek.qualification-event/v1'),
    event_id: `event-${eventType.toLowerCase()}-runner-wiring`,
    event_type: eventType,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    candidate_identity_sha256: plan.candidate_identity_sha256,
    stream_kind: streamKind,
    correlation_id: correlationId,
    sequence: 1,
    previous_event_sha256: null,
    occurred_at: NOW,
    recorded_at: NOW,
    actor_id: signer.identity,
    payload,
    key_registry_sha256: identity.registry.registry_sha256,
    event_sha256: null,
    event_attestation: null,
  }, { signer, registry: identity.registry });
}

function digest(label) {
  return sha256Object({ fixture: `runner-wiring:${label}` });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(relativePath), 'utf8'));
}
