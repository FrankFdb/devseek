import type { LLMProviderCapability, LLMProviderType } from './llm-types';

export const CODING_PROVIDER_ADVERTISEMENT_VERSION = 'devseek.coding-provider-advertisement/v1' as const;
export const CODING_PROVIDER_CAPABILITY_DECISION_VERSION = 'devseek.coding-provider-capability-decision/v1' as const;

export const CODING_PROVIDER_CAPABILITIES: readonly LLMProviderCapability[] = Object.freeze([
  'text',
  'vision',
  'streaming',
  'text-tools',
  'native-tools',
  'web',
  'local',
  'vscode-lm',
  'cancellation',
  'request-correlation',
  'bounded-retry',
]);

export type CodingProviderRequestKind = 'chat' | 'code-change' | 'release';

export interface CodingProviderAdvertisement {
  readonly version: typeof CODING_PROVIDER_ADVERTISEMENT_VERSION;
  readonly provider: LLMProviderType;
  readonly capabilities: readonly LLMProviderCapability[];
  readonly evidenceRefs: readonly string[];
}

export interface CodingProviderCapabilityRequirement {
  readonly requestKind: CodingProviderRequestKind;
  readonly requiredCapabilities?: readonly string[];
  readonly cancellationRequired?: boolean;
  readonly correlationRequired?: boolean;
}

export interface CodingProviderCapabilityDecision {
  readonly version: typeof CODING_PROVIDER_CAPABILITY_DECISION_VERSION;
  readonly provider: LLMProviderType;
  readonly requestKind: CodingProviderRequestKind;
  readonly decision: 'allow' | 'blocked';
  readonly reason: 'satisfied' | 'unknown-capability' | 'missing-capability';
  readonly requiredAll: readonly LLMProviderCapability[];
  readonly requiredAny: readonly (readonly LLMProviderCapability[])[];
  readonly satisfiedCapabilities: readonly LLMProviderCapability[];
  readonly missingCapabilities: readonly string[];
  readonly advertisementVersion: typeof CODING_PROVIDER_ADVERTISEMENT_VERSION;
  readonly evidenceRefs: readonly string[];
}

export interface ProviderCapabilitySessionPort {
  readonly advertisement: CodingProviderAdvertisement;
  negotiate(requirement: CodingProviderCapabilityRequirement): CodingProviderCapabilityDecision;
  decisions(): readonly CodingProviderCapabilityDecision[];
}

export interface ProviderCapabilityPort {
  bind(advertisement: CodingProviderAdvertisement): ProviderCapabilitySessionPort;
}

const KNOWN_PROVIDER_CAPABILITY_PROFILES: Readonly<Record<LLMProviderType, readonly LLMProviderCapability[]>> = Object.freeze({
  bridge: Object.freeze<LLMProviderCapability[]>([
    'text',
    'vision',
    'streaming',
    'text-tools',
    'web',
    'cancellation',
    'request-correlation',
    'bounded-retry',
  ]),
  'deepseek-api': Object.freeze<LLMProviderCapability[]>(['text', 'streaming', 'native-tools', 'cancellation']),
  'openai-compat': Object.freeze<LLMProviderCapability[]>(['text', 'streaming', 'native-tools', 'cancellation']),
  'local-api': Object.freeze<LLMProviderCapability[]>(['text', 'streaming', 'native-tools', 'local', 'cancellation']),
  'vscode-lm': Object.freeze<LLMProviderCapability[]>(['text', 'streaming', 'vscode-lm', 'cancellation']),
});

export class CanonicalProviderCapabilityService implements ProviderCapabilityPort {
  bind(input: CodingProviderAdvertisement): ProviderCapabilitySessionPort {
    const advertisement = snapshotProviderAdvertisement(input);
    const recorded: CodingProviderCapabilityDecision[] = [];
    return Object.freeze({
      advertisement,
      negotiate(requirement: CodingProviderCapabilityRequirement) {
        const decision = decideProviderCapabilities(advertisement, requirement);
        recorded.push(decision);
        return decision;
      },
      decisions() {
        return Object.freeze([...recorded]);
      },
    });
  }
}

export function knownCodingProviderAdvertisement(provider: LLMProviderType): CodingProviderAdvertisement {
  const capabilities = KNOWN_PROVIDER_CAPABILITY_PROFILES[provider];
  return Object.freeze({
    version: CODING_PROVIDER_ADVERTISEMENT_VERSION,
    provider,
    capabilities: Object.freeze([...capabilities]),
    evidenceRefs: Object.freeze([
      `provider-profile:${provider}:${CODING_PROVIDER_ADVERTISEMENT_VERSION}`,
    ]),
  });
}

export function knownCodingProviderCapabilities(provider: LLMProviderType): readonly LLMProviderCapability[] {
  return knownCodingProviderAdvertisement(provider).capabilities;
}

export function normalizeCodingProviderCapability(value: unknown): LLMProviderCapability | null {
  const candidate = String(value ?? '').trim() as LLMProviderCapability;
  return (CODING_PROVIDER_CAPABILITIES as readonly string[]).includes(candidate) ? candidate : null;
}

function decideProviderCapabilities(
  advertisement: CodingProviderAdvertisement,
  requirement: CodingProviderCapabilityRequirement,
): CodingProviderCapabilityDecision {
  const explicit = normalizeRequirements(requirement.requiredCapabilities);
  const requiredAll = uniqueCapabilities([
    'text',
    ...explicit.supported,
    ...(requirement.cancellationRequired ? ['cancellation' as const] : []),
    ...(requirement.correlationRequired ? ['request-correlation' as const] : []),
  ]);
  const requiredAny = requirement.requestKind === 'chat'
    ? []
    : [Object.freeze(['native-tools', 'text-tools'] as const)];
  const advertised = new Set(advertisement.capabilities);
  const missingAll = requiredAll.filter(capability => !advertised.has(capability));
  const missingAny = requiredAny
    .filter(group => !group.some(capability => advertised.has(capability)))
    .map(group => group.join('|'));
  const missingCapabilities = Object.freeze([
    ...explicit.unsupported,
    ...missingAll,
    ...missingAny,
  ]);
  const reason = explicit.unsupported.length > 0
    ? 'unknown-capability' as const
    : missingCapabilities.length > 0
      ? 'missing-capability' as const
      : 'satisfied' as const;
  const satisfiedCapabilities = Object.freeze(advertisement.capabilities.filter(capability => {
    return requiredAll.includes(capability)
      || requiredAny.some(group => group.includes(capability as never));
  }));
  return Object.freeze({
    version: CODING_PROVIDER_CAPABILITY_DECISION_VERSION,
    provider: advertisement.provider,
    requestKind: requirement.requestKind,
    decision: reason === 'satisfied' ? 'allow' as const : 'blocked' as const,
    reason,
    requiredAll: Object.freeze(requiredAll),
    requiredAny: Object.freeze(requiredAny),
    satisfiedCapabilities,
    missingCapabilities,
    advertisementVersion: advertisement.version,
    evidenceRefs: Object.freeze([
      ...advertisement.evidenceRefs,
      `provider-capability:${advertisement.provider}:${requirement.requestKind}:${reason}`,
    ]),
  });
}

function snapshotProviderAdvertisement(input: CodingProviderAdvertisement): CodingProviderAdvertisement {
  if (input.version !== CODING_PROVIDER_ADVERTISEMENT_VERSION) {
    throw new Error('provider-advertisement-version-invalid');
  }
  const provider = String(input.provider ?? '').trim() as LLMProviderType;
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PROVIDER_CAPABILITY_PROFILES, provider)) {
    throw new Error('provider-advertisement-provider-invalid');
  }
  const normalized = normalizeRequirements(input.capabilities);
  if (normalized.unsupported.length > 0) {
    throw new Error(`provider-advertisement-capability-invalid:${normalized.unsupported.join(',')}`);
  }
  return Object.freeze({
    version: CODING_PROVIDER_ADVERTISEMENT_VERSION,
    provider,
    capabilities: Object.freeze(uniqueCapabilities(normalized.supported)),
    evidenceRefs: Object.freeze(uniqueTexts(input.evidenceRefs)),
  });
}

function normalizeRequirements(values: readonly unknown[] | undefined): {
  supported: LLMProviderCapability[];
  unsupported: string[];
} {
  const supported: LLMProviderCapability[] = [];
  const unsupported: string[] = [];
  for (const value of values ?? []) {
    const candidate = String(value ?? '').trim();
    if (!candidate) continue;
    const normalized = normalizeCodingProviderCapability(candidate);
    if (normalized) {
      if (!supported.includes(normalized)) supported.push(normalized);
    } else if (!unsupported.includes(candidate)) {
      unsupported.push(candidate);
    }
  }
  return { supported, unsupported };
}

function uniqueCapabilities(values: readonly LLMProviderCapability[]): LLMProviderCapability[] {
  return [...new Set(values)];
}

function uniqueTexts(values: readonly string[]): string[] {
  const normalized = values.map(value => String(value ?? '').trim()).filter(Boolean);
  return [...new Set(normalized)];
}
