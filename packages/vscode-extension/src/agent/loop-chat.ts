import * as crypto from 'crypto';
import type { CodingToolCall } from '@devseek-netai/shared';
import { getActiveProvider } from '../llm/provider-router';
import { type ChatMessage } from '../llm/types';
import {
  normalizeProviderMessage,
  type ProviderNormalizationBoundary,
} from '../llm/provider-events';
import { invokeProviderWithRunEvidence } from '../app/provider-run-evidence';
export { consumeUserSteerMessages } from './user-steer';

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
  const provider = getActiveProvider();
  const traceOperationId = crypto.randomUUID();
  const text = await invokeProviderWithRunEvidence({
    request: {
      prompt: JSON.stringify(messages),
      traceRunId,
      traceWorkspaceRoot,
      traceOperationId,
      traceEvidenceParticipantToken,
    },
    providerType: provider.type,
    onEvidenceError: onTraceEvidenceError,
    invoke: () => provider.chat({
      messages,
      stream: true,
      onDelta,
      mode,
      signal,
      newSession,
      traceRunId,
      traceWorkspaceRoot,
      traceOperationId,
      ...(provider.type === 'bridge' && traceEvidenceParticipantToken
        ? { evidenceCapability: { role: 'participant' as const, token: traceEvidenceParticipantToken } }
        : {}),
    }),
  });
  const normalized = normalizeProviderMessage({
    type: 'message',
    provider: provider.type,
    content: text,
    ...(traceRunId ? { workflowId: traceRunId } : {}),
  }, normalization);
  return { text: normalized.event.type === 'message' ? normalized.event.content : text, tools: [...normalized.tools] };
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
  const provider = getActiveProvider();
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  const traceOperationId = crypto.randomUUID();
  const text = await invokeProviderWithRunEvidence({
    request: {
      prompt,
      traceRunId,
      traceWorkspaceRoot,
      traceOperationId,
      traceEvidenceParticipantToken,
    },
    providerType: provider.type,
    onEvidenceError: onTraceEvidenceError,
    invoke: () => provider.chat({
      messages,
      stream: true,
      onDelta,
      mode,
      signal,
      newSession,
      traceRunId,
      traceWorkspaceRoot,
      traceOperationId,
      ...(provider.type === 'bridge' && traceEvidenceParticipantToken
        ? { evidenceCapability: { role: 'participant' as const, token: traceEvidenceParticipantToken } }
        : {}),
    }),
  });
  const normalized = normalizeProviderMessage({
    type: 'message',
    provider: provider.type,
    content: text,
    ...(traceRunId ? { workflowId: traceRunId } : {}),
  }, normalization);
  return { text: normalized.event.type === 'message' ? normalized.event.content : text, tools: [...normalized.tools] };
}
