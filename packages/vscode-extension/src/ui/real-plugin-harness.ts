import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { DeepSeekViewProvider } from './deepseek-view-provider';

type HarnessViewProvider = Pick<
  DeepSeekViewProvider,
  'focus' | 'webview' | 'submitHarnessChatMessage' | 'submitHarnessAgentSteer'
>;
type HarnessSessionMeta = { readonly id: string; readonly title: string };
type HarnessSessionControls = {
  readonly getActiveSessionId: () => string;
  readonly getSessions: () => readonly HarnessSessionMeta[];
  readonly loadSession: (webview: vscode.Webview, sessionId: string) => Promise<void>;
  readonly getSteeringSnapshot?: () => unknown;
};
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
  sessionControls?: HarnessSessionControls,
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
    '_devseek.harnessSubmitAgentSteer',
    async (instruction: string, expectedRunId?: string, steeringId?: string) => {
      recordRealPluginHarnessProgress('extension-command-steering-started', { steeringId });
      viewProvider.focus();
      const webview = await waitForHarnessWebview(() => viewProvider.webview, 30_000);
      if (!webview) throw new Error('DevSeek harness could not resolve the chat webview for steering within 30s');
      const submission = await viewProvider.submitHarnessAgentSteer({
        type: 'agentSteer',
        text: instruction,
        prompt: instruction,
        expectedRunId,
        submissionId: steeringId,
      });
      recordRealPluginHarnessProgress('extension-command-steering-completed', submission);
      return submission;
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

  if (sessionControls) {
    context.subscriptions.push(vscode.commands.registerCommand(
      '_devseek.harnessSessionSnapshot',
      () => snapshotHarnessSessions(sessionControls),
    ));
    context.subscriptions.push(vscode.commands.registerCommand(
      '_devseek.harnessLoadSession',
      async (sessionId: string) => {
        const requestedId = String(sessionId || '').trim();
        if (!requestedId || !sessionControls.getSessions().some(session => session.id === requestedId)) {
          throw new Error('DevSeek harness cannot load an unknown session');
        }
        viewProvider.focus();
        const webview = await waitForHarnessWebview(() => viewProvider.webview, 30_000);
        if (!webview) throw new Error('DevSeek harness could not resolve the chat webview within 30s');
        await sessionControls.loadSession(webview, requestedId);
        recordRealPluginHarnessProgress('extension-command-session-loaded', { sessionId: requestedId });
        return snapshotHarnessSessions(sessionControls);
      },
    ));
    if (sessionControls.getSteeringSnapshot) {
      context.subscriptions.push(vscode.commands.registerCommand(
        '_devseek.harnessSteeringSnapshot',
        () => sessionControls.getSteeringSnapshot?.(),
      ));
    }
  }
}

function snapshotHarnessSessions(sessionControls: HarnessSessionControls): {
  activeSessionId: string;
  sessions: readonly HarnessSessionMeta[];
} {
  return {
    activeSessionId: sessionControls.getActiveSessionId(),
    sessions: sessionControls.getSessions().map(session => ({ id: session.id, title: session.title })),
  };
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
