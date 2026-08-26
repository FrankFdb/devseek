import {
  assertRunEvidenceEventObservationContract,
  requireRunEvidenceBoundedText,
  type RunEvidenceEvent,
  type RunEvidenceEventType,
  type RunEvidenceJson,
  type RunEvidenceSettlementStatus,
  RunEvidenceLedgerError,
  RUN_EVIDENCE_LATE_PROVIDER_FAILURE_RECOVERY_RESOLUTION,
  RUN_EVIDENCE_LATE_PROVIDER_FAILURE_RECOVERY_TRIGGER,
  RUN_EVIDENCE_PROVIDER_FAILURE_RECOVERY_RESOLUTION,
  RUN_EVIDENCE_PROVIDER_FAILURE_RECOVERY_TRIGGER,
  RUN_EVIDENCE_PROVIDER_RESPONSE_RETRY_RESOLUTION,
  RUN_EVIDENCE_PROVIDER_RESPONSE_RETRY_TRIGGER,
  RUN_EVIDENCE_TERMINAL_DENIAL_RECOVERY_RESOLUTION,
  RUN_EVIDENCE_TERMINAL_DENIAL_RECOVERY_TRIGGER,
  RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_RESOLUTION,
  RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_TRIGGER,
} from './run-evidence-protocol';
import {
  providerAttemptEvidenceIdentity,
  providerTransportSuccessSupersedesFailure,
  type ProviderAttemptEvidenceIdentity,
} from './provider-attempt-evidence';

export type RunEvidenceSemanticEvent = Pick<
  RunEvidenceEvent,
  'type' | 'surface' | 'idempotency_key' | 'payload' | 'sequence'
>;

interface OperationState {
  label?: string;
  boundary?: string;
  requested: boolean;
  authorized: boolean;
  started: boolean;
  requestedSequence?: number;
  authorizedSequence?: number;
  startedSequence?: number;
  terminal?: RunEvidenceEventType;
  terminalSequence?: number;
  requestedRecoveryOperationId?: string;
  authorizedRecoveryOperationId?: string;
  startedRecoveryOperationId?: string;
  terminalRecoveryOperationId?: string;
  providerAttempt?: ProviderAttemptEvidenceIdentity;
}

interface AdverseTerminal {
  resolutionOperationId: string;
  label: string;
  type: RunEvidenceEventType;
  sequence: number;
  payload: { [key: string]: RunEvidenceJson };
  providerAttempt?: ProviderAttemptEvidenceIdentity;
  resolvedBy?: string;
}

interface RecoveryState {
  detected: boolean;
  detectedSequence?: number;
  detectedTargetOperationIds?: readonly string[];
  recoveryLane?: string;
  terminal?: 'recovery.completed' | 'recovery.failed';
}

export interface RunEvidencePrefixState {
  settled: boolean;
  settlementStatus?: RunEvidenceSettlementStatus;
  operationalEventCount: number;
}

/**
 * Pure semantic reducer for a verified durable prefix. Pending operations are
 * valid until settlement; impossible transitions fail at their first event.
 */
export function reduceRunEvidencePrefix(
  events: readonly RunEvidenceSemanticEvent[],
): RunEvidencePrefixState {
  if (events.length === 0 || events[0].type !== 'run.opened') {
    semanticFailure('A run prefix must begin with run.opened');
  }

  const providers = new Map<string, OperationState>();
  const sideEffects = new Map<string, OperationState>();
  const verifications = new Map<string, OperationState>();
  const qualityGates = new Map<string, OperationState>();
  const recoveries = new Map<string, RecoveryState>();
  const adverseTerminals: AdverseTerminal[] = [];
  const degradedReasons: string[] = [];
  let operationalEventCount = 0;
  let settlementStatus: RunEvidencePrefixState['settlementStatus'];

  for (const [index, event] of events.entries()) {
    assertRunEvidenceEventObservationContract(event.type, event.payload, event.sequence);
    if (index > 0 && event.type === 'run.opened') semanticFailure('run.opened may only appear at sequence 1');
    if (settlementStatus !== undefined) semanticFailure('No event may follow run.settled');
    if (event.type === 'run.opened') continue;

    if (event.type === 'run.settled') {
      settlementStatus = requireSettlementStatus(event);
      assertSettlementClosure({
        operationalEventCount,
        providers,
        sideEffects,
        verifications,
        qualityGates,
        recoveries,
        adverseTerminals,
        degradedReasons,
      }, settlementStatus);
      continue;
    }

    operationalEventCount += 1;
    if (event.type === 'evidence.degraded') {
      degradedReasons.push(readObjectPayload(event).reason as string);
      continue;
    }
    if (event.type.startsWith('provider.')) {
      reduceProvider(event, providers, adverseTerminals);
      continue;
    }
    if (event.type.startsWith('side_effect.')) {
      reduceSideEffect(event, sideEffects, adverseTerminals);
      continue;
    }
    if (event.type.startsWith('verification.')) {
      reduceStartedTerminal(event, verifications, adverseTerminals, 'Verification');
      continue;
    }
    if (event.type.startsWith('quality_gate.')) {
      reduceStartedTerminal(event, qualityGates, adverseTerminals, 'Quality gate');
      continue;
    }
    if (event.type.startsWith('recovery.')) {
      reduceRecovery(event, recoveries, adverseTerminals, providers, sideEffects, verifications, qualityGates);
    }
  }

  return {
    settled: settlementStatus !== undefined,
    settlementStatus,
    operationalEventCount,
  };
}

export function assertRunEvidencePrefixCandidate(
  prefix: readonly RunEvidenceSemanticEvent[],
  candidate: RunEvidenceSemanticEvent,
): RunEvidencePrefixState {
  return reduceRunEvidencePrefix([...prefix, candidate]);
}

export function assertRunEvidencePrefixSealable(
  events: readonly RunEvidenceSemanticEvent[],
): RunEvidencePrefixState {
  const state = reduceRunEvidencePrefix(events);
  if (!state.settled) semanticFailure('A run must commit run.settled before it can be sealed');
  return state;
}

function reduceProvider(
  event: RunEvidenceSemanticEvent,
  states: Map<string, OperationState>,
  adverse: AdverseTerminal[],
): void {
  const operationId = requireLifecycleOperationId(event);
  const boundary = lifecycleBoundary(event);
  const operationKey = `${operationId}\u0000${boundary}`;
  const label = `${operationId}@${boundary}`;
  const state = stateFor(states, operationKey, label);
  const providerAttempt = validatedProviderAttemptEvidence(event);
  if (event.type === 'provider.requested') {
    if (state.requested || state.terminal) semanticFailure(`Provider operation ${label} was requested twice`);
    state.requested = true;
    state.requestedSequence = event.sequence;
    state.providerAttempt = providerAttempt;
    return;
  }
  if (!state.requested) semanticFailure(`Provider operation ${label} terminated before request`);
  assertProviderAttemptLifecycleConsistency(label, state.providerAttempt, providerAttempt);
  setTerminal(state, event, label);
  if (event.type === 'provider.failed') {
    adverse.push({
      resolutionOperationId: operationId,
      label,
      type: event.type,
      sequence: event.sequence,
      payload: readObjectPayload(event),
      providerAttempt,
    });
    return;
  }
  if (event.type === 'provider.completed') {
    const completion = providerAttempt;
    if (!completion) return;
    for (const terminal of adverse) {
      if (terminal.type !== 'provider.failed' || terminal.resolvedBy || !terminal.providerAttempt) continue;
      if (providerTransportSuccessSupersedesFailure(terminal.providerAttempt, completion)) {
        terminal.resolvedBy = operationId;
      }
    }
  }
}

function validatedProviderAttemptEvidence(
  event: RunEvidenceSemanticEvent,
): ProviderAttemptEvidenceIdentity | undefined {
  const payload = readObjectPayload(event);
  const hasAttemptFields = payload.sampling_id !== undefined || payload.transport_attempt !== undefined;
  const identity = providerAttemptEvidenceIdentity(event);
  if (hasAttemptFields && !identity) {
    semanticFailure(`Provider operation at sequence ${event.sequence} has invalid attempt identity`);
  }
  return identity;
}

function assertProviderAttemptLifecycleConsistency(
  label: string,
  requested: ProviderAttemptEvidenceIdentity | undefined,
  terminal: ProviderAttemptEvidenceIdentity | undefined,
): void {
  if (!requested && !terminal) return;
  if (!requested || !terminal
    || requested.samplingId !== terminal.samplingId
    || requested.operationId !== terminal.operationId
    || requested.transportAttempt !== terminal.transportAttempt
    || requested.boundary !== terminal.boundary) {
    semanticFailure(`Provider operation ${label} changed attempt identity before terminal`);
  }
}

function reduceSideEffect(
  event: RunEvidenceSemanticEvent,
  states: Map<string, OperationState>,
  adverse: AdverseTerminal[],
): void {
  const operationId = requireLifecycleOperationId(event);
  const state = stateFor(states, operationId);
  switch (event.type) {
    case 'side_effect.requested':
      if (state.requested || state.terminal) semanticFailure(`Side effect ${operationId} was requested twice`);
      state.requested = true;
      state.requestedSequence = event.sequence;
      state.requestedRecoveryOperationId = optionalRecoveryOperationId(event);
      state.boundary = lifecycleBoundary(event);
      return;
    case 'side_effect.authorized':
      if (!state.requested || state.terminal || state.authorized) {
        semanticFailure(`Side effect ${operationId} has an invalid authorization transition`);
      }
      state.authorized = true;
      state.authorizedSequence = event.sequence;
      state.authorizedRecoveryOperationId = optionalRecoveryOperationId(event);
      return;
    case 'side_effect.started':
      if (!state.requested || !state.authorized || state.terminal || state.started) {
        semanticFailure(`Side effect ${operationId} has an invalid start transition`);
      }
      state.started = true;
      state.startedSequence = event.sequence;
      state.startedRecoveryOperationId = optionalRecoveryOperationId(event);
      return;
    case 'side_effect.committed':
    case 'side_effect.indeterminate':
      if (!state.requested || !state.authorized || !state.started) {
        semanticFailure(`Side effect ${operationId} cannot ${event.type.split('.')[1]} before authorization and start`);
      }
      setTerminal(state, event, operationId);
      state.terminalRecoveryOperationId = optionalRecoveryOperationId(event);
      if (event.type === 'side_effect.indeterminate') {
        adverse.push({
          resolutionOperationId: operationId,
          label: operationId,
          type: event.type,
          sequence: event.sequence,
          payload: readObjectPayload(event),
        });
      }
      return;
    case 'side_effect.failed':
      if (!state.requested) semanticFailure(`Side effect ${operationId} failed before request`);
      setTerminal(state, event, operationId);
      adverse.push({
        resolutionOperationId: operationId,
        label: operationId,
        type: event.type,
        sequence: event.sequence,
        payload: readObjectPayload(event),
      });
      return;
  }
}

function reduceStartedTerminal(
  event: RunEvidenceSemanticEvent,
  states: Map<string, OperationState>,
  adverse: AdverseTerminal[],
  label: string,
): void {
  const operationId = requireLifecycleOperationId(event);
  const state = stateFor(states, operationId);
  const isStart = event.type === 'verification.started' || event.type === 'quality_gate.started';
  if (isStart) {
    if (state.started || state.terminal) semanticFailure(`${label} ${operationId} was started twice`);
    state.started = true;
    state.startedSequence = event.sequence;
    return;
  }
  if (!state.started) semanticFailure(`${label} ${operationId} terminated before start`);
  setTerminal(state, event, operationId);
  if (
    event.type === 'verification.failed'
    || event.type === 'quality_gate.failed'
    || event.type === 'quality_gate.vetoed'
  ) {
    adverse.push({
      resolutionOperationId: operationId,
      label: operationId,
      type: event.type,
      sequence: event.sequence,
      payload: readObjectPayload(event),
    });
  }
}

function reduceRecovery(
  event: RunEvidenceSemanticEvent,
  recoveries: Map<string, RecoveryState>,
  adverse: AdverseTerminal[],
  providers: ReadonlyMap<string, OperationState>,
  sideEffects: ReadonlyMap<string, OperationState>,
  verifications: ReadonlyMap<string, OperationState>,
  qualityGates: ReadonlyMap<string, OperationState>,
): void {
  const operationId = requireLifecycleOperationId(event);
  let state = recoveries.get(operationId);
  if (!state) {
    state = { detected: false };
    recoveries.set(operationId, state);
  }
  const payload = readObjectPayload(event);
  if (event.type === 'recovery.detected') {
    if (payload.resolves_operation_ids !== undefined) {
      semanticFailure(`Detected recovery ${operationId} cannot resolve adverse operations`);
    }
    if (state.detected || state.terminal) semanticFailure(`Recovery ${operationId} was detected twice`);
    state.detected = true;
    state.detectedSequence = event.sequence;
    state.detectedTargetOperationIds = optionalTargetOperationIds(event);
    state.recoveryLane = typeof payload.recovery_lane === 'string' ? payload.recovery_lane : undefined;
    if (payload.recovery_trigger === RUN_EVIDENCE_PROVIDER_RESPONSE_RETRY_TRIGGER
      && !state.detectedTargetOperationIds) {
      semanticFailure(`Recovery ${operationId} requires non-empty target_operation_ids`);
    }
    return;
  }
  if (!state.detected) semanticFailure(`Recovery ${operationId} terminated before detection`);
  if (state.terminal) semanticFailure(`Recovery ${operationId} has conflicting terminals`);
  if (event.type !== 'recovery.completed' && event.type !== 'recovery.failed') {
    semanticFailure(`Recovery ${operationId} has an unknown transition ${event.type}`);
  }
  state.terminal = event.type;
  if (event.type === 'recovery.failed') {
    if (payload.resolves_operation_ids !== undefined) {
      semanticFailure(`Failed recovery ${operationId} cannot resolve adverse operations`);
    }
    return;
  }
  const resolvedOperationIds = requireResolvedOperationIds(event);
  const detectionSequence = state.detectedSequence;
  if (detectionSequence === undefined) semanticFailure(`Recovery ${operationId} has no detection sequence`);
  if (payload.recovery_trigger === RUN_EVIDENCE_PROVIDER_RESPONSE_RETRY_TRIGGER) {
    if (!hasAcceptedProviderResponseRetryProof({
      payload,
      resolvedOperationIds,
      adverse,
      providers,
      detectionSequence,
      detectedTargetOperationIds: state.detectedTargetOperationIds,
      recoveryTerminalSequence: event.sequence,
    })) {
      semanticFailure(`Recovery ${operationId} requires a correlated accepted provider response`);
    }
    resolveAdverseOperations(operationId, resolvedOperationIds, adverse, detectionSequence);
    return;
  }
  const verificationOperationId = requireRunEvidenceBoundedText(
    payload.verification_operation_id,
    `recovery.completed at sequence ${event.sequence} verification_operation_id`,
    'RUN_SEMANTIC_INVALID',
  );
  const verification = verifications.get(verificationOperationId);
  const qualityGate = qualityGates.get(verificationOperationId);
  if (verification?.terminal !== 'verification.completed' || verification.terminalSequence === undefined) {
    semanticFailure(`Recovery ${operationId} requires a matching completed verification`);
  }
  if (qualityGate?.terminal !== 'quality_gate.passed' || qualityGate.terminalSequence === undefined) {
    semanticFailure(`Recovery ${operationId} requires a matching passed quality gate`);
  }
  if (verification.startedSequence === undefined) {
    semanticFailure(`Recovery ${operationId} requires a matching started verification`);
  }
  const verificationStartedSequence = verification.startedSequence;
  const verificationTerminalSequence = verification.terminalSequence;
  const qualityGateStartedSequence = qualityGate.startedSequence;
  const qualityGateTerminalSequence = qualityGate.terminalSequence;
  if (qualityGateStartedSequence === undefined) {
    semanticFailure(`Recovery ${operationId} requires a matching started quality gate`);
  }
  const orderedRecoveryMutation = [...sideEffects.values()].find(sideEffect => (
    sideEffect.terminal === 'side_effect.committed'
    && sideEffect.requestedRecoveryOperationId === operationId
    && sideEffect.authorizedRecoveryOperationId === operationId
    && sideEffect.startedRecoveryOperationId === operationId
    && sideEffect.terminalRecoveryOperationId === operationId
    && sideEffect.requestedSequence !== undefined
    && sideEffect.authorizedSequence !== undefined
    && sideEffect.startedSequence !== undefined
    && sideEffect.terminalSequence !== undefined
    && detectionSequence < sideEffect.requestedSequence
    && sideEffect.requestedSequence < sideEffect.authorizedSequence
    && sideEffect.authorizedSequence < sideEffect.startedSequence
    && sideEffect.startedSequence < sideEffect.terminalSequence
    && (
      sideEffect.terminalSequence < verificationStartedSequence
      || (
        verificationStartedSequence < detectionSequence
        && sideEffect.terminalSequence < verificationTerminalSequence
      )
    )
  ));
  const orderedVerificationGate = verificationStartedSequence < verificationTerminalSequence
    && verificationTerminalSequence < qualityGateStartedSequence
    && qualityGateStartedSequence < qualityGateTerminalSequence
    && qualityGateTerminalSequence < event.sequence;
  const providerFailureSupersession = hasProviderFailureSupersessionProof({
    payload,
    resolvedOperationIds,
    adverse,
    sideEffects,
    detectionSequence,
    verificationStartedSequence,
    qualityGateTerminalSequence,
  });
  const terminalDenialSupersession = hasTerminalDenialSupersessionProof({
    payload,
    resolvedOperationIds,
    adverse,
    sideEffects,
    detectionSequence,
    verificationStartedSequence,
    verificationTerminalSequence,
    qualityGateStartedSequence,
    qualityGateTerminalSequence,
    recoveryTerminalSequence: event.sequence,
  });
  const terminalValidationFailureSupersession = hasTerminalValidationFailureSupersessionProof({
    payload,
    resolvedOperationIds,
    adverse,
    sideEffects,
    detectionSequence,
    detectedRecoveryLane: state.recoveryLane,
    verificationStartedSequence,
    verificationTerminalSequence,
    qualityGateStartedSequence,
    qualityGateTerminalSequence,
    recoveryTerminalSequence: event.sequence,
  });
  if (
    !orderedVerificationGate
    || (
      !orderedRecoveryMutation
      && !providerFailureSupersession
      && !terminalDenialSupersession
      && !terminalValidationFailureSupersession
    )
  ) {
    semanticFailure(
      `Recovery ${operationId} requires an ordered retry or verified workspace supersession before verification and quality gate completion`,
    );
  }
  resolveAdverseOperations(operationId, resolvedOperationIds, adverse, detectionSequence);
}

function resolveAdverseOperations(
  recoveryOperationId: string,
  resolvedOperationIds: readonly string[],
  adverse: AdverseTerminal[],
  detectionSequence: number,
): void {
  for (const resolvedOperationId of resolvedOperationIds) {
    const matching = adverse.filter(item => (
      item.resolutionOperationId === resolvedOperationId && item.resolvedBy === undefined
    ));
    if (matching.length === 0) {
      semanticFailure(
        `Recovery ${recoveryOperationId} cannot resolve pending, unknown, or already resolved operation ${resolvedOperationId}`,
      );
    }
    if (matching.some(terminal => terminal.sequence >= detectionSequence)) {
      semanticFailure(`Recovery ${recoveryOperationId} cannot resolve an adverse operation detected after recovery began`);
    }
    for (const terminal of matching) terminal.resolvedBy = recoveryOperationId;
  }
}

function hasAcceptedProviderResponseRetryProof(input: {
  payload: { [key: string]: RunEvidenceJson };
  resolvedOperationIds: readonly string[];
  adverse: readonly AdverseTerminal[];
  providers: ReadonlyMap<string, OperationState>;
  detectionSequence: number;
  detectedTargetOperationIds?: readonly string[];
  recoveryTerminalSequence: number;
}): boolean {
  if (input.payload.recovery_resolution !== RUN_EVIDENCE_PROVIDER_RESPONSE_RETRY_RESOLUTION) return false;
  const resultOperationId = typeof input.payload.provider_result_operation_id === 'string'
    ? input.payload.provider_result_operation_id.trim()
    : '';
  if (!resultOperationId || input.resolvedOperationIds.includes(resultOperationId)) return false;
  if (!input.detectedTargetOperationIds
    || !sameOperationIds(input.detectedTargetOperationIds, input.resolvedOperationIds)) return false;
  const accepted = input.providers.get(`${resultOperationId}\u0000vscode-provider-client`);
  if (accepted?.terminal !== 'provider.completed'
    || accepted.requestedSequence === undefined
    || accepted.terminalSequence === undefined
    || input.detectionSequence >= accepted.requestedSequence
    || accepted.requestedSequence >= accepted.terminalSequence
    || accepted.terminalSequence >= input.recoveryTerminalSequence) {
    return false;
  }
  return input.resolvedOperationIds.every(operationId => {
    const matching = input.adverse.filter(item => (
      item.resolutionOperationId === operationId && item.resolvedBy === undefined
    ));
    return matching.length > 0 && matching.every(item => (
      item.type === 'provider.failed' && item.sequence < input.detectionSequence
    ));
  });
}

function hasTerminalValidationFailureSupersessionProof(input: {
  payload: { [key: string]: RunEvidenceJson };
  resolvedOperationIds: readonly string[];
  adverse: readonly AdverseTerminal[];
  sideEffects: ReadonlyMap<string, OperationState>;
  detectionSequence: number;
  detectedRecoveryLane?: string;
  verificationStartedSequence: number;
  verificationTerminalSequence: number;
  qualityGateStartedSequence: number;
  qualityGateTerminalSequence: number;
  recoveryTerminalSequence: number;
}): boolean {
  if (input.payload.recovery_trigger
    !== RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_TRIGGER) return false;
  if (input.payload.recovery_resolution
    !== RUN_EVIDENCE_TERMINAL_VALIDATION_FAILURE_RECOVERY_RESOLUTION) return false;
  if (input.payload.recovery_lane !== 'validation') return false;
  if (input.detectedRecoveryLane !== 'validation') return false;
  const matching = input.resolvedOperationIds.flatMap(operationId => input.adverse.filter(item => (
    item.resolutionOperationId === operationId && item.resolvedBy === undefined
  )));
  if (matching.length !== input.resolvedOperationIds.length || matching.some(item => (
    item.type !== 'side_effect.failed'
      || item.payload.boundary !== 'vscode-terminal-coordinator'
      || typeof item.payload.exit_code !== 'number'
      || item.payload.exit_code === 0
  ))) {
    return false;
  }
  const latestFailureSequence = Math.max(...matching.map(item => item.sequence));
  const verifiedWorkspaceCommit = [...input.sideEffects.values()].some(sideEffect => (
    sideEffect.boundary !== 'vscode-terminal-coordinator'
      && sideEffect.terminal === 'side_effect.committed'
      && sideEffect.requestedSequence !== undefined
      && sideEffect.authorizedSequence !== undefined
      && sideEffect.startedSequence !== undefined
      && sideEffect.terminalSequence !== undefined
      && latestFailureSequence < sideEffect.requestedSequence
      && sideEffect.requestedSequence < sideEffect.authorizedSequence
      && sideEffect.authorizedSequence < sideEffect.startedSequence
      && sideEffect.startedSequence < sideEffect.terminalSequence
      && sideEffect.terminalSequence < input.verificationStartedSequence
  ));
  return verifiedWorkspaceCommit
    && latestFailureSequence < input.detectionSequence
    && input.verificationStartedSequence < input.verificationTerminalSequence
    && input.verificationTerminalSequence < input.qualityGateStartedSequence
    && input.qualityGateStartedSequence < input.qualityGateTerminalSequence
    && input.qualityGateTerminalSequence < input.recoveryTerminalSequence;
}

function hasTerminalDenialSupersessionProof(input: {
  payload: { [key: string]: RunEvidenceJson };
  resolvedOperationIds: readonly string[];
  adverse: readonly AdverseTerminal[];
  sideEffects: ReadonlyMap<string, OperationState>;
  detectionSequence: number;
  verificationStartedSequence: number;
  verificationTerminalSequence: number;
  qualityGateStartedSequence: number;
  qualityGateTerminalSequence: number;
  recoveryTerminalSequence: number;
}): boolean {
  if (input.payload.recovery_trigger !== RUN_EVIDENCE_TERMINAL_DENIAL_RECOVERY_TRIGGER) return false;
  if (input.payload.recovery_resolution !== RUN_EVIDENCE_TERMINAL_DENIAL_RECOVERY_RESOLUTION) return false;
  const matching = input.resolvedOperationIds.flatMap(operationId => input.adverse.filter(item => (
    item.resolutionOperationId === operationId && item.resolvedBy === undefined
  )));
  if (matching.length !== input.resolvedOperationIds.length || matching.some(item => (
    item.type !== 'side_effect.failed'
      || item.payload.boundary !== 'vscode-terminal-coordinator'
      || item.payload.execution_started !== false
      || (item.payload.failure_phase !== 'policy' && item.payload.failure_phase !== 'confirmation')
  ))) {
    return false;
  }
  const latestDenialSequence = Math.max(...matching.map(item => item.sequence));
  const verifiedWorkspaceCommit = [...input.sideEffects.values()].some(sideEffect => (
    sideEffect.boundary !== 'vscode-terminal-coordinator'
      && sideEffect.terminal === 'side_effect.committed'
      && sideEffect.requestedSequence !== undefined
      && sideEffect.authorizedSequence !== undefined
      && sideEffect.startedSequence !== undefined
      && sideEffect.terminalSequence !== undefined
      && latestDenialSequence < sideEffect.requestedSequence
      && sideEffect.requestedSequence < sideEffect.authorizedSequence
      && sideEffect.authorizedSequence < sideEffect.startedSequence
      && sideEffect.startedSequence < sideEffect.terminalSequence
      && sideEffect.terminalSequence < input.verificationStartedSequence
  ));
  return verifiedWorkspaceCommit
    && input.verificationStartedSequence < input.verificationTerminalSequence
    && input.verificationTerminalSequence < input.qualityGateStartedSequence
    && input.qualityGateStartedSequence < input.qualityGateTerminalSequence
    && input.qualityGateTerminalSequence < input.detectionSequence
    && input.detectionSequence < input.recoveryTerminalSequence;
}

function hasProviderFailureSupersessionProof(input: {
  payload: { [key: string]: RunEvidenceJson };
  resolvedOperationIds: readonly string[];
  adverse: readonly AdverseTerminal[];
  sideEffects: ReadonlyMap<string, OperationState>;
  detectionSequence: number;
  verificationStartedSequence: number;
  qualityGateTerminalSequence: number;
}): boolean {
  if (input.payload.recovery_trigger === RUN_EVIDENCE_PROVIDER_FAILURE_RECOVERY_TRIGGER
    && input.payload.recovery_resolution === RUN_EVIDENCE_PROVIDER_FAILURE_RECOVERY_RESOLUTION) {
    return hasProviderFailureBeforeVerifiedWorkspaceProof(input);
  }
  if (input.payload.recovery_trigger !== RUN_EVIDENCE_LATE_PROVIDER_FAILURE_RECOVERY_TRIGGER) return false;
  if (input.payload.recovery_resolution !== RUN_EVIDENCE_LATE_PROVIDER_FAILURE_RECOVERY_RESOLUTION) return false;
  const verifiedLocalCommit = [...input.sideEffects.values()].some(sideEffect => (
    sideEffect.terminal === 'side_effect.committed'
    && sideEffect.terminalSequence !== undefined
    && sideEffect.terminalSequence < input.verificationStartedSequence
  ));
  if (!verifiedLocalCommit) return false;
  for (const resolvedOperationId of input.resolvedOperationIds) {
    const matching = input.adverse.filter(item => (
      item.resolutionOperationId === resolvedOperationId && item.resolvedBy === undefined
    ));
    if (matching.length === 0) return false;
    if (matching.some(terminal => (
      terminal.type !== 'provider.failed'
      || terminal.sequence <= input.qualityGateTerminalSequence
      || terminal.sequence >= input.detectionSequence
    ))) {
      return false;
    }
  }
  return true;
}

function hasProviderFailureBeforeVerifiedWorkspaceProof(input: {
  resolvedOperationIds: readonly string[];
  adverse: readonly AdverseTerminal[];
  sideEffects: ReadonlyMap<string, OperationState>;
  detectionSequence: number;
  verificationStartedSequence: number;
  qualityGateTerminalSequence: number;
}): boolean {
  const verifiedLocalCommit = [...input.sideEffects.values()].some(sideEffect => (
    sideEffect.terminal === 'side_effect.committed'
      && sideEffect.requestedSequence !== undefined
      && sideEffect.authorizedSequence !== undefined
      && sideEffect.startedSequence !== undefined
      && sideEffect.terminalSequence !== undefined
      && sideEffect.requestedSequence < sideEffect.authorizedSequence
      && sideEffect.authorizedSequence < sideEffect.startedSequence
      && sideEffect.startedSequence < sideEffect.terminalSequence
      && sideEffect.terminalSequence < input.verificationStartedSequence
  ));
  if (!verifiedLocalCommit || input.qualityGateTerminalSequence >= input.detectionSequence) return false;
  for (const resolvedOperationId of input.resolvedOperationIds) {
    const matching = input.adverse.filter(item => (
      item.resolutionOperationId === resolvedOperationId && item.resolvedBy === undefined
    ));
    if (matching.length === 0 || matching.some(terminal => (
      terminal.type !== 'provider.failed'
        || terminal.sequence >= input.verificationStartedSequence
    ))) {
      return false;
    }
  }
  return true;
}

function assertSettlementClosure(
  state: {
    operationalEventCount: number;
    providers: ReadonlyMap<string, OperationState>;
    sideEffects: ReadonlyMap<string, OperationState>;
    verifications: ReadonlyMap<string, OperationState>;
    qualityGates: ReadonlyMap<string, OperationState>;
    recoveries: ReadonlyMap<string, RecoveryState>;
    adverseTerminals: readonly AdverseTerminal[];
    degradedReasons: readonly string[];
  },
  status: RunEvidenceSettlementStatus,
): void {
  if (state.operationalEventCount === 0) {
    semanticFailure('An opened run cannot settle without operational evidence');
  }
  assertNoPending(state.providers, 'Provider', value => value.requested && !value.terminal);
  assertNoPending(state.sideEffects, 'Side effect', value => (value.requested || value.started) && !value.terminal);
  assertNoPending(state.verifications, 'Verification', value => value.started && !value.terminal);
  assertNoPending(state.qualityGates, 'Quality gate', value => value.started && !value.terminal);
  const pendingRecoveries = [...state.recoveries.entries()]
    .filter(([, recovery]) => recovery.detected && !recovery.terminal)
    .map(([operationId]) => operationId);
  if (pendingRecoveries.length > 0) {
    semanticFailure(`Recovery operations are not terminal: ${pendingRecoveries.join(', ')}`);
  }
  const unresolved = state.adverseTerminals.filter(item => item.resolvedBy === undefined);
  if (status === 'completed' && unresolved.length > 0) {
    semanticFailure(
      `A completed run cannot contain unresolved adverse terminals: ${unresolved
        .map(item => `${item.type}:${item.label}`)
        .join(', ')}`,
    );
  }
  if (status === 'completed' && state.degradedReasons.length > 0) {
    semanticFailure(`A completed run cannot contain degraded evidence: ${state.degradedReasons.join(', ')}`);
  }
}

function requireSettlementStatus(event: RunEvidenceSemanticEvent): RunEvidenceSettlementStatus {
  const status = readObjectPayload(event).status;
  if (status !== 'completed' && status !== 'failed' && status !== 'blocked' && status !== 'cancelled') {
    semanticFailure('run.settled requires status=completed, failed, blocked, or cancelled');
  }
  return status;
}

function requireResolvedOperationIds(event: RunEvidenceSemanticEvent): string[] {
  return requireOperationIdList(event, readObjectPayload(event).resolves_operation_ids, 'resolves_operation_ids');
}

function optionalTargetOperationIds(event: RunEvidenceSemanticEvent): string[] | undefined {
  const value = readObjectPayload(event).target_operation_ids;
  if (value === undefined) return undefined;
  return requireOperationIdList(event, value, 'target_operation_ids');
}

function requireOperationIdList(
  event: RunEvidenceSemanticEvent,
  value: RunEvidenceJson | undefined,
  field: string,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    semanticFailure(`${event.type} at sequence ${event.sequence} requires non-empty ${field}`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const operationId = requireRunEvidenceBoundedText(
      item,
      `${event.type} at sequence ${event.sequence} ${field} operation id`,
      'RUN_SEMANTIC_INVALID',
    );
    if (operationId.includes('\u0000')) semanticFailure(`${event.type} has an invalid ${field} operation id`);
    if (seen.has(operationId)) {
      const operationRole = field === 'resolves_operation_ids' ? 'resolved' : 'target';
      semanticFailure(`${event.type} at sequence ${event.sequence} repeats ${operationRole} operation ${operationId}`);
    }
    seen.add(operationId);
    normalized.push(operationId);
  }
  return normalized;
}

function sameOperationIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(operationId => right.includes(operationId));
}

function readObjectPayload(event: RunEvidenceSemanticEvent): { [key: string]: RunEvidenceJson } {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    semanticFailure(`${event.type} at sequence ${event.sequence} requires an object payload`);
  }
  return event.payload as { [key: string]: RunEvidenceJson };
}

function requireLifecycleOperationId(event: RunEvidenceSemanticEvent): string {
  const operationId = requireRunEvidenceBoundedText(
    readObjectPayload(event).operation_id,
    `${event.type} at sequence ${event.sequence} operation_id`,
    'RUN_SEMANTIC_INVALID',
  );
  if (operationId.includes('\u0000')) semanticFailure(`${event.type} has an invalid operation_id`);
  return operationId;
}

function optionalRecoveryOperationId(event: RunEvidenceSemanticEvent): string | undefined {
  const value = readObjectPayload(event).recovery_operation_id;
  if (value === undefined) return undefined;
  const operationId = requireRunEvidenceBoundedText(
    value,
    `${event.type} at sequence ${event.sequence} recovery_operation_id`,
    'RUN_SEMANTIC_INVALID',
  );
  if (operationId.includes('\u0000')) semanticFailure(`${event.type} has an invalid recovery_operation_id`);
  return operationId;
}

function lifecycleBoundary(event: RunEvidenceSemanticEvent): string {
  const payload = readObjectPayload(event);
  const declared = payload.boundary ?? payload.layer;
  if (declared === undefined) return event.surface;
  const boundary = requireRunEvidenceBoundedText(
    declared,
    `${event.type} at sequence ${event.sequence} boundary`,
    'RUN_SEMANTIC_INVALID',
  );
  if (boundary.includes('\u0000')) semanticFailure(`${event.type} has an invalid boundary`);
  return boundary;
}

function stateFor(states: Map<string, OperationState>, key: string, label?: string): OperationState {
  let state = states.get(key);
  if (!state) {
    state = { label, requested: false, authorized: false, started: false };
    states.set(key, state);
  }
  return state;
}

function setTerminal(state: OperationState, event: RunEvidenceSemanticEvent, label: string): void {
  if (state.terminal) semanticFailure(`Operation ${label} has conflicting terminals ${state.terminal} and ${event.type}`);
  state.terminal = event.type;
  state.terminalSequence = event.sequence;
}

function assertNoPending(
  states: ReadonlyMap<string, OperationState>,
  label: string,
  pending: (state: OperationState) => boolean,
): void {
  const unresolved = [...states.entries()]
    .filter(([, state]) => pending(state))
    .map(([operationId, state]) => state.label ?? operationId);
  if (unresolved.length > 0) semanticFailure(`${label} operations are not terminal: ${unresolved.join(', ')}`);
}

function semanticFailure(message: string): never {
  throw new RunEvidenceLedgerError('RUN_SEMANTIC_INVALID', message);
}
