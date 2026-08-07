import { snapshotCodingValue } from './coding-contract-utils';
import type { CodingRawToolCall } from './coding-tool-dispatch';

export const CODING_PROVIDER_EVENT_VERSION = 'devseek.coding-provider-event/v1' as const;

export interface CodingProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export type CodingProviderEventInput =
  | { readonly type: 'text-delta'; readonly provider: string; readonly text: string; readonly workflowId?: string }
  | { readonly type: 'message'; readonly provider: string; readonly content: string; readonly workflowId?: string }
  | { readonly type: 'tool-call'; readonly provider: string; readonly call: CodingRawToolCall; readonly workflowId?: string }
  | { readonly type: 'usage'; readonly provider: string; readonly usage: CodingProviderUsage; readonly workflowId?: string }
  | { readonly type: 'error'; readonly provider: string; readonly message: string; readonly recoverable?: boolean; readonly workflowId?: string };

export type CodingProviderEvent = CodingProviderEventInput & {
  readonly version: typeof CODING_PROVIDER_EVENT_VERSION;
};

export interface ProviderEventPort {
  accept(event: CodingProviderEventInput): CodingProviderEvent;
  acceptAll(events: readonly CodingProviderEventInput[]): readonly CodingProviderEvent[];
}

/**
 * Canonical boundary for provider output. Provider adapters remove wire dialects;
 * this owner validates and snapshots the event contract consumed by the Kernel.
 */
export class CanonicalProviderEventService implements ProviderEventPort {
  accept(event: CodingProviderEventInput): CodingProviderEvent {
    if (!event || typeof event !== 'object') providerEventFailure('invalid-event');
    const base = {
      version: CODING_PROVIDER_EVENT_VERSION,
      provider: requireText(event.provider, 'missing-provider'),
      ...(event.workflowId === undefined
        ? {}
        : { workflowId: requireText(event.workflowId, 'invalid-workflow-id') }),
    };
    switch (event.type) {
      case 'text-delta':
        return Object.freeze({ ...base, type: event.type, text: requireString(event.text, 'invalid-text-delta') });
      case 'message':
        return Object.freeze({ ...base, type: event.type, content: requireString(event.content, 'invalid-message') });
      case 'tool-call':
        if (!isRecord(event.call)) providerEventFailure('invalid-tool-call');
        return Object.freeze({
          ...base,
          type: event.type,
          call: snapshotCodingValue(event.call, 'provider-tool-call') as CodingRawToolCall,
        });
      case 'usage':
        return Object.freeze({ ...base, type: event.type, usage: snapshotUsage(event.usage) });
      case 'error':
        if (event.recoverable !== undefined && typeof event.recoverable !== 'boolean') {
          providerEventFailure('invalid-recoverable');
        }
        return Object.freeze({
          ...base,
          type: event.type,
          message: requireText(event.message, 'invalid-error-message'),
          ...(event.recoverable === undefined ? {} : { recoverable: Boolean(event.recoverable) }),
        });
      default:
        return providerEventFailure(`unsupported-type:${String((event as { type?: unknown }).type)}`);
    }
  }

  acceptAll(events: readonly CodingProviderEventInput[]): readonly CodingProviderEvent[] {
    if (!Array.isArray(events)) providerEventFailure('invalid-event-list');
    return Object.freeze(events.map(event => this.accept(event)));
  }
}

function snapshotUsage(usage: CodingProviderUsage): CodingProviderUsage {
  if (!usage || typeof usage !== 'object') providerEventFailure('invalid-usage');
  const promptTokens = requireNonNegativeInteger(usage.promptTokens, 'invalid-prompt-tokens');
  const completionTokens = requireNonNegativeInteger(usage.completionTokens, 'invalid-completion-tokens');
  const totalTokens = requireNonNegativeInteger(usage.totalTokens, 'invalid-total-tokens');
  if (totalTokens < promptTokens + completionTokens) providerEventFailure('inconsistent-token-total');
  return Object.freeze({ promptTokens, completionTokens, totalTokens });
}

function requireNonNegativeInteger(value: unknown, reason: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    providerEventFailure(reason);
  }
  return value as number;
}

function requireString(value: unknown, reason: string): string {
  if (typeof value !== 'string') providerEventFailure(reason);
  return value as string;
}

function requireText(value: unknown, reason: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) providerEventFailure(reason);
  return normalized;
}

function providerEventFailure(reason: string): never {
  throw new Error(`coding-provider-event:${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
