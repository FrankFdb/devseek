import type { TodoItem } from './evidence-recovery';
import type { FakeTool } from './fake-tool-parser';
import { getAgentToolActivity } from './tool-activity';

const NON_WORK_TOOL_NAMES = new Set(['manage_todo_list', 'task_complete']);

export function isAgentWorkToolName(name: string): boolean {
  return !NON_WORK_TOOL_NAMES.has(name);
}

export function buildAgentMetaOnlyToolFeedback(taskDescription?: string): string {
  const scope = taskDescription?.trim()
    ? `当前任务：${taskDescription.trim()}`
    : '当前任务仍缺少真实执行证据。';
  return [
    '【系统反馈】本轮只更新了 todo/完成状态，没有执行真实工作工具。',
    scope,
    '请继续调用 read_file/list_dir/grep_search/create_file/write_file/run_terminal 等真实工具。',
    '需要编译、运行或验证时，必须使用 run_terminal 并提供可验证的退出码和输出；不要只更新任务清单。',
  ].join('\n');
}

export function describeAgentToolActivity(tool: FakeTool): { kind: string; label: string } | undefined {
  return getAgentToolActivity(tool) ?? undefined;
}

export function normalizeVisibleTodos(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) return [];
  return (items as TodoItem[])
    .filter(item => item
      && typeof item.title === 'string'
      && item.title.trim()
      && !/(?:项目记忆|智能体记忆|记忆体|memory|memory_write|写入记忆|记录.*记忆)/iu.test(item.title || ''))
    .map((item, index) => ({ ...item, id: index + 1, title: item.title.trim() }));
}

export function optionalToolLineNumber(
  input: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
    if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}
