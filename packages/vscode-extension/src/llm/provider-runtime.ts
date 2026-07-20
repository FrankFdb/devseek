import type { ToolCall } from '../agent/tool-call-normalizer';
import type { LLMProviderCapability, LLMProviderHealth, LLMProviderType } from './types';
import {
  negotiateProviderCapabilities,
  type LLMProviderConfig,
  type ProviderCapabilityNegotiation,
  type ProviderCapabilityNegotiationReason,
  type ProviderConfigSnapshot,
} from './provider-config-service';

export interface ProviderWorkflowContext {
  workflowId?: string;
  checkpointId?: string;
  reviewLedgerId?: string;
  idempotencyLedgerId?: string;
  preferredProvider?: LLMProviderType;
  requiredCapabilities?: readonly string[];
}

export type ProviderRouteDecisionKind = 'allow' | 'blocked';

export interface ProviderRoutePlan {
  workflow: ProviderWorkflowContext;
  decision: ProviderRouteDecisionKind;
  primary?: LLMProviderConfig;
  fallbacks: LLMProviderConfig[];
  candidates: LLMProviderConfig[];
  capabilityNegotiation: ProviderCapabilityNegotiation;
  unsupportedCapabilities: string[];
  blockedReason?: ProviderCapabilityNegotiationReason;
}

export interface ProviderOperationFact {
  operationId?: string;
  description?: string;
  mutatesWorkspace?: boolean;
  toolCalls?: ToolCall[];
}

export interface ProviderFallbackPlan {
  workflow: ProviderWorkflowContext;
  failedProvider: LLMProviderType;
  nextProvider?: LLMProviderConfig;
  remainingProviders: LLMProviderConfig[];
  allowToolReplay: boolean;
  replayBlockedReason?: string;
}

export class LLMProviderRuntime {
  constructor(
    private readonly snapshot: ProviderConfigSnapshot,
    private readonly health: Partial<Record<LLMProviderType, LLMProviderHealth>> = {},
  ) {}

  selectProvider(context: ProviderWorkflowContext = {}): ProviderRoutePlan {
    const capabilityNegotiation = negotiateProviderCapabilities(context.requiredCapabilities);
    const requiredCapabilities = capabilityNegotiation.requiredCapabilities;
    if (capabilityNegotiation.decision === 'blocked') {
      return {
        workflow: { ...context, requiredCapabilities },
        decision: 'blocked',
        primary: undefined,
        fallbacks: [],
        candidates: [],
        capabilityNegotiation,
        unsupportedCapabilities: capabilityNegotiation.unsupportedCapabilities,
        blockedReason: capabilityNegotiation.reason,
      };
    }

    const preferred = context.preferredProvider ?? this.snapshot.activeProvider;
    const orderedTypes = uniqueProviderTypes([preferred, ...this.snapshot.fallbackOrder]);
    const candidates = orderedTypes
      .map(type => this.snapshot.providers[type])
      .filter((provider): provider is LLMProviderConfig => Boolean(provider))
      .filter(provider => provider.enabled && hasCapabilities(provider, requiredCapabilities))
      .filter(provider => this.health[provider.type]?.status !== 'unavailable');
    const primary = candidates[0] ?? this.snapshot.providers.bridge;
    return {
      workflow: { ...context, requiredCapabilities },
      decision: 'allow',
      primary,
      fallbacks: candidates.filter(provider => provider.type !== primary.type),
      candidates,
      capabilityNegotiation,
      unsupportedCapabilities: [],
    };
  }

  buildFallbackPlan(
    route: ProviderRoutePlan,
    failedProvider: LLMProviderType,
    operationFacts: ProviderOperationFact[] = [],
  ): ProviderFallbackPlan {
    const remainingProviders = route.fallbacks.filter(provider => provider.type !== failedProvider);
    const destructive = operationFacts.some(isDestructiveOperation);
    return {
      workflow: { ...route.workflow },
      failedProvider,
      nextProvider: remainingProviders[0],
      remainingProviders,
      allowToolReplay: !destructive,
      replayBlockedReason: destructive
        ? 'Provider fallback may regenerate tool calls, so destructive or workspace-mutating tools must not be replayed automatically.'
        : undefined,
    };
  }
}

export function providerSupports(
  provider: LLMProviderConfig,
  capability: LLMProviderCapability,
): boolean {
  return provider.capabilities.includes(capability);
}

function hasCapabilities(
  provider: LLMProviderConfig,
  requiredCapabilities: readonly LLMProviderCapability[],
): boolean {
  return requiredCapabilities.every(capability => providerSupports(provider, capability));
}

function isDestructiveOperation(fact: ProviderOperationFact): boolean {
  if (fact.mutatesWorkspace) return true;
  return (fact.toolCalls ?? []).some(call => {
    return call.definition?.mutatesWorkspace === true
      || call.risk === 'high'
      || call.kind === 'edit'
      || call.kind === 'terminal'
      || call.kind === 'vscode'
      || call.kind === 'mcp';
  });
}

function uniqueProviderTypes(values: LLMProviderType[]): LLMProviderType[] {
  const seen = new Set<LLMProviderType>();
  const out: LLMProviderType[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
