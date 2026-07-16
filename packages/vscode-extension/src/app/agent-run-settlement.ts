import type { AgentLoopResult } from '../agent/loop-types';
import { buildArtifactVerificationCompletionMetadata } from '../agent/artifact-grounding-lifecycle';
import type { DevSeekRunContext, RunContextStatus } from './run-context';
import type { TerminalPermissionCoordinator } from './terminal-permission-coordinator';

export interface AgentRunSettlement {
  requestedStatus: RunContextStatus;
  status: RunContextStatus;
  completed: boolean;
  refused: boolean;
}

export function settleRunContextDirect(
  runContext: DevSeekRunContext,
  requestedStatus: RunContextStatus,
  data: Record<string, unknown> = {},
): AgentRunSettlement {
  const status = runContext.complete(requestedStatus, data);
  const completed = requestedStatus === 'completed' && status === 'completed';
  return { requestedStatus, status, completed, refused: requestedStatus === 'completed' && !completed };
}

/** Settles an agent result before any UI/session success projection. */
export function settleAgentLoopResult(
  terminalPermissions: Pick<TerminalPermissionCoordinator, 'completeRunContext'>,
  runContext: DevSeekRunContext,
  result: AgentLoopResult,
  changedPaths: readonly string[] = result.changedPaths,
): AgentRunSettlement {
  const requestedStatus = result.tasksFailed > 0 ? 'failed' : 'completed';
  const status = terminalPermissions.completeRunContext(runContext, requestedStatus, {
    tasksTotal: result.tasksTotal,
    tasksApplied: result.tasksApplied,
    tasksFailed: result.tasksFailed,
    changedPaths: changedPaths.slice(0, 12),
    ...buildArtifactVerificationCompletionMetadata(result),
  });
  const completed = requestedStatus === 'completed' && status === 'completed';
  return { requestedStatus, status, completed, refused: requestedStatus === 'completed' && !completed };
}
