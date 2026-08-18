/** Serializes access to the single browser-backed DeepSeek session. */
export type QueueTask<T> = () => Promise<T>;

interface QueueItem {
  readonly id?: string;
  readonly task: QueueTask<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

export class RequestQueueClosedError extends Error {
  constructor(message = 'bridge-request-queue:closed') {
    super(message);
    this.name = 'RequestQueueClosedError';
  }
}

export class RequestQueueCancelledError extends Error {
  constructor(readonly requestId: string) {
    super(`bridge-request-queue:cancelled:${requestId}`);
    this.name = 'RequestQueueCancelledError';
  }
}

/**
 * Owns queued request settlement as well as FIFO execution. Closing rejects work
 * that has not started; the active task remains cooperative and can be awaited.
 */
export class RequestQueue {
  private readonly queue: QueueItem[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private running = false;
  private closedError?: Error;

  get length(): number {
    return this.queue.length;
  }

  get isIdle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  get isClosed(): boolean {
    return this.closedError !== undefined;
  }

  enqueue<T>(task: QueueTask<T>, options: { readonly id?: string } = {}): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: options.id,
        task: task as QueueTask<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      void this.drain();
    });
  }

  cancel(requestId: string, error: Error = new RequestQueueCancelledError(requestId)): boolean {
    const index = this.queue.findIndex(item => item.id === requestId);
    if (index < 0) return false;
    const [item] = this.queue.splice(index, 1);
    item.reject(error);
    this.notifyIdle();
    return true;
  }

  close(error: Error = new RequestQueueClosedError()): void {
    if (this.closedError) return;
    this.closedError = error;
    const pending = this.queue.splice(0);
    for (const item of pending) item.reject(error);
    this.notifyIdle();
  }

  whenIdle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.add(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          item.resolve(await item.task());
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.running = false;
      this.notifyIdle();
    }
  }

  private notifyIdle(): void {
    if (!this.isIdle) return;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) resolve();
  }
}
