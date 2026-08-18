import {
  inferInitialAgenticTodos as inferInitialAgenticTodosFromLedger,
  settleMissingEvidenceTodos,
  settleValidationFailureTodos,
} from './task-state-machine';

export interface TodoItem {
  id: number;
  title: string;
  /** Copilot-compatible status values */
  status: 'not-started' | 'in-progress' | 'completed' | 'failed';
  /** Runtime-owned state may override earlier model todo snapshots in the UI. */
  __agentState?: boolean;
}

export function markMissingEvidenceTodosIncomplete(todos: TodoItem[], missing: string[]): TodoItem[] {
  return settleMissingEvidenceTodos(todos, missing);
}

export function markValidationFailureTodos(todos: TodoItem[]): TodoItem[] {
  return settleValidationFailureTodos(todos);
}

export function inferInitialAgenticTodos(userPrompt: string): TodoItem[] {
  return inferInitialAgenticTodosFromLedger(userPrompt);
}

export function buildMissingEvidenceRecoveryInstruction(
  missing: string[],
  options: { mutationExpected?: boolean; mutationAllowed?: boolean } = {},
): string {
  const mutationContinuation = options.mutationExpected && options.mutationAllowed !== false
    ? '读取后继续使用受控文件工具完成用户要求的修改；当前写入授权仍然有效。'
    : '不要创建、修改或覆盖文件。';
  if (missing.some(item => item.includes('内容'))) {
    return `请调用 read_file 读取目标文件，或使用只读 run_terminal 命令 cat/head/sed 显示目标文件内容；test/ls 只能证明存在，不能满足内容读取。${mutationContinuation}`;
  }
  if (missing.some(item => item.includes('读取') || item.includes('检查'))) {
    return `请调用 read_file/list_dir，或使用只读 run_terminal 命令（test/ls/cat/head/stat）检查目标文件和内容；${mutationContinuation}`;
  }
  return '请立即调用 create_file/write_file 写入目标文件；只有代码/程序任务才需要随后调用 run_terminal 编译、运行或测试。';
}
