import {
  parseAuthorizedTextToolCalls,
  type TextToolProtocolSession,
} from '../agent/text-tool-protocol';
import {
  CanonicalProviderEventService,
  CanonicalToolDispatchService,
  type CodingProviderEvent,
  type CodingRawToolCall,
  type CodingToolCall,
  type CodingToolCallSource,
  type CodingToolDispatchContext,
  type CodingToolDispatchEnvelope,
  type ProviderEventPort,
  type ToolDispatchPort,
  redactCodingSecretsInText,
} from '@devseek-netai/shared';
import type { LLMProviderType, TokenUsage } from './types';
import { projectProviderNativeTextToolResponse } from './provider-native-text-tools';

export type LLMEvent =
  | { type: 'text-delta'; provider: LLMProviderType; text: string; workflowId?: string }
  | { type: 'message'; provider: LLMProviderType; content: string; workflowId?: string }
  | { type: 'tool-call'; provider: LLMProviderType; call: CodingRawToolCall; workflowId?: string }
  | { type: 'usage'; provider: LLMProviderType; usage: TokenUsage; workflowId?: string }
  | { type: 'error'; provider: LLMProviderType; message: string; recoverable?: boolean; workflowId?: string };

export interface ProviderNormalizationBoundary {
  readonly providerEvents: ProviderEventPort;
  readonly toolDispatch: ToolDispatchPort;
  readonly dispatchContext: Readonly<Pick<CodingToolDispatchContext, 'workspaceRoot'>>;
  readonly textToolProtocol?: TextToolProtocolSession;
  readonly allowProviderNativeTextTools?: boolean;
}

export interface ProviderNormalizationOptions {
  readonly allowProviderNativeTextTools?: boolean;
}

export function bindProviderNormalizationBoundary(
  providerEvents: ProviderEventPort | undefined,
  toolDispatch: ToolDispatchPort | undefined,
  dispatchContext: Pick<CodingToolDispatchContext, 'workspaceRoot'> = {},
  textToolProtocol?: TextToolProtocolSession,
  options: ProviderNormalizationOptions = {},
): ProviderNormalizationBoundary | undefined {
  if (!providerEvents && !toolDispatch) return undefined;
  if (!providerEvents || !toolDispatch) {
    throw new Error('vscode-provider-event:incomplete-normalization-ports');
  }
  return Object.freeze({
    providerEvents,
    toolDispatch,
    dispatchContext: Object.freeze({ ...dispatchContext }),
    ...(textToolProtocol ? { textToolProtocol } : {}),
    ...(options.allowProviderNativeTextTools ? { allowProviderNativeTextTools: true } : {}),
  });
}

const DEFAULT_PROVIDER_EVENTS = new CanonicalProviderEventService();
const DEFAULT_TOOL_DISPATCH = new CanonicalToolDispatchService();

export function llmEventsToToolCalls(
  events: readonly LLMEvent[],
  boundary?: ProviderNormalizationBoundary,
): CodingToolCall[] {
  return llmEventsToToolCallEnvelopes(events, boundary).map(envelope => envelope.call);
}

export function llmEventsToToolCallEnvelopes(
  events: readonly LLMEvent[],
  boundary: ProviderNormalizationBoundary = defaultProviderNormalizationBoundary(),
): CodingToolDispatchEnvelope[] {
  const envelopes: CodingToolDispatchEnvelope[] = [];
  for (const rawEvent of events) {
    const event = boundary.providerEvents.accept(rawEvent);
    if (event.type === 'tool-call') {
      envelopes.push(boundary.toolDispatch.dispatch(event.call, {
        ...boundary.dispatchContext,
        source: 'native',
      }));
      continue;
    }
    if (event.type === 'message' && boundary.textToolProtocol) {
      for (const proposal of providerMessageToolProposals(event, boundary)) {
        envelopes.push(boundary.toolDispatch.dispatch(proposal.tool, {
          ...boundary.dispatchContext,
          source: proposal.source,
        }));
      }
    }
  }
  return envelopes;
}

export function normalizeProviderMessage(
  event: Extract<LLMEvent, { readonly type: 'message' }>,
  boundary: ProviderNormalizationBoundary = defaultProviderNormalizationBoundary(),
): { readonly event: CodingProviderEvent; readonly tools: readonly CodingToolCall[] } {
  const accepted = boundary.providerEvents.accept(event);
  if (accepted.type !== 'message') throw new Error('vscode-provider-event:message-normalization-mismatch');
  return Object.freeze({
    event: accepted,
    tools: Object.freeze(providerMessageToolProposals(accepted, boundary)
      .map(proposal => boundary.toolDispatch.dispatch(proposal.tool, {
        ...boundary.dispatchContext,
        source: proposal.source,
      }).call)),
  });
}

function providerMessageToolProposals(
  event: Extract<CodingProviderEvent, { readonly type: 'message' }>,
  boundary: ProviderNormalizationBoundary,
): readonly { readonly tool: CodingRawToolCall; readonly source: CodingToolCallSource }[] {
  const authorized = parseAuthorizedTextToolCalls(event.content, boundary.textToolProtocol);
  if (authorized.length > 0) {
    return authorized.map(tool => ({ tool, source: 'text-protocol' }));
  }
  if (event.provider !== 'bridge' || !boundary.allowProviderNativeTextTools) return [];
  const native = projectProviderNativeTextToolResponse(event.content);
  return native?.tools.map(tool => ({ tool, source: 'provider-native-text' })) ?? [];
}

function defaultProviderNormalizationBoundary(): ProviderNormalizationBoundary {
  return {
    providerEvents: DEFAULT_PROVIDER_EVENTS,
    toolDispatch: DEFAULT_TOOL_DISPATCH,
    dispatchContext: Object.freeze({}),
  };
}

export function redactProviderSecrets(text: string): string {
  return redactCodingSecretsInText(text, { replacement: '***' }).text;
}
