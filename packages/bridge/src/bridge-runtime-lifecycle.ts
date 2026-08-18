import type { DeepSeekWebConnectorPort } from './deepseek-web-connector';
import type { DeepSeekAgentRuntime } from './deepseek-agent-runtime';
import type { RequestQueue } from './queue';
import { RequestQueueClosedError } from './queue';

export type BridgeShutdownReason = 'http' | 'sigint' | 'sigterm' | 'parent-exited' | 'startup-failure';

export interface BridgeShutdownReport {
  readonly reason: BridgeShutdownReason;
  readonly cooperativeDrainCompleted: boolean;
  readonly forcedDrainCompleted: boolean;
  readonly serverCloseCompleted: boolean;
}

export interface BridgeRuntimeLifecycleOptions {
  readonly queue: Pick<RequestQueue, 'close' | 'cancel' | 'whenIdle'>;
  readonly connector: Pick<DeepSeekWebConnectorPort, 'activeRequests' | 'cancel'>;
  readonly agent: Pick<DeepSeekAgentRuntime, 'cancel' | 'close'>;
  readonly closeServer: () => Promise<void>;
  readonly cooperativeGraceMs?: number;
  readonly forcedGraceMs?: number;
  readonly serverCloseGraceMs?: number;
}

/** Coordinates shutdown from every process boundary through one idempotent path. */
export class BridgeRuntimeLifecycle {
  private shutdownPromise?: Promise<BridgeShutdownReport>;

  constructor(private readonly options: BridgeRuntimeLifecycleOptions) {}

  get isShuttingDown(): boolean {
    return this.shutdownPromise !== undefined;
  }

  shutdown(reason: BridgeShutdownReason): Promise<BridgeShutdownReport> {
    if (!this.shutdownPromise) this.shutdownPromise = this.performShutdown(reason);
    return this.shutdownPromise;
  }

  private async performShutdown(reason: BridgeShutdownReason): Promise<BridgeShutdownReport> {
    const stopped = new RequestQueueClosedError(`bridge-request-queue:shutdown:${reason}`);
    this.options.queue.close(stopped);

    let interruptProvider = false;
    for (const request of this.options.connector.activeRequests()) {
      const decision = this.options.connector.cancel(request.requestId);
      this.options.queue.cancel(request.requestId, stopped);
      interruptProvider ||= decision.shouldInterruptProvider;
    }
    if (interruptProvider) this.options.agent.cancel();

    // Calling server.close first stops new connections while existing responses drain.
    const serverClose = this.options.closeServer().catch(() => {});
    const cooperativeDrainCompleted = await settlesWithin(
      this.options.queue.whenIdle(),
      this.options.cooperativeGraceMs ?? 1_500,
    );

    await this.options.agent.close();
    const forcedDrainCompleted = await settlesWithin(
      this.options.queue.whenIdle(),
      this.options.forcedGraceMs ?? 1_500,
    );
    const serverCloseCompleted = await settlesWithin(
      serverClose,
      this.options.serverCloseGraceMs ?? 2_000,
    );

    return Object.freeze({
      reason,
      cooperativeDrainCompleted,
      forcedDrainCompleted,
      serverCloseCompleted,
    });
  }
}

export interface ParentProcessWatchOptions {
  readonly parentPid: number | undefined;
  readonly onParentExit: () => void;
  readonly intervalMs?: number;
  readonly isAlive?: (pid: number) => boolean;
}

/** Returns a disposer. Invalid or self parent identifiers intentionally disable the watch. */
export function watchParentProcess(options: ParentProcessWatchOptions): () => void {
  const parentPid = options.parentPid;
  if (!Number.isSafeInteger(parentPid) || !parentPid || parentPid <= 1 || parentPid === process.pid) {
    return () => {};
  }
  const isAlive = options.isAlive ?? isProcessAlive;
  let disposed = false;
  const timer = setInterval(() => {
    if (disposed || isAlive(parentPid)) return;
    disposed = true;
    clearInterval(timer);
    options.onParentExit();
  }, Math.max(100, options.intervalMs ?? 1_000));
  timer.unref();
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => false),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
