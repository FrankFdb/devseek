import {
  AGENT_COMMAND_VERSION,
  CanonicalAgentCommandService,
  type CanonicalAgentCommand,
} from './agent-command';
import type {
  AgentSurfaceKind,
  ChatRequestCommand,
  PlatformProfile,
  SurfaceCapabilities,
} from './agent-protocol';

export const SURFACE_ADAPTER_CONFORMANCE_VERSION = 'devseek.surface-adapter-conformance/v1' as const;

export type SurfaceEventChannel = 'webview' | 'stdout' | 'callback';
export type SurfaceEventOrdering = 'host-ordered' | 'serialized';
export type SurfaceEventBackpressure = 'host-managed' | 'awaited';

export interface SurfaceEventDeliveryContract {
  readonly channel: SurfaceEventChannel;
  readonly ordering: SurfaceEventOrdering;
  readonly backpressure: SurfaceEventBackpressure;
}

export interface SurfaceAdapterConformanceInput {
  readonly adapterId: string;
  readonly kind: AgentSurfaceKind;
  readonly capabilities: SurfaceCapabilities;
  readonly platform: PlatformProfile;
  readonly command: CanonicalAgentCommand<ChatRequestCommand>;
  readonly eventDelivery: SurfaceEventDeliveryContract;
}

export interface SurfaceAdapterConformanceReceipt {
  readonly version: typeof SURFACE_ADAPTER_CONFORMANCE_VERSION;
  readonly adapterId: string;
  readonly surface: AgentSurfaceKind;
  readonly commandId: string;
  readonly commandVersion: typeof AGENT_COMMAND_VERSION;
  readonly capabilities: Readonly<SurfaceCapabilities>;
  readonly platform: Readonly<PlatformProfile>;
  readonly eventDelivery: Readonly<SurfaceEventDeliveryContract>;
  readonly checks: readonly string[];
}

export interface SurfaceAdapterConformancePort {
  certify(input: SurfaceAdapterConformanceInput): SurfaceAdapterConformanceReceipt;
}

const DELIVERY_BY_SURFACE: Readonly<Record<string, SurfaceEventDeliveryContract>> = Object.freeze({
  vscode: Object.freeze({ channel: 'webview', ordering: 'host-ordered', backpressure: 'host-managed' }),
  cli: Object.freeze({ channel: 'stdout', ordering: 'serialized', backpressure: 'awaited' }),
  jsonl: Object.freeze({ channel: 'stdout', ordering: 'serialized', backpressure: 'awaited' }),
  headless: Object.freeze({ channel: 'callback', ordering: 'serialized', backpressure: 'awaited' }),
});

/** Validates a Surface's transport facts without owning command or coding policy. */
export class CanonicalSurfaceAdapterConformanceService implements SurfaceAdapterConformancePort {
  private readonly commandAuthority = new CanonicalAgentCommandService();

  certify(input: SurfaceAdapterConformanceInput): SurfaceAdapterConformanceReceipt {
    const adapterId = requireText(input.adapterId, 'missing-adapter-id');
    const expectedDelivery = DELIVERY_BY_SURFACE[input.kind];
    if (!expectedDelivery) conformanceFailure(`unsupported-product-surface:${input.kind}`);
    if (input.command.version !== AGENT_COMMAND_VERSION) {
      conformanceFailure('non-canonical-command-version');
    }
    const command = this.commandAuthority.accept(input.command);
    if (command.surface !== input.kind) conformanceFailure('command-surface-mismatch');
    if (!equalCapabilities(command.capabilities, input.capabilities)) {
      conformanceFailure('command-capabilities-mismatch');
    }
    if (!equalPlatform(command.platform, input.platform)) {
      conformanceFailure('command-platform-mismatch');
    }
    if (!equalDelivery(input.eventDelivery, expectedDelivery)) {
      conformanceFailure('event-delivery-mismatch');
    }

    return Object.freeze({
      version: SURFACE_ADAPTER_CONFORMANCE_VERSION,
      adapterId,
      surface: input.kind,
      commandId: command.commandId,
      commandVersion: AGENT_COMMAND_VERSION,
      capabilities: snapshotCapabilities(input.capabilities),
      platform: snapshotPlatform(input.platform),
      eventDelivery: Object.freeze({ ...input.eventDelivery }),
      checks: Object.freeze([
        'canonical-command-boundary',
        'surface-command-binding',
        'capability-profile-binding',
        'platform-profile-binding',
        'event-delivery-contract',
      ]),
    });
  }
}

const CONFORMANCE = new CanonicalSurfaceAdapterConformanceService();

export function certifySurfaceAdapter(
  input: SurfaceAdapterConformanceInput,
): SurfaceAdapterConformanceReceipt {
  return CONFORMANCE.certify(input);
}

function equalCapabilities(
  left: SurfaceCapabilities | undefined,
  right: SurfaceCapabilities,
): boolean {
  return !!left
    && left.supportsHunkReview === right.supportsHunkReview
    && left.supportsInlineSelection === right.supportsInlineSelection
    && left.supportsTerminalEmbedding === right.supportsTerminalEmbedding
    && left.supportsBrowserPreview === right.supportsBrowserPreview
    && left.supportsJsonl === right.supportsJsonl
    && left.supportsDiagnostics === right.supportsDiagnostics;
}

function equalPlatform(left: PlatformProfile | undefined, right: PlatformProfile): boolean {
  return !!left
    && left.os === right.os
    && left.shell === right.shell
    && left.pathStyle === right.pathStyle
    && left.lineEnding === right.lineEnding
    && left.caseSensitive === right.caseSensitive
    && left.workspaceKind === right.workspaceKind;
}

function equalDelivery(
  left: SurfaceEventDeliveryContract,
  right: SurfaceEventDeliveryContract,
): boolean {
  return left.channel === right.channel
    && left.ordering === right.ordering
    && left.backpressure === right.backpressure;
}

function snapshotCapabilities(value: SurfaceCapabilities): Readonly<SurfaceCapabilities> {
  return Object.freeze({ ...value });
}

function snapshotPlatform(value: PlatformProfile): Readonly<PlatformProfile> {
  return Object.freeze({ ...value });
}

function requireText(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) conformanceFailure(reason);
  return value.trim();
}

function conformanceFailure(reason: string): never {
  throw new Error(`surface-adapter-conformance:${reason}`);
}
