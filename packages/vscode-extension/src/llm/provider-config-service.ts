import {
  CODING_PROVIDER_CAPABILITIES,
  knownCodingProviderCapabilities,
  normalizeCodingProviderCapability,
} from '@devseek-netai/shared';
import type { LLMProviderCapability, LLMProviderType } from './types';

export interface ProviderConfigReader {
  get<T>(key: string, defaultValue: T): T;
}

export interface LLMProviderConfig {
  type: LLMProviderType;
  displayName: string;
  enabled: boolean;
  model?: string;
  baseUrl?: string;
  secretRef?: string;
  secretConfigured?: boolean;
  capabilities: LLMProviderCapability[];
}

export interface ProviderConfigSnapshot {
  activeProvider: LLMProviderType;
  providers: Record<LLMProviderType, LLMProviderConfig>;
  fallbackOrder: LLMProviderType[];
}

export const DEFAULT_PROVIDER_TYPE: LLMProviderType = 'bridge';
export const PROVIDER_CONFIG_ADAPTER_PROTOCOL_VERSION = 'devseek.provider-config-adapter/v1';

export const SUPPORTED_PROVIDER_TYPES: readonly LLMProviderType[] = [
  'bridge',
  'deepseek-api',
  'openai-compat',
  'local-api',
  'vscode-lm',
];

export const SUPPORTED_PROVIDER_CAPABILITIES: readonly LLMProviderCapability[] = CODING_PROVIDER_CAPABILITIES;

export type ProviderCapabilityNegotiationDecisionKind = 'allow' | 'blocked';
export type ProviderCapabilityNegotiationReason = 'unknown-capability' | 'missing-capability';

export interface ProviderCapabilityNegotiation {
  version: typeof PROVIDER_CONFIG_ADAPTER_PROTOCOL_VERSION;
  decision: ProviderCapabilityNegotiationDecisionKind;
  requiredCapabilities: LLMProviderCapability[];
  unsupportedCapabilities: string[];
  reason?: ProviderCapabilityNegotiationReason;
}

const PROVIDER_CONFIG_KEYS = [
  'provider',
  'model',
  'apiKey',
  'openaiCompatBaseUrl',
  'openaiCompatApiKey',
  'openaiCompatModel',
  'localApiBaseUrl',
  'localApiApiKey',
  'localApiModel',
  'vscodeLmModel',
  'providerFallbackOrder',
] as const;

export class ProviderConfigService {
  constructor(private readonly reader: ProviderConfigReader) {}

  static configurationKeys(): string[] {
    return [...PROVIDER_CONFIG_KEYS];
  }

  getSnapshot(): ProviderConfigSnapshot {
    const providers = this.buildProviderConfigs();
    const activeProvider = normalizeProviderType(
      this.reader.get<string>('provider', DEFAULT_PROVIDER_TYPE),
      DEFAULT_PROVIDER_TYPE,
    ) ?? DEFAULT_PROVIDER_TYPE;
    return {
      activeProvider,
      providers,
      fallbackOrder: this.readFallbackOrder(activeProvider),
    };
  }

  getActiveProviderConfig(): LLMProviderConfig {
    const snapshot = this.getSnapshot();
    return snapshot.providers[snapshot.activeProvider] ?? snapshot.providers[DEFAULT_PROVIDER_TYPE];
  }

  private buildProviderConfigs(): Record<LLMProviderType, LLMProviderConfig> {
    return {
      bridge: {
        type: 'bridge',
        displayName: 'DeepSeek 网页',
        enabled: true,
        capabilities: [...knownCodingProviderCapabilities('bridge')],
      },
      'deepseek-api': {
        type: 'deepseek-api',
        displayName: 'DeepSeek API',
        enabled: true,
        model: cleanString(this.reader.get<string>('model', 'deepseek-chat')) || 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        secretRef: 'devseek.apiKey',
        secretConfigured: hasSecret(this.reader.get<string>('apiKey', '')),
        capabilities: [...knownCodingProviderCapabilities('deepseek-api')],
      },
      'openai-compat': {
        type: 'openai-compat',
        displayName: 'OpenAI 兼容',
        enabled: true,
        model: cleanString(this.reader.get<string>('openaiCompatModel', 'llama3')) || 'llama3',
        baseUrl: trimTrailingSlash(this.reader.get<string>('openaiCompatBaseUrl', 'http://localhost:11434/v1')),
        secretRef: 'devseek.openaiCompatApiKey',
        secretConfigured: hasSecret(this.reader.get<string>('openaiCompatApiKey', '')),
        capabilities: [...knownCodingProviderCapabilities('openai-compat')],
      },
      'local-api': {
        type: 'local-api',
        displayName: '本地 API',
        enabled: true,
        model: cleanString(this.reader.get<string>('localApiModel', 'llama3')) || 'llama3',
        baseUrl: trimTrailingSlash(this.reader.get<string>('localApiBaseUrl', 'http://localhost:11434/v1')),
        secretRef: 'devseek.localApiApiKey',
        secretConfigured: hasSecret(this.reader.get<string>('localApiApiKey', '')),
        capabilities: [...knownCodingProviderCapabilities('local-api')],
      },
      'vscode-lm': {
        type: 'vscode-lm',
        displayName: 'VS Code LM',
        enabled: true,
        model: cleanString(this.reader.get<string>('vscodeLmModel', '')),
        capabilities: [...knownCodingProviderCapabilities('vscode-lm')],
      },
    };
  }

  private readFallbackOrder(activeProvider: LLMProviderType): LLMProviderType[] {
    const configured = this.reader.get<unknown>('providerFallbackOrder', []);
    const ordered = Array.isArray(configured)
      ? configured.map(item => normalizeProviderType(String(item), null)).filter(Boolean) as LLMProviderType[]
      : [];
    return uniqueProviders([activeProvider, ...ordered, ...SUPPORTED_PROVIDER_TYPES]);
  }
}

export function sanitizeProviderConfigSnapshot(snapshot: ProviderConfigSnapshot): ProviderConfigSnapshot {
  const providers = {} as Record<LLMProviderType, LLMProviderConfig>;
  for (const type of SUPPORTED_PROVIDER_TYPES) {
    const provider = snapshot.providers[type];
    providers[type] = provider.secretRef
      ? { ...provider, secretConfigured: provider.secretConfigured === true }
      : { ...provider };
  }
  return {
    activeProvider: snapshot.activeProvider,
    providers,
    fallbackOrder: [...snapshot.fallbackOrder],
  };
}

export function negotiateProviderCapabilities(
  requiredCapabilities?: readonly string[],
): ProviderCapabilityNegotiation {
  const requested = requiredCapabilities?.length ? requiredCapabilities : ['text'];
  const supported: LLMProviderCapability[] = [];
  const unsupported: string[] = [];

  for (const value of requested) {
    const candidate = cleanString(String(value));
    if (!candidate) continue;
    const capability = normalizeProviderCapability(candidate);
    if (capability) {
      if (!supported.includes(capability)) supported.push(capability);
    } else if (!unsupported.includes(candidate)) {
      unsupported.push(candidate);
    }
  }

  if (supported.length === 0 && unsupported.length === 0) supported.push('text');

  return {
    version: PROVIDER_CONFIG_ADAPTER_PROTOCOL_VERSION,
    decision: unsupported.length ? 'blocked' : 'allow',
    requiredCapabilities: supported,
    unsupportedCapabilities: unsupported,
    ...(unsupported.length ? { reason: 'unknown-capability' as const } : {}),
  };
}

export function normalizeProviderType(value: string | undefined | null, fallback: LLMProviderType | null): LLMProviderType | null {
  const candidate = String(value ?? '').trim() as LLMProviderType;
  return (SUPPORTED_PROVIDER_TYPES as readonly string[]).includes(candidate) ? candidate : fallback;
}

export function normalizeProviderCapability(value: string | undefined | null): LLMProviderCapability | null {
  return normalizeCodingProviderCapability(value);
}

function uniqueProviders(values: LLMProviderType[]): LLMProviderType[] {
  const seen = new Set<LLMProviderType>();
  const out: LLMProviderType[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function hasSecret(value: string): boolean {
  return cleanString(value).length > 0;
}

function cleanString(value: string): string {
  return String(value ?? '').trim();
}

function trimTrailingSlash(value: string): string {
  return cleanString(value).replace(/\/+$/, '');
}
