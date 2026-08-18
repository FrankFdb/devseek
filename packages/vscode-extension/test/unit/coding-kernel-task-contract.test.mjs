import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-kernel-task-contract.bundle.cjs');

execSync(
  `npx esbuild src/app/coding-kernel-task-contract.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { projectVsCodeCodingKernelTaskContract } = createRequire(import.meta.url)(bundlePath);

test('plan-mode projection cannot turn a stale source-change hint into mutation or verification', () => {
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: '先 inspect src/math.js，然后 give me a fix plan only，暂时不要 apply，也不要 run command。',
    executionMode: 'plan',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: semanticTaskContract(['source-change']),
    externalEffectIntent: 'none',
  });

  assert.equal(contract.mode, 'review');
  assert.deepEqual(contract.deliverables.map(item => item.kind), ['report']);
  assert.deepEqual(contract.acceptance.map(item => item.id), ['grounded-response']);
  assert.equal(contract.constraints.includes('no-workspace-mutation'), true);
});

test('an edit contract projects source mutation and verification normally', () => {
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: 'Fix src/math.js and verify it.',
    executionMode: 'edit',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: semanticTaskContract(['source-change', 'verification-result']),
    externalEffectIntent: 'none',
    targetPaths: ['src/math.js'],
  });

  assert.equal(contract.mode, 'change');
  assert.deepEqual(contract.deliverables.map(item => item.kind), [
    'source-change',
    'verification-result',
  ]);
});

test('explicit medium-task targets remain included and are never projected as exclusions', () => {
  const targets = [
    'include/deployment_coordinator.hpp',
    'src/deployment_coordinator.cpp',
  ];
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: [
      '请补完整 deployment_coordinator。',
      '只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp。',
      '不要改测试、CMake 和已有组件。完成后运行 ./test.sh。',
    ].join('\n'),
    executionMode: 'edit',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: {
      ...semanticTaskContract(['source-change', 'verification-result']),
      inputs: [...targets, './test.sh'],
      deliverableTargets: targets,
    },
    externalEffectIntent: 'none',
    targetPaths: targets,
    prohibitedTargets: [],
    strictTargetScope: true,
  });

  assert.deepEqual(contract.scope.include, targets);
  assert.deepEqual(contract.scope.exclude, []);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change'),
    [{ id: 'source-change', kind: 'source-change' }],
  );
  assert.equal(contract.constraints.includes('no-other-files'), true);
  assert.deepEqual(contract.externalBoundaries, []);
  assert.equal(contract.acceptance.some(item => item.id === 'verified'), true);
});

test('model-proposed paths cannot turn allowed files or a prohibited verifier into required artifacts', () => {
  const targets = [
    'include/deployment_coordinator.hpp',
    'src/deployment_coordinator.cpp',
  ];
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: [
      '仍然只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp，',
      '不能修改 tests、CMake、test.sh 或已有组件。完成后运行 ./test.sh。',
    ].join(''),
    executionMode: 'edit',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: {
      ...semanticTaskContract(['source-change', 'verification-result']),
      inputs: [...targets, 'test.sh'],
      deliverableTargets: [...targets, 'test.sh'],
    },
    externalEffectIntent: 'none',
  });

  assert.deepEqual(contract.scope.include, targets);
  assert.deepEqual(contract.scope.exclude, ['test.sh']);
  assert.deepEqual(contract.deliverables, [
    { id: 'source-change', kind: 'source-change' },
    { id: 'verification-result', kind: 'verification-result' },
  ]);
});

test('an explicit external deployment action retains its deployment boundary', () => {
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: 'Deploy the service to production after updating src/service.ts.',
    executionMode: 'edit',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: semanticTaskContract(['source-change', 'verification-result']),
    externalEffectIntent: 'requested',
    targetPaths: ['src/service.ts'],
  });

  assert.deepEqual(contract.externalBoundaries.map(boundary => boundary.id), [
    'external-deployment',
  ]);
});

function semanticTaskContract(deliverables) {
  return {
    taskShapes: ['existing-project'],
    objectives: [],
    inputs: ['src/math.js'],
    deliverableTargets: [],
    deliverables,
    constraints: [],
    qualityObligations: [],
    evidenceRequirements: [],
    verificationContract: {
      requireSourceClaimGrounding: false,
      requireTitle: false,
      requiredSourcePaths: [],
      exactCodeBlocks: [],
      exactArtifactRequested: false,
      requireArtifactReadback: false,
    },
  };
}
