import { disposeBridgeRuntime } from '../bridge-client';
import { disposeCapturedTerminalProcesses } from '../tools/terminal';
import { shutdownMemoryPipelineWork } from './memory-pipeline-service';

export async function shutdownExtensionRuntime(input: {
  cancelActiveRun(): void;
  flushSession(): Promise<void>;
}): Promise<void> {
  input.cancelActiveRun();
  await Promise.allSettled([
    shutdownMemoryPipelineWork(),
    disposeCapturedTerminalProcesses(),
    disposeBridgeRuntime(),
    input.flushSession(),
  ]);
}
