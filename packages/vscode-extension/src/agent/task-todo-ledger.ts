import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import type { AgentStatusEvent } from './events';
import {
  findBlockingTerminalFailureEvidence,
  getMissingCompletionEvidence,
  type TerminalEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import { buildTaskTerminalFailureDetail } from './task-execution-result';

type TodoStatus = TodoItem['status'];

interface TaskEvidence {
  action: AgentTaskAction;
  applied?: boolean;
  path?: string;
  raw?: string;
  taskComplete?: boolean;
  terminalEvidence?: TerminalEvidence[];
}

export interface TaskSettleResult {
  completed: boolean;
  failed: boolean;
  todos: TodoItem[];
}

export interface AgentTaskTodoLedger {
  snapshot(): TodoItem[];
  startTask(index: number): TodoItem[];
  settleTask(index: number, evidence: TaskEvidence): TaskSettleResult;
  repairSnapshot(title: string, id: number): TodoItem[];
  markValidationFailure(): TodoItem[];
}

export function buildTaskSettlementFailureStatus(
  task: AgentTask,
  taskIndex: number,
  taskTotal: number,
  result: { applied?: boolean; terminalEvidence?: TerminalEvidence[] },
): AgentStatusEvent {
  const target = getTaskDisplayTarget(task);
  return {
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id,
    taskFile: target,
    taskAction: task.action,
    taskDesc: task.desc,
    taskIndex,
    taskTotal,
    state: 'failed',
    title: task.desc || target,
    detail: buildTaskSettlementFailureDetail(task, result),
  };
}

export function createAgentTaskTodoLedger(
  tasks: AgentTask[],
  startFromIndex = 0,
): AgentTaskTodoLedger {
  const statuses: TodoStatus[] = tasks.map((_, index) => (
    index < startFromIndex ? 'completed' : 'not-started'
  ));
  let validationFailureTodo: TodoItem | undefined;

  const snapshot = (): TodoItem[] => {
    const items = tasks.map((task, index) => taskTodoItem(task, index, statuses[index] ?? 'not-started'));
    return validationFailureTodo ? [...items, validationFailureTodo] : items;
  };

  return {
    snapshot,
    startTask(index: number): TodoItem[] {
      if (isTaskIndex(index, tasks) && !isTerminalStatus(statuses[index])) {
        statuses[index] = 'in-progress';
      }
      return snapshot();
    },
    settleTask(index: number, evidence: TaskEvidence): TaskSettleResult {
      const terminalFailure = findBlockingTerminalFailureEvidence(evidence.terminalEvidence);
      const missingEvidence = isTaskIndex(index, tasks)
        ? getTaskMissingCompletionEvidence(tasks[index], evidence)
        : [];
      const completed = !terminalFailure && missingEvidence.length === 0 && hasTaskCompletionEvidence(evidence);
      const failed = Boolean(terminalFailure)
        || missingEvidence.length > 0
        || (!completed && !isReadOnlyAgentTaskAction(evidence.action));
      if (isTaskIndex(index, tasks)) {
        statuses[index] = failed ? 'failed' : completed ? 'completed' : 'in-progress';
      }
      return { completed, failed, todos: snapshot() };
    },
    repairSnapshot(title: string, id: number): TodoItem[] {
      return [
        ...snapshot(),
        {
          id,
          title,
          status: 'in-progress',
          __agentState: true,
        },
      ];
    },
    markValidationFailure(): TodoItem[] {
      const validationIndex = findValidationTaskIndex(tasks);
      if (validationIndex >= 0) {
        statuses[validationIndex] = 'failed';
        validationFailureTodo = undefined;
      } else {
        validationFailureTodo = {
          id: tasks.length + 1,
          title: '运行自动验证 / QualityGate',
          status: 'failed',
          __agentState: true,
        };
      }
      return snapshot();
    },
  };
}

export function settleValidationFailureTodos(todos: TodoItem[]): TodoItem[] {
  if (!todos.length) return todos;
  let matched = false;
  const updated = todos.map(item => {
    const title = item.title.toLowerCase();
    if (!isAutomaticValidationTodoTitle(title)) {
      return item;
    }
    matched = true;
    return { ...item, status: 'failed' as const };
  });
  if (matched) return updated;

  if (updated.some(item => isFileFactVerificationTodoTitle(item.title))) {
    return [
      ...updated,
      {
        id: nextTodoId(updated),
        title: '运行自动验证 / QualityGate',
        status: 'failed' as const,
      },
    ];
  }

  const lastCompletedIndex = updated
    .map((item, index) => ({ item, index }))
    .reverse()
    .find(({ item }) => item.status === 'completed')?.index;
  if (lastCompletedIndex === undefined) return updated;
  return updated.map((item, index) => (
    index === lastCompletedIndex ? { ...item, status: 'failed' as const } : item
  ));
}

function getTaskMissingCompletionEvidence(task: AgentTask, evidence: TaskEvidence): string[] {
  if (!isReadOnlyAgentTaskAction(evidence.action)) return [];
  if (evidence.action === 'respond') return [];
  return getMissingCompletionEvidence(
    task.desc || task.file || '',
    [{ title: task.desc || task.file || '' }],
    [],
    evidence.terminalEvidence ?? [],
  );
}

export function isReadOnlyAgentTaskAction(action: AgentTaskAction): boolean {
  return action === 'analyze' || action === 'explain' || action === 'explore' || action === 'respond';
}

function hasTaskCompletionEvidence(evidence: TaskEvidence): boolean {
  if (!isReadOnlyAgentTaskAction(evidence.action)) {
    return Boolean(evidence.applied && evidence.path);
  }
  return Boolean(evidence.raw?.trim() || evidence.taskComplete || hasSuccessfulTerminalCompletionEvidence(evidence.terminalEvidence));
}

function hasSuccessfulTerminalCompletionEvidence(evidence: TerminalEvidence[] | undefined): boolean {
  return Boolean(evidence?.some(item =>
    item.ok && (item.kind === 'run' || item.kind === 'test' || item.kind === 'compile-run'),
  ));
}

function buildTaskSettlementFailureDetail(
  task: AgentTask,
  result: { applied?: boolean; terminalEvidence?: TerminalEvidence[] },
): string {
  const terminalFailure = findBlockingTerminalFailureEvidence(result.terminalEvidence);
  if (terminalFailure) return buildTaskTerminalFailureDetail(terminalFailure);
  const missingEvidence = getTaskMissingCompletionEvidence(task, {
    action: task.action,
    applied: result.applied,
    terminalEvidence: result.terminalEvidence,
  });
  if (missingEvidence.length > 0) {
    return `任务缺少必要完成证据：${missingEvidence.join('、')}。不能仅凭文字说明或构建命令标记完成。`;
  }
  if (!isReadOnlyAgentTaskAction(task.action) && !result.applied) {
    return '任务缺少本地写盘证据，不能标记为完成。请继续生成可应用补丁或完整文件内容。';
  }
  return '任务缺少本地验证证据，不能标记为完成。';
}

function getTaskDisplayTarget(task: Pick<AgentTask, 'file' | 'visibleTarget'>): string {
  if (task.visibleTarget) return task.visibleTarget;
  if (!task.file) return 'Agent 任务';
  const normalized = task.file.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Agent 任务';
}

function taskTodoItem(task: AgentTask, index: number, status: TodoStatus): TodoItem {
  return {
    id: index + 1,
    title: task.desc,
    status,
    __agentState: true,
  };
}

function isTaskIndex(index: number, tasks: AgentTask[]): boolean {
  return Number.isInteger(index) && index >= 0 && index < tasks.length;
}

function isTerminalStatus(status: TodoStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function findValidationTaskIndex(tasks: AgentTask[]): number {
  return tasks.findIndex(task => isAutomaticValidationTodoTitle(
    `${task.desc || ''} ${task.file || ''}`,
  ));
}

function isAutomaticValidationTodoTitle(title: string): boolean {
  return /(?:编译|运行|执行|测试|type(?:script)?|tsc|compile|build|test|run|execute|validate|qualitygate)/i.test(title);
}

function isFileFactVerificationTodoTitle(title: string): boolean {
  return /(?:文件|内容|大小|存在|创建成功|读取|检查|确认|校验|验证)/i.test(title)
    && !isAutomaticValidationTodoTitle(title);
}

function nextTodoId(todos: TodoItem[]): number {
  return Math.max(0, ...todos.map(todo => Number(todo.id) || 0)) + 1;
}
