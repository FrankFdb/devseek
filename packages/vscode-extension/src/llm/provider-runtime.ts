import type { ToolCall } from '../agent/tool-call-normalizer';
import type { ChatMessage, ContentPart, LLMChatOptions, LLMProviderCapability, LLMProviderHealth, LLMProviderType } from './types';
import {
  negotiateProviderCapabilities,
  type LLMProviderConfig,
  type ProviderCapabilityNegotiation,
  type ProviderCapabilityNegotiationReason,
  type ProviderConfigSnapshot,
} from './provider-config-service';

export const PROVIDER_FALLBACK_CONTINUITY_PROTOCOL_VERSION = 'devseek.provider-fallback-continuity/v1';

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
  effectId?: string;
  effectState?: ProviderEffectState;
  description?: string;
  mutatesWorkspace?: boolean;
  toolCalls?: ToolCall[];
}

export type ProviderEffectState = 'planned' | 'committed' | 'failed' | 'rejected';
export type ProviderStreamContinuityState = 'not-started' | 'partial' | 'complete' | 'failed';
export type PartialOutputReplayPolicy = 'blocked' | 'not-applicable';

export interface ProviderStreamContinuityInput {
  state?: ProviderStreamContinuityState;
  providerRequestId?: string;
  receivedChunks?: number;
  receivedBytes?: number;
}

export interface ProviderFallbackContinuityOptions {
  request?: LLMChatOptions;
  stream?: ProviderStreamContinuityInput;
}

export interface ProviderFallbackRequestCopy {
  provider: LLMProviderType;
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  timeoutMs?: number;
  mode?: LLMChatOptions['mode'];
  files?: string[];
  newSession?: boolean;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  traceOperationId?: string;
}

export interface ProviderStreamContinuityReport {
  state: ProviderStreamContinuityState;
  providerRequestId?: string;
  receivedChunks: number;
  receivedBytes: number;
  partialOutputReplay: PartialOutputReplayPolicy;
}

export interface ProviderFallbackContinuity {
  workflow: ProviderWorkflowContext;
  providerSwitch: {
    from: LLMProviderType;
    to?: LLMProviderType;
  };
  requestFreshCopy: boolean;
  stream: ProviderStreamContinuityReport;
  operationIds: string[];
  toolCallIds: string[];
  committedEffectIds: string[];
  replayBlockedEffectIds: string[];
}

export interface ProviderFallbackPlan {
  version: typeof PROVIDER_FALLBACK_CONTINUITY_PROTOCOL_VERSION;
  workflow: ProviderWorkflowContext;
  failedProvider: LLMProviderType;
  nextProvider?: LLMProviderConfig;
  remainingProviders: LLMProviderConfig[];
  continuity: ProviderFallbackContinuity;
  nextRequest?: ProviderFallbackRequestCopy;
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
    options: ProviderFallbackContinuityOptions = {},
  ): ProviderFallbackPlan {
    const remainingProviders = route.fallbacks.filter(provider => provider.type !== failedProvider);
    const nextProvider = remainingProviders[0];
    const destructive = operationFacts.some(isDestructiveOperation);
    const replayBlockedEffectIds = collectReplayBlockedEffectIds(operationFacts);
    const nextRequest = nextProvider && options.request
      ? buildFallbackRequestCopy(options.request, nextProvider.type, route.workflow)
      : undefined;
    const continuity = buildFallbackContinuity({
      route,
      failedProvider,
      nextProviderType: nextProvider?.type,
      operationFacts,
      requestFreshCopy: Boolean(nextRequest),
      stream: options.stream,
      replayBlockedEffectIds,
    });
    const replayBlocked = destructive || replayBlockedEffectIds.length > 0;
    return {
      version: PROVIDER_FALLBACK_CONTINUITY_PROTOCOL_VERSION,
      workflow: { ...route.workflow },
      failedProvider,
      nextProvider,
      remainingProviders,
      continuity,
      ...(nextRequest ? { nextRequest } : {}),
      allowToolReplay: !replayBlocked,
      replayBlockedReason: replayBlocked
        ? buildReplayBlockedReason(destructive, replayBlockedEffectIds)
        : undefined,
    };
  }
}

export function buildFallbackRequestCopy(
  request: LLMChatOptions,
  provider: LLMProviderType,
  workflow: ProviderWorkflowContext = {},
): ProviderFallbackRequestCopy {
  const copy: ProviderFallbackRequestCopy = {
    provider,
    messages: cloneChatMessages(request.messages),
  };
  if (request.model !== undefined) copy.model = request.model;
  if (request.stream !== undefined) copy.stream = request.stream;
  if (request.timeoutMs !== undefined) copy.timeoutMs = request.timeoutMs;
  if (request.mode !== undefined) copy.mode = request.mode;
  if (request.files !== undefined) copy.files = [...request.files];
  if (request.newSession !== undefined) copy.newSession = request.newSession;
  copy.traceRunId = request.traceRunId ?? workflow.workflowId;
  if (request.traceWorkspaceRoot !== undefined) copy.traceWorkspaceRoot = request.traceWorkspaceRoot;
  if (request.traceOperationId !== undefined) copy.traceOperationId = request.traceOperationId;
  // bridge-only capability is regenerated by Bridge adapter, not copied during fallback.
  return copy;
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

function buildFallbackContinuity(input: {
  route: ProviderRoutePlan;
  failedProvider: LLMProviderType;
  nextProviderType?: LLMProviderType;
  operationFacts: ProviderOperationFact[];
  requestFreshCopy: boolean;
  stream?: ProviderStreamContinuityInput;
  replayBlockedEffectIds: string[];
}): ProviderFallbackContinuity {
  return {
    workflow: { ...input.route.workflow },
    providerSwitch: {
      from: input.failedProvider,
      ...(input.nextProviderType ? { to: input.nextProviderType } : {}),
    },
    requestFreshCopy: input.requestFreshCopy,
    stream: normalizeStreamContinuity(input.stream),
    operationIds: uniqueStrings(input.operationFacts.map(fact => fact.operationId)),
    toolCallIds: uniqueStrings(input.operationFacts.flatMap(fact => (fact.toolCalls ?? []).map(call => call.id))),
    committedEffectIds: collectCommittedEffectIds(input.operationFacts),
    replayBlockedEffectIds: input.replayBlockedEffectIds,
  };
}

function normalizeStreamContinuity(input?: ProviderStreamContinuityInput): ProviderStreamContinuityReport {
  const state = input?.state ?? 'not-started';
  const providerRequestId = normalizeOptionalText(input?.providerRequestId);
  return {
    state,
    ...(providerRequestId ? { providerRequestId } : {}),
    receivedChunks: normalizeNonNegativeInteger(input?.receivedChunks),
    receivedBytes: normalizeNonNegativeInteger(input?.receivedBytes),
    partialOutputReplay: state === 'partial' ? 'blocked' : 'not-applicable',
  };
}

function collectCommittedEffectIds(operationFacts: ProviderOperationFact[]): string[] {
  return uniqueStrings(operationFacts
    .filter(fact => fact.effectState === 'committed')
    .map(fact => fact.effectId ?? fact.operationId));
}

function collectReplayBlockedEffectIds(operationFacts: ProviderOperationFact[]): string[] {
  return collectCommittedEffectIds(operationFacts);
}

function buildReplayBlockedReason(destructive: boolean, replayBlockedEffectIds: string[]): string {
  if (destructive && replayBlockedEffectIds.length > 0) {
    return 'Provider fallback may regenerate tool calls, so committed side effects or destructive/workspace-mutating tools must not be replayed automatically.';
  }
  if (replayBlockedEffectIds.length > 0) {
    return 'Provider fallback may regenerate tool calls, so committed side effects must not be replayed automatically.';
  }
  return 'Provider fallback may regenerate tool calls, so destructive or workspace-mutating tools must not be replayed automatically.';
}

function cloneChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: cloneMessageContent(message.content),
  }));
}

function cloneMessageContent(content: ChatMessage['content']): ChatMessage['content'] {
  if (typeof content === 'string') return content;
  return content.map(cloneContentPart);
}

function cloneContentPart(part: ContentPart): ContentPart {
  return {
    type: part.type,
    ...(part.text !== undefined ? { text: part.text } : {}),
    ...(part.image_url ? { image_url: { url: part.image_url.url } } : {}),
  };
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
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
