import {
  requireDeepSeekWebConnectorAdvertisement,
  type DeepSeekWebConnectorAdvertisement,
} from './deepseek-web-connector-protocol';

export const BRIDGE_RUNTIME_PROTOCOL_VERSION = 'devseek.bridge-runtime/v1' as const;

export interface BridgeRuntimeAdvertisement {
  readonly protocolVersion: typeof BRIDGE_RUNTIME_PROTOCOL_VERSION;
  readonly runtimeInstanceId: string;
  readonly appVersion?: string;
  readonly buildChannel?: string;
  readonly buildId?: string;
  readonly gitCommit?: string;
  readonly connector: DeepSeekWebConnectorAdvertisement;
}

export function requireBridgeRuntimeAdvertisement(value: unknown): BridgeRuntimeAdvertisement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('bridge-runtime:advertisement-invalid');
  }
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== BRIDGE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error('bridge-runtime:protocol-version-mismatch');
  }
  const runtimeInstanceId = requireRuntimeInstanceId(record.runtimeInstanceId);
  return Object.freeze({
    protocolVersion: BRIDGE_RUNTIME_PROTOCOL_VERSION,
    runtimeInstanceId,
    ...optionalStringProperties(record),
    connector: requireDeepSeekWebConnectorAdvertisement(record.connector),
  });
}

function requireRuntimeInstanceId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('bridge-runtime:instance-id-invalid');
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new Error('bridge-runtime:instance-id-invalid');
  }
  return normalized;
}

function optionalStringProperties(record: Record<string, unknown>): Pick<
  BridgeRuntimeAdvertisement,
  'appVersion' | 'buildChannel' | 'buildId' | 'gitCommit'
> {
  return {
    ...optionalStringProperty(record, 'appVersion'),
    ...optionalStringProperty(record, 'buildChannel'),
    ...optionalStringProperty(record, 'buildId'),
    ...optionalStringProperty(record, 'gitCommit'),
  };
}

function optionalStringProperty<K extends 'appVersion' | 'buildChannel' | 'buildId' | 'gitCommit'>(
  record: Record<string, unknown>,
  key: K,
): Partial<Record<K, string>> {
  const value = record[key];
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') throw new Error(`bridge-runtime:${key}-invalid`);
  return { [key]: value } as Partial<Record<K, string>>;
}
