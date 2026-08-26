import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requiredResumePreflightStage,
  selectJourneyRounds,
} from './journey-resume-policy.mjs';

test('fresh journeys require a consecutive prefix from round one', () => {
  assert.deepEqual(selectJourneyRounds('1,2,3,4', 4), [1, 2, 3, 4]);
  assert.throws(() => selectJourneyRounds('2,3,4', 4), /consecutive prefix/);
});

test('existing workspaces accept a consecutive suffix after prior-stage verification', () => {
  const rounds = selectJourneyRounds('2,3,4', 4, true);
  assert.deepEqual(rounds, [2, 3, 4]);
  assert.equal(requiredResumePreflightStage(rounds), 1);
  assert.equal(requiredResumePreflightStage([4]), 3);
});

test('resume selection rejects gaps and invalid round numbers', () => {
  assert.throws(() => selectJourneyRounds('2,4', 4, true), /consecutive range/);
  assert.throws(() => selectJourneyRounds('0,1', 4, true), /between 1 and 4/);
});
