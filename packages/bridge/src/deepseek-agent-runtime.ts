export interface DeepSeekAgentLifecyclePort {
  readonly isReady: boolean;
  init(): Promise<void>;
  loginWithVisibleBrowser(): Promise<void>;
  cancel(): void;
  close(): Promise<void>;
}

export class DeepSeekAgentRuntimeClosedError extends Error {
  constructor() {
    super('deepseek-agent-runtime:closed');
    this.name = 'DeepSeekAgentRuntimeClosedError';
  }
}

/** Owns browser initialization, recovery, and shutdown races for one agent. */
export class DeepSeekAgentRuntime {
  private initialization?: Promise<void>;
  private recovery?: Promise<void>;
  private closePromise?: Promise<void>;
  private ready = false;
  private closed = false;

  constructor(
    private readonly agent: DeepSeekAgentLifecyclePort,
    private readonly initializationCloseGraceMs = 2_000,
  ) {}

  get isReady(): boolean {
    return this.ready && this.agent.isReady && !this.closed;
  }

  ensureReady(): Promise<void> {
    return this.initialize(() => this.agent.init());
  }

  loginWithVisibleBrowser(): Promise<void> {
    this.ready = false;
    return this.initialize(() => this.agent.loginWithVisibleBrowser());
  }

  cancel(): void {
    this.agent.cancel();
  }

  invalidate(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.ready = false;
    if (!this.recovery) {
      this.recovery = this.agent.close()
        .catch(() => {})
        .finally(() => { this.recovery = undefined; });
    }
    return this.recovery;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.ready = false;
    this.agent.cancel();
    this.closePromise = this.closeResources();
    return this.closePromise;
  }

  private initialize(operation: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new DeepSeekAgentRuntimeClosedError());
    if (this.isReady) return Promise.resolve();
    if (this.initialization) return this.initialization;

    const initialization = (async () => {
      if (this.recovery) await this.recovery;
      if (this.closed) throw new DeepSeekAgentRuntimeClosedError();
      try {
        await operation();
      } catch (error) {
        this.ready = false;
        await this.agent.close().catch(() => {});
        throw error;
      }
      if (this.closed) {
        await this.agent.close().catch(() => {});
        throw new DeepSeekAgentRuntimeClosedError();
      }
      this.ready = true;
    })();
    let wrapped: Promise<void>;
    wrapped = initialization.finally(() => {
      if (this.initialization === wrapped) this.initialization = undefined;
    });
    this.initialization = wrapped;
    return wrapped;
  }

  private async closeResources(): Promise<void> {
    await this.agent.close().catch(() => {});
    const pending = [this.initialization, this.recovery].filter(
      (promise): promise is Promise<void> => Boolean(promise),
    );
    if (pending.length > 0) {
      await settleWithin(Promise.allSettled(pending), this.initializationCloseGraceMs);
    }
    await this.agent.close().catch(() => {});
  }
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
