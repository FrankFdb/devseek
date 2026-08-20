import type { TodoItem } from './evidence-recovery';

type RuntimeTodoKind = NonNullable<TodoItem['__agentKind']>;

export function completeAgentTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.map(item => ({
    ...item,
    status: 'completed',
    __agentState: true,
  }));
}

export function settleMissingEvidenceTodos(
  todos: readonly TodoItem[],
  missing: readonly string[],
): TodoItem[] {
  if (missing.length === 0) return [...todos];
  return upsertRuntimeTodo(todos, {
    kind: 'evidence-closure',
    title: '补齐任务完成证据',
    status: 'in-progress',
  });
}

export function settleValidationFailureTodos(todos: readonly TodoItem[]): TodoItem[] {
  return upsertRuntimeTodo(todos, {
    kind: 'validation',
    title: '修复并重新运行自动验证',
    status: 'failed',
  });
}

function upsertRuntimeTodo(
  todos: readonly TodoItem[],
  update: {
    kind: RuntimeTodoKind;
    title: string;
    status: TodoItem['status'];
  },
): TodoItem[] {
  let found = false;
  const next = todos.map(item => {
    if (item.__agentKind !== update.kind) return { ...item };
    found = true;
    return {
      ...item,
      title: update.title,
      status: update.status,
      __agentState: true,
    };
  });
  if (found) return next;
  return [
    ...next,
    {
      id: nextTodoId(next),
      title: update.title,
      status: update.status,
      __agentState: true,
      __agentKind: update.kind,
    },
  ];
}

function nextTodoId(todos: readonly TodoItem[]): number {
  return Math.max(0, ...todos.map(todo => Number(todo.id) || 0)) + 1;
}
