import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  classifyCodingTerminalEffects,
  projectCodingKernelTaskContract,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

test('one task-contract resolver keeps all five fixture semantics equal across Surfaces', () => {
  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    const projections = ['vscode', 'cli', 'headless'].map(surface => projectCodingKernelTaskContract(
      resolveCodingKernelTaskContract({ prompt: fixture.prompt, surface }),
    ));
    for (const projection of projections) {
      assert.deepEqual(
        { ...projection, provenanceRefs: projection.provenanceRefs.length > 0 },
        { ...fixture.expected.taskContract, provenanceRefs: true },
        fixture.fixtureId,
      );
    }
  }
});

test('task-contract mode resolution preserves read-only questions and explicit change authority', () => {
  const explain = resolveCodingKernelTaskContract({
    prompt: 'How does the update command work?',
    surface: 'headless',
  });
  const review = resolveCodingKernelTaskContract({
    prompt: 'Analyze the release workflow and package.json.',
    surface: 'headless',
  });
  const change = resolveCodingKernelTaskContract({
    prompt: 'Review src/value.ts and fix the incorrect return value.',
    surface: 'headless',
  });

  assert.equal(explain.mode, 'explain');
  assert.equal(review.mode, 'review');
  assert.equal(change.mode, 'change');
  assert.deepEqual(change.deliverables.map(deliverable => deliverable.kind), [
    'source-change',
    'verification-result',
  ]);
});

test('terminal effect classification is command-owned and conservative for package operations', () => {
  assert.deepEqual(classifyCodingTerminalEffects('node --test test/value.test.js'), ['process']);
  assert.deepEqual(classifyCodingTerminalEffects('npm install left-pad'), [
    'process',
    'network',
    'workspace-mutation',
  ]);
  assert.deepEqual(classifyCodingTerminalEffects('git add src/value.ts'), [
    'process',
    'workspace-mutation',
  ]);
  assert.throws(() => classifyCodingTerminalEffects(''), /missing-command/);
});
