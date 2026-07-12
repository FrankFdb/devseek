import {
  ProductRunEvidenceSession,
  normalizeRunEvidenceJson,
  productRunEvidenceIdempotencyKey,
  requireRunEvidenceBoundedText,
} from '@devseek-netai/shared';

export type BridgeProviderEvidenceType = 'provider.requested' | 'provider.completed' | 'provider.failed';

export interface BridgeRunEvidence {
  readonly runId: string;
  readonly requestId: string;
  record(type: BridgeProviderEvidenceType, payload: Record<string, unknown>): void;
}

export interface AttachBridgeRunEvidenceOptions {
  workspaceRoot: string;
  runId: string;
  operationId: string;
  authorityToken: string;
}

/** Attach only: the bridge is a participant and may never invent an owner run. */
export function attachBridgeRunEvidence(options: AttachBridgeRunEvidenceOptions): BridgeRunEvidence {
  const requestId = requireOperationId(options.operationId);
  const session = ProductRunEvidenceSession.forWorkspace({
    workspaceRoot: options.workspaceRoot,
    runId: options.runId,
    surface: 'bridge',
    authority: { role: 'participant', token: options.authorityToken },
  });
  return {
    runId: session.runId,
    requestId,
    record(type, payload) {
      const normalizedPayload = normalizeRunEvidenceJson(payload);
      if (!normalizedPayload || typeof normalizedPayload !== 'object' || Array.isArray(normalizedPayload)) {
        throw new Error('Bridge evidence payload must be a strict JSON object');
      }
      session.record({
        type,
        idempotencyKey: productRunEvidenceIdempotencyKey(`bridge-${type}`, {
          runId: session.runId,
          requestId,
        }),
        payload: normalizeRunEvidenceJson({
          ...normalizedPayload,
          operation_id: requestId,
          boundary: 'bridge-server',
          status: type.slice('provider.'.length),
          trust: 'product-runtime-observation',
        }),
      });
    },
  };
}

function requireOperationId(value: string): string {
  return requireRunEvidenceBoundedText(value, 'Bridge run evidence operationId');
}
