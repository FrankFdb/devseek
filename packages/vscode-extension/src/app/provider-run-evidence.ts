import * as crypto from 'crypto';

import {
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type AgentChatRequest,
  type LLMProviderType,
} from '@devseek-netai/shared';

export interface ProviderRunEvidenceInput {
  request: AgentChatRequest;
  providerType: LLMProviderType;
  invoke: () => Promise<string>;
  newOperationId?: () => string;
  onEvidenceError?: (error: unknown) => void;
}

/**
 * Records the provider boundary for both direct API providers and the bridge
 * client. The bridge server writes its own participant events into the same
 * run, so transport and actual web-provider facts remain distinguishable.
 */
export async function invokeProviderWithRunEvidence(input: ProviderRunEvidenceInput): Promise<string> {
  const operationId = input.request.traceOperationId?.trim() || (input.newOperationId ?? crypto.randomUUID)();
  const evidence = attachEvidence(input);
  record(evidence, input, 'provider.requested', operationId, {
    provider: input.providerType,
    layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
    prompt: summarizeTraceText(input.request.prompt),
    file_count: input.request.files?.length ?? 0,
  });
  try {
    const response = await input.invoke();
    record(evidence, input, 'provider.completed', operationId, {
      provider: input.providerType,
      layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
      response: summarizeTraceText(response),
    });
    if (input.providerType === 'bridge') {
      assertBridgeParticipantTerminal(evidence, operationId, 'provider.completed', input);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(evidence, input, 'provider.failed', operationId, {
      provider: input.providerType,
      layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
      error: summarizeTraceText(message),
    });
    if (input.providerType === 'bridge') {
      assertBridgeParticipantTerminal(evidence, operationId, 'provider.failed', input);
    }
    throw error;
  }
}

function attachEvidence(input: ProviderRunEvidenceInput): ProductRunEvidenceSession | undefined {
  const runId = input.request.traceRunId?.trim();
  const workspaceRoot = input.request.traceWorkspaceRoot?.trim();
  const authorityToken = input.request.traceEvidenceParticipantToken?.trim();
  if (!runId || !workspaceRoot) return undefined;
  if (!authorityToken) {
    input.onEvidenceError?.(new Error('Run evidence participant authority is missing'));
    return undefined;
  }
  try {
    return ProductRunEvidenceSession.forWorkspace({
      workspaceRoot,
      runId,
      surface: 'vscode-provider',
      authority: { role: 'participant', token: authorityToken },
    });
  } catch (error) {
    input.onEvidenceError?.(error);
    return undefined;
  }
}

function record(
  evidence: ProductRunEvidenceSession | undefined,
  input: ProviderRunEvidenceInput,
  type: 'provider.requested' | 'provider.completed' | 'provider.failed',
  operationId: string,
  payload: import('@devseek-netai/shared').RunEvidenceJson,
): void {
  if (!evidence) return;
  try {
    evidence.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-${type}`, {
        runId: evidence.runId,
        operationId,
      }),
      payload: {
        ...(payload as Record<string, import('@devseek-netai/shared').RunEvidenceJson>),
        operation_id: operationId,
        boundary: 'vscode-provider-client',
        status: type.slice('provider.'.length),
        trust: 'product-runtime-observation',
      },
    });
  } catch (error) {
    input.onEvidenceError?.(error);
  }
}

function assertBridgeParticipantTerminal(
  evidence: ProductRunEvidenceSession | undefined,
  operationId: string,
  expectedTerminal: 'provider.completed' | 'provider.failed',
  input: ProviderRunEvidenceInput,
): void {
  if (!evidence) return;
  try {
    const matching = evidence.readEvents().filter(event => {
      if (!event.type.startsWith('provider.')) return false;
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
      return event.payload.operation_id === operationId && event.payload.boundary === 'bridge-server';
    });
    const requested = matching.filter(event => event.type === 'provider.requested').length;
    const terminal = matching.filter(event => event.type === 'provider.completed' || event.type === 'provider.failed').length;
    if (requested !== 1 || terminal !== 1 || matching.at(-1)?.type !== expectedTerminal) {
      throw new Error(
        `Bridge evidence boundary is incomplete for operation ${operationId}; expected ${expectedTerminal}`,
      );
    }
  } catch (error) {
    input.onEvidenceError?.(error);
  }
}
