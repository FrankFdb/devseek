import { parseFakeToolCalls } from '../agent/fake-tool-parser';
import {
  CanonicalProviderEventService,
  CanonicalToolDispatchService,
  type CodingProviderEvent,
  type CodingRawToolCall,
  type CodingToolCall,
  type CodingToolDispatchContext,
  type CodingToolDispatchEnvelope,
  type ProviderEventPort,
  type ToolDispatchPort,
} from '@devseek-netai/shared';
import type { LLMProviderType, TokenUsage } from './types';

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
}

export function bindProviderNormalizationBoundary(
  providerEvents: ProviderEventPort | undefined,
  toolDispatch: ToolDispatchPort | undefined,
  dispatchContext: Pick<CodingToolDispatchContext, 'workspaceRoot'> = {},
): ProviderNormalizationBoundary | undefined {
  if (!providerEvents && !toolDispatch) return undefined;
  if (!providerEvents || !toolDispatch) {
    throw new Error('vscode-provider-event:incomplete-normalization-ports');
  }
  return Object.freeze({
    providerEvents,
    toolDispatch,
    dispatchContext: Object.freeze({ ...dispatchContext }),
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
    if (event.type === 'message') {
      for (const fakeTool of parseFakeToolCalls(event.content)) {
        envelopes.push(boundary.toolDispatch.dispatch(fakeTool, {
          ...boundary.dispatchContext,
          source: 'fake-tool',
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
    tools: Object.freeze(parseFakeToolCalls(accepted.content)
      .map(tool => boundary.toolDispatch.dispatch(tool, {
        ...boundary.dispatchContext,
        source: 'fake-tool',
      }).call)),
  });
}

function defaultProviderNormalizationBoundary(): ProviderNormalizationBoundary {
  return {
    providerEvents: DEFAULT_PROVIDER_EVENTS,
    toolDispatch: DEFAULT_TOOL_DISPATCH,
    dispatchContext: Object.freeze({}),
  };
}

export function redactProviderSecrets(text: string): string {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\b(api[_-]?key|token|cookie|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=***');
}
