import type { CodingTerminalStatus } from './coding-conformance';
import {
  assertCodingRunLifecycleSnapshot,
  type CodingRunLifecycleSnapshot,
} from './coding-run-lifecycle';

export const CODING_SETTLEMENT_DECISION_VERSION = 'devseek.coding-settlement-decision/v1' as const;

export interface CodingSettlementDecisionInput {
  readonly lifecycle: CodingRunLifecycleSnapshot;
  readonly requestedStatus: CodingTerminalStatus;
  readonly evidenceRefs?: readonly string[];
  readonly residualRisks?: readonly string[];
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
 * Preserves the terminal fact chosen by the completion/runtime authorities.
 * It validates settlement binding and never remaps one terminal into another.
 */
export class CanonicalSettlementDecisionService implements SettlementDecisionPort {
  decide(input: CodingSettlementDecisionInput): CodingSettlementDecision {
    const lifecycle = assertCodingRunLifecycleSnapshot(input.lifecycle);
    if (!lifecycle.terminal) settlementFailure('non-terminal-lifecycle');
    if (!isTerminalStatus(input.requestedStatus)) settlementFailure('invalid-requested-status');
    if (lifecycle.status !== input.requestedStatus) {
      settlementFailure(`terminal-mismatch:${lifecycle.status}:${input.requestedStatus}`);
    }
    return Object.freeze({
      version: CODING_SETTLEMENT_DECISION_VERSION,
      runId: lifecycle.runId,
      surface: lifecycle.surface,
      status: input.requestedStatus,
      lifecycleSequence: lifecycle.events.length,
      reasonCodes: Object.freeze([
        'canonical-lifecycle-terminal',
        `terminal-preserved:${input.requestedStatus}`,
      ]),
      evidenceRefs: uniqueNonEmpty(input.evidenceRefs ?? []),
      residualRisks: uniqueNonEmpty(input.residualRisks ?? []),
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
