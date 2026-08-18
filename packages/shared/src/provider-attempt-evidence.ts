import {
  requireProviderAttempt,
  requireProviderCorrelationId,
} from './provider-efficiency';
import type { RunEvidenceEvent, RunEvidenceJson } from './run-evidence-protocol';

export type ProviderAttemptEvidenceEvent = Pick<
  RunEvidenceEvent,
  'type' | 'surface' | 'payload' | 'sequence'
>;

export interface ProviderAttemptEvidenceIdentity {
  readonly samplingId: string;
  readonly operationId: string;
  readonly transportAttempt: number;
  readonly boundary: string;
  readonly sequence: number;
}

/**
 * Reads the cross-attempt identity added by provider lifecycle owners. Legacy
 * evidence remains valid, but cannot prove that a later request superseded it.
 */
export function providerAttemptEvidenceIdentity(
  event: ProviderAttemptEvidenceEvent,
): ProviderAttemptEvidenceIdentity | undefined {
  if (!event.type.startsWith('provider.')) return undefined;
  const payload = objectPayload(event.payload);
  if (!payload) return undefined;
  const declaredBoundary = payload.boundary ?? payload.layer ?? event.surface;
  if (typeof payload.sampling_id !== 'string'
    || typeof payload.operation_id !== 'string'
    || typeof declaredBoundary !== 'string'
    || typeof payload.transport_attempt !== 'number') {
    return undefined;
  }
  try {
    return Object.freeze({
      samplingId: requireProviderCorrelationId(payload.sampling_id, 'sampling-id'),
      operationId: requireProviderCorrelationId(payload.operation_id, 'operation-id'),
      transportAttempt: requireProviderAttempt(payload.transport_attempt),
      boundary: requireProviderCorrelationId(declaredBoundary, 'boundary'),
      sequence: event.sequence,
    });
  } catch {
    return undefined;
  }
}

export function providerAttemptEvidenceLifecycleKey(
  identity: Pick<ProviderAttemptEvidenceIdentity, 'operationId' | 'boundary'>,
): string {
  return `${identity.operationId}\u0000${identity.boundary}`;
}

/** A successful, later transport attempt may close only its own failed sampling lane. */
export function providerTransportSuccessSupersedesFailure(
  failure: ProviderAttemptEvidenceIdentity,
  completion: ProviderAttemptEvidenceIdentity,
): boolean {
  return completion.sequence > failure.sequence
    && completion.samplingId === failure.samplingId
    && completion.boundary === failure.boundary
    && completion.transportAttempt > failure.transportAttempt
    && completion.operationId !== failure.operationId;
}

export function collectTransportSupersededProviderFailureKeys(
  events: readonly ProviderAttemptEvidenceEvent[],
): ReadonlySet<string> {
  const completions = events
    .filter(event => event.type === 'provider.completed')
    .map(providerAttemptEvidenceIdentity)
    .filter((identity): identity is ProviderAttemptEvidenceIdentity => identity !== undefined);
  const superseded = new Set<string>();
  for (const event of events) {
    if (event.type !== 'provider.failed') continue;
    const failure = providerAttemptEvidenceIdentity(event);
    if (!failure) continue;
    if (completions.some(completion => providerTransportSuccessSupersedesFailure(failure, completion))) {
      superseded.add(providerAttemptEvidenceLifecycleKey(failure));
    }
  }
  return superseded;
}

export function collectTransportSupersededProviderFailureOperationIds(
  events: readonly ProviderAttemptEvidenceEvent[],
): ReadonlySet<string> {
  const supersededKeys = collectTransportSupersededProviderFailureKeys(events);
  const operationIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'provider.failed') continue;
    const identity = providerAttemptEvidenceIdentity(event);
    if (identity && supersededKeys.has(providerAttemptEvidenceLifecycleKey(identity))) {
      operationIds.add(identity.operationId);
    }
  }
  return operationIds;
}

function objectPayload(value: RunEvidenceJson): { [key: string]: RunEvidenceJson } | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}
