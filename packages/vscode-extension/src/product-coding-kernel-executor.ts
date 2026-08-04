import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  createProductRunEvidenceId,
} from '@devseek-netai/shared';
import { runAgenticLoop } from './agent/agentic-loop';
import {
  VsCodeCodingKernelRuntimeAdapter,
  type CodingKernelExecutionPort,
} from './app/coding-kernel-execution';
import { projectVsCodeCodingKernelTaskContract } from './app/coding-kernel-task-contract';

const runtime = new VsCodeCodingKernelRuntimeAdapter({
  runCanonical: request => runAgenticLoop(
    request.userPrompt,
    request.contextFiles,
    request.workspaceRoot,
    request.mode,
    request.callbacks,
    request.sessionContextText,
    request.workflowMode,
    request.memoryRelatedPaths,
    request.semanticContract,
    { recoveryContextText: request.recoveryContextText },
  ),
});
const kernel = new CanonicalCodingKernel(runtime);

export const productCodingKernelExecutor: CodingKernelExecutionPort = {
  async execute(request) {
    if (!request.semanticContract) {
      throw new Error('vscode-coding-kernel:missing-semantic-contract');
    }
    const output = await kernel.execute({
      version: CODING_KERNEL_REQUEST_VERSION,
      route: 'canonical',
      surface: 'vscode',
      runId: request.callbacks.traceRunId ?? createProductRunEvidenceId(),
      userPrompt: request.userPrompt,
      workspaceRoot: request.workspaceRoot,
      taskContract: projectVsCodeCodingKernelTaskContract({
        userPrompt: request.userPrompt,
        workflowMode: request.workflowMode,
        contextFiles: request.contextFiles,
        taskContract: request.semanticContract.taskContract,
      }),
      runtimeContext: {
        contextFiles: request.contextFiles,
        mode: request.mode,
        callbacks: request.callbacks,
        sessionContextText: request.sessionContextText,
        workflowMode: request.workflowMode,
        memoryRelatedPaths: request.memoryRelatedPaths,
        semanticContract: request.semanticContract,
        recovery: request.recovery,
      },
      signal: request.callbacks.signal,
    });
    return output.result;
  },
};
