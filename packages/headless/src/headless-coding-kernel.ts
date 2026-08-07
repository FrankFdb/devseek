import { isDeepStrictEqual } from 'node:util';
import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  CodingKernelExecutionError,
  FileSystemCodingOperationJournal,
  projectCodingKernelTaskContract,
  validateCodingConformanceProjection,
  type CodingConformanceObservedProjection,
  type CodingConformanceProjection,
  type CodingCheckpoint,
  type CodingContextSeed,
  type CodingKernelExecutionOutput,
  type CodingKernelRuntimePort,
  type CodingKernelTaskContract,
  type CodingMemoryCandidate,
  type CodingResumeOperationReceipt,
} from '@devseek-netai/shared';
import {
  HeadlessRunEvidence,
  type HeadlessRunEvidenceReceipt,
} from './headless-run-evidence';
import { HeadlessSurfaceAdapter } from './headless-surface-adapter';

export interface HeadlessCodingRunInput<TRuntimeContext> {
  readonly runId: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly contextSeed?: CodingContextSeed;
  readonly memoryCandidates?: readonly CodingMemoryCandidate[];
  readonly resumeCheckpoint?: CodingCheckpoint;
  readonly resumeReceipts?: readonly CodingResumeOperationReceipt[];
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
}

export interface HeadlessCodingRuntimeResult<TResult> {
  readonly value: TResult;
  readonly conformance: CodingConformanceObservedProjection;
}

export type HeadlessCodingRuntimePort<TRuntimeContext, TResult> = CodingKernelRuntimePort<
  TRuntimeContext,
  HeadlessCodingRuntimeResult<TResult>
>;

export type HeadlessCodingExecutionOutput<TResult> = Omit<
  CodingKernelExecutionOutput<HeadlessCodingRuntimeResult<TResult>>,
  'result'
> & {
  readonly result: TResult;
  readonly conformance: CodingConformanceProjection;
  readonly runEvidence: HeadlessRunEvidenceReceipt;
};

/**
 * Programmatic Surface adapter for CI, SDK, and deterministic Headless runs.
 * It owns no coding decisions; every run enters the shared canonical Kernel.
 */
export class HeadlessCodingKernelExecutor<TRuntimeContext, TResult> {
  private readonly kernel: CanonicalCodingKernel<TRuntimeContext, HeadlessCodingRuntimeResult<TResult>>;

  constructor(
    runtime: HeadlessCodingRuntimePort<TRuntimeContext, TResult>,
    private readonly surface: HeadlessSurfaceAdapter = new HeadlessSurfaceAdapter(),
  ) {
    this.kernel = new CanonicalCodingKernel(runtime);
  }

  async execute(
    input: HeadlessCodingRunInput<TRuntimeContext>,
  ): Promise<HeadlessCodingExecutionOutput<TResult>> {
    const command = this.surface.toChatCommand({
      prompt: input.userPrompt,
      commandId: `headless-${input.runId}`,
      request: {
        stream: false,
        trackHistory: false,
        signal: input.signal,
      },
    });
    const evidence = HeadlessRunEvidence.open(input);
    let lifecycle: CodingKernelExecutionOutput<unknown>['lifecycle'] | undefined;
    let finalizationAttempted = false;
    try {
      const output = await this.kernel.execute({
        version: CODING_KERNEL_REQUEST_VERSION,
        route: 'canonical',
        surface: 'headless',
        runId: input.runId,
        userPrompt: command.request.prompt,
        workspaceRoot: input.workspaceRoot,
        taskContract: input.taskContract,
        contextSeed: input.contextSeed,
        memoryCandidates: input.memoryCandidates,
        resumeCheckpoint: input.resumeCheckpoint,
        resumeReceipts: input.resumeReceipts,
        operationJournal: FileSystemCodingOperationJournal.forWorkspace(input.workspaceRoot),
        runtimeContext: input.runtimeContext,
        signal: command.request.signal,
      });
      lifecycle = output.lifecycle;

      const runtimeResult = output.result;
      if (!runtimeResult || typeof runtimeResult !== 'object' || !runtimeResult.conformance) {
        throw new Error('headless-coding-conformance:missing-runtime-evidence');
      }
      const conformance = snapshotConformance(runtimeResult.conformance);
      assertOutputBinding(output, conformance);
      finalizationAttempted = true;
      const runEvidence = evidence.finalize(lifecycle, output.status, 'surface-output-settled');
      const { result: _runtimeResult, ...kernelOutput } = output;
      return Object.freeze({
        ...kernelOutput,
        result: runtimeResult.value,
        conformance,
        runEvidence,
      });
    } catch (error) {
      if (!finalizationAttempted) {
        const kernelLifecycle = error instanceof CodingKernelExecutionError
          ? error.lifecycle
          : lifecycle;
        const status = error instanceof CodingKernelExecutionError
          && (error.settlement.status === 'cancelled' || error.settlement.status === 'blocked')
          ? error.settlement.status
          : 'failed';
        finalizationAttempted = true;
        evidence.finalize(kernelLifecycle, status, 'surface-output-failed');
      }
      throw error;
    }
  }
}

function snapshotConformance(
  projection: CodingConformanceObservedProjection,
): CodingConformanceProjection {
  let snapshot: CodingConformanceObservedProjection;
  try {
    snapshot = structuredClone(projection);
  } catch {
    throw new Error('headless-coding-conformance:uncloneable-projection');
  }
  const violations = validateCodingConformanceProjection(snapshot, 'headless');
  if (violations.length > 0) {
    const codes = violations.map(violation => `${violation.dimension}:${violation.code}`).join(',');
    throw new Error(`headless-coding-conformance:invalid-projection:${codes}`);
  }
  return deepFreeze(snapshot as CodingConformanceProjection);
}

function assertOutputBinding<TResult>(
  output: CodingKernelExecutionOutput<HeadlessCodingRuntimeResult<TResult>>,
  conformance: CodingConformanceProjection,
): void {
  const violations: string[] = [];
  if (conformance.fixtureId !== output.runId) violations.push('run-id-mismatch');
  if (!isDeepStrictEqual(conformance.taskContract, projectCodingKernelTaskContract(output.taskContract))) {
    violations.push('task-contract-mismatch');
  }
  if (conformance.completion.status !== output.settlement.status) violations.push('terminal-status-mismatch');
  if (!isDeepStrictEqual(conformance.completion.evidenceRefs, output.settlement.evidenceRefs)) {
    violations.push('completion-evidence-mismatch');
  }
  if (!isDeepStrictEqual(conformance.completion.residualRisks, output.settlement.residualRisks)) {
    violations.push('residual-risk-mismatch');
  }
  if (violations.length > 0) {
    throw new Error(`headless-coding-conformance:binding-mismatch:${violations.join(',')}`);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
