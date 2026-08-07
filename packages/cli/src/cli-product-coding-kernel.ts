import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  FileSystemCodingOperationJournal,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import {
  CliCodingKernelRuntimeAdapter,
  type CliCodingKernelResult,
  type CliCodingKernelRuntimeContext,
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

export type CliProductCodingKernelOutput = CodingKernelExecutionOutput<CliCodingKernelResult>;

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
  execute(input: CliProductCodingKernelInput): Promise<CliProductCodingKernelOutput> {
    const {
      workspaceRoot,
      userPrompt,
      contextFiles,
      runId,
      signal,
      ...runtimeContext
    } = input;
    return kernel.execute({
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
  },
};

export function assertCompletedCliCodingKernelOutput(
  output: CliProductCodingKernelOutput,
): void {
  if (output.status !== output.settlement.status
    || output.result.completion.status !== output.settlement.status) {
    throw new Error('cli-coding-kernel:settlement-binding-mismatch');
  }
  if (output.status === 'completed') return;
  const reasons = output.result.completion.reasonCodes.join(', ') || 'completion-not-authorized';
  throw new CliCodingKernelTerminalError(
    output.status,
    `DevSeek coding run ${output.status}: ${reasons}`,
  );
}
