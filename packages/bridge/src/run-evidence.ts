import {
  classifyDeepSeekStreamErrorMessage,
  ProductRunEvidenceSession,
  RUN_EVIDENCE_LEGACY_TRUST,
  RUN_EVIDENCE_RUNTIME_TRUST,
  normalizeRunEvidenceJson,
  productRunEvidenceIdempotencyKey,
  requireRunEvidenceBoundedText,
  redactDevSeekAuthorityCapabilities,
  sha256RunEvidence,
  summarizeTraceText,
  type RunEvidenceJson,
} from '@devseek-netai/shared';

export type BridgeProviderEvidenceType = 'provider.requested' | 'provider.completed' | 'provider.failed';

export const BRIDGE_CONNECTOR_REPLAY_PROTOCOL = 'devseek.bridge-connector-replay/v1' as const;
export const BRIDGE_CONNECTOR_REDACTED_SECRET = '[REDACTED-BRIDGE-CONNECTOR-SECRET]' as const;

const SENSITIVE_CONNECTOR_KEY_RE = /(?:token|cookie|authorization|password|secret|api[_-]?key|session|credential|header)/i;
const SECRET_CONNECTOR_VALUE_RE = /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]{6,}|(?:api[_-]?key|authorization|cookie|token|password|secret|session|credential)\s*[:=]\s*[^,\s;]+)/i;
const SUMMARY_TEXT_KEY_RE = /^(?:prompt|response|error|message|transcript|content|html|raw|body)$/i;

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
      const normalizedPayload = normalizeBridgeConnectorEvidencePayload(type, payload);
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
          trust: RUN_EVIDENCE_RUNTIME_TRUST,
        }),
      });
    },
  };
}

function requireOperationId(value: string): string {
  return requireRunEvidenceBoundedText(value, 'Bridge run evidence operationId');
}

function normalizeBridgeConnectorEvidencePayload(
  type: BridgeProviderEvidenceType,
  payload: Record<string, unknown>,
): Record<string, RunEvidenceJson> {
  const normalizedPayload = normalizeRunEvidenceJson(payload);
  if (!normalizedPayload || typeof normalizedPayload !== 'object' || Array.isArray(normalizedPayload)) {
    throw new Error('Bridge evidence payload must be a strict JSON object');
  }
  const sanitized = sanitizeBridgeConnectorObject(normalizedPayload);
  if (type === 'provider.failed' && typeof sanitized.category !== 'string') {
    sanitized.category = classifyBridgeConnectorErrorCategory(normalizedPayload);
  }
  return sanitized;
}

function sanitizeBridgeConnectorValue(value: RunEvidenceJson, key: string): RunEvidenceJson {
  if (key === 'live_provider' || key === 'liveProvider') return false;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (key === 'trust' && value === RUN_EVIDENCE_RUNTIME_TRUST) return RUN_EVIDENCE_LEGACY_TRUST;
    const redacted = redactBridgeConnectorText(value);
    if (SUMMARY_TEXT_KEY_RE.test(key)) return summarizeTraceText(redacted);
    return redacted;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeBridgeConnectorValue(item, key));
  if (isTraceTextSummary(value)) return value;
  return sanitizeBridgeConnectorObject(value);
}

function sanitizeBridgeConnectorObject(value: { [key: string]: RunEvidenceJson }): Record<string, RunEvidenceJson> {
  const output: Record<string, RunEvidenceJson> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = redactBridgeConnectorText(rawKey);
    if (key === 'replay') {
      output[key] = summarizeBridgeConnectorReplay(rawValue);
      continue;
    }
    if (SENSITIVE_CONNECTOR_KEY_RE.test(rawKey)) {
      output[key] = BRIDGE_CONNECTOR_REDACTED_SECRET;
      continue;
    }
    output[key] = sanitizeBridgeConnectorValue(rawValue, key);
  }
  return output;
}

function summarizeBridgeConnectorReplay(value: RunEvidenceJson): RunEvidenceJson {
  const sanitizedSource = sanitizeBridgeConnectorValue(value, 'replay_source');
  return {
    protocol: BRIDGE_CONNECTOR_REPLAY_PROTOCOL,
    trust: RUN_EVIDENCE_LEGACY_TRUST,
    live_provider: false,
    source_digest_scope: 'sanitized-connector-replay-payload',
    source_sha256: sha256RunEvidence(sanitizedSource),
  };
}

function classifyBridgeConnectorErrorCategory(payload: RunEvidenceJson): string {
  const message = collectBridgeConnectorFailureText(payload).join('\n');
  return classifyDeepSeekStreamErrorMessage(message);
}

function collectBridgeConnectorFailureText(value: RunEvidenceJson, key = ''): string[] {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return [];
  if (typeof value === 'string') {
    return /^(?:error|message|reason|category)$/i.test(key) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(item => collectBridgeConnectorFailureText(item, key));
  return Object.entries(value).flatMap(([entryKey, entryValue]) => collectBridgeConnectorFailureText(entryValue, entryKey));
}

function isTraceTextSummary(value: { [key: string]: RunEvidenceJson }): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === 'length'
    && keys[1] === 'sha256'
    && typeof value.length === 'number'
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function redactBridgeConnectorText(value: string): string {
  const withoutCapabilities = redactDevSeekAuthorityCapabilities(value);
  if (SECRET_CONNECTOR_VALUE_RE.test(withoutCapabilities)) return BRIDGE_CONNECTOR_REDACTED_SECRET;
  return withoutCapabilities;
}
