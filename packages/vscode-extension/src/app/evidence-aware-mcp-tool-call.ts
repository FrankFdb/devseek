import * as vscode from 'vscode';
import type { McpManager } from '../mcp/client';
import type { DevSeekRunContext } from './run-context';
import type { TerminalPermissionCoordinator } from './terminal-permission-coordinator';
import { ProductMutationCoordinator } from './product-mutation-coordinator';
import { adaptPreparedProductTool } from './prepared-product-tool-adapter';
import type { AgentLoopCallbacks } from '../agent/loop-types';
import type {
  CodingMcpToolCallReceipt,
} from '@devseek-netai/shared';

type PrepareMcpToolCall = NonNullable<AgentLoopCallbacks['onPrepareMcpToolCall']>;

export function createEvidenceAwareMcpToolCallFactory(deps: {
  terminalPermissions: Pick<TerminalPermissionCoordinator, 'requestInlineConfirmation'>;
  mcpManager: Pick<McpManager, 'prepareToolCall' | 'authorizeToolCall' | 'callTool'>;
}): (
  runContext: DevSeekRunContext,
  webview: vscode.Webview,
  signal?: AbortSignal,
) => PrepareMcpToolCall {
  return (runContext, webview, signal) => {
    const mutations = new ProductMutationCoordinator(runContext, 'vscode-mcp');
    return async (fakeName, args) => {
      const authorityRequest = deps.mcpManager.prepareToolCall(fakeName, args);
      let authorityReceipt: CodingMcpToolCallReceipt | undefined;
      const prepared = await mutations.prepare({
        kind: 'mcp-tool',
        label: `mcp:${fakeName}:${authorityRequest.risk}`,
        authorize: async () => {
          if (!authorityRequest.requiresUserConfirmation) {
            authorityReceipt = deps.mcpManager.authorizeToolCall(authorityRequest, {
              decision: 'allow',
              actor: 'host-policy',
              reason: 'session-approved-read-only-mcp-tool-call',
              evidenceRef: `mcp-session-registration:${authorityRequest.registrationSha256}`,
            });
            return {
              allowed: true,
              source: 'execution-policy',
              reason: authorityReceipt.reason,
            };
          }
          const decision = await deps.terminalPermissions.requestInlineConfirmation(
            webview,
            `MCP ${authorityRequest.risk}: ${fakeName}`,
          );
          authorityReceipt = deps.mcpManager.authorizeToolCall(authorityRequest, {
            decision: decision.allow ? 'allow' : 'deny',
            actor: decision.allow || !decision.reason ? 'user' : 'host-policy',
            reason: decision.allow
              ? 'user-approved-visible-mcp-tool-call'
              : decision.reason ?? 'user-rejected-mcp-tool-call',
            ...(decision.confirmationRef ? { evidenceRef: decision.confirmationRef } : {}),
          });
          return {
            allowed: decision.allow,
            source: 'user-confirmed',
            reason: authorityReceipt.reason,
          };
        },
        invoke: () => {
          if (!authorityReceipt || authorityReceipt.decision !== 'allow') {
            throw new Error('mcp-tool-call:missing-user-authority-receipt');
          }
          return deps.mcpManager.callTool(authorityRequest, authorityReceipt, { signal });
        },
        completionEvidence: {
          kind: 'invocation-receipt',
          proof: () => ({
            tool_name: fakeName,
            authority_request_sha256: authorityRequest.requestSha256,
            authority_receipt_version: authorityReceipt?.version ?? null,
            receipt: 'official-mcp-sdk-call-resolved',
          }),
        },
      });
      return adaptPreparedProductTool({
        prepared,
        constraintRef: `mcp-tool-constraint:${runContext.runId}:${authorityRequest.callId}`,
        completedEvidenceRef: `mcp-tool-result:${runContext.runId}:${authorityRequest.callId}`,
        formatResult: result => result,
      });
    };
  };
}
