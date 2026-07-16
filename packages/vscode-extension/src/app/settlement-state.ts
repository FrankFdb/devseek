export type SettlementTerminalStatus = 'completed' | 'failed' | 'cancelled';

export interface SettlementStateInput {
  requestedStatus: SettlementTerminalStatus;
  existingTerminalStatus?: SettlementTerminalStatus;
  pendingAdverseOperationCount?: number;
  qualityGateRequired?: boolean;
  passedQualityGateCount?: number;
  pendingQualityGateCount?: number;
  pendingRecoveryCount?: number;
  evidenceDegraded?: boolean;
  settlementAppendFailed?: boolean;
  data?: Record<string, unknown>;
}

export interface SettlementStateDecision {
  status: SettlementTerminalStatus;
  terminal: true;
  requestedStatus: SettlementTerminalStatus;
  reason?: string;
  data: Record<string, unknown>;
}

export function decideSettlementState(input: SettlementStateInput): SettlementStateDecision {
  const data = input.data ?? {};
  if (input.existingTerminalStatus) {
    return decision(input.existingTerminalStatus, input.requestedStatus, {
      ...data,
      requestedStatus: input.requestedStatus,
      existingTerminalStatus: input.existingTerminalStatus,
    }, 'existing-terminal-status');
  }

  if (input.settlementAppendFailed) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'settlement-failed',
      requestedStatus: input.requestedStatus,
    }, 'settlement-failed');
  }

  if (input.requestedStatus === 'completed' && (input.pendingAdverseOperationCount ?? 0) > 0) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'unresolved-run-context-adverse-evidence',
      requestedStatus: input.requestedStatus,
      unresolvedOperationCount: input.pendingAdverseOperationCount,
    }, 'unresolved-run-context-adverse-evidence');
  }

  if (input.requestedStatus === 'completed' && (input.pendingRecoveryCount ?? 0) > 0) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'pending-recovery-settlement',
      requestedStatus: input.requestedStatus,
      pendingRecoveryCount: input.pendingRecoveryCount,
    }, 'pending-recovery-settlement');
  }

  if (input.requestedStatus === 'completed' && (input.pendingQualityGateCount ?? 0) > 0) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'pending-quality-gate-settlement',
      requestedStatus: input.requestedStatus,
      pendingQualityGateCount: input.pendingQualityGateCount,
    }, 'pending-quality-gate-settlement');
  }

  if (
    input.requestedStatus === 'completed'
    && input.qualityGateRequired
    && (input.passedQualityGateCount ?? 0) < 1
  ) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'missing-quality-gate-verdict',
      requestedStatus: input.requestedStatus,
      passedQualityGateCount: input.passedQualityGateCount ?? 0,
    }, 'missing-quality-gate-verdict');
  }

  if (input.requestedStatus === 'completed' && input.evidenceDegraded) {
    return decision('failed', input.requestedStatus, {
      ...data,
      reason: 'evidence-degraded',
      requestedStatus: input.requestedStatus,
    }, 'evidence-degraded');
  }

  const reason = typeof data.reason === 'string' && data.reason.trim()
    ? data.reason
    : undefined;
  return decision(input.requestedStatus, input.requestedStatus, data, reason);
}

function decision(
  status: SettlementTerminalStatus,
  requestedStatus: SettlementTerminalStatus,
  data: Record<string, unknown>,
  reason?: string,
): SettlementStateDecision {
  return {
    status,
    terminal: true,
    requestedStatus,
    ...(reason ? { reason } : {}),
    data,
  };
}
