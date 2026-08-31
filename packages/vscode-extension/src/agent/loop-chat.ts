import * as crypto from 'crypto';
import {
  createDevSeekTraceLogger,
  measureProviderMessagePrompt,
  summarizeTraceText,
  type CodingToolCall,
  type LLMProviderSessionResetEvent,
} from '@devseek-netai/shared';
import { getActiveProvider } from '../llm/provider-router';
import { type ChatMessage } from '../llm/types';
import {
  normalizeProviderMessage,
  type ProviderNormalizationBoundary,
} from '../llm/provider-events';
import { invokeProviderWithRunEvidence } from '../app/provider-run-evidence';
import {
  ProviderInvocationRetryService,
  type ProviderInvocationRetryEvent,
} from '../app/provider-invocation-retry';
import { providerErrorText } from '../llm/provider-transport-error';
import { assertProviderTurnIntegrity } from './provider-turn-integrity';
export { consumeUserSteerMessages } from './user-steer';

interface LoopChatInput {
  messages: ChatMessage[];
  evidencePrompt: string;
  mode: 'fast' | 'r1' | undefined;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  newSession: boolean;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  traceEvidenceParticipantToken?: string;
  onTraceEvidenceError?: (error: unknown) => void;
  normalization?: ProviderNormalizationBoundary;
  onProviderSessionReset?: (event: LLMProviderSessionResetEvent) => void;
}

const providerInvocationRetry = new ProviderInvocationRetryService();

export async function chatWithMessages(
  messages: ChatMessage[],
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession = false,
  traceRunId?: string,
  traceWorkspaceRoot?: string,
  traceEvidenceParticipantToken?: string,
  onTraceEvidenceError?: (error: unknown) => void,
  normalization?: ProviderNormalizationBoundary,
  onProviderSessionReset?: (event: LLMProviderSessionResetEvent) => void,
): Promise<{ text: string; tools: CodingToolCall[]; providerOperationId?: string }> {
  return invokeLoopChat({
    messages,
    evidencePrompt: JSON.stringify(messages),
    mode,
    onDelta,
    signal,
    newSession,
    traceRunId,
    traceWorkspaceRoot,
    traceEvidenceParticipantToken,
    onTraceEvidenceError,
    normalization,
    onProviderSessionReset,
  });
}

export async function chatViaProvider(
  prompt: string,
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  history?: ChatMessage[],
  signal?: AbortSignal,
  newSession = false,
  traceRunId?: string,
  traceWorkspaceRoot?: string,
  traceEvidenceParticipantToken?: string,
  onTraceEvidenceError?: (error: unknown) => void,
  normalization?: ProviderNormalizationBoundary,
  onProviderSessionReset?: (event: LLMProviderSessionResetEvent) => void,
): Promise<{ text: string; tools: CodingToolCall[]; providerOperationId?: string }> {
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  return invokeLoopChat({
    messages,
    evidencePrompt: prompt,
    mode,
    onDelta,
    signal,
    newSession,
    traceRunId,
    traceWorkspaceRoot,
    traceEvidenceParticipantToken,
    onTraceEvidenceError,
    normalization,
    onProviderSessionReset,
  });
}

async function invokeLoopChat(input: LoopChatInput): Promise<{
  text: string;
  tools: CodingToolCall[];
  providerOperationId?: string;
}> {
  const provider = getActiveProvider();
  const samplingId = crypto.randomUUID();
  const promptBudget = measureProviderMessagePrompt(input.messages);
  let providerOperationId: string | undefined;
  const text = await providerInvocationRetry.execute({
    providerType: provider.type,
    signal: input.signal,
    invoke: async ({ attempt, markOutputObserved }) => {
      const traceOperationId = crypto.randomUUID();
      return invokeProviderWithRunEvidence({
        request: {
          prompt: input.evidencePrompt,
          signal: input.signal,
          traceRunId: input.traceRunId,
          traceWorkspaceRoot: input.traceWorkspaceRoot,
          traceOperationId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
        },
        providerType: provider.type,
        samplingId,
        transportAttempt: attempt,
        promptBudget,
        onEvidenceError: input.onTraceEvidenceError,
        onCompleted: operationId => { providerOperationId = operationId; },
        invoke: observation => provider.chat({
          messages: input.messages,
          stream: true,
          onDelta: (delta) => {
            if (delta.length > 0) markOutputObserved();
            observation.observeOutput(delta);
            input.onDelta?.(delta);
          },
          mode: input.mode,
          signal: input.signal,
          newSession: input.newSession,
          onProviderSessionReset: input.onProviderSessionReset,
          traceRunId: input.traceRunId,
          traceWorkspaceRoot: input.traceWorkspaceRoot,
          traceOperationId,
          traceSamplingId: samplingId,
          traceTransportAttempt: attempt,
          ...(provider.type === 'bridge' && input.traceEvidenceParticipantToken
            ? { evidenceCapability: { role: 'participant' as const, token: input.traceEvidenceParticipantToken } }
            : {}),
        }),
      });
    },
    onRetry: event => traceProviderRetry(input, event, samplingId),
  });
  const normalized = normalizeProviderMessage({
    type: 'message',
    provider: provider.type,
    content: text,
    ...(input.traceRunId ? { workflowId: input.traceRunId } : {}),
  }, input.normalization);
  const normalizedText = normalized.event.type === 'message' ? normalized.event.content : text;
  const tools = [...normalized.tools];
  assertProviderTurnIntegrity(normalizedText, { toolCallCount: tools.length });
  return { text: normalizedText, tools, ...(providerOperationId ? { providerOperationId } : {}) };
}

function traceProviderRetry(input: LoopChatInput, event: ProviderInvocationRetryEvent, samplingId: string): void {
  if (!input.traceRunId || !input.traceWorkspaceRoot) return;
  const trace = createDevSeekTraceLogger({
    workspaceRoot: input.traceWorkspaceRoot,
    source: 'vscode-extension.provider-retry',
    level: 'debug',
    runId: input.traceRunId,
  });
  trace.info('provider-retry', 'provider-transport-retry-scheduled', {
    samplingId,
    attempt: event.attempt,
    nextAttempt: event.nextAttempt,
    delayMs: event.delayMs,
    error: summarizeTraceText(providerErrorText(event.error)),
  });
}
