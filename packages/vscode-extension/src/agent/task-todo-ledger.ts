import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import {
  findBlockingTerminalFailureEvidence,
  type TerminalEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';

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
      const completed = !terminalFailure && hasTaskCompletionEvidence(evidence);
      const failed = Boolean(terminalFailure) || (!completed && !isReadOnlyAgentTaskAction(evidence.action));
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

export function isReadOnlyAgentTaskAction(action: AgentTaskAction): boolean {
  return action === 'analyze' || action === 'explain' || action === 'explore' || action === 'respond';
}

function hasTaskCompletionEvidence(evidence: TaskEvidence): boolean {
  if (!isReadOnlyAgentTaskAction(evidence.action)) {
    return Boolean(evidence.applied && evidence.path);
  }
  return Boolean(evidence.raw?.trim() || evidence.taskComplete);
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
  return tasks.findIndex(task => /编译|构建|运行|测试|验证|compile|build|run|test|validate|qualitygate/i.test(
    `${task.desc || ''} ${task.file || ''}`,
  ));
}
