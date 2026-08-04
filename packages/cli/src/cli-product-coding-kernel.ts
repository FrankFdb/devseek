import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import {
  CliCodingKernelRuntimeAdapter,
  type CliCodingKernelResult,
  type CliCodingKernelRuntimeContext,
} from './cli-coding-kernel-runtime';
import { buildCliCodingKernelTaskContract } from './cli-coding-kernel-task-contract';
import { CliVerificationService } from './cli-verification-service';
import { CliWorkspaceMutationService } from './cli-workspace-mutation-service';

export interface CliProductCodingKernelInput extends CliCodingKernelRuntimeContext {
  readonly workspaceRoot: string;
  readonly userPrompt: string;
  readonly contextFiles: readonly string[];
  readonly runId: string;
  readonly signal: AbortSignal;
}

const kernel = new CanonicalCodingKernel(new CliCodingKernelRuntimeAdapter(
  new CliCodingArtifactInterpreter(),
  new CliWorkspaceMutationService(),
  new CliVerificationService(),
));

export const productCliCodingKernelExecutor = {
  execute(input: CliProductCodingKernelInput): Promise<CodingKernelExecutionOutput<CliCodingKernelResult>> {
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
      runtimeContext,
      signal,
    });
  },
};
