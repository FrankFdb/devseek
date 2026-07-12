import * as vscode from 'vscode';
import type { McpManager } from '../mcp/client';
import type { DevSeekRunContext } from './run-context';
import type { TerminalPermissionCoordinator } from './terminal-permission-coordinator';
import { ProductMutationCoordinator } from './product-mutation-coordinator';

type McpToolCall = (fakeName: string, args: Record<string, unknown>) => Promise<string>;

export function createEvidenceAwareMcpToolCallFactory(deps: {
  terminalPermissions: Pick<TerminalPermissionCoordinator, 'requestInlineConfirmation'>;
  mcpManager: Pick<McpManager, 'callTool'>;
}): (runContext: DevSeekRunContext, webview: vscode.Webview) => McpToolCall {
  return (runContext, webview) => {
    const mutations = new ProductMutationCoordinator(runContext, 'vscode-mcp');
    return async (fakeName, args) => mutations.run({
      kind: 'mcp-tool',
      label: `mcp:${fakeName}`,
      authorize: async () => {
        if (vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false)) {
          return { allowed: true, source: 'execution-policy' };
        }
        const decision = await deps.terminalPermissions.requestInlineConfirmation(webview, `MCP: ${fakeName}`);
        return { allowed: decision.allow, source: 'user-confirmed', reason: decision.reason };
      },
      invoke: () => deps.mcpManager.callTool(fakeName, args),
      completionEvidence: {
        kind: 'invocation-receipt',
        proof: () => ({
          tool_name: fakeName,
          receipt: 'mcp-json-rpc-call-resolved',
        }),
      },
    });
  };
}
