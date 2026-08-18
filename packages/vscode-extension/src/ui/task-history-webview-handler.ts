import * as vscode from 'vscode';
import { TaskHistoryUiService } from '../app/task-history-ui-service';
import { postWebviewMessage } from './webview-event-adapter';
import type { WebviewInboundMessage } from './webview-protocol';

export async function handleTaskHistoryWebviewMessage(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  message: WebviewInboundMessage,
): Promise<void> {
  const service = new TaskHistoryUiService(context.workspaceState, {
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  });
  for (const response of await service.handle(message)) postWebviewMessage(webview, response);
}
