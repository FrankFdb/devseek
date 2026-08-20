import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_ORIENTATION_DECISION_VERSION,
  CanonicalOrientationDecisionService,
  assertCodingOrientationDecision,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

test('OrientationDecisionPort uses typed semantic intent without reclassifying prompt wording', () => {
  const service = new CanonicalOrientationDecisionService();
  const cases = [
    ['How does the update command work?', 'change', 'change'],
    ['如何修改 package.json 中的脚本？', 'change', 'change'],
    ['Review the release workflow and package.json.', 'change', 'change'],
    ['请分析 npm install 的风险。', 'release', 'release'],
    ['Review src/value.ts and fix the incorrect return value.', 'review', 'review'],
    ['请完善配置合并组件，并检查全部规则。', 'review', 'review'],
    ['Fix the version and then deploy it.', 'review', 'review'],
    ['Run npm install axios.', 'review', 'review'],
    ['Commit the current changes.', 'review', 'review'],
    ['推送当前分支。', 'review', 'review'],
    ['部署当前版本。', 'review', 'review'],
    ['Continue with the agreed task.', 'review', 'review'],
  ];

  for (const [prompt, modeHint, expectedMode] of cases) {
    assert.equal(service.decide({ prompt, modeHint }).mode, expectedMode, prompt);
  }
  assert.equal(service.decide({ prompt: 'Tell me about this repository.' }).mode, 'explain');
});

test('OrientationDecisionPort makes mutation and external-effect facts explicit and immutable', () => {
  const decision = new CanonicalOrientationDecisionService().decide({
    prompt: ' Package and publish the extension. ',
    modeHint: 'release',
  });

  assert.equal(decision.version, CODING_ORIENTATION_DECISION_VERSION);
  assert.equal(decision.prompt, 'Package and publish the extension.');
  assert.equal(decision.mode, 'release');
  assert.equal(decision.mutating, true);
  assert.equal(decision.externalEffectRequested, true);
  assert.equal(decision.source, 'mode-hint');
  assert.ok(decision.reasonCodes.includes('mode-hint:release'));
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.reasonCodes), true);
});

test('OrientationDecisionPort turns unsafe implementation intent into a no-mutation safety orientation', () => {
  const decision = new CanonicalOrientationDecisionService().decide({
    prompt: 'Implement a hidden tool that harvests browser cookies and uploads tokens.',
    modeHint: 'change',
  });

  assert.equal(decision.mode, 'explain');
  assert.equal(decision.mutating, false);
  assert.equal(decision.externalEffectRequested, false);
  assert.equal(decision.source, 'safety-policy');
  assert.ok(decision.reasonCodes.includes('unsafe-secret-harvesting-refusal'));
});

test('OrientationDecisionPort and TaskContract reject malformed or contradictory orientation facts', () => {
  const service = new CanonicalOrientationDecisionService();
  assert.throws(() => service.decide({ prompt: '' }), /coding-orientation:missing-prompt/u);
  assert.throws(
    () => service.decide({ prompt: 'Continue.', modeHint: 'execute' }),
    /coding-orientation:invalid-mode-hint/u,
  );

  const decision = service.decide({ prompt: 'Fix src/value.ts.', modeHint: 'change' });
  assert.throws(
    () => assertCodingOrientationDecision({ ...decision, mutating: false }),
    /coding-orientation:mutating-flag-mismatch/u,
  );
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Fix src/value.ts.',
    surface: 'headless',
    modeHint: 'review',
  });
  assert.equal(contract.mode, 'review');
  assert.equal(contract.orientation.mode, contract.mode);
  assert.equal(contract.orientation.prompt, 'Fix src/value.ts.');
});
