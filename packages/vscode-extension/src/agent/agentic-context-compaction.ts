import type {
  CodingCheckpointPendingUnitInput,
  CodingContextCompactionReceipt,
  CodingContextCompactionSessionPort,
  CodingContextCompactionTrigger,
} from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import type { TodoItem } from './evidence-recovery';
import {
  CONTEXT_COMPACTION_SUMMARY_MARKER,
  compactAgentMessageHistoryWithFidelity,
  redactAgentMessageHistory,
  replaceAllAssistantToolHistory,
} from './agent-history-compaction';

const FINALIZE_UNIT_ID = 'agentic:finalize';
const AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET = 52_000;
const AGENTIC_TASK_PROMPT_CHAR_BUDGET = 34_000;
const AGENTIC_TOOL_FEEDBACK_CHAR_BUDGET = 8_000;
const AGENTIC_ASSISTANT_HISTORY_CHAR_BUDGET = 6_000;
const AGENTIC_USER_HISTORY_CHAR_BUDGET = 8_000;
const AGENTIC_RECENT_MESSAGE_KEEP_COUNT = 5;

export interface AgenticCompactionEvidenceRef {
  readonly evidenceId?: string;
  readonly operationId?: string;
  readonly ref?: string;
  readonly contentHash?: string;
  readonly kind: string;
  readonly label: string;
}

export interface AgenticMessageCompactionInput {
  readonly messages: ChatMessage[];
  readonly session?: CodingContextCompactionSessionPort;
  readonly currentTodos: readonly TodoItem[];
  readonly workspaceRoot: string;
  readonly round: number;
  readonly evidenceRefs: readonly AgenticCompactionEvidenceRef[];
  readonly trigger?: CodingContextCompactionTrigger;
}

export interface AgenticContextCompactionInput {
  readonly messages: ChatMessage[];
  readonly session: CodingContextCompactionSessionPort;
  readonly currentTodos: readonly TodoItem[];
  readonly workspaceRoot: string;
  readonly observedChars: number;
  readonly maxChars: number;
  readonly maxMessages: number;
  readonly round: number;
  readonly evidenceRefs?: readonly string[];
  readonly trigger?: CodingContextCompactionTrigger;
}

/** Owns the agentic history budget and delegates semantic pruning to the Kernel session. */
export function compactAgenticMessageHistory(input: AgenticMessageCompactionInput): number {
  replaceAllAssistantToolHistory(input.messages);
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index];
    if (typeof message.content !== 'string') continue;
    message.content = truncateHistoryText(
      message.content,
      messageBudgetFor(message, index),
      index === 0 ? '任务上下文' : message.role === 'assistant' ? '模型历史回复' : '工具反馈/用户补充',
    );
  }
  let total = totalMessageChars(input.messages);
  if (total <= AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET) return total;
  if (input.messages.length > AGENTIC_RECENT_MESSAGE_KEEP_COUNT + 1) {
    if (!input.session) compactionFailure('missing-canonical-owner');
    compactCanonicalAgenticHistory({
      messages: input.messages,
      session: input.session,
      currentTodos: input.currentTodos,
      workspaceRoot: input.workspaceRoot,
      observedChars: total,
      maxChars: AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET,
      maxMessages: AGENTIC_RECENT_MESSAGE_KEEP_COUNT + 2,
      round: input.round,
      evidenceRefs: projectEvidenceRefs(input.evidenceRefs),
      trigger: input.trigger,
    });
    total = totalMessageChars(input.messages);
  }
  if (total <= AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET) return total;
  for (let index = 1; index < input.messages.length - 1; index += 1) {
    const message = input.messages[index];
    if (typeof message.content !== 'string') continue;
    if (message.content.trimStart().startsWith(CONTEXT_COMPACTION_SUMMARY_MARKER)) continue;
    message.content = truncateHistoryText(message.content, 2_500, '早期轮次历史');
  }
  return fitWithinTotalBudget(input.messages);
}

/** Binds transport pruning to the Kernel-owned semantic compaction receipt. */
export function compactCanonicalAgenticHistory(
  input: AgenticContextCompactionInput,
): CodingContextCompactionReceipt {
  if (!input.session) compactionFailure('missing-canonical-owner');
  const progress = projectCompactionProgress(input.session, input.currentTodos, input.workspaceRoot);
  const redactedSecretCount = redactAgentMessageHistory(input.messages);
  const receipt = input.session.compact({
    trigger: input.trigger ?? 'budget-exceeded',
    observedChars: input.observedChars,
    maxChars: input.maxChars,
    completedUnitCount: progress.completedUnitCount,
    pendingUnits: progress.pendingUnits,
    evidenceRefs: [
      `agentic:context-budget:round-${positiveInteger(input.round, 'invalid-round')}`,
      ...(input.evidenceRefs ?? []),
    ],
    redactedSecretCount,
  });
  compactAgentMessageHistoryWithFidelity(input.messages, {
    receipt,
    maxMessages: positiveInteger(input.maxMessages, 'invalid-max-messages'),
  });
  return receipt;
}

function projectCompactionProgress(
  session: CodingContextCompactionSessionPort,
  todos: readonly TodoItem[],
  workspaceRoot: string,
): {
  readonly completedUnitCount: number;
  readonly pendingUnits: readonly CodingCheckpointPendingUnitInput[];
} {
  const normalized = snapshotTodos(todos);
  const previousReceipts = session.receipts();
  const previous = previousReceipts[previousReceipts.length - 1];
  if (!previous) {
    return {
      completedUnitCount: normalized.filter(todo => todo.status === 'completed').length,
      pendingUnits: [
        ...normalized
          .filter(todo => todo.status !== 'completed')
          .map(todo => todoUnit(todo, workspaceRoot)),
        finalizeUnit(workspaceRoot),
      ],
    };
  }

  const currentById = new Map(normalized.map(todo => [`agentic:todo:${todo.id}`, todo]));
  const previousTodoIds = new Set(previous.pendingUnits
    .filter(unit => unit.id !== FINALIZE_UNIT_ID)
    .map(unit => unit.id));
  const expanded = normalized.find(todo => (
    todo.status !== 'completed' && !previousTodoIds.has(`agentic:todo:${todo.id}`)
  ));
  if (expanded) compactionFailure('pending-plan-expanded');

  let completedSincePrevious = 0;
  const pendingUnits: CodingCheckpointPendingUnitInput[] = [];
  for (const unit of previous.pendingUnits) {
    if (unit.id === FINALIZE_UNIT_ID) {
      pendingUnits.push(finalizeUnit(workspaceRoot));
      continue;
    }
    const todo = currentById.get(unit.id);
    if (!todo) {
      pendingUnits.push(copyUnit(unit));
      continue;
    }
    if (todo.title !== unit.description) compactionFailure('pending-plan-drift');
    if (todo.status === 'completed') {
      completedSincePrevious += 1;
      continue;
    }
    pendingUnits.push(copyUnit(unit));
  }
  return {
    completedUnitCount: previous.completedUnitCount + completedSincePrevious,
    pendingUnits,
  };
}

function snapshotTodos(todos: readonly TodoItem[]): readonly TodoItem[] {
  if (!Array.isArray(todos)) compactionFailure('invalid-todos');
  const normalized = todos.map(todo => {
    if (!todo || !Number.isSafeInteger(todo.id) || !String(todo.title ?? '').trim()) {
      compactionFailure('invalid-todo');
    }
    if (!['not-started', 'in-progress', 'completed', 'failed'].includes(todo.status)) {
      compactionFailure('invalid-todo-status');
    }
    return Object.freeze({ id: todo.id, title: todo.title.trim(), status: todo.status });
  });
  if (new Set(normalized.map(todo => todo.id)).size !== normalized.length) {
    compactionFailure('duplicate-todo');
  }
  return Object.freeze(normalized);
}

function todoUnit(todo: TodoItem, workspaceRoot: string): CodingCheckpointPendingUnitInput {
  return Object.freeze({
    id: `agentic:todo:${todo.id}`,
    description: todo.title,
    action: 'workspace-task',
    target: requireRoot(workspaceRoot),
    effectClass: 'workspace-mutation',
  });
}

function finalizeUnit(workspaceRoot: string): CodingCheckpointPendingUnitInput {
  return Object.freeze({
    id: FINALIZE_UNIT_ID,
    description: 'Revalidate task acceptance and settle the terminal result',
    action: 'verify',
    target: requireRoot(workspaceRoot),
    effectClass: 'verification',
  });
}

function copyUnit(unit: CodingCheckpointPendingUnitInput): CodingCheckpointPendingUnitInput {
  return Object.freeze({
    id: unit.id,
    description: unit.description,
    ...(unit.action ? { action: unit.action } : {}),
    ...(unit.target ? { target: unit.target } : {}),
    ...(unit.effectClass ? { effectClass: unit.effectClass } : {}),
  });
}

function messageBudgetFor(message: ChatMessage, index: number): number {
  if (typeof message.content !== 'string') return Number.POSITIVE_INFINITY;
  if (message.content.trimStart().startsWith(CONTEXT_COMPACTION_SUMMARY_MARKER)) {
    return Number.POSITIVE_INFINITY;
  }
  if (index === 0) return AGENTIC_TASK_PROMPT_CHAR_BUDGET;
  if (isToolFeedback(message.content)) return AGENTIC_TOOL_FEEDBACK_CHAR_BUDGET;
  return message.role === 'assistant'
    ? AGENTIC_ASSISTANT_HISTORY_CHAR_BUDGET
    : AGENTIC_USER_HISTORY_CHAR_BUDGET;
}

function isToolFeedback(content: string): boolean {
  return /^\s*\[工具结果 Round \d+\]/u.test(content)
    || /^\s*【系统反馈】/u.test(content)
    || /^\s*\[DevSeek 上下文压缩(?:事实)?\]/u.test(content);
}

function truncateHistoryText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  const notice = `[DevSeek 上下文压缩] ${label} 已压缩 ${omitted} 字符，保留首尾关键信息；如需细节，请继续用 read_file/grep_search 精确读取。`;
  const contentBudget = Math.max(0, maxChars - notice.length - 4);
  const headChars = Math.ceil(contentBudget * 0.58);
  const tailChars = contentBudget - headChars;
  return `${text.slice(0, headChars).trimEnd()}\n\n${notice}\n\n${text.slice(-tailChars).trimStart()}`
    .slice(0, maxChars);
}

function totalMessageChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + (
    typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content).length
  ), 0);
}

function fitWithinTotalBudget(messages: ChatMessage[]): number {
  let total = totalMessageChars(messages);
  for (const message of messages) {
    if (total <= AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET) return total;
    if (typeof message.content !== 'string') continue;
    if (message.content.trimStart().startsWith(CONTEXT_COMPACTION_SUMMARY_MARKER)) continue;
    const targetChars = Math.max(
      512,
      message.content.length - (total - AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET),
    );
    message.content = truncateHistoryText(message.content, targetChars, '超预算历史');
    total = totalMessageChars(messages);
  }
  if (total > AGENTIC_MESSAGE_TOTAL_CHAR_BUDGET) compactionFailure('budget-unrecoverable');
  return total;
}

function projectEvidenceRefs(evidenceRefs: readonly AgenticCompactionEvidenceRef[]): string[] {
  return [...new Set(evidenceRefs.map(evidence => (
    evidence.evidenceId
    || evidence.operationId
    || evidence.ref
    || evidence.contentHash
    || `${evidence.kind}:${evidence.label}`
  )).map(value => String(value ?? '').trim()).filter(Boolean))];
}

function requireRoot(value: string): string {
  const root = String(value ?? '').trim();
  if (!root) compactionFailure('missing-workspace-root');
  return root;
}

function positiveInteger(value: number, reason: string): number {
  if (!Number.isSafeInteger(value) || value < 1) compactionFailure(reason);
  return value;
}

function compactionFailure(reason: string): never {
  throw new Error(`agentic-context-compaction:${reason}`);
}
