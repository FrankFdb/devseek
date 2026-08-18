import type { CodingTerminalStatus } from '@devseek-netai/shared';
import type {
  AgentLoopCallbacks,
  AgentStatusMessage,
  DeferredAgentTerminalPresentation,
} from '../agent/loop-types';
import type { TodoItem } from '../agent/evidence-recovery';
import { settleValidationFailureTodos } from '../agent/task-state-machine';

const FINAL_ANSWER_PREFIX = '\x00ASUM\x00';

/** Buffers model-loop terminal claims until the canonical run has settled. */
export class AgentTerminalPresentationBuffer {
  private finalStatus?: AgentStatusMessage;
  private finalAnswerDelta?: string;
  private latestTodos?: TodoItem[];
  private completedCheckpointRequested = false;

  constructor(private readonly downstream: AgentLoopCallbacks) {}

  readonly onDelta = (delta: string): void => {
    if (delta.startsWith(FINAL_ANSWER_PREFIX)) {
      this.finalAnswerDelta = delta;
      return;
    }
    this.downstream.onDelta(delta);
  };

  readonly onAgentStatus = async (status: AgentStatusMessage): Promise<void> => {
    if (status.phase === 'done') {
      this.finalStatus = status;
      return;
    }
    await this.downstream.onAgentStatus(status);
    if (status.phase === 'validate' && status.state === 'failed' && this.latestTodos?.length) {
      this.latestTodos = settleValidationFailureTodos(this.latestTodos)
        .map(item => ({ ...item, __agentState: true }));
      await this.downstream.onTodoUpdate?.(cloneTodos(this.latestTodos));
    }
  };

  readonly onTodoUpdate = async (items: TodoItem[]): Promise<void> => {
    this.latestTodos = cloneTodos(items);
    if (items.length > 0 && items.every(item => item.status === 'completed')) return;
    await this.downstream.onTodoUpdate?.(cloneTodos(items));
  };

  captureCompletedCheckpoint(): void {
    this.completedCheckpointRequested = true;
  }

  snapshot(): DeferredAgentTerminalPresentation {
    return {
      ...(this.finalStatus ? { status: { ...this.finalStatus } } : {}),
      ...(this.finalAnswerDelta ? { answerDelta: this.finalAnswerDelta } : {}),
      ...(this.latestTodos ? { todos: cloneTodos(this.latestTodos) } : {}),
      completedCheckpointRequested: this.completedCheckpointRequested,
    };
  }
}

export async function deliverSettledAgentTerminalPresentation(input: {
  readonly presentation?: DeferredAgentTerminalPresentation;
  readonly status: CodingTerminalStatus;
  readonly reasonCodes?: readonly string[];
  readonly callbacks: AgentLoopCallbacks;
}): Promise<void> {
  const presentation = input.presentation;
  if (!presentation) return;
  const completed = input.status === 'completed';
  await deliverSettledAgentTodoPresentation(input);

  if (completed) {
    await input.callbacks.onAgentStatus(presentation.status ?? {
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      title: '任务已完成',
    });
    if (presentation.answerDelta) input.callbacks.onDelta(presentation.answerDelta);
    if (presentation.completedCheckpointRequested) {
      await input.callbacks.onTaskCheckpoint?.(null, [], 'completed');
    }
    return;
  }

  const failure = terminalFailurePresentation(input.status, input.reasonCodes ?? []);
  await input.callbacks.onAgentStatus(failure.status);
  input.callbacks.onDelta(`${FINAL_ANSWER_PREFIX}${failure.answer}`);
}

/** Settles a nested agent task's todos without projecting it as the outer task's terminal answer. */
export async function deliverSettledAgentTodoPresentation(input: {
  readonly presentation?: DeferredAgentTerminalPresentation;
  readonly status: CodingTerminalStatus;
  readonly reasonCodes?: readonly string[];
  readonly callbacks: Pick<AgentLoopCallbacks, 'onTodoUpdate'>;
}): Promise<void> {
  const todos = input.presentation?.todos ? settleTerminalTodos(
    input.presentation.todos,
    input.status,
    input.reasonCodes ?? [],
  ) : [];
  if (todos.length > 0) await input.callbacks.onTodoUpdate?.(todos);
}

function settleTerminalTodos(
  todos: readonly TodoItem[],
  status: CodingTerminalStatus,
  reasonCodes: readonly string[],
): TodoItem[] {
  const snapshot = cloneTodos(todos);
  if (status === 'completed') {
    return snapshot.map(item => ({ ...item, status: 'completed', __agentState: true }));
  }
  if (reasonCodes.some(code => code.includes('verification') || code.includes('review'))) {
    return settleValidationFailureTodos(snapshot)
      .map(item => ({ ...item, __agentState: true }));
  }
  const activeIndex = snapshot.findIndex(item => item.status === 'in-progress');
  const completedIndex = snapshot
    .map((item, index) => ({ item, index }))
    .reverse()
    .find(({ item }) => item.status === 'completed')?.index;
  const failedIndex = activeIndex >= 0 ? activeIndex : completedIndex ?? snapshot.length - 1;
  return snapshot.map((item, index) => (
    index === failedIndex
      ? { ...item, status: 'failed', __agentState: true }
      : item.status === 'in-progress'
        ? { ...item, status: 'not-started', __agentState: true }
        : { ...item, __agentState: true }
  ));
}

function terminalFailurePresentation(
  status: Exclude<CodingTerminalStatus, 'completed'>,
  reasonCodes: readonly string[],
): { status: AgentStatusMessage; answer: string } {
  const verificationFailed = reasonCodes.some(code => code.includes('verification') || code.includes('review'));
  const blocked = status === 'blocked';
  const title = verificationFailed
    ? '任务未完成：验证或复核未通过'
    : blocked
      ? '任务尚未完成：仍缺少可交付证据'
      : status === 'cancelled'
        ? '任务已取消'
        : '任务执行未完成';
  const detail = verificationFailed
    ? '已保留实际文件和命令结果，但不会把未通过验证的任务标记为完成。'
    : '已保留实际执行结果，并将本轮状态按最终证据结算。';
  return {
    status: {
      type: 'agentStatus',
      phase: 'done',
      state: status === 'cancelled' ? 'skipped' : 'failed',
      title,
      detail,
    },
    answer: `${title}。${detail}`,
  };
}

function cloneTodos(items: readonly TodoItem[]): TodoItem[] {
  return items.map(item => ({ ...item }));
}
