import {
  assertRunEvidenceEventObservationContract,
  requireRunEvidenceBoundedText,
  type RunEvidenceEvent,
  type RunEvidenceEventType,
  type RunEvidenceJson,
  RunEvidenceLedgerError,
} from './run-evidence-protocol';

export type RunEvidenceSemanticEvent = Pick<
  RunEvidenceEvent,
  'type' | 'surface' | 'idempotency_key' | 'payload' | 'sequence'
>;

interface OperationState {
  label?: string;
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
}

interface AdverseTerminal {
  resolutionOperationId: string;
  label: string;
  type: RunEvidenceEventType;
  sequence: number;
  resolvedBy?: string;
}

interface RecoveryState {
  detected: boolean;
  detectedSequence?: number;
  terminal?: 'recovery.completed' | 'recovery.failed';
}

const VERIFIED_LOCAL_PROVIDER_FAILURE_TRIGGER = 'provider-failure-after-verified-local-result' as const;
const VERIFIED_LOCAL_PROVIDER_FAILURE_RESOLUTION = 'provider-failure-superseded-by-verified-local-result' as const;

export interface RunEvidencePrefixState {
  settled: boolean;
  settlementStatus?: 'completed' | 'failed' | 'cancelled';
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
      reduceRecovery(event, recoveries, adverseTerminals, sideEffects, verifications, qualityGates);
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
  if (event.type === 'provider.requested') {
    if (state.requested || state.terminal) semanticFailure(`Provider operation ${label} was requested twice`);
    state.requested = true;
    return;
  }
  if (!state.requested) semanticFailure(`Provider operation ${label} terminated before request`);
  setTerminal(state, event, label);
  if (event.type === 'provider.failed') {
    adverse.push({ resolutionOperationId: operationId, label, type: event.type, sequence: event.sequence });
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
        adverse.push({ resolutionOperationId: operationId, label: operationId, type: event.type, sequence: event.sequence });
      }
      return;
    case 'side_effect.failed':
      if (!state.requested) semanticFailure(`Side effect ${operationId} failed before request`);
      setTerminal(state, event, operationId);
      adverse.push({ resolutionOperationId: operationId, label: operationId, type: event.type, sequence: event.sequence });
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
    adverse.push({ resolutionOperationId: operationId, label: operationId, type: event.type, sequence: event.sequence });
  }
}

function reduceRecovery(
  event: RunEvidenceSemanticEvent,
  recoveries: Map<string, RecoveryState>,
  adverse: AdverseTerminal[],
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
  if (
    !orderedVerificationGate
    || (!orderedRecoveryMutation && !providerFailureSupersession)
  ) {
    semanticFailure(
      `Recovery ${operationId} requires detected < correlated requested < authorized < started < committed < verification < quality gate < completed`,
    );
  }
  for (const resolvedOperationId of resolvedOperationIds) {
    const matching = adverse.filter(item => (
      item.resolutionOperationId === resolvedOperationId && item.resolvedBy === undefined
    ));
    if (matching.length === 0) {
      semanticFailure(
        `Recovery ${operationId} cannot resolve pending, unknown, or already resolved operation ${resolvedOperationId}`,
      );
    }
    if (matching.some(terminal => terminal.sequence >= detectionSequence)) {
      semanticFailure(`Recovery ${operationId} cannot resolve an adverse operation detected after recovery began`);
    }
    for (const terminal of matching) terminal.resolvedBy = operationId;
  }
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
  if (input.payload.recovery_trigger !== VERIFIED_LOCAL_PROVIDER_FAILURE_TRIGGER) return false;
  if (input.payload.recovery_resolution !== VERIFIED_LOCAL_PROVIDER_FAILURE_RESOLUTION) return false;
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
  status: 'completed' | 'failed' | 'cancelled',
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

function requireSettlementStatus(event: RunEvidenceSemanticEvent): 'completed' | 'failed' | 'cancelled' {
  const status = readObjectPayload(event).status;
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
    semanticFailure('run.settled requires status=completed, failed, or cancelled');
  }
  return status;
}

function requireResolvedOperationIds(event: RunEvidenceSemanticEvent): string[] {
  const value = readObjectPayload(event).resolves_operation_ids;
  if (!Array.isArray(value) || value.length === 0) {
    semanticFailure(`${event.type} at sequence ${event.sequence} requires non-empty resolves_operation_ids`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const operationId = requireRunEvidenceBoundedText(
      item,
      `${event.type} at sequence ${event.sequence} resolved operation id`,
      'RUN_SEMANTIC_INVALID',
    );
    if (operationId.includes('\u0000')) semanticFailure(`${event.type} has an invalid resolved operation id`);
    if (seen.has(operationId)) {
      semanticFailure(`${event.type} at sequence ${event.sequence} repeats resolved operation ${operationId}`);
    }
    seen.add(operationId);
    normalized.push(operationId);
  }
  return normalized;
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
