import {
  HEADLESS_SURFACE_CAPABILITIES,
  certifySurfaceAdapter,
  CanonicalSurfaceAccessibilityService,
  CanonicalUserCollaborationService,
  CODING_CANCELLATION_RECEIPT_VERSION,
  createChatRequestCommand,
  detectPlatformProfile,
  type AgentEvent,
  type PlatformProfile,
  type SurfaceAdapter,
  type SurfaceAdapterConformanceReceipt,
  type SurfaceChatInput,
  type SurfaceCapabilities,
  type CodingSurfaceAccessibilityDecision,
  type CodingUserCollaborationDecision,
} from '@devseek-netai/shared';

export interface HeadlessSurfaceAdapterOptions {
  readonly platform?: PlatformProfile;
  readonly eventSink?: (event: AgentEvent) => void | Promise<void>;
}

/** Programmatic command and event delivery boundary for Headless consumers. */
export class HeadlessSurfaceAdapter implements SurfaceAdapter {
  readonly kind = 'headless' as const;
  readonly capabilities: SurfaceCapabilities = HEADLESS_SURFACE_CAPABILITIES;
  readonly platform: PlatformProfile;

  private readonly eventSink: (event: AgentEvent) => void | Promise<void>;
  private deliveryQueue: Promise<void> = Promise.resolve();
  private deliveryError: unknown;

  constructor(options: HeadlessSurfaceAdapterOptions = {}) {
    this.platform = options.platform ?? detectPlatformProfile({
      platform: process.platform,
      env: process.env,
      shellPath: process.env.SHELL ?? process.env.ComSpec,
      workspaceKind: 'local',
    });
    this.eventSink = options.eventSink ?? (() => {});
  }

  toChatCommand(input: SurfaceChatInput) {
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
    const delivery = this.deliveryQueue.then(() => this.eventSink(event));
    this.deliveryQueue = delivery.catch(error => {
      this.deliveryError ??= error;
    });
    return delivery;
  }

  async flush(): Promise<void> {
    await this.deliveryQueue;
    if (this.deliveryError) throw this.deliveryError;
  }

  conformance(): SurfaceAdapterConformanceReceipt {
    return certifySurfaceAdapter({
      adapterId: 'headless-callback',
      kind: this.kind,
      capabilities: this.capabilities,
      platform: this.platform,
      command: this.toChatCommand({
        prompt: 'surface adapter conformance probe',
        commandId: 'headless-surface-conformance',
      }),
      eventDelivery: {
        channel: 'callback',
        ordering: 'serialized',
        backpressure: 'awaited',
      },
    });
  }

  collaboration(): CodingUserCollaborationDecision {
    return new CanonicalUserCollaborationService().assess({
      surface: this.kind,
      interactions: ['progress', 'cancellation', 'resume', 'error-explanation'],
      eventTypes: ['chat.started', 'provider.status', 'checkpoint.available', 'error'],
      traceBound: true,
      cancellationProtocol: CODING_CANCELLATION_RECEIPT_VERSION,
      evidenceRefs: [
        'headless-surface:serialized-callback-events',
        'headless-surface:abort-signal',
        'headless-surface:checkpoint-input',
      ],
    });
  }

  accessibility(): CodingSurfaceAccessibilityDecision {
    return new CanonicalSurfaceAccessibilityService().assess({
      surface: this.kind,
      channels: ['programmatic'],
      statusNotColorOnly: true,
      cancellationReachable: true,
      recoveryReachable: true,
      evidenceRefs: [
        'headless-surface:typed-events',
        'headless-surface:typed-terminal-output',
      ],
    });
  }
}
