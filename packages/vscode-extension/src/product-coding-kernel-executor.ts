import {
  CODING_KERNEL_REQUEST_VERSION,
  CanonicalCodingKernel,
  CodingKernelExecutionError,
  FileSystemCodingOperationJournal,
  createCodingKernelEnvironmentSync,
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
import { deliverVsCodeRecoverySettlement } from './app/coding-kernel-recovery-delivery';
import { projectVsCodeCodingKernelOutput } from './app/vscode-coding-kernel-output';

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
      const taskContract = projectVsCodeCodingKernelTaskContract({
        userPrompt: request.userPrompt,
        executionMode: request.semanticContract.intent.mode,
        contextFiles: request.contextFiles,
        workspaceRoot: request.workspaceRoot,
        taskContract: request.semanticContract.taskContract,
      });
      const output = await kernel.execute({
        version: CODING_KERNEL_REQUEST_VERSION,
        route: 'canonical',
        surface: 'vscode',
        runId,
        userPrompt: request.userPrompt,
        workspaceRoot: request.workspaceRoot,
        taskContract,
        toolAuthorityStrategy: request.workflowMode === 'model-led' ? 'model-led' : 'contract-bound',
        contextSeed: projectVsCodeCodingContextSeed(request.contextFiles, request.semanticContract),
        memoryCandidates,
        resumeCheckpoint: request.recovery?.kind === 'checkpoint-resume'
          ? request.recovery.checkpoint
          : undefined,
        operationJournal: FileSystemCodingOperationJournal.forWorkspace(request.workspaceRoot),
        environment: createCodingKernelEnvironmentSync({
          workspaceRoot: request.workspaceRoot,
          provider: request.providerType,
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
          providerType: request.providerType,
        },
        signal: request.callbacks.signal,
        ...(request.callbacks.onUserSteer ? {
          steeringSource: {
            drain: () => request.callbacks.onUserSteer?.() ?? [],
          },
        } : {}),
      });
      retainLifecycle(output.lifecycle);
      const productOutput = projectVsCodeCodingKernelOutput(output);
      const fallback = output.result.recoveryFallback;
      await deliverVsCodeRecoverySettlement({
        status: output.status,
        fallback,
        onTaskCheckpoint: request.callbacks.onTaskCheckpoint,
      });
      return productOutput;
    } catch (error) {
      if (error instanceof CodingKernelExecutionError) retainLifecycle(error.lifecycle);
      throw error;
    }
  },
};
