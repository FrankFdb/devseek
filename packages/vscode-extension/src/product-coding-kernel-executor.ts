import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  CodingKernelExecutionError,
  createProductRunEvidenceId,
} from '@devseek-netai/shared';
import { runAgenticLoop } from './agent/agentic-loop';
import {
  VsCodeCodingKernelRuntimeAdapter,
  type CodingKernelExecutionPort,
} from './app/coding-kernel-execution';
import { projectVsCodeCodingKernelTaskContract } from './app/coding-kernel-task-contract';
import { projectVsCodeCodingContextSeed } from './app/coding-kernel-context-seed';
import { retainVsCodeCodingRunLifecycle } from './app/coding-run-evidence-retention';
import { MemoryService } from './app/memory-service';

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
    {
      recoveryContextText: request.recoveryContextText,
      memoryContextText: request.memoryContextText,
      contextCompaction: request.contextCompaction,
    },
  ),
});
const kernel = new CanonicalCodingKernel(runtime);

export const productCodingKernelExecutor: CodingKernelExecutionPort = {
  async execute(request) {
    if (!request.semanticContract) {
      throw new Error('vscode-coding-kernel:missing-semantic-contract');
    }
    const runId = request.callbacks.traceRunId ?? createProductRunEvidenceId();
    const retainLifecycle = (lifecycle: CodingKernelExecutionError['lifecycle']) => (
      retainVsCodeCodingRunLifecycle({
        workspaceRoot: request.workspaceRoot,
        runId,
        participantToken: request.callbacks.traceEvidenceParticipantToken,
        lifecycle,
        onError: request.callbacks.onTraceEvidenceError,
      })
    );
    try {
      const memoryCandidates = new MemoryService({ workspaceRoot: request.workspaceRoot })
        .retrieveCodingMemoryCandidates({
          query: request.userPrompt,
          relatedPaths: [...request.contextFiles, ...(request.memoryRelatedPaths ?? [])],
          requireContextMatch: true,
        });
      const output = await kernel.execute({
        version: CODING_KERNEL_REQUEST_VERSION,
        route: 'canonical',
        surface: 'vscode',
        runId,
        userPrompt: request.userPrompt,
        workspaceRoot: request.workspaceRoot,
        taskContract: projectVsCodeCodingKernelTaskContract({
          userPrompt: request.userPrompt,
          workflowMode: request.workflowMode,
          contextFiles: request.contextFiles,
          taskContract: request.semanticContract.taskContract,
        }),
        contextSeed: projectVsCodeCodingContextSeed(request.contextFiles, request.semanticContract),
        memoryCandidates,
        resumeCheckpoint: request.recovery?.kind === 'checkpoint-resume'
          ? request.recovery.checkpoint
          : undefined,
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
      retainLifecycle(output.lifecycle);
      if (output.result.completionDecision?.status !== output.settlement.status) {
        throw new Error('vscode-coding-kernel:settlement-binding-mismatch');
      }
      return output.result;
    } catch (error) {
      if (error instanceof CodingKernelExecutionError) retainLifecycle(error.lifecycle);
      throw error;
    }
  },
};
