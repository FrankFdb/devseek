import { settleMissingEvidenceTodos, settleValidationFailureTodos } from './task-state-machine';

export interface TodoItem {
  id: number;
  title: string;
  /** Copilot-compatible status values */
  status: 'not-started' | 'in-progress' | 'completed' | 'failed';
  /** Runtime-owned state may override earlier model todo snapshots in the UI. */
  __agentState?: boolean;
  /** Structured runtime state; model-authored titles are never parsed for authority. */
  __agentKind?: 'evidence-closure' | 'validation';
}

export function markMissingEvidenceTodosIncomplete(todos: TodoItem[], missing: string[]): TodoItem[] {
  return settleMissingEvidenceTodos(todos, missing);
}

export function markValidationFailureTodos(todos: TodoItem[]): TodoItem[] {
  return settleValidationFailureTodos(todos);
}

export function buildMissingEvidenceRecoveryInstruction(
  missing: string[],
  options: { mutationExpected?: boolean; mutationAllowed?: boolean } = {},
): string {
  const mutationContinuation = options.mutationExpected && options.mutationAllowed !== false
    ? '读取后继续使用受控文件工具完成用户要求的修改；当前写入授权仍然有效。'
    : '不要创建、修改或覆盖文件。';
  return `当前缺失证据：${missing.join('、')}。请根据已结算任务契约调用对应的 read_file、文件写入或 run_terminal 工具补齐真实证据；不要用文字声明代替工具结果。${mutationContinuation}`;
}
