/**
 * Bridge Provider — 封装现有浏览器自动化 Bridge
 * 将 bridge-client.ts 的 chat() 适配到 LLMProvider 接口
 */
import * as vscode from 'vscode';
import { knownCodingProviderCapabilities } from '@devseek-netai/shared';
import { LLMProvider, LLMProviderType, LLMChatOptions } from '../types';
import * as bridgeClient from '../../bridge-client';
import { isBridgeRuntimeChangedError } from '../../bridge-runtime-continuity';
import { assertProviderTurnIntegrity } from '../../agent/provider-turn-integrity';
import { BridgeHealthMonitor, ResponseIntegrityChecker } from './web-reliability';
import {
  prepareBridgePromptForSession,
  recordBridgePromptSessionRequest,
} from './bridge-prompt-session';

export class BridgeProvider implements LLMProvider {
  readonly type: LLMProviderType = 'bridge';
  readonly displayName = '$(globe) 网页';
  readonly capabilities = knownCodingProviderCapabilities('bridge');

  async available(): Promise<boolean> {
    try {
      return new BridgeHealthMonitor().evaluate(await bridgeClient.status()).canSendPrompt;
    } catch {
      return false;
    }
  }

  async chat(opts: LLMChatOptions): Promise<string> {
    const cfg = vscode.workspace.getConfiguration('devseek');
    for (let continuityAttempt = 0; continuityAttempt < 2; continuityAttempt++) {
      if (!await bridgeClient.ensureBridgeRunning()) {
        throw new Error('BRIDGE_CONNECTOR_UNAVAILABLE: Bridge capability negotiation failed.');
      }
      const providerSessionId = bridgeClient.getBridgeRuntimeInstanceId();
      // Incremental prompts are valid only while both the logical turn and the
      // concrete browser-owning Bridge instance remain unchanged.
      const preparedPrompt = prepareBridgePromptForSession({
        messages: opts.messages,
        newSession: opts.newSession,
        traceRunId: opts.traceRunId,
        traceWorkspaceRoot: opts.traceWorkspaceRoot,
        providerSessionId,
      });
      const resetsBrowserSession = Boolean(opts.newSession || preparedPrompt.resetBrowserSession);
      if (resetsBrowserSession) {
        opts.onProviderSessionReset?.({
          reason: opts.newSession ? 'requested' : 'provider-context-rebuild',
        });
      }
      try {
        const response = await bridgeClient.chat({
          prompt: preparedPrompt.prompt,
          newSession: resetsBrowserSession,
          stream: opts.stream !== false,
          onDelta: opts.onDelta,
          timeoutMs: opts.timeoutMs ?? cfg.get<number>('requestTimeoutMs', 120000),
          mode: opts.mode,
          files: opts.files,
          traceRunId: opts.traceRunId,
          traceWorkspaceRoot: opts.traceWorkspaceRoot,
          traceOperationId: opts.traceOperationId,
          traceSamplingId: opts.traceSamplingId,
          traceTransportAttempt: opts.traceTransportAttempt,
          traceEvidenceParticipantToken: opts.evidenceCapability?.token,
          signal: opts.signal,
        });
        new ResponseIntegrityChecker().assertSafeForExecution(response);
        assertProviderTurnIntegrity(response);
        recordBridgePromptSessionRequest({
          messages: opts.messages,
          newSession: opts.newSession,
          traceRunId: opts.traceRunId,
          traceWorkspaceRoot: opts.traceWorkspaceRoot,
          providerSessionId,
        });
        return response;
      } catch (error) {
        if (continuityAttempt === 0 && isBridgeRuntimeChangedError(error)) continue;
        throw error;
      }
    }
    throw new Error('BRIDGE_RUNTIME_CHANGED: Bridge process changed repeatedly before submission.');
  }
}
