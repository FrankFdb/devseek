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

  renderEvent(event: AgentEvent): void {
    if (this.options.jsonl) {
      this.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }

    if (event.type === 'provider.status' && event.status === 'waiting') {
      this.scheduleProviderWaitNotice();
    } else if (event.type === 'provider.status' && event.status === 'completed') {
      this.clearProviderWaitNotice();
    } else if (event.type === 'chat.delta') {
      this.clearProviderWaitNotice();
      this.sawDelta = true;
      this.stdout.write(event.delta);
    } else if (event.type === 'chat.completed') {
      this.clearProviderWaitNotice();
      if (!this.sawDelta) {
        this.stdout.write(`${event.response}\n`);
      } else {
        this.stdout.write('\n');
      }
      this.sawDelta = false;
    } else if (event.type === 'error') {
      this.clearProviderWaitNotice();
      this.stderr.write(`DevSeek error: ${event.message}\n`);
    }
  }

  private scheduleProviderWaitNotice(): void {
    this.clearProviderWaitNotice();
    this.waitTimer = setTimeout(() => {
      this.stderr.write('DevSeek: waiting for Bridge provider response...\n');
    }, Math.max(0, this.progressDelayMs));
  }

  private clearProviderWaitNotice(): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = undefined;
    }
  }
}
