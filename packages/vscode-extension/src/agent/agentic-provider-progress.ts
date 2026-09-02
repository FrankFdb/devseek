import {
  redactCodingSecretsInText,
  type CodingToolExecutionReceipt,
  type CodingVerificationReceipt,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import type { ChatMessage } from '../llm/types';
import {
  coalesceWrittenFileEvidence,
  resolveCurrentTerminalEvidenceState,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { RequirementReviewCompletionObligation } from './requirement-review-ledger';

export const AGENTIC_PROVIDER_PROGRESS_VERSION = 'devseek.agentic-provider-progress/v1' as const;
export const AGENTIC_PROVIDER_PROGRESS_MARKER = '[DevSeek Provider Recovery Progress]';

const MAX_PROGRESS_MESSAGE_CHARS = 7_500;
const MAX_PROJECTED_ITEMS = 8;

export interface AgenticProviderProgressInput {
  readonly progressEpoch: number;
  readonly currentTodos: readonly TodoItem[];
  readonly readEvidencePaths: readonly string[];
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly toolExecutionReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly currentSourceValidated: boolean;
  readonly missingEvidence: readonly string[];
  readonly completionObligation?: RequirementReviewCompletionObligation;
}

/** Projects receipt-backed local progress into a bounded fresh-Provider fact frontier. */
export class AgenticProviderProgressService {
  constructor(private readonly workspaceRoot: string) {}

  render(input: AgenticProviderProgressInput): string {
    const terminal = resolveCurrentTerminalEvidenceState(input.terminalEvidence, 3);
    const writtenFiles = coalesceWrittenFileEvidence(input.writtenFiles, this.workspaceRoot)
      .slice(-MAX_PROJECTED_ITEMS)
      .map(file => ({
        path: boundedText(file.path, 220),
        action: file.action,
        linesAdded: file.linesAdded,
        linesRemoved: file.linesRemoved,
      }));
    const completedActions = input.toolExecutionReceipts
      .filter(receipt => receipt.status === 'completed' && receipt.effects.some(effect => effect !== 'read'))
      .slice(-MAX_PROJECTED_ITEMS)
      .map(receipt => ({
        sequence: receipt.sequence,
        actionId: receipt.actionId,
        tool: receipt.tool,
        purpose: receipt.purpose,
        inputSha256: receipt.inputSha256,
        evidenceRefs: receipt.evidenceRefs.slice(-3).map(ref => boundedText(ref, 220)),
      }));
    const committedMutations = input.changeReceipts
      .filter(receipt => receipt.status === 'committed')
      .slice(-MAX_PROJECTED_ITEMS)
      .map(receipt => ({
        sequence: receipt.sequence,
        actionId: receipt.actionId,
        paths: receipt.paths.slice(0, 4).map(path => boundedText(path, 220)),
        readbackRef: boundedText(receipt.readbackRef ?? '', 220),
        evidenceRefs: receipt.evidenceRefs.slice(-3).map(ref => boundedText(ref, 220)),
      }));
    const verification = currentVerificationReceipts(input.verificationReceipts)
      .slice(-MAX_PROJECTED_ITEMS)
      .map(receipt => ({
        sequence: receipt.sequence,
        actionId: receipt.actionId,
        verifier: boundedText(receipt.verifier, 180),
        status: receipt.status,
        scopePaths: receipt.scopePaths.slice(0, 4).map(path => boundedText(path, 220)),
        checks: receipt.checks.map(check => check.status).slice(0, 12),
        evidenceRefs: receipt.evidenceRefs.slice(-3).map(ref => boundedText(ref, 220)),
      }));
    const terminalFacts = terminal.facts.map(fact => ({
      kind: fact.kind,
      ok: fact.ok,
      exitCode: fact.exitCode,
      command: boundedText(fact.command, 360),
      detail: boundedText(fact.detail ?? '', 500),
      actionId: fact.canonicalAction?.actionId,
    }));
    const pendingTodos = input.currentTodos
      .filter(todo => todo.status !== 'completed')
      .slice(0, MAX_PROJECTED_ITEMS)
      .map(todo => ({ id: todo.id, title: boundedText(todo.title, 260), status: todo.status }));
    const nextAction = resolveNextAction({
      hasWrites: writtenFiles.length > 0,
      currentSourceValidated: input.currentSourceValidated,
      blockingFailure: terminal.blockingFailure,
      completionObligation: input.completionObligation,
      missingEvidence: input.missingEvidence,
    });
    const lines = [
      AGENTIC_PROVIDER_PROGRESS_MARKER,
      `protocol: ${AGENTIC_PROVIDER_PROGRESS_VERSION}`,
      'authority: local receipts and current workspace facts; this projection is context, not permission',
      `progressEpoch: ${nonNegativeInteger(input.progressEpoch)}`,
      `sourceState: ${safeJson({
        writeEventCount: input.writtenFiles.length,
        projectedArtifactCount: writtenFiles.length,
        currentSourceValidated: input.currentSourceValidated,
      })}`,
      `writtenFiles: ${safeJson(writtenFiles)}`,
      `completedActions: ${safeJson(completedActions)}`,
      `committedMutations: ${safeJson(committedMutations)}`,
      `currentVerificationReceipts: ${safeJson(verification)}`,
      `currentTerminalFacts: ${safeJson(terminalFacts)}`,
      `readEvidencePaths: ${safeJson(uniqueBounded(input.readEvidencePaths, MAX_PROJECTED_ITEMS, 220))}`,
      `pendingTodos: ${safeJson(pendingTodos)}`,
      `missingEvidence: ${safeJson(uniqueBounded(input.missingEvidence, MAX_PROJECTED_ITEMS, 260))}`,
      `completionObligation: ${safeJson(input.completionObligation ? {
        kind: input.completionObligation.kind,
        blocker: boundedText(input.completionObligation.blocker, 700),
      } : null)}`,
      `nextAction: ${nextAction}`,
      'Do not repeat completed mutations or restart the task. Continue only from nextAction and unresolved evidence.',
    ];
    return fitWholeLines(lines, MAX_PROGRESS_MESSAGE_CHARS);
  }
}

export function upsertAgenticProviderProgressMessage(messages: ChatMessage[], content: string): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isAgenticProviderProgressMessage(messages[index])) messages.splice(index, 1);
  }
  const message: ChatMessage = { role: 'user', content };
  const insertAt = messages.length > 1 ? messages.length - 1 : messages.length;
  messages.splice(insertAt, 0, message);
}

export function isAgenticProviderProgressMessage(message: ChatMessage): boolean {
  return message.role === 'user'
    && typeof message.content === 'string'
    && message.content.trimStart().startsWith(AGENTIC_PROVIDER_PROGRESS_MARKER);
}

function resolveNextAction(input: {
  readonly hasWrites: boolean;
  readonly currentSourceValidated: boolean;
  readonly blockingFailure?: TerminalEvidence;
  readonly completionObligation?: RequirementReviewCompletionObligation;
  readonly missingEvidence: readonly string[];
}): string {
  if (input.completionObligation?.kind === 'source-repair') {
    return 'repair only the active independent-review finding, then validate the new write cohort';
  }
  if (input.blockingFailure) {
    return `repair the active validation failure: ${boundedText(input.blockingFailure.detail || input.blockingFailure.command, 500)}`;
  }
  if (input.hasWrites && !input.currentSourceValidated) {
    return 'validate the current write cohort before proposing another mutation';
  }
  if (input.completionObligation) {
    return `satisfy the pending ${input.completionObligation.kind} obligation without reimplementing completed work`;
  }
  if (input.missingEvidence.length > 0) {
    return `collect the missing completion evidence: ${uniqueBounded(input.missingEvidence, 4, 180).join(', ')}`;
  }
  if (input.hasWrites && input.currentSourceValidated) {
    return 'settle final review and completion from the validated current source; do not rewrite it';
  }
  return 'continue the original task from the pending todo and current workspace facts';
}

function currentVerificationReceipts(
  receipts: readonly CodingVerificationReceipt[],
): CodingVerificationReceipt[] {
  const latestByScope = new Map<string, CodingVerificationReceipt>();
  for (const receipt of receipts) {
    const scope = [...receipt.scopePaths].sort().join('\u0000');
    const key = `${receipt.runId}\u0000${receipt.verifier}\u0000${scope}`;
    const current = latestByScope.get(key);
    if (!current || receipt.sequence >= current.sequence) latestByScope.set(key, receipt);
  }
  return [...latestByScope.values()].sort((left, right) => left.sequence - right.sequence);
}

function uniqueBounded(values: readonly string[], limit: number, maxChars: number): string[] {
  return [...new Set(values.map(value => boundedText(value, maxChars)).filter(Boolean))].slice(-limit);
}

function boundedText(value: string, maxChars: number): string {
  const redacted = redactCodingSecretsInText(String(value ?? ''), { replacement: '[REDACTED_SECRET]' }).text
    .replace(/\s+/gu, ' ')
    .trim();
  return redacted.length <= maxChars ? redacted : `${redacted.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

function fitWholeLines(lines: readonly string[], maxChars: number): string {
  const retained: string[] = [];
  let length = 0;
  for (const line of lines) {
    const additional = line.length + (retained.length > 0 ? 1 : 0);
    if (length + additional > maxChars) {
      const notice = 'projectionTruncated: true';
      while (retained.length > 1
        && retained.join('\n').length + notice.length + 1 > maxChars) {
        retained.pop();
      }
      if (retained.join('\n').length + notice.length + 1 <= maxChars) retained.push(notice);
      break;
    }
    retained.push(line);
    length += additional;
  }
  return retained.join('\n');
}

function nonNegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
