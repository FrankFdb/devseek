import {
  CODING_COMPLETION_DECISION_VERSION,
  type CodingCompletionDecision,
} from './coding-completion';
import type { CodingTerminalStatus } from './coding-conformance';
import {
  assertCodingRunLifecycleSnapshot,
  type CodingRunLifecycleSnapshot,
} from './coding-run-lifecycle';

export const CODING_SETTLEMENT_DECISION_VERSION = 'devseek.coding-settlement-decision/v1' as const;

export interface CodingSettlementDecisionInput {
  readonly lifecycle: CodingRunLifecycleSnapshot;
  readonly completion: CodingCompletionDecision;
}

export interface CodingSettlementDecision {
  readonly version: typeof CODING_SETTLEMENT_DECISION_VERSION;
  readonly runId: string;
  readonly surface: CodingRunLifecycleSnapshot['surface'];
  readonly status: CodingTerminalStatus;
  readonly lifecycleSequence: number;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface SettlementDecisionPort {
  decide(input: CodingSettlementDecisionInput): CodingSettlementDecision;
}

/**
 * Atomically binds the sole completion authority's decision to one terminal
 * lifecycle. Runtime and Surface adapters cannot supply or remap terminal state.
 */
export class CanonicalSettlementDecisionService implements SettlementDecisionPort {
  decide(input: CodingSettlementDecisionInput): CodingSettlementDecision {
    const lifecycle = assertCodingRunLifecycleSnapshot(input.lifecycle);
    if (!lifecycle.terminal) settlementFailure('non-terminal-lifecycle');
    const completion = input.completion;
    if (!completion || completion.version !== CODING_COMPLETION_DECISION_VERSION) {
      settlementFailure('invalid-completion-decision');
    }
    if (!isTerminalStatus(completion.status)) settlementFailure('invalid-completion-status');
    if (completion.runId !== lifecycle.runId) settlementFailure('completion-run-mismatch');
    if (lifecycle.status !== completion.status) {
      settlementFailure(`terminal-mismatch:${lifecycle.status}:${completion.status}`);
    }
    return Object.freeze({
      version: CODING_SETTLEMENT_DECISION_VERSION,
      runId: lifecycle.runId,
      surface: lifecycle.surface,
      status: completion.status,
      lifecycleSequence: lifecycle.events.length,
      reasonCodes: uniqueNonEmpty([
        'canonical-lifecycle-terminal',
        'canonical-completion-bound',
        ...completion.reasonCodes,
      ]),
      evidenceRefs: uniqueNonEmpty(completion.evidenceRefs),
      residualRisks: uniqueNonEmpty(completion.residualRisks),
    });
  }
}

function isTerminalStatus(status: unknown): status is CodingTerminalStatus {
  return status === 'completed' || status === 'failed' || status === 'blocked' || status === 'cancelled';
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map(value => String(value).trim()).filter(Boolean))]);
}

function settlementFailure(reason: string): never {
  throw new Error(`coding-settlement:${reason}`);
}
