import type { CodingCheckpoint, CodingTerminalStatus } from '@devseek-netai/shared';
import type { AgentTask } from '../agent/agent-task';
import type { AgentLoopCallbacks } from '../agent/loop-types';

export interface VsCodeRecoveryFallback {
  readonly pendingTasks: readonly AgentTask[];
  readonly checkpoint?: CodingCheckpoint;
}

export async function deliverVsCodeRecoverySettlement(input: {
  readonly status: CodingTerminalStatus;
  readonly fallback?: VsCodeRecoveryFallback;
  readonly onTaskCheckpoint?: AgentLoopCallbacks['onTaskCheckpoint'];
}): Promise<void> {
  if (!input.fallback || !input.onTaskCheckpoint) return;
  if (input.status === 'completed') {
    await input.onTaskCheckpoint(null, [], 'completed');
    return;
  }
  await input.onTaskCheckpoint(
    0,
    [...input.fallback.pendingTasks],
    'paused',
    input.fallback.checkpoint,
  );
}
