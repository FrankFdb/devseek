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

export interface CliSurfaceAdapterOptions {
  jsonl?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export class CliSurfaceAdapter implements SurfaceAdapter {
  readonly kind: AgentSurfaceKind;
  readonly capabilities: SurfaceCapabilities;
  readonly platform = detectPlatformProfile({
    platform: process.platform,
    env: process.env,
    shellPath: process.env.SHELL ?? process.env.ComSpec,
  });

  private sawDelta = false;
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(private readonly options: CliSurfaceAdapterOptions = {}) {
    this.kind = options.jsonl ? 'jsonl' : 'cli';
    this.capabilities = options.jsonl ? JSONL_SURFACE_CAPABILITIES : CLI_SURFACE_CAPABILITIES;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
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

    if (event.type === 'chat.delta') {
      this.sawDelta = true;
      this.stdout.write(event.delta);
    } else if (event.type === 'chat.completed') {
      if (!this.sawDelta) {
        this.stdout.write(`${event.response}\n`);
      } else {
        this.stdout.write('\n');
      }
      this.sawDelta = false;
    } else if (event.type === 'error') {
      this.stderr.write(`DevSeek error: ${event.message}\n`);
    }
  }
}
