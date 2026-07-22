import { once } from 'events';
import {
  CLI_SURFACE_CAPABILITIES,
  JSONL_SURFACE_CAPABILITIES,
  createChatRequestCommand,
  detectPlatformProfile,
  type AgentEvent,
  type AgentSurfaceKind,
  type ChatRequestCommand,
  type SurfaceAdapter,
  type SurfaceCapabilities,
  type SurfaceChatInput,
} from '@devseek-netai/shared';

export type CliSurfaceKind = Extract<AgentSurfaceKind, 'cli' | 'jsonl'>;

export interface CliSurfaceAdapterOptions {
  jsonl?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  progressDelayMs?: number;
}

export const CLI_JSONL_COLLABORATION_SCHEMA = 'devseek.cli-jsonl-collaboration/v1';

export type CliRunLifecycleStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface CliRunLifecycleEvent {
  type: 'cli.run.started' | 'cli.run.completed' | 'cli.run.failed' | 'cli.run.cancelled';
  schema: typeof CLI_JSONL_COLLABORATION_SCHEMA;
  surface: CliSurfaceKind;
  timestamp: number;
  runId: string;
  commandId: string;
  status: CliRunLifecycleStatus;
  exitCode: number | null;
  backpressure: {
    owner: 'CliSurfaceAdapter';
    queue: 'writeQueue';
    drainEvent: 'drain';
    renderEventAwaited: true;
    flushRequiredBeforeSettlement: true;
  };
  cancel: {
    requested: boolean;
    signal: NodeJS.Signals | null;
    exitCode: number | null;
  };
}

export class CliSurfaceAdapter implements SurfaceAdapter {
  readonly kind: CliSurfaceKind;
  readonly capabilities: SurfaceCapabilities;
  readonly platform = detectPlatformProfile({
    platform: process.platform,
    env: process.env,
    shellPath: process.env.SHELL ?? process.env.ComSpec,
  });

  private sawDelta = false;
  private waitTimer: NodeJS.Timeout | undefined;
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly progressDelayMs: number;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeError: unknown;

  constructor(private readonly options: CliSurfaceAdapterOptions = {}) {
    this.kind = options.jsonl ? 'jsonl' : 'cli';
    this.capabilities = options.jsonl ? JSONL_SURFACE_CAPABILITIES : CLI_SURFACE_CAPABILITIES;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.progressDelayMs = options.progressDelayMs ?? Number(process.env.DEVSEEK_CLI_PROGRESS_DELAY_MS ?? 1500);
  }

  toChatCommand(input: SurfaceChatInput): ChatRequestCommand {
    return createChatRequestCommand({
      surface: this.kind,
      capabilities: this.capabilities,
      platform: this.platform,
      prompt: input.prompt,
      commandId: input.commandId,
      request: input.request,
    });
  }

  renderEvent(event: AgentEvent): Promise<void> {
    return this.enqueueWrite(() => this.renderEventNow(event));
  }

  renderLifecycleEvent(event: CliRunLifecycleEvent): Promise<void> {
    return this.enqueueWrite(() => this.renderLifecycleEventNow(event));
  }

  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.writeError) throw this.writeError;
  }

  private async renderLifecycleEventNow(event: CliRunLifecycleEvent): Promise<void> {
    if (this.options.jsonl) {
      await this.writeStdout(`${JSON.stringify(event)}\n`);
      return;
    }
    if (!this.shouldRenderTextLifecycle()) return;
    if (event.type === 'cli.run.started') {
      await this.writeStderr(`DevSeek CLI: run started (${event.runId})\n`);
      return;
    }
    await this.writeStderr(`DevSeek CLI: run ${event.status} (exit=${event.exitCode ?? 'unknown'})\n`);
  }

  private async renderEventNow(event: AgentEvent): Promise<void> {
    if (this.options.jsonl) {
      await this.writeStdout(`${JSON.stringify(event)}\n`);
      return;
    }

    if (event.type === 'provider.status' && event.status === 'waiting') {
      this.scheduleProviderWaitNotice();
    } else if (event.type === 'provider.status' && event.status === 'completed') {
      this.clearProviderWaitNotice();
    } else if (event.type === 'chat.delta') {
      this.clearProviderWaitNotice();
      this.sawDelta = true;
      await this.writeStdout(event.delta);
    } else if (event.type === 'chat.completed') {
      this.clearProviderWaitNotice();
      if (!this.sawDelta) {
        await this.writeStdout(`${event.response}\n`);
      } else {
        await this.writeStdout('\n');
      }
      this.sawDelta = false;
    } else if (event.type === 'error') {
      this.clearProviderWaitNotice();
      await this.writeStderr(`DevSeek error: ${event.message}\n`);
    }
  }

  private scheduleProviderWaitNotice(): void {
    this.clearProviderWaitNotice();
    this.waitTimer = setTimeout(() => {
      void this.enqueueWrite(() => this.writeStderr('DevSeek: waiting for Bridge provider response...\n'));
    }, Math.max(0, this.progressDelayMs));
  }

  private clearProviderWaitNotice(): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = undefined;
    }
  }

  private shouldRenderTextLifecycle(): boolean {
    return process.env.DEVSEEK_CLI_COLLABORATION_STATUS === '1'
      || Boolean((this.stderr as { isTTY?: boolean }).isTTY);
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const write = this.writeQueue.then(operation);
    this.writeQueue = write.catch(error => {
      this.writeError = this.writeError ?? error;
    });
    return write;
  }

  private writeStdout(text: string): Promise<void> {
    return this.writeStream(this.stdout, text);
  }

  private writeStderr(text: string): Promise<void> {
    return this.writeStream(this.stderr, text);
  }

  private async writeStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
    if (stream.write(text)) return;
    await once(stream, 'drain');
  }
}

export function createCliRunLifecycleEvent(args: {
  surface: CliSurfaceKind;
  runId: string;
  commandId: string;
  status: CliRunLifecycleStatus;
  exitCode?: number | null;
  cancelSignal?: NodeJS.Signals;
  now?: () => number;
}): CliRunLifecycleEvent {
  const cancelRequested = args.status === 'cancelled' || Boolean(args.cancelSignal);
  return {
    type: lifecycleTypeForStatus(args.status),
    schema: CLI_JSONL_COLLABORATION_SCHEMA,
    surface: args.surface,
    timestamp: (args.now ?? Date.now)(),
    runId: args.runId,
    commandId: args.commandId,
    status: args.status,
    exitCode: args.exitCode ?? null,
    backpressure: {
      owner: 'CliSurfaceAdapter',
      queue: 'writeQueue',
      drainEvent: 'drain',
      renderEventAwaited: true,
      flushRequiredBeforeSettlement: true,
    },
    cancel: {
      requested: cancelRequested,
      signal: args.cancelSignal ?? null,
      exitCode: cancelRequested ? args.exitCode ?? null : null,
    },
  };
}

function lifecycleTypeForStatus(status: CliRunLifecycleStatus): CliRunLifecycleEvent['type'] {
  if (status === 'running') return 'cli.run.started';
  if (status === 'completed') return 'cli.run.completed';
  if (status === 'cancelled') return 'cli.run.cancelled';
  return 'cli.run.failed';
}
