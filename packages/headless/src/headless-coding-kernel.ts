import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  CodingKernelExecutionError,
  FileSystemCodingOperationJournal,
  projectSettledCodingConformanceRun,
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

export type HeadlessCodingRuntimePort<TRuntimeContext, TResult> = CodingKernelRuntimePort<
  TRuntimeContext,
  TResult
>;

export type HeadlessCodingExecutionOutput<TResult> = CodingKernelExecutionOutput<TResult> & {
  readonly conformance: CodingConformanceProjection;
  readonly runEvidence: HeadlessRunEvidenceReceipt;
};

/**
 * Programmatic Surface adapter for CI, SDK, and deterministic Headless runs.
 * It owns no coding decisions; every run enters the shared canonical Kernel.
 */
export class HeadlessCodingKernelExecutor<TRuntimeContext, TResult> {
  private readonly kernel: CanonicalCodingKernel<TRuntimeContext, TResult>;

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

      const conformance = projectSettledCodingConformanceRun({
        fixtureId: output.runId,
        taskContract: output.taskContract,
        toolExecutions: output.toolExecutionReceipts,
        changeReceipts: output.workspaceMutationReceipts,
        verifications: output.verificationReceipts,
        completion: output.completion,
      });
      finalizationAttempted = true;
      const runEvidence = evidence.finalize(lifecycle, output.status, 'surface-output-settled');
      return Object.freeze({
        ...output,
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
