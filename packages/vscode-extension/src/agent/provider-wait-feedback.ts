export type ProviderWaitActivity = (kind: 'label', label: string) => void;

export interface ProviderWaitScheduler {
  readonly now: () => number;
  readonly setInterval: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

const DEFAULT_UPDATE_INTERVAL_MS = 5_000;

const defaultScheduler: ProviderWaitScheduler = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Keeps one user-facing progress label alive while a provider turn is silent. */
export class ProviderWaitFeedback {
  private readonly startedAt: number;
  private intervalHandle?: unknown;
  private receivedOutput = false;
  private stopped = false;

  constructor(
    private readonly activity: ProviderWaitActivity | undefined,
    private readonly round: number,
    private readonly scheduler: ProviderWaitScheduler = defaultScheduler,
    updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS,
  ) {
    this.startedAt = scheduler.now();
    if (!activity) return;
    activity('label', round === 1 ? '正在等待模型响应' : '正在等待模型继续处理');
    this.intervalHandle = scheduler.setInterval(() => this.reportElapsed(), updateIntervalMs);
  }

  observeOutput(): void {
    if (this.stopped || this.receivedOutput) return;
    this.receivedOutput = true;
    this.clearTimer();
    this.activity?.('label', '已收到模型响应，正在解析动作');
  }

  complete(): void {
    if (this.stopped) return;
    if (!this.receivedOutput) this.observeOutput();
    this.stop();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
  }

  private reportElapsed(): void {
    if (this.stopped || this.receivedOutput) return;
    const elapsedSeconds = Math.max(1, Math.round((this.scheduler.now() - this.startedAt) / 1_000));
    this.activity?.('label', `模型仍在处理，已等待 ${elapsedSeconds} 秒`);
  }

  private clearTimer(): void {
    if (this.intervalHandle === undefined) return;
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
  }
}
