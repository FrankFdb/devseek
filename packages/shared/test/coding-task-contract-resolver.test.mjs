import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  classifyCodingTerminalEffects,
  extractCodingWorkspacePaths,
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
  assert.equal(explain.orientation.mode, explain.mode);
  assert.equal(review.mode, 'review');
  assert.equal(review.orientation.mode, review.mode);
  assert.equal(change.mode, 'change');
  assert.equal(change.orientation.mode, change.mode);
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

test('task resolution separates subjective acceptance from executable verification', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Create report.md and make it look professional.',
    surface: 'vscode',
    targetPaths: ['report.md'],
  });

  assert.equal(contract.acceptance.some(item => item.oracle.kind === 'subjective'), true);
  assert.equal(contract.acceptance.some(item => item.oracle.kind === 'workspace-readback'), true);
});

test('workspace paths named license do not create an external license boundary', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Refactor src/license/client.ts and run focused tests.',
    surface: 'vscode',
  });

  assert.equal(contract.externalBoundaries.some(boundary => boundary.kind === 'license'), false);
});

test('task resolution normalizes sentence punctuation and keeps every declared root or nested target', () => {
  const prompt = 'Create src/todo.cpp. Also create devseek.verify.json, then verify both.';
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'cli' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), ['src/todo.cpp', 'devseek.verify.json']);
  assert.deepEqual(contract.scope.include, ['src/todo.cpp', 'devseek.verify.json']);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change').map(item => item.path),
    ['src/todo.cpp', 'devseek.verify.json'],
  );
});

test('context files remain evidence and cannot silently become mutation targets', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Implement the requested behavior and run focused tests.',
    surface: 'cli',
    contextFiles: ['src/context-only.ts'],
  });

  assert.deepEqual(contract.scope.include, []);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, undefined);
});
