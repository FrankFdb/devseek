import {
  ProviderEfficiencyProfiler,
  measureProviderTextPrompt,
  providerEfficiencyEvidence,
  providerPromptBudgetEvidence,
  requireProviderAttempt,
  requireProviderCorrelationId,
  summarizeTraceText,
  type DeepSeekStreamErrorCategory,
  type DevSeekTraceLogger,
  type ProviderEfficiencyPhase,
  type ProviderEfficiencyProfile,
} from '@devseek-netai/shared';

import type { BridgeRunEvidence, BridgeProviderEvidenceType } from './run-evidence';

export interface BridgeProviderLifecycleOptions {
  readonly operationId: string;
  readonly samplingId?: string;
  readonly transportAttempt?: number;
  readonly prompt: string;
  readonly stream: boolean;
  readonly mode?: 'fast' | 'r1';
  readonly fileCount: number;
  readonly evidence?: BridgeRunEvidence;
  readonly trace: DevSeekTraceLogger;
  readonly now?: () => number;
}

export interface BridgeProviderFailure {
  readonly message: string;
  readonly category: DeepSeekStreamErrorCategory;
  readonly phase: 'initialization' | 'generation';
  readonly retryAfterMs?: number;
}

/**
 * Owns one Bridge provider boundary from admission to exactly one terminal.
 * Browser and connector components report milestones; neither writes run
 * evidence directly.
 */
export class BridgeProviderLifecycle {
  readonly operationId: string;
  readonly samplingId: string;
  readonly transportAttempt: number;

  private profiler?: ProviderEfficiencyProfiler;
  private terminal = false;
  private outputObserved = false;

  static start(options: BridgeProviderLifecycleOptions): BridgeProviderLifecycle {
    const lifecycle = new BridgeProviderLifecycle(options);
    lifecycle.record('provider.requested', {
      provider: 'deepseek-web',
      sampling_id: lifecycle.samplingId,
      transport_attempt: lifecycle.transportAttempt,
      stream: options.stream,
      mode: options.mode ?? null,
      prompt_budget: providerPromptBudgetEvidence(measureProviderTextPrompt(options.prompt)),
      prompt: summarizeTraceText(options.prompt),
      file_count: options.fileCount,
    });
    return lifecycle;
  }

  private constructor(private readonly options: BridgeProviderLifecycleOptions) {
    this.operationId = requireProviderCorrelationId(options.operationId, 'operation-id');
    this.samplingId = this.normalizeSamplingId(options.samplingId);
    this.transportAttempt = this.normalizeTransportAttempt(options.transportAttempt);
    try {
      this.profiler = new ProviderEfficiencyProfiler({
        layer: 'bridge-server',
        samplingId: this.samplingId,
        operationId: this.operationId,
        transportAttempt: this.transportAttempt,
      }, {
        promptBudget: measureProviderTextPrompt(options.prompt),
        ...(options.now ? { now: options.now } : {}),
      });
    } catch (error) {
      this.reportDiagnosticFailure('start', error);
    }
  }

  beginInitialization(): void {
    this.transition('initialization');
  }

  beginAdmission(): void {
    this.transition('admission');
  }

  beginAttempt(attempt: number): void {
    this.observeProfile('attempt-started', profiler => {
      profiler.markAttemptStarted(attempt);
    });
  }

  beginPromptPreparation(): void {
    this.transition('prompt-preparation');
  }

  promptPrepared(prompt: string): void {
    this.observeProfile('prompt-prepared', profiler => {
      profiler.updatePromptBudget(measureProviderTextPrompt(prompt));
    });
  }

  submitConfirmed(): void {
    this.transition('sampling');
  }

  observeProviderOutput(delta: string): void {
    if (!delta) return;
    this.outputObserved = true;
    this.observeProfile('provider-output', profiler => profiler.observeOutput(delta));
  }

  retryScheduled(): void {
    this.observeProfile('retry-scheduled', profiler => profiler.markRetryScheduled());
  }

  complete(response: string): ProviderEfficiencyProfile | undefined {
    if (this.terminal) return undefined;
    this.terminal = true;
    if (!this.outputObserved) this.observeProfile('provider-output', profiler => profiler.observeOutput(response));
    const efficiency = this.finishProfile('completed');
    this.record('provider.completed', {
      provider: 'deepseek-web',
      sampling_id: this.samplingId,
      transport_attempt: this.transportAttempt,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
      response: summarizeTraceText(response),
    });
    this.options.trace.info('provider-efficiency', 'bridge-provider-completed', {
      operationId: this.operationId,
      samplingId: this.samplingId,
      transportAttempt: this.transportAttempt,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
    });
    return efficiency;
  }

  fail(failure: BridgeProviderFailure): ProviderEfficiencyProfile | undefined {
    if (this.terminal) return undefined;
    this.terminal = true;
    const outcome = failure.category === 'cancelled' ? 'cancelled' : 'failed';
    const efficiency = this.finishProfile(outcome);
    this.record('provider.failed', {
      provider: 'deepseek-web',
      sampling_id: this.samplingId,
      transport_attempt: this.transportAttempt,
      phase: failure.phase,
      category: failure.category,
      retry_after_ms: failure.retryAfterMs ?? null,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
      error: summarizeTraceText(failure.message),
    });
    this.options.trace.info('provider-efficiency', 'bridge-provider-failed', {
      operationId: this.operationId,
      samplingId: this.samplingId,
      transportAttempt: this.transportAttempt,
      category: failure.category,
      phase: failure.phase,
      ...(efficiency ? { efficiency: providerEfficiencyEvidence(efficiency) } : {}),
    });
    return efficiency;
  }

  private transition(phase: ProviderEfficiencyPhase): void {
    this.observeProfile(`phase-${phase}`, profiler => profiler.transition(phase));
  }

  private finishProfile(outcome: 'completed' | 'failed' | 'cancelled'): ProviderEfficiencyProfile | undefined {
    let efficiency: ProviderEfficiencyProfile | undefined;
    this.observeProfile('settlement', profiler => {
      profiler.transition('settlement');
      efficiency = profiler.finish(outcome);
    });
    return efficiency;
  }

  private observeProfile(name: string, operation: (profiler: ProviderEfficiencyProfiler) => void): void {
    const profiler = this.profiler;
    if (!profiler) return;
    try {
      operation(profiler);
    } catch (error) {
      this.profiler = undefined;
      this.reportDiagnosticFailure(name, error);
    }
  }

  private record(type: BridgeProviderEvidenceType, payload: Record<string, unknown>): void {
    if (!this.options.evidence) return;
    try {
      this.options.evidence.record(type, payload);
    } catch (error) {
      this.reportDiagnosticFailure(`evidence-${type}`, error);
    }
  }

  private normalizeSamplingId(value: string | undefined): string {
    try {
      return requireProviderCorrelationId(value ?? this.operationId, 'sampling-id');
    } catch (error) {
      this.reportDiagnosticFailure('sampling-id', error);
      return this.operationId;
    }
  }

  private normalizeTransportAttempt(value: number | undefined): number {
    try {
      return requireProviderAttempt(value ?? 1);
    } catch (error) {
      this.reportDiagnosticFailure('transport-attempt', error);
      return 1;
    }
  }

  private reportDiagnosticFailure(stage: string, error: unknown): void {
    this.options.trace.error('provider-efficiency', 'bridge-observation-failed', {
      operationId: this.operationId || this.options.operationId,
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
