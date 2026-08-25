import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/requirement-review-policy.bundle.cjs');

execSync(
  `npx esbuild src/agent/requirement-review-policy.ts src/agent/requirement-review-ledger.ts --bundle ` +
  `--outdir=${path.dirname(bundlePath)} --out-extension:.js=.bundle.cjs --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { RequirementReviewPolicy } = createRequire(import.meta.url)(bundlePath);
const { RequirementReviewLedger } = createRequire(import.meta.url)(
  path.join(rootDir, 'test/unit/requirement-review-ledger.bundle.cjs'),
);

const passedGate = { status: 'pass', summary: 'compile and focused tests passed' };
const sourceWrite = (filePath, action = 'create') => ({
  path: filePath,
  basename: path.basename(filePath),
  linesAdded: 10,
  linesRemoved: 0,
  action,
});

function semanticContract(overrides = {}) {
  const base = {
    kind: 'standalone-code',
    scope: 'standalone',
    mutation: { requested: true, prohibited: false, sourceChange: true, targets: [] },
    validation: { requested: true, runProhibited: false },
    quality: { formalProjectRequired: false },
    ambiguity: { status: 'clear', reasons: [] },
    intent: {
      context: {
        externalEffect: 'none',
        broadScope: false,
        complexAction: false,
        planningOnly: false,
        unsafeSecretHarvesting: false,
        failureContext: false,
      },
    },
  };
  return mergeContract(base, overrides);
}

function kernelContract(overrides = {}) {
  const base = {
    mode: 'change',
    scope: { include: [], exclude: [] },
    deliverables: [
      { id: 'source-change', kind: 'source-change' },
      { id: 'verification-result', kind: 'verification-result' },
    ],
    constraints: ['workspace-root-only', 'verification-before-completion'],
    assumptions: [],
    conflicts: [],
    externalBoundaries: [],
    acceptance: [
      {
        id: 'requested-outcome',
        externalBoundaryRefs: [],
        oracle: { kind: 'workspace-readback' },
      },
      {
        id: 'verified',
        externalBoundaryRefs: [],
        oracle: { kind: 'verification' },
      },
    ],
  };
  return mergeContract(base, overrides);
}

function evaluate(overrides = {}) {
  return new RequirementReviewPolicy().evaluate({
    qualityGate: passedGate,
    hostFinalSourceEvidenceReady: true,
    workspaceRoot: '/workspace',
    writtenFiles: [sourceWrite('offwork.cpp')],
    semanticContract: semanticContract(),
    canonicalTaskContract: kernelContract(),
    ...overrides,
  });
}

test('RequirementReviewPolicy accepts a bounded standalone creation only after host validation and readback', () => {
  assert.deepEqual(evaluate(), {
    strategy: 'host-evidence',
    reason: 'bounded-validated-source-creation',
    sourcePaths: ['offwork.cpp'],
  });

  assert.equal(evaluate({ qualityGate: { status: 'fail', summary: 'compile failed' } }).reason, 'validation-not-passed');
  assert.equal(evaluate({ hostFinalSourceEvidenceReady: false }).reason, 'host-source-evidence-missing');
  assert.equal(evaluate({ semanticContract: undefined }).reason, 'missing-semantic-contract');
  assert.equal(evaluate({ canonicalTaskContract: undefined }).reason, 'missing-kernel-contract');
});

test('RequirementReviewPolicy accepts two explicit new source files with focused verification', () => {
  const decision = evaluate({
    writtenFiles: [
      sourceWrite('/workspace/src/slugify.js'),
      sourceWrite('/workspace/test/slugify.test.js'),
    ],
    semanticContract: semanticContract({
      kind: 'existing-project-code',
      scope: 'existing-project',
      mutation: {
        targets: ['src/slugify.js', 'test/slugify.test.js'],
      },
    }),
    canonicalTaskContract: kernelContract({
      deliverables: [
        { id: 'source-change', kind: 'source-change', path: 'src/slugify.js' },
        { id: 'source-change:2', kind: 'source-change', path: 'test/slugify.test.js' },
        { id: 'verification-result', kind: 'verification-result' },
      ],
      constraints: ['workspace-root-only', 'no-dependencies', 'verification-before-completion'],
    }),
  });

  assert.equal(decision.strategy, 'host-evidence');
  assert.deepEqual(decision.sourcePaths, ['src/slugify.js', 'test/slugify.test.js']);
});

test('RequirementReviewPolicy keeps existing edits and oversized source sets with the provider reviewer', () => {
  const existingEdit = evaluate({
    writtenFiles: [sourceWrite('src/math.js', 'edit')],
    semanticContract: semanticContract({
      kind: 'existing-project-code',
      scope: 'existing-project',
      mutation: { targets: ['src/math.js'] },
    }),
    canonicalTaskContract: kernelContract({
      deliverables: [{ id: 'source-change', kind: 'source-change', path: 'src/math.js' }],
    }),
  });
  assert.equal(existingEdit.strategy, 'independent-provider');
  assert.equal(existingEdit.reason, 'existing-source-change-requires-review');

  const oversized = evaluate({
    writtenFiles: [sourceWrite('a.cpp'), sourceWrite('b.cpp'), sourceWrite('c.cpp')],
  });
  assert.equal(oversized.reason, 'source-set-out-of-bounds');
});

test('RequirementReviewPolicy fails closed for every semantic risk class', () => {
  const risks = [
    { ambiguity: { status: 'needs-clarification', reasons: ['target unclear'] } },
    { quality: { formalProjectRequired: true } },
    { validation: { runProhibited: true } },
    { intent: { context: { externalEffect: 'requested' } } },
    { intent: { context: { broadScope: true } } },
    { intent: { context: { complexAction: true } } },
    { intent: { context: { planningOnly: true } } },
  ];
  for (const risk of risks) {
    const decision = evaluate({ semanticContract: semanticContract(risk) });
    assert.equal(decision.strategy, 'independent-provider');
    assert.equal(decision.reason, 'semantic-risk-requires-review');
  }
});

test('RequirementReviewPolicy fails closed for every kernel contract risk class', () => {
  const risks = [
    { conflicts: [{ id: 'c1' }] },
    { externalBoundaries: [{ id: 'b1' }] },
    { assumptions: [{ id: 'a1', status: 'unconfirmed' }] },
    { constraints: ['workspace-root-only', 'network-requires-approval'] },
    { acceptance: [{ id: 'subjective', externalBoundaryRefs: [], oracle: { kind: 'subjective' } }] },
    { acceptance: [{ id: 'readback', externalBoundaryRefs: [], oracle: { kind: 'workspace-readback' } }] },
    { acceptance: [{ id: 'verified', externalBoundaryRefs: ['api'], oracle: { kind: 'verification' } }] },
  ];
  for (const risk of risks) {
    const decision = evaluate({ canonicalTaskContract: kernelContract(risk) });
    assert.equal(decision.strategy, 'independent-provider');
    assert.equal(decision.reason, 'kernel-risk-requires-review');
  }
});

test('RequirementReviewLedger closes an eligible cohort without creating hidden review state', () => {
  const ledger = new RequirementReviewLedger();
  const input = {
    qualityGate: passedGate,
    writtenFiles: [sourceWrite('offwork.cpp')],
    roundReadFiles: [],
    hostFinalSourceEvidenceReady: true,
  };
  const decision = evaluate();

  assert.equal(ledger.request(input, decision), undefined);
  assert.equal(ledger.takeIndependentReviewCandidate(), undefined);
  assert.equal(ledger.completionBlocker(), undefined);
  assert.equal(ledger.beforeNoToolCompletion(), undefined);

  const repairedInput = {
    ...input,
    writtenFiles: [...input.writtenFiles, sourceWrite('offwork.cpp', 'edit')],
  };
  assert.equal(ledger.request(repairedInput, evaluate({ writtenFiles: repairedInput.writtenFiles })), undefined);
  assert.equal(ledger.completionBlocker(), undefined);
});

test('RequirementReviewPolicy excludes deleted source tombstones from the final cohort', () => {
  const writtenFiles = [
    sourceWrite('src/x11_window.cpp'),
    sourceWrite('src/x11_app.cpp'),
    sourceWrite('src/x11_window.cpp', 'delete'),
  ];
  const decision = evaluate({ writtenFiles });

  assert.deepEqual(decision.sourcePaths, ['src/x11_app.cpp']);
});

function mergeContract(base, overrides) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
      merged[key] = mergeContract(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}
