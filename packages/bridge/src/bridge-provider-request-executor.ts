import type {
  DeepSeekWebConnectorExecutionObserver,
  DeepSeekWebConnectorSessionPort,
} from './deepseek-web-connector';

export type BridgeProviderExecutionPhase = 'initialization' | 'generation';

export class BridgeProviderExecutionError extends Error {
  constructor(
    readonly phase: BridgeProviderExecutionPhase,
    readonly originalError: unknown,
  ) {
    super(providerExecutionErrorMessage(originalError));
    this.name = 'BridgeProviderExecutionError';
  }
}

interface BridgeProviderRuntimePort {
  ensureReady(): Promise<void>;
}

interface BridgeProviderAttemptLifecyclePort {
  beginInitialization(): void;
  beginAdmission(): void;
  beginAttempt(attempt: number): void;
  beginPromptPreparation(): void;
  retryScheduled(): void;
}

interface BridgeProviderConnectorExecutionPort {
  execute<T>(
    session: DeepSeekWebConnectorSessionPort,
    operation: (attempt: number) => Promise<T>,
    observer?: DeepSeekWebConnectorExecutionObserver,
  ): Promise<T>;
}

export interface BridgeProviderRequestExecutorOptions {
  readonly runtime: BridgeProviderRuntimePort;
  readonly connectorExecution: BridgeProviderConnectorExecutionPort;
}

export interface BridgeProviderRequestExecutionOptions {
  readonly lifecycle?: BridgeProviderAttemptLifecyclePort;
  readonly observer?: Pick<DeepSeekWebConnectorExecutionObserver, 'onRetryFrame'>;
}

/** Owns readiness and generation as one bounded, observable provider attempt loop. */
export class BridgeProviderRequestExecutor {
  constructor(private readonly options: BridgeProviderRequestExecutorOptions) {}

  async execute<T>(
    session: DeepSeekWebConnectorSessionPort,
    operation: (attempt: number) => Promise<T>,
    options: BridgeProviderRequestExecutionOptions,
  ): Promise<T> {
    let activePhase: BridgeProviderExecutionPhase = 'initialization';
    try {
      return await this.options.connectorExecution.execute(session, async attempt => {
        activePhase = 'initialization';
        options.lifecycle?.beginInitialization();
        try {
          await this.options.runtime.ensureReady();
        } catch (error) {
          throw new BridgeProviderExecutionError('initialization', error);
        }

        session.assertDispatchable();
        options.lifecycle?.beginAdmission();
        options.lifecycle?.beginPromptPreparation();
        activePhase = 'generation';
        try {
          return await operation(attempt);
        } catch (error) {
          throw new BridgeProviderExecutionError('generation', error);
        }
      }, {
        onAttemptStarted: attempt => options.lifecycle?.beginAttempt(attempt),
        onRetryScheduled: () => options.lifecycle?.retryScheduled(),
        onRetryFrame: options.observer?.onRetryFrame,
      });
    } catch (error) {
      if (error instanceof BridgeProviderExecutionError) throw error;
      throw new BridgeProviderExecutionError(activePhase, error);
    }
  }
}

function providerExecutionErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  const message = (error as { readonly message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'Bridge provider operation failed';
}
