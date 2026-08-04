import { runAgenticLoop } from './agent/agentic-loop';
import { CodingKernelExecutionService } from './app/coding-kernel-execution';

export const productCodingKernelExecutor = new CodingKernelExecutionService({
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
