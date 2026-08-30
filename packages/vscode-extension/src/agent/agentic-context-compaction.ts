import type {
  CodingCheckpointPendingUnitInput,
  CodingContextCompactionReceipt,
  CodingContextCompactionSessionPort,
  CodingContextCompactionTrigger,
} from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import type { TodoItem } from './evidence-recovery';
import type { TextToolProtocolSession } from './text-tool-protocol';
import type { ProviderVisibleReadExposure } from './tool-loop-result';
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
const TOOL_FEEDBACK_SEPARATOR = '\n\n';

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
  readonly textToolProtocol: TextToolProtocolSession;
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

export interface AgenticToolFeedbackProjection {
  readonly message: string;
  readonly readExposures: readonly ProviderVisibleReadExposure[];
}

/**
 * Projects independently executed tool results into one bounded provider turn.
 * Every result keeps an identity and an explicit continuation instead of being
 * silently lost to whole-message head/tail truncation.
 */
export function projectAgenticToolFeedback(
  round: number,
  segments: readonly string[],
): AgenticToolFeedbackProjection {
  const prefix = `[工具结果 Round ${positiveInteger(round, 'invalid-round')}]\n`;
  const normalized = segments
    .map((segment, sourceSegmentIndex) => ({
      content: String(segment ?? '').trim(),
      sourceSegmentIndex,
    }))
    .filter(segment => Boolean(segment.content));
  if (normalized.length === 0) return { message: prefix.trimEnd(), readExposures: [] };

  const bodyBudget = AGENTIC_TOOL_FEEDBACK_CHAR_BUDGET - prefix.length;
  const separatorBudget = TOOL_FEEDBACK_SEPARATOR.length * Math.max(0, normalized.length - 1);
  const segmentBudgets = allocateFairBudgets(
    normalized.map(segment => segment.content.length),
    Math.max(0, bodyBudget - separatorBudget),
  );
  const projected = normalized.map((segment, index) => compactToolFeedbackSegment(
    segment.content,
    segmentBudgets[index],
    index,
    normalized.length,
    segment.sourceSegmentIndex,
  ));
  return {
    message: `${prefix}${projected.map(result => result.content).join(TOOL_FEEDBACK_SEPARATOR)}`,
    readExposures: projected.flatMap(result => result.readExposures),
  };
}

/** Owns the agentic history budget and delegates semantic pruning to the Kernel session. */
export function compactAgenticMessageHistory(input: AgenticMessageCompactionInput): number {
  replaceAllAssistantToolHistory(input.messages, input.textToolProtocol);
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

function allocateFairBudgets(lengths: readonly number[], totalBudget: number): number[] {
  const budgets = lengths.map(() => 0);
  let remainingBudget = Math.max(0, totalBudget);
  let pending = lengths.map((length, index) => ({ length, index }));
  while (pending.length > 0) {
    const share = Math.floor(remainingBudget / pending.length);
    const complete = pending.filter(item => item.length <= share);
    if (complete.length === 0) {
      pending.forEach((item, offset) => {
        budgets[item.index] = share + (offset < remainingBudget % pending.length ? 1 : 0);
      });
      break;
    }
    const completeIndexes = new Set(complete.map(item => item.index));
    for (const item of complete) {
      budgets[item.index] = item.length;
      remainingBudget -= item.length;
    }
    pending = pending.filter(item => !completeIndexes.has(item.index));
  }
  return budgets;
}

function compactToolFeedbackSegment(
  segment: string,
  maxChars: number,
  index: number,
  total: number,
  sourceSegmentIndex: number,
): { content: string; readExposures: readonly ProviderVisibleReadExposure[] } {
  if (segment.length <= maxChars) {
    return { content: segment, readExposures: parseCompleteReadExposure(segment, sourceSegmentIndex) };
  }
  if (maxChars <= 0) return { content: '', readExposures: [] };
  const readProjection = compactReadFileFeedback(segment, maxChars, index, total, sourceSegmentIndex);
  if (readProjection) return readProjection;

  const firstLine = segment.split(/\r?\n/u, 1)[0]?.trim() || 'tool-result';
  const omitted = Math.max(1, segment.length - maxChars);
  const notice = `[DevSeek 工具结果 ${index + 1}/${total} 已压缩 ${omitted} 字符；请针对 ${firstLine} 重新发起精确查询。]`;
  return { content: retainFeedbackHeadAndTail(segment, notice, maxChars), readExposures: [] };
}

function compactReadFileFeedback(
  segment: string,
  maxChars: number,
  index: number,
  total: number,
  sourceSegmentIndex: number,
): { content: string; readExposures: readonly ProviderVisibleReadExposure[] } | undefined {
  const lines = segment.split(/\r?\n/u);
  const pathMatch = /^\[read_file:\s*(.+?)\]$/u.exec(lines[0]?.trim() ?? '');
  const metadataEnd = lines.findIndex(line => line.trim() === '[/file_context]');
  const returnedMatch = /^returnedLines=(\d+)-(\d+)\/(\d+)$/u.exec(
    lines.find(line => /^returnedLines=/u.test(line.trim()))?.trim() ?? '',
  );
  if (!pathMatch || metadataEnd < 0 || !returnedMatch) return undefined;

  const sourceLines = lines.slice(metadataEnd + 1);
  const returnedStart = Number(returnedMatch[1]);
  const returnedEnd = Number(returnedMatch[2]);
  if (sourceLines.length < 3 || returnedEnd - returnedStart + 1 !== sourceLines.length) return undefined;

  const identity = [
    lines[0],
    '[file_context]',
    `returnedLines=${returnedMatch[1]}-${returnedMatch[2]}/${returnedMatch[3]}`,
    'contextProjection=devseek-coherent-tool-feedback/v2',
    '[/file_context]',
  ];
  const render = (visibleLineCount: number): string => {
    const omittedStart = returnedStart + visibleLineCount;
    const notice = omittedStart <= returnedEnd
      ? `[DevSeek 读取结果 ${index + 1}/${total} 已压缩；文件行 ${omittedStart}-${returnedEnd} 存在但尚未交付给模型，严禁据此判断代码缺失或修改该文件。必须继续：read_file 使用同一 path，startLine=${omittedStart}, endLine=${returnedEnd}。]`
      : '';
    return [
      ...identity,
      ...sourceLines.slice(0, visibleLineCount),
      notice,
    ].filter(Boolean).join('\n');
  };

  let visibleLineCount = 0;
  let projected = render(visibleLineCount);
  if (projected.length > maxChars) {
    const notice = `[DevSeek 读取结果 ${index + 1}/${total} 已压缩；继续：read_file 使用同一 path 和更小行范围。]`;
    return { content: retainFeedbackHeadAndTail(lines[0], notice, maxChars), readExposures: [] };
  }
  while (visibleLineCount < sourceLines.length) {
    const candidate = render(visibleLineCount + 1);
    if (candidate.length > maxChars) break;
    visibleLineCount += 1;
    projected = candidate;
  }
  const readExposures: ProviderVisibleReadExposure[] = [];
  if (visibleLineCount > 0) {
    readExposures.push({
      path: pathMatch[1],
      startLine: returnedStart,
      endLine: returnedStart + visibleLineCount - 1,
      totalLines: Number(returnedMatch[3]),
      sourceSegmentIndex,
      sourceRangeStartLine: returnedStart,
      sourceRangeEndLine: returnedEnd,
    });
  }
  return { content: projected, readExposures };
}

function parseCompleteReadExposure(
  segment: string,
  sourceSegmentIndex: number,
): readonly ProviderVisibleReadExposure[] {
  const path = /^\[read_file:\s*(.+?)\]$/mu.exec(segment)?.[1];
  const returned = /^returnedLines=(\d+)-(\d+)\/(\d+)$/mu.exec(segment);
  if (!path || !returned) return [];
  return [{
    path,
    startLine: Number(returned[1]),
    endLine: Number(returned[2]),
    totalLines: Number(returned[3]),
    sourceSegmentIndex,
    sourceRangeStartLine: Number(returned[1]),
    sourceRangeEndLine: Number(returned[2]),
  }];
}

function retainFeedbackHeadAndTail(text: string, notice: string, maxChars: number): string {
  if (notice.length >= maxChars) return notice.slice(0, maxChars);
  const contentBudget = Math.max(0, maxChars - notice.length - 2);
  const headChars = Math.ceil(contentBudget * 0.58);
  const tailChars = contentBudget - headChars;
  return `${text.slice(0, headChars).trimEnd()}\n${notice}\n${text.slice(-tailChars).trimStart()}`
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
