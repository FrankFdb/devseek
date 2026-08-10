import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  FileSystemCodingOperationJournal,
  projectSettledCodingConformanceRun,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import {
  CliCodingKernelRuntimeAdapter,
  type CliCodingKernelResult,
  type CliCodingKernelRuntimeContext,
  type CliCodingKernelRuntimeResult,
} from './cli-coding-kernel-runtime';
import { buildCliCodingKernelTaskContract } from './cli-coding-kernel-task-contract';
import { CliVerificationAdapter } from './cli-verification-adapter';
import { CliVerificationHostAdapter } from './cli-verification-service';
import { CliWorkspaceMutationHostAdapter } from './cli-workspace-mutation-service';

export interface CliProductCodingKernelInput extends CliCodingKernelRuntimeContext {
  readonly workspaceRoot: string;
  readonly userPrompt: string;
  readonly contextFiles: readonly string[];
  readonly runId: string;
  readonly signal: AbortSignal;
}

export type CliProductCodingKernelOutput = Omit<
  CodingKernelExecutionOutput<CliCodingKernelRuntimeResult>,
  'result'
> & { readonly result: CliCodingKernelResult };

export class CliCodingKernelTerminalError extends Error {
  constructor(
    readonly status: Exclude<CodingKernelExecutionOutput<unknown>['status'], 'completed'>,
    message: string,
  ) {
    super(message);
    this.name = 'CliCodingKernelTerminalError';
  }
}

const kernel = new CanonicalCodingKernel(new CliCodingKernelRuntimeAdapter(
  new CliCodingArtifactInterpreter(),
  new CliWorkspaceMutationHostAdapter(),
  new CliVerificationAdapter(new CliVerificationHostAdapter()),
));

export const productCliCodingKernelExecutor = {
  async execute(input: CliProductCodingKernelInput): Promise<CliProductCodingKernelOutput> {
    const {
      workspaceRoot,
      userPrompt,
      contextFiles,
      runId,
      signal,
      ...runtimeContext
    } = input;
    const output = await kernel.execute({
      version: CODING_KERNEL_REQUEST_VERSION,
      route: 'canonical',
      surface: 'cli',
      runId,
      userPrompt,
      workspaceRoot,
      taskContract: buildCliCodingKernelTaskContract(userPrompt, contextFiles),
      contextSeed: { files: contextFiles.map(path => ({ path })) },
      operationJournal: FileSystemCodingOperationJournal.forWorkspace(workspaceRoot),
      runtimeContext,
      signal,
    });
    const codingConformance = projectSettledCodingConformanceRun({
      fixtureId: output.runId,
      taskContract: output.taskContract,
      toolExecutions: output.toolExecutionReceipts,
      changeReceipts: output.workspaceMutationReceipts,
      verifications: output.verificationReceipts,
      completion: output.completion,
    });
    return {
      ...output,
      result: {
        ...output.result,
        toolExecutions: output.toolExecutionReceipts,
        changeReceipts: output.workspaceMutationReceipts,
        verificationReceipts: output.verificationReceipts,
        completion: output.completion,
        codingConformance,
      },
    };
  },
};

export function assertCompletedCliCodingKernelOutput(
  output: CliProductCodingKernelOutput,
): void {
  if (output.status !== output.settlement.status
    || output.completion.status !== output.settlement.status
    || output.result.completion !== output.completion) {
    throw new Error('cli-coding-kernel:settlement-binding-mismatch');
  }
  if (output.status === 'completed') return;
  const reasons = output.completion.reasonCodes.join(', ') || 'completion-not-authorized';
  throw new CliCodingKernelTerminalError(
    output.status,
    `DevSeek coding run ${output.status}: ${reasons}`,
  );
}
