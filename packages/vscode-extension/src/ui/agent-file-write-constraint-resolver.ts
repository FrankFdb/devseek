import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { CodingToolSurfaceConstraint, DevSeekTraceLogger } from '@devseek-netai/shared';
import { isFileProtected } from '../protected-files';
import {
  decideAgentFileWrite,
  projectAgentFileWriteConstraint,
  type AgentFileWriteContext,
} from '../app/agent-file-write-policy';
import type { ToolPolicy } from '../app/permission-service';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import { postWebviewMessage } from './webview-event-adapter';

export interface AgentFileWriteConstraintInput {
  webview: vscode.Webview;
  absPath: string;
  context?: AgentFileWriteContext;
  workspaceRoot?: string;
  toolPolicy: ToolPolicy;
  trace?: DevSeekTraceLogger;
}

/** Owns the UI confirmation and returns evidence, never final execution authority. */
export function createAgentFileWriteConstraintResolver(
  terminalPermissions: Pick<TerminalPermissionCoordinator, 'requestInlineConfirmation'>,
): (input: AgentFileWriteConstraintInput) => Promise<CodingToolSurfaceConstraint> {
  return async (input) => {
    const autopilotMode = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
    const protectedPath = isFileProtected(input.absPath, input.workspaceRoot || '');
    const decision = decideAgentFileWrite({
      absPath: input.absPath,
      workspaceRoot: input.workspaceRoot,
      toolPolicy: input.toolPolicy,
      autopilotMode,
      protectedPath,
      context: input.context,
    });
    input.trace?.info('file-write-policy', 'file-write-decision', {
      action: decision.action,
      reason: decision.reason,
      absPath: input.absPath,
      workspaceRoot: input.workspaceRoot,
      toolPolicyMode: input.toolPolicy.mode,
      context: input.context,
      autopilotMode,
      protectedPath,
      audit: decision.audit,
    });

    if (decision.action === 'allow') return projectAgentFileWriteConstraint(decision);
    if (decision.action === 'deny') {
      postWebviewMessage(input.webview, {
        type: 'agentNotice',
        kind: 'warn',
        text: decision.notice || `写入被权限策略阻止：${decision.reason}`,
      });
      return projectAgentFileWriteConstraint(decision);
    }

    const confirmation = await terminalPermissions.requestInlineConfirmation(
      input.webview,
      decision.confirmationTitle || `确认写入文件：${nodePath.basename(input.absPath)}`,
    );
    return projectAgentFileWriteConstraint(decision, confirmation.allow ? confirmation.confirmationRef : undefined);
  };
}
