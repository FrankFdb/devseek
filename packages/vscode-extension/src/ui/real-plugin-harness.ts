import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { DeepSeekViewProvider } from './deepseek-view-provider';

type HarnessViewProvider = Pick<DeepSeekViewProvider, 'focus' | 'webview' | 'submitHarnessChatMessage'>;
type HarnessRunChat = (
  webview: vscode.Webview,
  userDisplay: string,
  prompt: string,
  newSession: boolean,
  mode?: 'fast' | 'r1',
  files?: string[],
  forceNoAgent?: boolean,
  resumeFromIndex?: number,
  resumeTasks?: never[],
  images?: string[],
  intentConfirmed?: boolean,
) => Promise<void>;

export function registerRealPluginDeepSeekHarnessCommand(
  context: vscode.ExtensionContext,
  viewProvider: HarnessViewProvider,
  runChat: HarnessRunChat,
): void {
  if (process.env.DEVSEEK_REAL_PLUGIN_DEEPSEEK !== '1') return;

  context.subscriptions.push(vscode.commands.registerCommand(
    '_devseek.harnessRunChat',
    async (userDisplay: string, prompt: string, newSession: boolean, mode?: 'fast' | 'r1') => {
      recordRealPluginHarnessProgress('extension-command-started');
      viewProvider.focus();
      const webview = await waitForHarnessWebview(() => viewProvider.webview, 30_000);
      recordRealPluginHarnessProgress('extension-command-webview-resolved', { hasWebview: !!webview });
      if (!webview) throw new Error('DevSeek harness could not resolve the chat webview within 30s');
      const harnessMode = mode === 'r1' ? 'r1' : 'fast';
      recordRealPluginHarnessProgress('extension-command-run-chat-started', { mode: harnessMode });
      await runChat(webview, userDisplay, prompt, newSession, harnessMode, undefined, undefined, undefined, undefined, undefined, true);
      recordRealPluginHarnessProgress('extension-command-run-chat-completed');
    },
  ));

  context.subscriptions.push(vscode.commands.registerCommand(
    '_devseek.harnessSubmitChatMessage',
    async (userDisplay: string, prompt: string, newSession: boolean, mode?: 'fast' | 'r1') => {
      recordRealPluginHarnessProgress('extension-command-started', { route: 'webview-message' });
      viewProvider.focus();
      const webview = await waitForHarnessWebview(() => viewProvider.webview, 30_000);
      recordRealPluginHarnessProgress('extension-command-webview-resolved', { hasWebview: !!webview, route: 'webview-message' });
      if (!webview) throw new Error('DevSeek harness could not resolve the chat webview within 30s');
      const harnessMode = mode === 'r1' ? 'r1' : 'fast';
      recordRealPluginHarnessProgress('extension-command-submit-chat-started', { mode: harnessMode, route: 'webview-message' });
      await viewProvider.submitHarnessChatMessage({
        type: 'chat',
        text: userDisplay,
        prompt,
        newSession,
        mode: harnessMode,
        intentConfirmed: true,
      });
      recordRealPluginHarnessProgress('extension-command-submit-chat-completed', { route: 'webview-message' });
    },
  ));
}

export function recordRealPluginHarnessProgress(stage: string, extra?: Record<string, unknown>): void {
  const progressPath = process.env.DEVSEEK_REAL_PLUGIN_PROGRESS_PATH;
  if (!progressPath) return;
  try {
    fs.mkdirSync(nodePath.dirname(progressPath), { recursive: true });
    fs.appendFileSync(progressPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      stage,
      ...(extra ?? {}),
    })}\n`, 'utf8');
  } catch {
    // Harness diagnostics must never affect production or test execution.
  }
}

async function waitForHarnessWebview(
  getWebview: () => vscode.Webview | undefined,
  timeoutMs: number,
): Promise<vscode.Webview | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const webview = getWebview();
    if (webview) return webview;
    await new Promise<void>(resolve => setTimeout(resolve, 250));
  }
  return getWebview();
}
