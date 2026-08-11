import type { LLMProviderCapability } from './llm-types';

export const DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION = 'devseek.deepseek-web-connector/v1' as const;

export const DEEPSEEK_WEB_CONNECTOR_CAPABILITIES: readonly LLMProviderCapability[] = Object.freeze([
  'text',
  'vision',
  'streaming',
  'text-tools',
  'web',
  'cancellation',
  'request-correlation',
  'bounded-retry',
]);

export interface DeepSeekWebConnectorAdvertisement {
  readonly protocolVersion: typeof DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION;
  readonly provider: 'deepseek-web';
  readonly capabilities: readonly LLMProviderCapability[];
  readonly maxAttempts: number;
  readonly activeRequestCount: number;
}

export function requireDeepSeekWebConnectorAdvertisement(
  value: unknown,
): DeepSeekWebConnectorAdvertisement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('deepseek-web-connector:advertisement-invalid');
  }
  const record = value as Record<string, unknown>;
  if (record.protocolVersion !== DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION) {
    throw new Error('deepseek-web-connector:protocol-version-mismatch');
  }
  if (record.provider !== 'deepseek-web') {
    throw new Error('deepseek-web-connector:provider-mismatch');
  }
  if (!Array.isArray(record.capabilities)) {
    throw new Error('deepseek-web-connector:capabilities-invalid');
  }
  const capabilities = Object.freeze(record.capabilities.map(value => String(value).trim()) as LLMProviderCapability[]);
  const missing = DEEPSEEK_WEB_CONNECTOR_CAPABILITIES.filter(capability => !capabilities.includes(capability));
  const unknown = capabilities.filter(capability => !DEEPSEEK_WEB_CONNECTOR_CAPABILITIES.includes(capability));
  if (missing.length > 0 || unknown.length > 0 || new Set(capabilities).size !== capabilities.length) {
    throw new Error('deepseek-web-connector:capability-contract-mismatch');
  }
  const maxAttempts = requireNonNegativeInteger(record.maxAttempts, 'max-attempts');
  if (maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('deepseek-web-connector:max-attempts-invalid');
  }
  return Object.freeze({
    protocolVersion: DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION,
    provider: 'deepseek-web',
    capabilities,
    maxAttempts,
    activeRequestCount: requireNonNegativeInteger(record.activeRequestCount, 'active-request-count'),
  });
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`deepseek-web-connector:${name}-invalid`);
  }
  return value;
}
