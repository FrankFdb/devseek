import * as crypto from 'crypto';
import {
  createDevSeekTraceLogger,
  summarizeTraceText,
  type CodingToolCall,
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
): Promise<{ text: string; tools: CodingToolCall[] }> {
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
): Promise<{ text: string; tools: CodingToolCall[] }> {
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
  });
}

async function invokeLoopChat(input: LoopChatInput): Promise<{ text: string; tools: CodingToolCall[] }> {
  const provider = getActiveProvider();
  const text = await providerInvocationRetry.execute({
    providerType: provider.type,
    signal: input.signal,
    invoke: async ({ markOutputObserved }) => {
      const traceOperationId = crypto.randomUUID();
      return invokeProviderWithRunEvidence({
        request: {
          prompt: input.evidencePrompt,
          traceRunId: input.traceRunId,
          traceWorkspaceRoot: input.traceWorkspaceRoot,
          traceOperationId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken,
        },
        providerType: provider.type,
        onEvidenceError: input.onTraceEvidenceError,
        invoke: () => provider.chat({
          messages: input.messages,
          stream: true,
          onDelta: (delta) => {
            if (delta.length > 0) markOutputObserved();
            input.onDelta?.(delta);
          },
          mode: input.mode,
          signal: input.signal,
          newSession: input.newSession,
          traceRunId: input.traceRunId,
          traceWorkspaceRoot: input.traceWorkspaceRoot,
          traceOperationId,
          ...(provider.type === 'bridge' && input.traceEvidenceParticipantToken
            ? { evidenceCapability: { role: 'participant' as const, token: input.traceEvidenceParticipantToken } }
            : {}),
        }),
      });
    },
    onRetry: event => traceProviderRetry(input, event),
  });
  const normalized = normalizeProviderMessage({
    type: 'message',
    provider: provider.type,
    content: text,
    ...(input.traceRunId ? { workflowId: input.traceRunId } : {}),
  }, input.normalization);
  return { text: normalized.event.type === 'message' ? normalized.event.content : text, tools: [...normalized.tools] };
}

function traceProviderRetry(input: LoopChatInput, event: ProviderInvocationRetryEvent): void {
  if (!input.traceRunId || !input.traceWorkspaceRoot) return;
  const trace = createDevSeekTraceLogger({
    workspaceRoot: input.traceWorkspaceRoot,
    source: 'vscode-extension.provider-retry',
    level: 'debug',
    runId: input.traceRunId,
  });
  trace.info('provider-retry', 'provider-transport-retry-scheduled', {
    attempt: event.attempt,
    nextAttempt: event.nextAttempt,
    delayMs: event.delayMs,
    error: summarizeTraceText(providerErrorText(event.error)),
  });
}
