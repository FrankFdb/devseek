import * as vscode from 'vscode';
import {
  createChatRequestCommand,
  detectPlatformProfile,
  VSCODE_SURFACE_CAPABILITIES,
  type AgentEvent,
  type ChatRequestCommand,
  type PlatformProfile,
  type SurfaceAdapter,
  type SurfaceChatInput,
  type SurfaceCapabilities,
} from '@devseek-netai/shared';
import { postWebviewMessage } from './webview-event-adapter';

export class VSCodeSurfaceAdapter implements SurfaceAdapter {
  readonly kind = 'vscode' as const;
  readonly capabilities: SurfaceCapabilities = VSCODE_SURFACE_CAPABILITIES;
  readonly platform: PlatformProfile;

  constructor(private readonly getWebview: () => vscode.Webview | undefined = () => undefined) {
    this.platform = detectPlatformProfile({
      platform: process.platform,
      env: process.env,
      shellPath: process.env.SHELL ?? process.env.ComSpec,
      workspaceKind: vscode.env.remoteName
        ? vscode.env.remoteName.includes('wsl') ? 'wsl' : 'remote'
        : 'local',
    });
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
    const webview = this.getWebview();
    if (!webview) return;
    if (event.type === 'chat.delta') {
      postWebviewMessage(webview, { type: 'delta', text: event.delta });
    } else if (event.type === 'error') {
      postWebviewMessage(webview, { type: 'error', text: event.message });
    }
  }
}
