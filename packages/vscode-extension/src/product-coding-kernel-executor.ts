import { runAgentLoop } from './agent-loop';
import { runAgenticLoop } from './agent/agentic-loop';
import { CodingKernelExecutionService } from './app/coding-kernel-execution';

export const productCodingKernelExecutor = new CodingKernelExecutionService({
  runExploratory: runAgenticLoop,
  runPlanned: runAgentLoop,
});
