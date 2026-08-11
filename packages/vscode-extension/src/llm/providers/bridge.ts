/**
 * Bridge Provider — 封装现有浏览器自动化 Bridge
 * 将 bridge-client.ts 的 chat() 适配到 LLMProvider 接口
 */
import * as vscode from 'vscode';
import { knownCodingProviderCapabilities } from '@devseek-netai/shared';
import { LLMProvider, LLMProviderType, LLMChatOptions } from '../types';
import * as bridgeClient from '../../bridge-client';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  isProviderOutputFatal,
} from '../../agent/provider-output-integrity';
import { BridgeHealthMonitor, ResponseIntegrityChecker } from './web-reliability';
import {
  prepareBridgePromptForSession,
  recordBridgePromptSessionResponse,
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
    // Bridge accepts one prompt string. For DeepSeek Web, the browser session
    // already retains earlier turns, so subsequent Agent rounds send only
    // incremental context when the trace/run key proves it is the same task.
    const preparedPrompt = prepareBridgePromptForSession({
      messages: opts.messages,
      newSession: opts.newSession,
      traceRunId: opts.traceRunId,
      traceWorkspaceRoot: opts.traceWorkspaceRoot,
    });
    const cfg = vscode.workspace.getConfiguration('devseek');
    const response = await bridgeClient.chat({
      prompt: preparedPrompt.prompt,
      // Resetting DeepSeek's browser-side conversation is a top-level task
      // boundary decision. Agent loops call the provider several times inside
      // one task, and those rounds must stay in the same web conversation.
      newSession: opts.newSession ?? false,
      stream: opts.stream !== false,
      onDelta: opts.onDelta,
      timeoutMs: opts.timeoutMs ?? cfg.get<number>('requestTimeoutMs', 120000),
      mode: opts.mode,
      files: opts.files,
      traceRunId: opts.traceRunId,
      traceWorkspaceRoot: opts.traceWorkspaceRoot,
      traceOperationId: opts.traceOperationId,
      traceEvidenceParticipantToken: opts.evidenceCapability?.token,
      signal: opts.signal,
    });
    new ResponseIntegrityChecker().assertSafeForExecution(response);
    const providerOutput = classifyProviderOutputIntegrity(response);
    if (isProviderOutputFatal(providerOutput.kind)) {
      throw new Error(`RESPONSE_CORRUPTED:${providerOutput.kind}:${describeProviderOutputIntegrity(providerOutput.kind)}`);
    }
    if (providerOutput.kind === 'tool_call' || providerOutput.kind === 'complete_answer') {
      recordBridgePromptSessionResponse({
        messages: opts.messages,
        newSession: opts.newSession,
        traceRunId: opts.traceRunId,
        traceWorkspaceRoot: opts.traceWorkspaceRoot,
      }, response);
    }
    return response;
  }
}
