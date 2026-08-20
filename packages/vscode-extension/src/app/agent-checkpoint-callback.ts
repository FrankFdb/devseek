import type { AgentTask } from '../agent/agent-task';
import type { AgentLoopCallbacks } from '../agent/loop-types';
import type { CodingCheckpoint } from '@devseek-netai/shared';
import type { TaskCheckpointRecord } from './task-checkpoint-store';

interface AgentCheckpointCallbackInput {
  userPrompt: string;
  displayPrompt: string;
  mode?: 'fast' | 'r1';
  workspaceRoot: string;
  sessionId: string;
  save: (checkpoint: TaskCheckpointRecord<AgentTask> | null) => Promise<void>;
  postMessage: (message: Record<string, unknown>) => void;
}

export function createAgentCheckpointCallback(
  input: AgentCheckpointCallbackInput,
): NonNullable<AgentLoopCallbacks['onTaskCheckpoint']> {
  return async (firstUnfinishedIndex, remainingTasks, reason = 'progress', canonicalCheckpoint?: CodingCheckpoint) => {
    if (firstUnfinishedIndex === null) {
      await input.save(null);
      input.postMessage({ type: 'agentCheckpointCleared' });
      return;
    }
    const pendingTasks = [...remainingTasks];
    if (pendingTasks.length === 0) {
      await input.save(null);
      input.postMessage({ type: 'agentCheckpointCleared' });
      return;
    }
    if (!canonicalCheckpoint) {
      throw new Error('agent-checkpoint:missing-canonical-checkpoint');
    }
    if (canonicalCheckpoint.pendingUnits.map(unit => unit.id).join('\n') !== pendingTasks.map(task => task.id).join('\n')) {
      throw new Error('agent-checkpoint:pending-task-binding-mismatch');
    }
    const completedBeforePending = canonicalCheckpoint.completedUnitCount;
    const savedAt = Date.now();
    const pauseReason = reason === 'paused'
      ? `Agent execution paused with ${pendingTasks.length} unfinished task(s).`
      : undefined;
    await input.save({
      userPrompt: input.userPrompt,
      displayPrompt: input.displayPrompt,
      mode: input.mode,
      wsRootFsPath: input.workspaceRoot,
      // The callback receives a global first-unfinished index together with a
      // pending-only task slice. Rebase the persisted queue so every stored
      // index is relative to `allTasks`; otherwise late checkpoints are
      // normalized as already complete and discarded by TaskCheckpointStore.
      allTasks: pendingTasks,
      startFromIndex: 0,
      completedCount: 0,
      savedAt,
      sessionId: input.sessionId,
      canonicalCheckpoint,
      ...(pauseReason ? { pauseReason } : {}),
    });
    if (reason === 'paused') {
      input.postMessage({
        type: 'agentCheckpointAvailable',
        // UI progress remains in the original task coordinate space. Resume
        // itself uses the rebased pending queue persisted above.
        resumeTaskIndex: completedBeforePending,
        totalTasks: completedBeforePending + pendingTasks.length,
        userPrompt: input.displayPrompt,
        savedAt,
        pauseReason,
        checkpointId: canonicalCheckpoint.checkpointId,
      });
    }
  };
}
