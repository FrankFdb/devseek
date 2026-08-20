import type { CodingCheckpointEffectClass } from '@devseek-netai/shared';
import type { AgentTaskAction } from '../agent/agent-task';

/** Projects structured task semantics into the shared resume protocol. */
export function projectAgentTaskCheckpointEffect(
  action: AgentTaskAction,
): CodingCheckpointEffectClass {
  return action === 'modify' || action === 'create' || action === 'delete'
    ? 'workspace-mutation'
    : 'read';
}
