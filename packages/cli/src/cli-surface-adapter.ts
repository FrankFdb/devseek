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

  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.writeError) throw this.writeError;
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
