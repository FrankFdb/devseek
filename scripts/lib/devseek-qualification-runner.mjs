import {
  GuardedQualificationActionAdapter,
  LOCAL_INTEGRITY_SCOPE,
  QUALIFICATION_PROTOCOL_INTEGRITY,
  createSignedEvent,
  hashText,
} from './devseek-qualification-protocol.mjs';
import {
  aggregateQualificationEvidence,
  createQualificationRetentionLock,
  currentQualificationState,
  verifyQualificationEvidenceManifest,
} from './devseek-qualification-evidence-manifest.mjs';

const COMPOSITION_ROOT = 'scripts/lib/devseek-qualification-runner.mjs#createQualificationRunner';
const G0C_READER_BRAND = Symbol('devseek.g0c-independent-reader');

export class QualificationRunnerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'QualificationRunnerError';
    this.code = code;
  }
}

/**
 * Adapter for the existing G0-C authority. It re-reads durable G0-B streams and
 * receipts, then delegates every manifest, retention, and claim decision to
 * devseek-qualification-evidence-manifest.mjs. It deliberately contains no
 * fixture construction or qualification policy rules.
 */
export function createIndependentG0CReader({
  protocolStore,
  aggregationPolicy,
  manifestSigner,
  retentionSigner,
  manifestStore,
  expectedAnchor,
  governanceMode = 'deterministic-test-only',
}) {
  requireMethod(protocolStore, 'readStream', 'G0C_PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'readEventReceipt', 'G0C_PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'verifyActionReceipt', 'G0C_PROTOCOL_STORE_REQUIRED');
  requireMethod(manifestStore, 'retain', 'G0C_RETENTION_STORE_REQUIRED');
  if (!aggregationPolicy || !manifestSigner || !retentionSigner || !expectedAnchor) {
    throw new QualificationRunnerError('G0C_READER_CONFIGURATION_REQUIRED');
  }

  return Object.freeze({
    authority: 'devseek-g0c-independent-reader/v1',
    [G0C_READER_BRAND]: true,

    readAndVerify({
      plan,
      profile,
      catalog,
      registry,
      streamDescriptors,
      action,
      actionReceipt,
      manifest,
      runEvidenceAuxiliary = [],
      dependencyManifests = [],
    }) {
      if (!Array.isArray(streamDescriptors) || streamDescriptors.length === 0) {
        throw new QualificationRunnerError('G0C_STREAM_DESCRIPTORS_REQUIRED');
      }
      if (!actionReceipt) throw new QualificationRunnerError('G0C_ACTION_RECEIPT_REQUIRED');
      protocolStore.verifyActionReceipt(actionReceipt, {
        plan,
        action,
        now: new Date(actionReceipt.issued_at),
      });

      const eventStreams = streamDescriptors.map(({ streamKind, correlationId }) => {
        const stream = protocolStore.readStream(streamKind, correlationId, { plan });
        if (stream.events.length === 0) {
          throw new QualificationRunnerError('G0C_DECLARED_STREAM_EMPTY', `${streamKind}:${correlationId}`);
        }
        return {
          stream_kind: streamKind,
          correlation_id: correlationId,
          events: stream.events,
          receipts: stream.events.map(event => protocolStore.readEventReceipt(event.event_sha256)),
        };
      });
      assertUniqueStreams(eventStreams);
      assertGuardEvidence(eventStreams, action, actionReceipt);

      const frozenEvidence = {
        plan,
        profile,
        catalog,
        key_registry: registry,
        event_streams: eventStreams,
        run_evidence_auxiliary: runEvidenceAuxiliary,
        dependency_manifests: dependencyManifests,
      };
      const evidenceManifest = aggregateQualificationEvidence({
        manifestId: manifest.manifestId,
        generatedAt: manifest.generatedAt,
        expiresAt: manifest.expiresAt,
        supersedesManifestSha256: manifest.supersedesManifestSha256 ?? null,
        frozenEvidence,
        aggregationPolicy,
        manifestSigner,
        governanceMode,
      });
      const retentionLock = createQualificationRetentionLock({
        manifest: evidenceManifest,
        aggregationPolicy,
        retentionSigner,
        retainedAt: manifest.retainedAt,
        retainUntil: manifest.retainUntil,
        previousLockSha256: manifest.previousLockSha256 ?? null,
        lockId: manifest.lockId,
      });
      const retentionAudit = manifestStore.retain({
        manifest: evidenceManifest,
        retentionLock,
        aggregationPolicy,
        expectedAnchor,
      });
      const currentState = currentQualificationState(frozenEvidence);
      const verification = verifyQualificationEvidenceManifest({
        manifest: evidenceManifest,
        retentionLock,
        frozenEvidence,
        aggregationPolicy,
        currentState,
        now: manifest.verifyAt,
        governanceMode,
      });
      return {
        frozenEvidence,
        manifest: evidenceManifest,
        retentionLock,
        retentionAudit,
        currentState,
        verification,
      };
    },
  });
}

/**
 * The only qualification runner composition root. Raw dispatch is captured by
 * GuardedQualificationActionAdapter and is never returned to callers.
 */
export function createQualificationRunner({
  protocolStore,
  registry,
  runnerSigner,
  oracleSigner,
  dispatch,
  evidenceReader,
  now = () => new Date(),
}) {
  requireMethod(protocolStore, 'registerPlan', 'PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'reserveSlot', 'PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'compareAndAppend', 'PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'authorizeExternalAction', 'PROTOCOL_STORE_REQUIRED');
  requireMethod(protocolStore, 'completeSlot', 'PROTOCOL_STORE_REQUIRED');
  if (!registry || !runnerSigner || !oracleSigner || typeof dispatch !== 'function') {
    throw new QualificationRunnerError('RUNNER_CONFIGURATION_REQUIRED');
  }
  if (evidenceReader?.authority !== 'devseek-g0c-independent-reader/v1'
    || evidenceReader[G0C_READER_BRAND] !== true) {
    throw new QualificationRunnerError('G0C_READER_AUTHORITY_REQUIRED');
  }
  requireMethod(evidenceReader, 'readAndVerify', 'G0C_READER_AUTHORITY_REQUIRED');
  const guardedAction = new GuardedQualificationActionAdapter({ store: protocolStore, dispatch });

  async function runLocalSimulation(request) {
    const normalized = validateRunRequest(request);
    const {
      plan,
      profile,
      catalog,
      registrationEvent,
      seedReveal,
      session,
      attempt,
      action,
    } = normalized;

    protocolStore.registerPlan(plan, {
      seedReveal,
      registrationEvent,
      profile,
      catalog,
    });

    const preflightReservation = protocolStore.reserveSlot({
      plan,
      slotKind: 'preflight',
      slotId: session.preflightSlotId,
      attemptRole: 'original',
      ownerCorrelationId: session.correlationId,
    }).reservation;
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'session',
      correlationId: session.correlationId,
      eventType: 'QualificationSessionRegistered',
      payload: { preflight_slot_id: session.preflightSlotId },
    });
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'session',
      correlationId: session.correlationId,
      eventType: 'PreflightAttemptStarted',
      payload: { phase: 'preflight' },
    });
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'session',
      correlationId: session.correlationId,
      eventType: 'PreflightObserved',
      payload: { ready: true },
    });
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'session',
      correlationId: session.correlationId,
      eventType: 'PreflightClassified',
      payload: { decision: 'ready' },
    });
    const readyEvent = appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'session',
      correlationId: session.correlationId,
      eventType: 'QualificationSessionReady',
      payload: { ready_until: session.readyUntil ?? plan.expires_at },
    });
    protocolStore.completeSlot({ plan, reservation: preflightReservation, terminalEvent: readyEvent });

    const coverageSlot = plan.coverage_slots.find(slot => slot.coverage_slot_id === attempt.coverageSlotId);
    const preflightSlot = plan.preflight_slots.find(slot => slot.preflight_slot_id === session.preflightSlotId);
    const attemptReservation = protocolStore.reserveSlot({
      plan,
      slotKind: 'coverage',
      slotId: attempt.coverageSlotId,
      attemptRole: 'primary',
      ownerCorrelationId: attempt.correlationId,
    }).reservation;
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      eventType: 'AttemptRegistered',
      payload: {
        coverage_slot_id: coverageSlot.coverage_slot_id,
        coverage_slot_sha256: coverageSlot.coverage_slot_sha256,
        qualification_session_id: session.correlationId,
        preflight_slot_id: preflightSlot.preflight_slot_id,
        preflight_slot_sha256: preflightSlot.preflight_slot_sha256,
        attempt_role: 'primary',
      },
    });
    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      eventType: 'AttemptStarted',
      payload: { started: true },
    });

    const actionReceipt = protocolStore.authorizeExternalAction({
      plan,
      reservation: attemptReservation,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      action,
    });
    const dispatchResult = await guardedAction.execute({ plan, receipt: actionReceipt, action });

    appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      eventType: 'RunObserved',
      payload: attempt.observation ?? { run_evidence_auxiliary: false },
    });
    const oracleEvent = appendRunnerEvent({
      protocolStore,
      registry,
      signer: oracleSigner,
      now,
      plan,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      eventType: 'OracleClassified',
      payload: attempt.oracle ?? { decision: 'pass' },
    });
    const terminalEvent = appendRunnerEvent({
      protocolStore,
      registry,
      signer: runnerSigner,
      now,
      plan,
      streamKind: 'attempt',
      correlationId: attempt.correlationId,
      eventType: 'AttemptTerminated',
      payload: {
        oracle_event_sha256: oracleEvent.event_sha256,
        product_terminal_state: 'settled',
      },
    });
    protocolStore.completeSlot({ plan, reservation: attemptReservation, terminalEvent });

    const evidence = evidenceReader.readAndVerify({
      plan,
      profile,
      catalog,
      registry,
      streamDescriptors: [
        { streamKind: 'plan', correlationId: plan.qualification_campaign_id },
        { streamKind: 'session', correlationId: session.correlationId },
        { streamKind: 'attempt', correlationId: attempt.correlationId },
      ],
      action,
      actionReceipt,
      manifest: normalized.manifest,
      runEvidenceAuxiliary: normalized.runEvidenceAuxiliary,
      dependencyManifests: normalized.dependencyManifests,
    });
    if (evidence.verification.qualification_eligible !== false
      || evidence.verification.qualification_claims.length !== 0) {
      throw new QualificationRunnerError('LOCAL_RUNNER_QUALIFICATION_ESCALATION_FORBIDDEN');
    }
    return {
      compositionRoot: COMPOSITION_ROOT,
      entrypoint: 'createQualificationRunner',
      dispatchResult,
      actionReceipt,
      evidence,
    };
  }

  return Object.freeze({
    compositionRoot: COMPOSITION_ROOT,
    runLocalSimulation,
  });
}

function appendRunnerEvent({
  protocolStore,
  registry,
  signer,
  now,
  plan,
  streamKind,
  correlationId,
  eventType,
  payload,
}) {
  const stream = protocolStore.readStream(streamKind, correlationId, { plan });
  const prior = stream.events.at(-1);
  const timestamp = canonicalNow(now);
  const event = createSignedEvent({
    schema_version: 'devseek.qualification-event/v1',
    integrity: { ...QUALIFICATION_PROTOCOL_INTEGRITY },
    integrity_scope: LOCAL_INTEGRITY_SCOPE,
    qualification_eligible: false,
    event_id: `qre-${hashText(`${plan.qualification_plan_sha256}\0${streamKind}\0${correlationId}\0${eventType}\0${(prior?.sequence ?? 0) + 1}`)}`,
    event_type: eventType,
    qualification_plan_sha256: plan.qualification_plan_sha256,
    candidate_identity_sha256: plan.candidate_identity_sha256,
    stream_kind: streamKind,
    correlation_id: correlationId,
    sequence: (prior?.sequence ?? 0) + 1,
    previous_event_sha256: prior?.event_sha256 ?? null,
    occurred_at: timestamp,
    recorded_at: timestamp,
    actor_id: signer.identity,
    payload,
    key_registry_sha256: registry.registry_sha256,
    event_sha256: null,
    event_attestation: null,
  }, { signer, registry });
  protocolStore.compareAndAppend({
    plan,
    event,
    expectedSequence: event.sequence,
    expectedHeadSha256: event.previous_event_sha256,
  });
  return event;
}

function validateRunRequest(request) {
  if (!request || typeof request !== 'object') throw new QualificationRunnerError('RUN_REQUEST_REQUIRED');
  const requiredObjects = ['plan', 'profile', 'catalog', 'registrationEvent', 'session', 'attempt', 'action', 'manifest'];
  for (const key of requiredObjects) {
    if (!request[key] || typeof request[key] !== 'object') {
      throw new QualificationRunnerError(`RUN_${key.toUpperCase()}_REQUIRED`);
    }
  }
  if (typeof request.seedReveal !== 'string' || request.seedReveal.length === 0) {
    throw new QualificationRunnerError('RUN_SEED_REVEAL_REQUIRED');
  }
  const coverage = request.plan.coverage_slots?.find(slot => slot.coverage_slot_id === request.attempt.coverageSlotId);
  if (!coverage) throw new QualificationRunnerError('RUN_COVERAGE_SLOT_NOT_DECLARED');
  const attemptWindow = coverage.attempt_windows?.find(window => window.attempt_role === 'primary');
  if (!attemptWindow || attemptWindow.eligible_preflight_slot_id !== request.session.preflightSlotId) {
    throw new QualificationRunnerError('RUN_SESSION_ATTEMPT_BINDING_INVALID');
  }
  const preflight = request.plan.preflight_slots?.find(slot => slot.preflight_slot_id === request.session.preflightSlotId);
  if (!preflight || preflight.retry_of_preflight_slot_id !== null) {
    throw new QualificationRunnerError('RUN_PREFLIGHT_SLOT_NOT_ORIGINAL');
  }
  for (const [label, value] of [
    ['session', request.session.correlationId],
    ['attempt', request.attempt.correlationId],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new QualificationRunnerError(`RUN_${label.toUpperCase()}_CORRELATION_REQUIRED`);
    }
  }
  return {
    ...request,
    runEvidenceAuxiliary: request.runEvidenceAuxiliary ?? [],
    dependencyManifests: request.dependencyManifests ?? [],
  };
}

function assertUniqueStreams(streams) {
  const keys = streams.map(stream => `${stream.stream_kind}\0${stream.correlation_id}`);
  if (new Set(keys).size !== keys.length) throw new QualificationRunnerError('G0C_STREAM_DUPLICATE');
}

function assertGuardEvidence(streams, action, actionReceipt) {
  const attemptStreams = streams.filter(stream => stream.stream_kind === 'attempt');
  const attemptEvents = attemptStreams.flatMap(stream => stream.events);
  const authorized = attemptEvents.filter(event => event.event_type === 'ExternalActionAuthorized');
  const started = attemptEvents.filter(event => event.event_type === 'ExternalActionStarted');
  if (authorized.length !== 1 || started.length !== 1) {
    throw new QualificationRunnerError('G0C_GUARD_EVENT_CARDINALITY_INVALID');
  }
  const fields = ['action_id', 'action_ordinal', 'action_type', 'destination', 'nonce'];
  if (fields.some(field => authorized[0].payload?.[field] !== action[field]
    || started[0].payload?.[field] !== action[field])) {
    throw new QualificationRunnerError('G0C_GUARD_EVENT_ACTION_MISMATCH');
  }
  if (started[0].payload?.authorization_receipt_sha256 !== actionReceipt.receipt_sha256) {
    throw new QualificationRunnerError('G0C_GUARD_RECEIPT_NOT_BOUND');
  }
  const startedStream = attemptStreams.find(stream => stream.events.some(event => event.event_sha256 === started[0].event_sha256));
  const startedIndex = startedStream?.events.findIndex(event => event.event_sha256 === started[0].event_sha256) ?? -1;
  const storeReceiptTime = Date.parse(startedStream?.receipts[startedIndex]?.trusted_recorded_at);
  if (!Number.isFinite(storeReceiptTime)
    || storeReceiptTime < Date.parse(actionReceipt.issued_at)
    || storeReceiptTime >= Date.parse(actionReceipt.expires_at)) {
    throw new QualificationRunnerError('G0C_ACTION_STARTED_RECEIPT_OUTSIDE_AUTHORIZATION_WINDOW');
  }
}

function requireMethod(value, name, code) {
  if (!value || typeof value[name] !== 'function') throw new QualificationRunnerError(code);
}

function canonicalNow(now) {
  const value = now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new QualificationRunnerError('RUNNER_TIME_INVALID');
  return date.toISOString();
}
