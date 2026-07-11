import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIVE_STABILITY_QUOTA,
  buildStabilityQualification,
  inspectRealPluginEvidence,
} from '../lib/devseek-stability-qualification.mjs';

const commit = 'abcdef1';
const deterministicGates = [
  { id: 'extension-unit', status: 'passed' },
  { id: 'runtime-replay', status: 'passed' },
];

test('deterministic green does not authorize a stability claim', () => {
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [],
    currentCommit: commit,
  });

  assert.equal(result.level, 'deterministic');
  assert.equal(result.candidateClaimAllowed, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('real plugin evidence must be successful, replayed, and bound to the current commit', () => {
  const evidence = inspectRealPluginEvidence(realPluginReport({ commit }), '/tmp/report.json', commit);
  const stale = inspectRealPluginEvidence(realPluginReport({ commit: '1234567' }), '/tmp/stale.json', commit);

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.scenario, 'canary');
  assert.equal(stale.status, 'invalid');
  assert.ok(stale.reasons.includes('stale-or-different-git-commit'));
});

test('one live success permits a candidate claim but not a stable claim', () => {
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [passedEvidence('canary', 'run-1')],
    currentCommit: commit,
  });

  assert.equal(result.level, 'live-plugin');
  assert.equal(result.candidateClaimAllowed, true);
  assert.equal(result.stableClaimAllowed, false);
});

test('a dirty worktree cannot borrow the HEAD commit identity for live qualification', () => {
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [passedEvidence('canary', 'run-1')],
    currentCommit: commit,
    worktreeDirty: true,
  });

  assert.equal(result.level, 'deterministic-dirty');
  assert.equal(result.worktree, 'dirty');
  assert.equal(result.candidateClaimAllowed, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('stable requires distinct same-commit live evidence across the convergence ladder', () => {
  const evidence = [];
  for (const [scenario, count] of Object.entries(LIVE_STABILITY_QUOTA)) {
    for (let index = 0; index < count; index++) evidence.push(passedEvidence(scenario, `${scenario}-${index}`));
  }
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: evidence,
    currentCommit: commit,
  });

  assert.equal(result.level, 'stable');
  assert.equal(result.stableClaimAllowed, true);
});

test('the same live run cannot be copied or repeated to satisfy the quota', () => {
  const duplicate = passedEvidence('canary', 'same-run');
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [duplicate, { ...duplicate, reportPath: '/tmp/copy.json' }, duplicate],
    currentCommit: commit,
  });

  assert.equal(result.scenarioCounts.canary, 1);
  assert.equal(result.stableClaimAllowed, false);
});

test('a requested live CLI failure blocks stability even with full plugin evidence', () => {
  const evidence = [];
  for (const [scenario, count] of Object.entries(LIVE_STABILITY_QUOTA)) {
    for (let index = 0; index < count; index++) evidence.push(passedEvidence(scenario, `${scenario}-${index}`));
  }
  const result = buildStabilityQualification({
    gates: [...deterministicGates, { id: 'agent-loop-live-deepseek-cli', status: 'failed' }],
    includeRealDeepSeek: true,
    realPluginEvidence: evidence,
    currentCommit: commit,
  });

  assert.equal(result.liveDeepSeekCli, 'failed');
  assert.equal(result.stableClaimAllowed, false);
});

function realPluginReport({ commit: reportCommit }) {
  return {
    ok: true,
    mode: 'real-plugin-deepseek',
    scenario: 'short-canary',
    errors: [],
    checks: { successTerminal: true },
    replay: { ok: true, stdout: { gitCommit: reportCommit, runId: 'run-1' } },
  };
}

function passedEvidence(scenario, runId) {
  return { status: 'passed', scenario, runId, reportedCommit: commit, reasons: [] };
}
