import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  FileSystemCodingOperationJournal,
  codingToolExecutionFailureReason,
  createCodingKernelEnvironmentSync,
  projectSettledCodingConformanceRun,
  type CodingKernelExecutionOutput,
} from '@devseek-netai/shared';
import { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import {
  CliCodingKernelRuntimeAdapter,
  cliWorkspaceToolFailureMessage,
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
    const taskContract = buildCliCodingKernelTaskContract(userPrompt, contextFiles);
    const output = await kernel.execute({
      version: CODING_KERNEL_REQUEST_VERSION,
      route: 'canonical',
      surface: 'cli',
      runId,
      userPrompt,
      workspaceRoot,
      taskContract,
      toolAuthorityStrategy: 'model-led',
      contextSeed: { files: contextFiles.map(path => ({ path })) },
      operationJournal: FileSystemCodingOperationJournal.forWorkspace(workspaceRoot),
      environment: createCodingKernelEnvironmentSync({
        workspaceRoot,
        provider: input.usesBridge ? 'bridge' : 'local-api',
      }),
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
  const workspaceFailure = output.toolExecutionReceipts.find(receipt => (
    receipt.tool === 'apply_workspace_artifacts' && receipt.status !== 'completed'
  ));
  const reasons = [
    ...(workspaceFailure
      ? [cliWorkspaceToolFailureMessage(codingToolExecutionFailureReason(workspaceFailure))]
      : []),
    ...(output.completion.reasonCodes.length > 0
      ? output.completion.reasonCodes
      : ['completion-not-authorized']),
  ].join(', ');
  throw new CliCodingKernelTerminalError(
    output.status,
    `DevSeek coding run ${output.status}: ${reasons}`,
  );
}
