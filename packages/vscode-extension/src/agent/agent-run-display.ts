import type { AgentTaskAction } from './agent-task';
import type { TaskSemanticContract } from '../task-semantic-contract';

export type AgentRunDisplayKind = 'model-led';

export interface AgentRunDisplayProfile {
  kind: AgentRunDisplayKind;
  planStartedTitle: string;
  planStartedDetail: string;
  planCompletedTitle: string;
  planCompletedDetail: string;
  initialTaskAction: AgentTaskAction;
  initialTaskLabel?: string;
  emitPlanningStatus: boolean;
  suppressToolPlanning: boolean;
}

const DEFAULT_FREE_EXPLORE_PROFILE: AgentRunDisplayProfile = {
  kind: 'model-led',
  planStartedTitle: '正在理解当前请求',
  planStartedDetail: '正在结合本轮要求与当前会话上下文确定下一步。',
  planCompletedTitle: '已确认当前任务边界',
  planCompletedDetail: '后续步骤将依据当前请求和实际结果推进。',
  initialTaskAction: 'explore',
  emitPlanningStatus: true,
  suppressToolPlanning: false,
};

export function buildAgentRunDisplayProfile(
  _prompt: string,
  _semanticContract?: TaskSemanticContract,
): AgentRunDisplayProfile {
  return DEFAULT_FREE_EXPLORE_PROFILE;
}
