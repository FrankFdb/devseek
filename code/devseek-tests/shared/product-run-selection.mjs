export function selectAuthoritativeProductRun(report) {
  const logs = Array.isArray(report?.runLogs?.logs) ? report.runLogs.logs : [];
  const authoritativeTerminal = report?.runLogs?.terminal;
  if (authoritativeTerminal?.event === 'agent-run-completed'
    && !isAuxiliaryMutationTerminal(authoritativeTerminal)) {
    const matched = logs.find(log => sameTerminalOutcome(log.terminal, authoritativeTerminal));
    return matched || {
      terminal: authoritativeTerminal,
      toolExecutionCount: report?.replay?.stdout?.toolExecutions ?? null,
    };
  }
  return logs
    .map(log => ({ log, score: productRunScore(log) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => (right.score - left.score)
      || ((right.log.runStartedAtMs || 0) - (left.log.runStartedAtMs || 0))
      || ((right.log.mtimeMs || 0) - (left.log.mtimeMs || 0))
      || ((right.log.size || 0) - (left.log.size || 0)))[0]?.log
    || logs[0]
    || null;
}

function productRunScore(log) {
  if (!log || log.workloadRole === 'background-maintenance') return 0;
  if (isAuxiliaryMutationTerminal(log.terminal)) return 0;
  if (log.terminal?.data?.canonicalCompletionStatus === 'completed') return 5;
  if (log.terminal?.data?.status === 'completed') return 4;
  if (log.terminal?.event === 'agent-run-completed') return 3;
  if (log.hasAgentRunStarted && (Number(log.committedMutationCount || 0) > 0
    || Number(log.providerEventCount || 0) > 0
    || Number(log.toolExecutionCount || 0) > 0)) return 2;
  if (log.hasAgentRunStarted || log.hasAgentStatus
    || Number(log.providerEventCount || 0) > 0
    || Number(log.toolExecutionCount || 0) > 0) return 1;
  return 0;
}

function isAuxiliaryMutationTerminal(terminal) {
  const mutationKind = terminal?.data?.mutationKind;
  return mutationKind === 'pending-edit-resolution' || mutationKind === 'pending-edit-undo';
}

function sameTerminalOutcome(candidate, authoritative) {
  if (candidate?.event !== authoritative?.event || candidate?.source !== authoritative?.source) return false;
  const left = candidate.data || {};
  const right = authoritative.data || {};
  return left.status === right.status
    && left.canonicalCompletionStatus === right.canonicalCompletionStatus
    && left.tasksApplied === right.tasksApplied
    && left.tasksFailed === right.tasksFailed
    && left.taskContractFingerprint === right.taskContractFingerprint
    && left.semanticContractFingerprint === right.semanticContractFingerprint
    && JSON.stringify(left.changedPaths || []) === JSON.stringify(right.changedPaths || []);
}
