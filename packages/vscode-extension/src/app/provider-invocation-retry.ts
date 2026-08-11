import { deepSeekStreamBackoffMs, type LLMProviderType } from '@devseek-netai/shared';
import { isTransientProviderTransportError } from '../llm/provider-transport-error';

export const PROVIDER_INVOCATION_MAX_ATTEMPTS = 2;

export interface ProviderInvocationAttempt {
  attempt: number;
  markOutputObserved(): void;
}

export interface ProviderInvocationRetryEvent {
  attempt: number;
  nextAttempt: number;
  delayMs: number;
  error: unknown;
}

export interface ProviderInvocationRetryInput<T> {
  providerType: LLMProviderType;
  signal?: AbortSignal;
  invoke: (attempt: ProviderInvocationAttempt) => Promise<T>;
  onRetry?: (event: ProviderInvocationRetryEvent) => void;
}

export interface ProviderInvocationRetryDeps {
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export class ProviderInvocationRetryService {
  private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;

  constructor(deps: ProviderInvocationRetryDeps = {}) {
    this.sleep = deps.sleep ?? waitForRetry;
  }

  async execute<T>(input: ProviderInvocationRetryInput<T>): Promise<T> {
    for (let attempt = 1; attempt <= PROVIDER_INVOCATION_MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(input.signal);
      let outputObserved = false;
      try {
        return await input.invoke({
          attempt,
          markOutputObserved: () => { outputObserved = true; },
        });
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason ?? error;
        const canRetry = input.providerType === 'bridge'
          && attempt < PROVIDER_INVOCATION_MAX_ATTEMPTS
          && !outputObserved
          && isTransientProviderTransportError(error);
        if (!canRetry) throw error;

        const delayMs = deepSeekStreamBackoffMs('provider-error', attempt) ?? 1_000;
        try {
          input.onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
        } catch {
          // Retry observers are diagnostic-only and cannot change provider behavior.
        }
        await this.sleep(delayMs, input.signal);
      }
    }
    throw new Error('Provider retry budget exhausted');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Cancelled');
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new Error('Cancelled'));
    };
    function finish(): void {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
