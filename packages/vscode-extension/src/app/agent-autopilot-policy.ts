import type { AgentLoopResult } from '../agent/loop-types';

export interface AgentAutopilotDecision {
  accept: boolean;
  reason: 'no-pending' | 'failed-result' | 'no-successful-work' | 'passed';
  notice?: string;
}

export function decideAgentAutopilotAccept(
  result: AgentLoopResult | undefined,
  pendingEditCount: number,
): AgentAutopilotDecision {
  if (pendingEditCount <= 0) return { accept: false, reason: 'no-pending' };

  if (result && result.tasksFailed > 0) {
    return {
      accept: false,
      reason: 'failed-result',
      notice: `[自动驾驶] 未自动接受文件改动：任务或验证失败，已保留 ${pendingEditCount} 个待确认文件供人工审查。`,
    };
  }

  if (result && result.tasksApplied <= 0 && result.changedPaths.length === 0) {
    return {
      accept: false,
      reason: 'no-successful-work',
      notice: `[自动驾驶] 未自动接受文件改动：本轮没有可确认的成功写入证据，已保留 ${pendingEditCount} 个待确认文件。`,
    };
  }

  return { accept: true, reason: 'passed' };
}
