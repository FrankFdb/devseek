import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRepairContinuationPrompt,
  planResumePreflight,
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

test('repair continuation verifies the current stage before deciding whether code work is needed', () => {
  assert.deepEqual(planResumePreflight([2, 3, 4], true), {
    stage: 2,
    allowFailure: true,
    skipFirstRoundWhenPassed: true,
  });
  assert.deepEqual(planResumePreflight([2, 3, 4]), {
    stage: 1,
    allowFailure: false,
    skipFirstRoundWhenPassed: false,
  });
});

test('repair continuation preserves the original requirement after its evidence-led instruction', () => {
  const prompt = buildRepairContinuationPrompt('执行 ./test.sh 并完成第二轮。');
  assert.match(prompt, /独立验证已经失败/);
  assert.match(prompt, /不要从头重写项目/);
  assert.match(prompt, /执行 \.\/test\.sh 并完成第二轮/);
});
