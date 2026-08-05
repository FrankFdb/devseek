import type { CodingToolEffect } from './coding-conformance';
import {
  canonicalCodingJson,
  normalizeCodingErrorCode,
  normalizedCodingId,
  snapshotCodingValue,
  uniqueCodingRefs,
} from './coding-contract-utils';

export const CODING_TOOL_ACTION_VERSION = 'devseek.coding-tool-action/v1' as const;
export const CODING_TOOL_RECEIPT_VERSION = 'devseek.coding-tool-receipt/v1' as const;

export type CodingToolPermissionDecision = 'allow' | 'require-confirmation' | 'deny';
export type CodingToolAuthorityStatus = 'authorized' | 'denied';
export type CodingToolTerminalStatus = 'completed' | 'failed' | 'denied' | 'indeterminate';

export interface CodingToolAuthorityReceipt {
  readonly decision: CodingToolPermissionDecision;
  readonly status: CodingToolAuthorityStatus;
  readonly reason: string;
  readonly confirmationRef?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingToolAction<TInput> {
  readonly version: typeof CODING_TOOL_ACTION_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly tool: string;
  readonly effects: readonly CodingToolEffect[];
  readonly input: TInput;
  readonly authority: CodingToolAuthorityReceipt;
}

export interface BuildCodingToolActionInput<TInput> {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly tool: string;
  readonly effects: readonly CodingToolEffect[];
  readonly input: TInput;
  readonly authority: CodingToolAuthorityReceipt;
}

export interface CodingToolHostResult<TResult> {
  readonly status: 'completed' | 'failed' | 'indeterminate';
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingToolExecutionReceipt<TResult> {
  readonly version: typeof CODING_TOOL_RECEIPT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly tool: string;
  readonly effects: readonly CodingToolEffect[];
  readonly permission: CodingToolAuthorityReceipt;
  readonly status: CodingToolTerminalStatus;
  readonly result?: TResult;
  readonly errorCode?: string;
  readonly evidenceRefs: readonly string[];
}

export interface CodingToolExecutionOutcome<TResult> {
  readonly receipt: CodingToolExecutionReceipt<TResult>;
  readonly replayed: boolean;
}

export interface ToolExecutionHostPort<TInput, TResult> {
  execute(action: CodingToolAction<TInput>): Promise<CodingToolHostResult<TResult>>;
}

export interface CodingToolExecutionJournalRecord {
  readonly action: CodingToolAction<unknown>;
  readonly receipt: CodingToolExecutionReceipt<unknown>;
}

export interface CodingToolExecutionJournalPort {
  load(runId: string, actionId: string): Promise<CodingToolExecutionJournalRecord | undefined>;
  append(record: CodingToolExecutionJournalRecord): Promise<void>;
}

export interface ToolExecutorPort {
  execute<TInput, TResult>(
    action: CodingToolAction<TInput>,
    host: ToolExecutionHostPort<TInput, TResult>,
  ): Promise<CodingToolExecutionOutcome<TResult>>;
}

interface ActiveExecution {
  readonly canonicalAction: string;
  readonly receipt: Promise<CodingToolExecutionReceipt<unknown>>;
}

/**
 * Shared execution owner below the authority boundary. It consumes an already
 * settled authority receipt, invokes one host capability at most once per
 * action identity, and returns an immutable terminal receipt.
 */
export class CanonicalToolExecutor implements ToolExecutorPort {
  private readonly executions = new Map<string, ActiveExecution>();

  constructor(private readonly journal?: CodingToolExecutionJournalPort) {}

  async execute<TInput, TResult>(
    action: CodingToolAction<TInput>,
    host: ToolExecutionHostPort<TInput, TResult>,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const snapshot = snapshotCodingToolAction(action);
    const key = actionIdentity(snapshot);
    const canonicalAction = canonicalCodingJson(snapshot);
    const existing = this.executions.get(key);
    if (existing) {
      assertSameAction(existing.canonicalAction, canonicalAction);
      return {
        receipt: await existing.receipt as CodingToolExecutionReceipt<TResult>,
        replayed: true,
      };
    }

    const execution = this.executeOnce(snapshot, host, canonicalAction);
    this.executions.set(key, {
      canonicalAction,
      receipt: execution.then(outcome => outcome.receipt) as Promise<CodingToolExecutionReceipt<unknown>>,
    });
    return execution;
  }

  private async executeOnce<TInput, TResult>(
    action: CodingToolAction<TInput>,
    host: ToolExecutionHostPort<TInput, TResult>,
    canonicalAction: string,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const replay = await this.journal?.load(action.runId, action.actionId);
    if (replay) {
      assertSameAction(canonicalCodingJson(replay.action), canonicalAction);
      return {
        receipt: snapshotCodingToolReceipt(replay.receipt) as CodingToolExecutionReceipt<TResult>,
        replayed: true,
      };
    }

    const receipt = action.authority.status === 'authorized'
      ? await executeAuthorizedAction(action, host)
      : deniedReceipt<TResult>(action);
    if (!this.journal) return { receipt, replayed: false };

    try {
      await this.journal.append({ action, receipt });
      return { receipt, replayed: false };
    } catch {
      return {
        receipt: indeterminateReceipt<TResult>(action, receipt.evidenceRefs, 'tool-receipt-journal-failed'),
        replayed: false,
      };
    }
  }
}

export class InMemoryCodingToolExecutionJournal implements CodingToolExecutionJournalPort {
  private readonly records = new Map<string, CodingToolExecutionJournalRecord>();

  async load(runId: string, actionId: string): Promise<CodingToolExecutionJournalRecord | undefined> {
    const record = this.records.get(actionIdentity({ runId, actionId }));
    if (!record) return undefined;
    return {
      action: snapshotCodingToolAction(record.action),
      receipt: snapshotCodingToolReceipt(record.receipt),
    };
  }

  async append(record: CodingToolExecutionJournalRecord): Promise<void> {
    const action = snapshotCodingToolAction(record.action);
    const receipt = snapshotCodingToolReceipt(record.receipt);
    const key = actionIdentity(action);
    const existing = this.records.get(key);
    if (existing) {
      assertSameAction(canonicalCodingJson(existing.action), canonicalCodingJson(action));
      if (canonicalCodingJson(existing.receipt) !== canonicalCodingJson(receipt)) {
        throw new Error('coding-tool-execution:conflicting-terminal-receipt');
      }
      return;
    }
    this.records.set(key, Object.freeze({ action, receipt }));
  }
}

export function buildCodingToolAction<TInput>(
  input: BuildCodingToolActionInput<TInput>,
): CodingToolAction<TInput> {
  return snapshotCodingToolAction({
    version: CODING_TOOL_ACTION_VERSION,
    ...input,
  });
}

async function executeAuthorizedAction<TInput, TResult>(
  action: CodingToolAction<TInput>,
  host: ToolExecutionHostPort<TInput, TResult>,
): Promise<CodingToolExecutionReceipt<TResult>> {
  let hostResult: CodingToolHostResult<TResult>;
  try {
    hostResult = await host.execute(action);
  } catch {
    return uncertainHostReceipt(action, 'tool-host-threw', [`tool-host-error:${action.actionId}`]);
  }

  if (!hostResult || typeof hostResult !== 'object') {
    return uncertainHostReceipt(action, 'missing-tool-host-result', [`tool-host-result-missing:${action.actionId}`]);
  }
  const hostEvidence = uniqueCodingRefs(hostResult.evidenceRefs ?? []);
  if (hostResult.status === 'completed' && hostEvidence.length === 0) {
    return uncertainHostReceipt(action, 'missing-tool-host-evidence', [`tool-host-evidence-missing:${action.actionId}`]);
  }
  if (!['completed', 'failed', 'indeterminate'].includes(hostResult.status)) {
    return uncertainHostReceipt(action, 'invalid-tool-host-status', [`tool-host-status-invalid:${action.actionId}`]);
  }

  const evidenceRefs = uniqueCodingRefs([...action.authority.evidenceRefs, ...hostEvidence]);
  if (hostResult.status === 'failed') {
    return failedReceipt(
      action,
      normalizeCodingErrorCode(hostResult.errorCode) || 'tool-host-failed',
      evidenceRefs.length > 0 ? evidenceRefs : [`tool-host-failed:${action.actionId}`],
      hostResult.result,
    );
  }
  if (hostResult.status === 'indeterminate') {
    return indeterminateReceipt(
      action,
      evidenceRefs.length > 0 ? evidenceRefs : [`tool-host-indeterminate:${action.actionId}`],
      normalizeCodingErrorCode(hostResult.errorCode) || 'tool-host-indeterminate',
    );
  }
  return snapshotCodingToolReceipt({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: action.runId,
    sequence: action.sequence,
    actionId: action.actionId,
    tool: action.tool,
    effects: action.effects,
    permission: action.authority,
    status: 'completed',
    ...(hostResult.result === undefined ? {} : { result: hostResult.result }),
    evidenceRefs,
  });
}

function uncertainHostReceipt<TResult>(
  action: CodingToolAction<unknown>,
  errorCode: string,
  evidenceRefs: readonly string[],
): CodingToolExecutionReceipt<TResult> {
  return action.effects.every(effect => effect === 'read')
    ? failedReceipt(action, errorCode, evidenceRefs)
    : indeterminateReceipt(action, evidenceRefs, errorCode);
}

function deniedReceipt<TResult>(action: CodingToolAction<unknown>): CodingToolExecutionReceipt<TResult> {
  return snapshotCodingToolReceipt({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: action.runId,
    sequence: action.sequence,
    actionId: action.actionId,
    tool: action.tool,
    effects: action.effects,
    permission: action.authority,
    status: 'denied',
    errorCode: 'tool-authority-denied',
    evidenceRefs: action.authority.evidenceRefs,
  });
}

function failedReceipt<TResult>(
  action: CodingToolAction<unknown>,
  errorCode: string,
  evidenceRefs: readonly string[],
  result?: TResult,
): CodingToolExecutionReceipt<TResult> {
  return snapshotCodingToolReceipt({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: action.runId,
    sequence: action.sequence,
    actionId: action.actionId,
    tool: action.tool,
    effects: action.effects,
    permission: action.authority,
    status: 'failed',
    errorCode: normalizeCodingErrorCode(errorCode) || 'tool-execution-failed',
    ...(result === undefined ? {} : { result }),
    evidenceRefs: uniqueCodingRefs([...action.authority.evidenceRefs, ...evidenceRefs]),
  });
}

function indeterminateReceipt<TResult>(
  action: CodingToolAction<unknown>,
  evidenceRefs: readonly string[],
  errorCode: string,
): CodingToolExecutionReceipt<TResult> {
  return snapshotCodingToolReceipt({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: action.runId,
    sequence: action.sequence,
    actionId: action.actionId,
    tool: action.tool,
    effects: action.effects,
    permission: action.authority,
    status: 'indeterminate',
    errorCode,
    evidenceRefs: uniqueCodingRefs([...action.authority.evidenceRefs, ...evidenceRefs]),
  });
}

function snapshotCodingToolAction<TInput>(action: CodingToolAction<TInput>): CodingToolAction<TInput> {
  if (!action || typeof action !== 'object') throw new Error('coding-tool-execution:invalid-action');
  if (action.version !== CODING_TOOL_ACTION_VERSION) {
    throw new Error('coding-tool-execution:unsupported-action-version');
  }
  const runId = normalizedCodingId(action.runId, 'run-id');
  const actionId = normalizedCodingId(action.actionId, 'action-id');
  const tool = normalizedCodingId(action.tool, 'tool');
  if (!Number.isInteger(action.sequence) || action.sequence < 1) {
    throw new Error('coding-tool-execution:invalid-sequence');
  }
  const effects = uniqueEffects(action.effects);
  const authority = snapshotAuthorityReceipt(action.authority);
  const input = snapshotCodingValue(action.input, 'action-input') as TInput;
  return Object.freeze({
    version: CODING_TOOL_ACTION_VERSION,
    runId,
    sequence: action.sequence,
    actionId,
    tool,
    effects,
    input,
    authority,
  });
}

function snapshotAuthorityReceipt(authority: CodingToolAuthorityReceipt): CodingToolAuthorityReceipt {
  if (!authority || typeof authority !== 'object') {
    throw new Error('coding-tool-execution:missing-authority-receipt');
  }
  const decision = authority.decision;
  const status = authority.status;
  if (!['allow', 'require-confirmation', 'deny'].includes(decision)) {
    throw new Error('coding-tool-execution:invalid-permission-decision');
  }
  if (!['authorized', 'denied'].includes(status)) {
    throw new Error('coding-tool-execution:invalid-authority-status');
  }
  if ((decision === 'deny' && status !== 'denied') || (decision === 'allow' && status !== 'authorized')) {
    throw new Error('coding-tool-execution:inconsistent-authority-receipt');
  }
  const confirmationRef = authority.confirmationRef?.trim();
  if (decision === 'require-confirmation' && status === 'authorized' && !confirmationRef) {
    throw new Error('coding-tool-execution:missing-confirmation-reference');
  }
  const evidenceRefs = uniqueCodingRefs(authority.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-tool-execution:missing-authority-evidence');
  return Object.freeze({
    decision,
    status,
    reason: normalizedCodingId(authority.reason, 'authority-reason'),
    ...(confirmationRef ? { confirmationRef } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function snapshotCodingToolReceipt<TResult>(
  receipt: CodingToolExecutionReceipt<TResult>,
): CodingToolExecutionReceipt<TResult> {
  if (!receipt || typeof receipt !== 'object' || receipt.version !== CODING_TOOL_RECEIPT_VERSION) {
    throw new Error('coding-tool-execution:invalid-receipt');
  }
  if (!['completed', 'failed', 'denied', 'indeterminate'].includes(receipt.status)) {
    throw new Error('coding-tool-execution:invalid-receipt-status');
  }
  const evidenceRefs = uniqueCodingRefs(receipt.evidenceRefs ?? []);
  if (evidenceRefs.length === 0) throw new Error('coding-tool-execution:missing-receipt-evidence');
  const result = receipt.result === undefined
    ? undefined
    : snapshotCodingValue(receipt.result, 'tool-result') as TResult;
  return Object.freeze({
    version: CODING_TOOL_RECEIPT_VERSION,
    runId: normalizedCodingId(receipt.runId, 'receipt-run-id'),
    sequence: receipt.sequence,
    actionId: normalizedCodingId(receipt.actionId, 'receipt-action-id'),
    tool: normalizedCodingId(receipt.tool, 'receipt-tool'),
    effects: uniqueEffects(receipt.effects),
    permission: snapshotAuthorityReceipt(receipt.permission),
    status: receipt.status,
    ...(result === undefined ? {} : { result }),
    ...(receipt.errorCode ? { errorCode: normalizeCodingErrorCode(receipt.errorCode) } : {}),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function uniqueEffects(effects: readonly CodingToolEffect[]): readonly CodingToolEffect[] {
  const valid = new Set<CodingToolEffect>([
    'read',
    'process',
    'network',
    'workspace-mutation',
    'git',
    'release',
  ]);
  if (!Array.isArray(effects) || effects.length === 0 || effects.some(effect => !valid.has(effect))) {
    throw new Error('coding-tool-execution:invalid-effects');
  }
  return Object.freeze([...new Set(effects)]);
}

function actionIdentity(action: Pick<CodingToolAction<unknown>, 'runId' | 'actionId'>): string {
  return `${action.runId}\u0000${action.actionId}`;
}

function assertSameAction(existing: string, candidate: string): void {
  if (existing !== candidate) throw new Error('coding-tool-execution:conflicting-action-identity');
}
