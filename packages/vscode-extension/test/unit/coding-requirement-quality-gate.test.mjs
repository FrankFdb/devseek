import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { test, after } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCodingKernelTaskContract,
  resolveCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundlePath = path.join(root, 'test/unit/coding-requirement-quality-gate.bundle.cjs');

execSync(
  `npx esbuild src/app/coding-requirement-quality-gate.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: root, stdio: 'pipe' },
);

const { evaluateCodingRequirementQualityGate } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(bundlePath, { force: true }));

test('VS Code requirement QualityGate accepts an exact executable local task', () => {
  const prompt = 'Fix src/value.ts and run focused tests.';
  const taskContract = resolveCodingKernelTaskContract({
    prompt,
    surface: 'vscode',
    modeHint: 'change',
    targetPaths: ['src/value.ts'],
    verificationRequired: true,
    verificationRequirementAuthoritative: true,
  });
  const result = evaluateCodingRequirementQualityGate({
    prompt,
    workspaceRoot: '/repo',
    targetPaths: ['src/value.ts'],
    taskContract,
  });

  assert.equal(result.status, 'accepted');
  assert.equal(result.reason, 'canonical-requirement-decision-ready');
  assert.match(result.evidenceRefs[0], /^requirement-/u);
});

test('I15-EXT-01 VS Code requirement QualityGate blocks current API claims without source receipts', () => {
  const prompt = 'Review src/client.ts against the latest API version.';
  const taskContract = buildCodingKernelTaskContract({
    goal: prompt,
    mode: 'review',
    include: ['src/client.ts'],
    deliverables: [{ id: 'report', kind: 'report' }],
    externalBoundaries: [{
      id: 'current-api-version',
      kind: 'api-version',
      subject: 'Current API version',
      sourceRef: 'official-api-docs',
    }],
    acceptance: [{
      id: 'grounded-api-version',
      statement: 'The current API claim is grounded in official evidence.',
      deliverableIds: ['report'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'source-grounded-review',
        scope: ['response'],
        evidenceKinds: ['response-evidence', 'source-citation'],
      },
      externalBoundaryRefs: ['current-api-version'],
    }],
    provenanceRefs: ['user:current'],
  });
  const result = evaluateCodingRequirementQualityGate({
    prompt,
    workspaceRoot: '/repo',
    targetPaths: ['src/client.ts'],
    taskContract,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'canonical-requirement-exploration-required');
  assert.ok(result.risks.some(reason => reason.includes('external-source-unresolved')));
  assert.match(result.requiredActions[0], /exact source and effect-receipt evidence/u);
});

test('VS Code requirement QualityGate consumes the canonical contract without reclassifying domain names', () => {
  const prompt = 'Complete src/deployment_coordinator.cpp and run ./test.sh.';
  const taskContract = resolveCodingKernelTaskContract({
    prompt,
    surface: 'vscode',
    modeHint: 'change',
    targetPaths: ['src/deployment_coordinator.cpp'],
    externalEffectIntent: 'none',
  });
  const result = evaluateCodingRequirementQualityGate({
    prompt,
    workspaceRoot: '/repo',
    targetPaths: ['src/deployment_coordinator.cpp'],
    taskContract,
  });

  assert.equal(result.status, 'accepted');
  assert.equal(result.reason, 'canonical-requirement-decision-ready');
});
