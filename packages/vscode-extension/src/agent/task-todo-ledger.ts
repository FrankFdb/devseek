import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import type { AgentStatusEvent } from './events';
import {
  findBlockingTerminalFailureEvidence,
  getMissingCompletionEvidence,
  requiresCodeArtifactForEvidence,
  requiresCommandEvidence,
  requiresFileCheckEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  type TerminalEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import { buildTaskTerminalFailureDetail } from './task-execution-result';

type TodoStatus = TodoItem['status'];
type LinearTodoInput = Pick<TodoItem, 'title'> & Partial<Pick<TodoItem, 'status' | '__agentState'>>;

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

export function createLinearAgentTodos(items: LinearTodoInput[]): TodoItem[] {
  return items.map((item, index) => ({
    id: index + 1,
    title: item.title,
    status: item.status ?? (index === 0 ? 'in-progress' : 'not-started'),
    ...(item.__agentState ? { __agentState: true } : {}),
  }));
}

export function completeAgentTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map(item => ({ ...item, status: 'completed' as const, __agentState: true }));
}

export function advanceLinearAgentTodo(
  todos: TodoItem[],
  completedIndex: number,
  nextIndex?: number,
): TodoItem[] {
  return todos.map((item, index) => {
    if (index === completedIndex) return { ...item, status: 'completed' as const };
    if (nextIndex !== undefined && index === nextIndex && item.status !== 'completed' && item.status !== 'failed') {
      return { ...item, status: 'in-progress' as const };
    }
    return item;
  });
}

export function failLinearAgentTodo(todos: TodoItem[], failedIndex: number): TodoItem[] {
  return todos.map((todo, todoIndex) => (
    todoIndex === failedIndex
      ? { ...todo, status: 'failed' as const }
      : todo.status === 'in-progress'
        ? { ...todo, status: 'not-started' as const }
        : todo
  ));
}

export function settleMissingEvidenceTodos(todos: TodoItem[], missing: string[]): TodoItem[] {
  if (!todos.length || !missing.length) return todos;
  const needsCode = missing.some(m => m.includes('代码') || m.includes('程序'));
  const needsCommand = missing.some(m => m.includes('编译') || m.includes('运行') || m.includes('测试') || m.includes('成功'));
  const needsRead = missing.some(m => m.includes('读取') || m.includes('检查'));
  let firstMissing = true;
  return todos.map(item => {
    const title = item.title.toLowerCase();
    const matchesCode = needsCode && /(?:代码|源码|程序|脚本|实现|动画|开发)/i.test(title);
    const matchesCommand = needsCommand && /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run)/i.test(title);
    const matchesRead = needsRead && /(?:读取|检查|查看|显示|确认|验证|校验|read|inspect|check|show|verify|validate)/i.test(title);
    if (!matchesCode && !matchesCommand && !matchesRead) return item;
    const status = firstMissing ? 'in-progress' as const : 'not-started' as const;
    firstMissing = false;
    return { ...item, status };
  });
}

export function appendQualityGateTodo(todos: TodoItem[], status: Extract<TodoStatus, 'completed' | 'failed'>): TodoItem[] {
  return [
    ...todos,
    {
      id: nextTodoId(todos),
      title: '运行自动验证 / QualityGate',
      status,
    },
  ];
}

export function inferInitialAgenticTodos(userPrompt: string): TodoItem[] {
  const items: LinearTodoInput[] = [];
  const needsRead = requiresReadEvidence(userPrompt);
  const needsFile = requiresFileChangeEvidence(userPrompt);
  const needsCode = requiresCodeArtifactForEvidence(userPrompt);
  const needsFileCheck = requiresFileCheckEvidence(userPrompt);
  const needsCommand = !needsFileCheck && (requiresCommandEvidence(userPrompt) || /(?:程序|代码|动画|运行效果|效果)/i.test(userPrompt));
  if (needsRead) {
    items.push({ title: '检查/读取目标文件', status: 'in-progress' });
  }
  if (needsFile) {
    items.push({ title: needsCode ? '创建/更新代码文件' : '创建/更新文件', status: 'in-progress' });
  }
  if (needsCommand) {
    items.push({ title: '编译/运行并验证结果', status: needsCode ? 'not-started' : 'in-progress' });
  }
  if (needsFileCheck) {
    items.push({ title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: needsFile ? 'not-started' : 'in-progress' });
  }
  if (!items.length && /(?:查找|定位|分析|确认|排查|检查)/i.test(userPrompt)) {
    items.push({ title: '分析并定位问题', status: 'in-progress' });
  }
  return createLinearAgentTodos(items);
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
