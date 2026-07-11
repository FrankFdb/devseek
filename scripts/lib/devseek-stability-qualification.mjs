import fs from 'node:fs';
import path from 'node:path';

export const LIVE_STABILITY_QUOTA = Object.freeze({
  canary: 3,
  medium: 2,
  formal: 1,
});

export function loadRealPluginEvidence(reportPaths, currentCommit) {
  const uniquePaths = [...new Set((reportPaths || []).map(value => path.resolve(value)))];
  return uniquePaths.map(reportPath => {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      return inspectRealPluginEvidence(report, reportPath, currentCommit);
    } catch (error) {
      return {
        reportPath,
        status: 'invalid',
        scenario: 'unclassified',
        reportedCommit: '',
        reasons: [`report-unreadable:${String(error?.message || error)}`],
      };
    }
  });
}

export function inspectRealPluginEvidence(report, reportPath, currentCommit) {
  const reportedCommit = String(report?.replay?.stdout?.gitCommit || extractCommitFromVsix(report?.harness?.vsixPath));
  const runId = String(report?.replay?.stdout?.runId || '');
  const reasons = [];
  if (report?.mode !== 'real-plugin-deepseek') reasons.push('not-real-plugin-deepseek-report');
  if (report?.ok !== true) reasons.push('plugin-run-not-ok');
  if (report?.replay?.ok !== true) reasons.push('runtime-replay-not-ok');
  if (report?.checks?.successTerminal !== true) reasons.push('missing-success-terminal');
  if (Array.isArray(report?.errors) && report.errors.length > 0) reasons.push('report-contains-errors');
  if (!runId) reasons.push('missing-runtime-run-id');
  if (!reportedCommit) reasons.push('missing-runtime-git-commit');
  else if (!sameCommit(reportedCommit, currentCommit)) reasons.push('stale-or-different-git-commit');

  return {
    reportPath: path.resolve(reportPath),
    status: reasons.length === 0 ? 'passed' : 'invalid',
    scenario: classifyLiveScenario(report),
    runId,
    reportedCommit,
    reasons,
  };
}

export function buildStabilityQualification({
  gates,
  includeRealDeepSeek,
  realPluginEvidence,
  currentCommit,
  worktreeDirty = false,
}) {
  const deterministicGates = (gates || []).filter(gate => gate.id !== 'agent-loop-live-deepseek-cli');
  const deterministicPassed = deterministicGates.every(gate => gate.status === 'passed');
  const liveCliGate = (gates || []).find(gate => gate.id === 'agent-loop-live-deepseek-cli');
  const liveDeepSeekCli = includeRealDeepSeek
    ? (liveCliGate?.status === 'passed' ? 'passed' : 'failed')
    : 'not-run';
  const passedEvidence = distinctPassedEvidence(realPluginEvidence);
  const scenarioCounts = countScenarios(passedEvidence);
  const quotaSatisfied = Object.entries(LIVE_STABILITY_QUOTA)
    .every(([scenario, required]) => scenarioCounts[scenario] >= required);
  const candidateClaimAllowed = deterministicPassed && !worktreeDirty && passedEvidence.length > 0;
  const stableClaimAllowed = deterministicPassed
    && !worktreeDirty
    && quotaSatisfied
    && liveDeepSeekCli !== 'failed';

  return {
    currentCommit,
    worktree: worktreeDirty ? 'dirty' : 'clean',
    deterministic: deterministicPassed ? 'passed' : 'failed',
    liveDeepSeekCli,
    realPlugin: passedEvidence.length > 0 ? 'passed' : (realPluginEvidence?.length ? 'failed' : 'not-run'),
    realPluginEvidence,
    scenarioCounts,
    requiredScenarioCounts: LIVE_STABILITY_QUOTA,
    candidateClaimAllowed,
    stableClaimAllowed,
    level: !deterministicPassed
      ? 'failed'
      : worktreeDirty
        ? 'deterministic-dirty'
      : stableClaimAllowed
        ? 'stable'
        : candidateClaimAllowed
          ? 'live-plugin'
          : liveDeepSeekCli === 'passed'
            ? 'live-provider-cli'
            : 'deterministic',
  };
}

export function classifyLiveScenario(report) {
  const value = String(report?.scenario || report?.harness?.scenario || '').toLowerCase();
  if (/canary|smoke|short|tiny|read-only/.test(value)) return 'canary';
  if (/medium|integration/.test(value)) return 'medium';
  if (/formal|project|benchmark/.test(value)) return 'formal';
  return 'unclassified';
}

function countScenarios(evidence) {
  const counts = { canary: 0, medium: 0, formal: 0, unclassified: 0 };
  for (const item of evidence) counts[item.scenario] = (counts[item.scenario] || 0) + 1;
  return counts;
}

function distinctPassedEvidence(evidence) {
  const seen = new Set();
  return (evidence || []).filter(item => {
    if (item.status !== 'passed') return false;
    const identity = `${item.reportedCommit || ''}:${item.runId || item.reportPath || ''}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function extractCommitFromVsix(value) {
  return String(value || '').match(/\.g([0-9a-f]{7,40})\.vsix$/i)?.[1] || '';
}

function sameCommit(reported, current) {
  const left = String(reported || '').toLowerCase();
  const right = String(current || '').toLowerCase();
  return Boolean(left && right && (left.startsWith(right) || right.startsWith(left)));
}
