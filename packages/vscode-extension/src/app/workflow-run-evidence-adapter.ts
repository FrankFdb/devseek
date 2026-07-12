import type { ApplyWorkflowStatus } from '../workspace-applier';
import type { DevSeekRunContext } from './run-context';

/** Projects workspace workflow events into the owning run evidence lifecycle. */
export function recordApplyWorkflowEvidence(
  runContext: DevSeekRunContext | undefined,
  status: ApplyWorkflowStatus,
  taskPrefix = 'workspace',
): void {
  runContext?.recordAgentStatus({
    type: 'agentStatus',
    phase: status.phase === 'apply'
      ? 'execute'
      : status.phase === 'repair'
        ? 'repair'
        : status.phase,
    taskId: `${taskPrefix}-${status.phase}`,
    ...((status.phase === 'validate' || status.phase === 'quality')
      ? { evidenceOperationId: status.operationId }
      : {}),
    ...(status.phase === 'apply' ? { taskAction: 'modify' as const } : {}),
    state: status.state === 'passed' ? 'completed' : status.state,
    title: status.title,
    detail: status.detail,
  });
}
