import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_LIVE_OBSERVATION_THRESHOLDS,
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
  assert.equal(result.qualificationAuthority, 'none');
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

test('one legacy live success is an observation and cannot authorize a product claim', () => {
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [passedEvidence('canary', 'run-1')],
    currentCommit: commit,
  });

  assert.equal(result.level, 'legacy-development-live-observation');
  assert.equal(result.realPlugin, 'observed');
  assert.equal(result.candidateClaimAllowed, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('a dirty worktree cannot borrow the HEAD commit identity for a live observation level', () => {
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

test('full legacy name-bucket coverage remains an observation and cannot authorize stable', () => {
  const evidence = [];
  for (const [scenario, count] of Object.entries(LEGACY_LIVE_OBSERVATION_THRESHOLDS)) {
    for (let index = 0; index < count; index++) evidence.push(passedEvidence(scenario, `${scenario}-${index}`));
  }
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: evidence,
    currentCommit: commit,
  });

  assert.equal(result.level, 'legacy-development-live-observation');
  assert.equal(result.legacyObservationThresholdMet, true);
  assert.equal(result.candidateClaimAllowed, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('the same live run cannot be copied or repeated to satisfy the observation threshold', () => {
  const duplicate = passedEvidence('canary', 'same-run');
  const result = buildStabilityQualification({
    gates: deterministicGates,
    includeRealDeepSeek: false,
    realPluginEvidence: [duplicate, { ...duplicate, reportPath: '/tmp/copy.json' }, duplicate],
    currentCommit: commit,
  });

  assert.equal(result.scenarioCounts.canary, 1);
  assert.equal(result.legacyObservationThresholdMet, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('a requested live CLI failure is retained without changing the no-qualification invariant', () => {
  const evidence = [];
  for (const [scenario, count] of Object.entries(LEGACY_LIVE_OBSERVATION_THRESHOLDS)) {
    for (let index = 0; index < count; index++) evidence.push(passedEvidence(scenario, `${scenario}-${index}`));
  }
  const result = buildStabilityQualification({
    gates: [...deterministicGates, { id: 'agent-loop-live-deepseek-cli', status: 'failed' }],
    includeRealDeepSeek: true,
    realPluginEvidence: evidence,
    currentCommit: commit,
  });

  assert.equal(result.liveDeepSeekCli, 'failed');
  assert.equal(result.legacyObservationThresholdMet, true);
  assert.equal(result.candidateClaimAllowed, false);
  assert.equal(result.stableClaimAllowed, false);
});

test('legacy evidence can never emit candidate, stable, or their former level labels', () => {
  const fullEvidence = Object.entries(LEGACY_LIVE_OBSERVATION_THRESHOLDS).flatMap(([scenario, count]) => (
    Array.from({ length: count }, (_, index) => passedEvidence(scenario, `${scenario}-${index}`))
  ));
  const cases = [
    { gates: deterministicGates, realPluginEvidence: [] },
    { gates: deterministicGates, realPluginEvidence: fullEvidence },
    { gates: deterministicGates, realPluginEvidence: fullEvidence, worktreeDirty: true },
    { gates: [{ id: 'extension-unit', status: 'failed' }], realPluginEvidence: fullEvidence },
    {
      gates: [...deterministicGates, { id: 'agent-loop-live-deepseek-cli', status: 'passed' }],
      includeRealDeepSeek: true,
      realPluginEvidence: fullEvidence,
    },
  ];

  for (const input of cases) {
    const result = buildStabilityQualification({
      includeRealDeepSeek: false,
      currentCommit: commit,
      ...input,
    });
    assert.equal(result.candidateClaimAllowed, false);
    assert.equal(result.stableClaimAllowed, false);
    assert.notEqual(result.level, 'live-plugin');
    assert.notEqual(result.level, 'stable');
  }
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
