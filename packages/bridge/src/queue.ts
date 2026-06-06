/**
 * FIFO 请求队列 — 确保同一时间只有一个请求传入 DeepSeek
 */
export type QueueTask<T> = () => Promise<T>;

export class RequestQueue {
  private queue: Array<{ task: QueueTask<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  private running = false;

  get length(): number {
    return this.queue.length;
  }

  get isIdle(): boolean {
    return !this.running;
  }

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as QueueTask<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      }
    }

    this.running = false;
  }
}
