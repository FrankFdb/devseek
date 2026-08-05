import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  type CodingKernelExecutionOutput,
  type CodingKernelRuntimePort,
  type CodingKernelTaskContract,
} from '@devseek-netai/shared';

export interface HeadlessCodingRunInput<TRuntimeContext> {
  readonly runId: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly taskContract: CodingKernelTaskContract;
  readonly runtimeContext: TRuntimeContext;
  readonly signal?: AbortSignal;
}

/**
 * Programmatic Surface adapter for CI, SDK, and deterministic Headless runs.
 * It owns no coding decisions; every run enters the shared canonical Kernel.
 */
export class HeadlessCodingKernelExecutor<TRuntimeContext, TResult> {
  private readonly kernel: CanonicalCodingKernel<TRuntimeContext, TResult>;

  constructor(runtime: CodingKernelRuntimePort<TRuntimeContext, TResult>) {
    this.kernel = new CanonicalCodingKernel(runtime);
  }

  execute(
    input: HeadlessCodingRunInput<TRuntimeContext>,
  ): Promise<CodingKernelExecutionOutput<TResult>> {
    return this.kernel.execute({
      version: CODING_KERNEL_REQUEST_VERSION,
      route: 'canonical',
      surface: 'headless',
      runId: input.runId,
      userPrompt: input.userPrompt,
      workspaceRoot: input.workspaceRoot,
      taskContract: input.taskContract,
      runtimeContext: input.runtimeContext,
      signal: input.signal,
    });
  }
}
