import * as crypto from 'crypto';

import {
  ProductRunEvidenceSession,
  ProviderEfficiencyProfiler,
  measureProviderTextPrompt,
  productRunEvidenceIdempotencyKey,
  providerEfficiencyEvidence,
  providerPromptBudgetEvidence,
  requireProviderAttempt,
  requireProviderCorrelationId,
  summarizeTraceText,
  type AgentChatRequest,
  type LLMProviderType,
  type ProviderEfficiencyProfile,
  type ProviderPromptBudgetSnapshot,
} from '@devseek-netai/shared';

export interface ProviderInvocationObservation {
  observeOutput(delta: string): void;
}

export interface ProviderRunEvidenceInput {
  request: AgentChatRequest;
  providerType: LLMProviderType;
  invoke: (observation: ProviderInvocationObservation) => Promise<string>;
  samplingId?: string;
  transportAttempt?: number;
  promptBudget?: ProviderPromptBudgetSnapshot;
  now?: () => number;
  newOperationId?: () => string;
  onEvidenceError?: (error: unknown) => void;
  onCompleted?: (operationId: string) => void;
}

export const BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP = 'BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP';
const PROVIDER_RUN_EVIDENCE_OPERATION_ID: unique symbol = Symbol('devseek.provider-run-evidence-operation-id');

type ProviderOperationBoundError = Error & {
  readonly [PROVIDER_RUN_EVIDENCE_OPERATION_ID]: string;
};

export function providerRunEvidenceOperationId(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const operationId = (error as Partial<ProviderOperationBoundError>)[PROVIDER_RUN_EVIDENCE_OPERATION_ID];
  return typeof operationId === 'string' && operationId.trim() ? operationId.trim() : undefined;
}

/**
 * A failed bridge request already has a trustworthy client-side terminal, but
 * the server participant disappeared before it could append its own terminal.
 * RunContext may supersede this gap only with a fully verified local result.
 */
export class BridgeProviderFailureEvidenceGapError extends Error {
  readonly code = BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP;

  constructor(readonly operationId: string) {
    super(
      `Bridge evidence boundary is incomplete for operation ${operationId}; `
      + 'expected provider.completed or provider.failed',
    );
    this.name = 'BridgeProviderFailureEvidenceGapError';
  }
}

export function isBridgeProviderFailureEvidenceGap(
  error: unknown,
): error is BridgeProviderFailureEvidenceGapError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; operationId?: unknown };
  return candidate.code === BRIDGE_PROVIDER_FAILURE_EVIDENCE_GAP
    && typeof candidate.operationId === 'string'
    && candidate.operationId.trim().length > 0;
}

/**
 * Records the provider boundary for both direct API providers and the bridge
 * client. The bridge server writes its own participant events into the same
 * run, so transport and actual web-provider facts remain distinguishable.
 */
export async function invokeProviderWithRunEvidence(input: ProviderRunEvidenceInput): Promise<string> {
  const operationId = input.request.traceOperationId?.trim() || (input.newOperationId ?? crypto.randomUUID)();
  requireProviderCorrelationId(operationId, 'operation-id');
  const samplingId = normalizeSamplingId(input, operationId);
  const transportAttempt = normalizeTransportAttempt(input);
  const promptBudget = input.promptBudget ?? measureProviderTextPrompt(input.request.prompt);
  const profiler = ProviderInvocationProfiler.start({
    input,
    operationId,
    samplingId,
    transportAttempt,
    promptBudget,
  });
  const evidence = attachEvidence(input);
  record(evidence, input, 'provider.requested', operationId, {
    provider: input.providerType,
    layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
    sampling_id: samplingId,
    transport_attempt: transportAttempt,
    prompt_budget: providerPromptBudgetEvidence(promptBudget),
    prompt: summarizeTraceText(input.request.prompt),
    file_count: input.request.files?.length ?? 0,
  });
  let completedResponse: string;
  try {
    profiler.beginSampling();
    const response = await input.invoke({
      observeOutput: delta => profiler.observeOutput(delta),
    });
    const efficiency = profiler.finish('completed', response);
    record(evidence, input, 'provider.completed', operationId, {
      provider: input.providerType,
      layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
      sampling_id: samplingId,
      transport_attempt: transportAttempt,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
      response: summarizeTraceText(response),
    });
    if (input.providerType === 'bridge') {
      await assertBridgeParticipantTerminal(evidence, operationId, 'provider.completed', input);
    }
    completedResponse = response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const efficiency = profiler.finish(providerInvocationWasCancelled(input.request.signal, message)
      ? 'cancelled'
      : 'failed');
    record(evidence, input, 'provider.failed', operationId, {
      provider: input.providerType,
      layer: input.providerType === 'bridge' ? 'bridge-client' : 'direct-provider',
      sampling_id: samplingId,
      transport_attempt: transportAttempt,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
      error: summarizeTraceText(message),
    });
    if (input.providerType === 'bridge') {
      await assertBridgeParticipantTerminal(evidence, operationId, 'provider.failed', input);
    }
    throw bindProviderRunEvidenceOperationId(error, operationId);
  }
  input.onCompleted?.(operationId);
  return completedResponse;
}

function bindProviderRunEvidenceOperationId(error: unknown, operationId: string): Error {
  const target = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(target, PROVIDER_RUN_EVIDENCE_OPERATION_ID, {
      value: operationId,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return target;
  } catch {
    const wrapped = new Error(target.message) as Error & { cause?: unknown };
    wrapped.cause = target;
    Object.defineProperty(wrapped, PROVIDER_RUN_EVIDENCE_OPERATION_ID, {
      value: operationId,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return wrapped;
  }
}

interface ProviderInvocationProfilerStartInput {
  readonly input: ProviderRunEvidenceInput;
  readonly operationId: string;
  readonly samplingId: string;
  readonly transportAttempt: number;
  readonly promptBudget: ProviderPromptBudgetSnapshot;
}

/** Best-effort diagnostics wrapper: profiler defects may not change provider behavior. */
class ProviderInvocationProfiler {
  private profiler?: ProviderEfficiencyProfiler;

  static start(options: ProviderInvocationProfilerStartInput): ProviderInvocationProfiler {
    return new ProviderInvocationProfiler(options);
  }

  private constructor(private readonly options: ProviderInvocationProfilerStartInput) {
    try {
      this.profiler = new ProviderEfficiencyProfiler({
        layer: 'vscode-provider-client',
        samplingId: options.samplingId,
        operationId: options.operationId,
        transportAttempt: options.transportAttempt,
      }, {
        promptBudget: options.promptBudget,
        ...(options.input.now ? { now: options.input.now } : {}),
      });
      this.profiler.markAttemptStarted(1);
    } catch (error) {
      this.report(error);
    }
  }

  beginSampling(): void {
    this.observe(profiler => profiler.transition('sampling'));
  }

  observeOutput(delta: string): void {
    this.observe(profiler => profiler.observeOutput(delta));
  }

  finish(
    outcome: 'completed' | 'failed' | 'cancelled',
    output?: string,
  ): ProviderEfficiencyProfile | undefined {
    let efficiency: ProviderEfficiencyProfile | undefined;
    this.observe(profiler => {
      profiler.transition('settlement');
      efficiency = profiler.finish(outcome, output);
    });
    return efficiency;
  }

  private observe(operation: (profiler: ProviderEfficiencyProfiler) => void): void {
    const profiler = this.profiler;
    if (!profiler) return;
    try {
      operation(profiler);
    } catch (error) {
      this.profiler = undefined;
      this.report(error);
    }
  }

  private report(error: unknown): void {
    this.options.input.onEvidenceError?.(error);
  }
}

function normalizeSamplingId(input: ProviderRunEvidenceInput, operationId: string): string {
  try {
    return requireProviderCorrelationId(input.samplingId ?? operationId, 'sampling-id');
  } catch (error) {
    input.onEvidenceError?.(error);
    return operationId;
  }
}

function normalizeTransportAttempt(input: ProviderRunEvidenceInput): number {
  try {
    return requireProviderAttempt(input.transportAttempt ?? 1);
  } catch (error) {
    input.onEvidenceError?.(error);
    return 1;
  }
}

function providerInvocationWasCancelled(signal: AbortSignal | undefined, message: string): boolean {
  return signal?.aborted === true || /(?:cancelled|canceled|已取消|abort(?:ed)?)/iu.test(message);
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

async function assertBridgeParticipantTerminal(
  evidence: ProductRunEvidenceSession | undefined,
  operationId: string,
  expectedTerminal: 'provider.completed' | 'provider.failed',
  input: ProviderRunEvidenceInput,
): Promise<void> {
  if (!evidence) return;
  try {
    const deadline = Date.now() + 1_000;
    while (true) {
      if (bridgeParticipantTerminalIsComplete(evidence, operationId, expectedTerminal)) return;
      if (Date.now() >= deadline) {
        throw expectedTerminal === 'provider.failed'
          ? new BridgeProviderFailureEvidenceGapError(operationId)
          : new Error(
            `Bridge evidence boundary is incomplete for operation ${operationId}; expected ${describeExpectedBridgeTerminal(expectedTerminal)}`,
          );
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } catch (error) {
    input.onEvidenceError?.(error);
  }
}

function bridgeParticipantTerminalIsComplete(
  evidence: ProductRunEvidenceSession,
  operationId: string,
  expectedTerminal: 'provider.completed' | 'provider.failed',
): boolean {
  const matching = evidence.readEvents().filter(event => {
    if (!event.type.startsWith('provider.')) return false;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
    return event.payload.operation_id === operationId && event.payload.boundary === 'bridge-server';
  });
  const requested = matching.filter(event => event.type === 'provider.requested').length;
  const terminal = matching.filter(event => event.type === 'provider.completed' || event.type === 'provider.failed').length;
  const actualTerminal = matching.at(-1)?.type;
  const terminalMatches = expectedTerminal === 'provider.completed'
    ? actualTerminal === 'provider.completed'
    : actualTerminal === 'provider.completed' || actualTerminal === 'provider.failed';
  return requested === 1 && terminal === 1 && terminalMatches;
}

function describeExpectedBridgeTerminal(expectedTerminal: 'provider.completed' | 'provider.failed'): string {
  if (expectedTerminal === 'provider.completed') return 'provider.completed';
  return 'provider.completed or provider.failed';
}
