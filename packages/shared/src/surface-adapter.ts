import type {
  AgentChatRequest,
  AgentCommand,
  AgentEvent,
  AgentSurfaceKind,
  ChatRequestCommand,
  PlatformProfile,
  SurfaceCapabilities,
} from './agent-protocol';
import { assertPlatformRuntimeProfileSupported } from './platform-runtime';
import { acceptAgentCommand } from './agent-command';
import type { CanonicalAgentCommand } from './agent-command';
import type { SurfaceAdapterConformanceReceipt } from './surface-adapter-conformance';

export interface SurfaceAdapter {
  readonly kind: AgentSurfaceKind;
  readonly capabilities: SurfaceCapabilities;
  readonly platform: PlatformProfile;
  toChatCommand(input: SurfaceChatInput): CanonicalAgentCommand<ChatRequestCommand>;
  renderEvent(event: AgentEvent): void | Promise<void>;
  conformance(): SurfaceAdapterConformanceReceipt;
}

export interface SurfaceChatInput {
  prompt: string;
  commandId?: string;
  request?: Partial<AgentChatRequest>;
}

export const VSCODE_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  supportsHunkReview: true,
  supportsInlineSelection: true,
  supportsTerminalEmbedding: true,
  supportsBrowserPreview: true,
  supportsJsonl: false,
  supportsDiagnostics: true,
};

export const CLI_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  supportsHunkReview: false,
  supportsInlineSelection: false,
  supportsTerminalEmbedding: false,
  supportsBrowserPreview: false,
  supportsJsonl: false,
  supportsDiagnostics: false,
};

export const JSONL_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  ...CLI_SURFACE_CAPABILITIES,
  supportsJsonl: true,
};

export const HEADLESS_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  ...CLI_SURFACE_CAPABILITIES,
  supportsDiagnostics: true,
};

export const DESKTOP_SURFACE_CAPABILITIES: SurfaceCapabilities = {
  supportsHunkReview: true,
  supportsInlineSelection: false,
  supportsTerminalEmbedding: false,
  supportsBrowserPreview: true,
  supportsJsonl: false,
  supportsDiagnostics: true,
};

export function createChatRequestCommand(args: {
  surface: AgentSurfaceKind;
  capabilities: SurfaceCapabilities;
  platform: PlatformProfile;
  prompt: string;
  commandId?: string;
  request?: Partial<AgentChatRequest>;
  now?: () => number;
}): CanonicalAgentCommand<ChatRequestCommand> {
  assertPlatformRuntimeProfileSupported(args.platform);
  return acceptAgentCommand({
    type: 'chat.request',
    commandId: args.commandId ?? `cmd-${(args.now ?? Date.now)().toString(36)}`,
    surface: args.surface,
    capabilities: args.capabilities,
    platform: args.platform,
    createdAt: (args.now ?? Date.now)(),
    request: {
      prompt: args.prompt,
      stream: true,
      trackHistory: true,
      ...args.request,
    },
  });
}

export function summarizeSurfaceCapabilityGaps(
  capabilities: SurfaceCapabilities,
  required: Partial<Record<keyof SurfaceCapabilities, string>>,
): string[] {
  const gaps: string[] = [];
  for (const [key, label] of Object.entries(required) as [keyof SurfaceCapabilities, string][]) {
    if (capabilities[key] !== true) gaps.push(label);
  }
  return gaps;
}

export function isAgentCommand(value: unknown): value is AgentCommand {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { commandId?: unknown }).commandId === 'string';
}
