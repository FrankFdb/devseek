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
  });

  assert.equal(contract.mode, 'review');
  assert.deepEqual(contract.deliverables.map(item => item.kind), ['report']);
  assert.deepEqual(contract.acceptance.map(item => item.id), ['grounded-response']);
  assert.equal(contract.constraints.includes('no-workspace-mutation'), true);
});

test('a model-revised edit mode projects source mutation and verification normally', () => {
  const contract = projectVsCodeCodingKernelTaskContract({
    userPrompt: 'Fix src/math.js and verify it.',
    executionMode: 'edit',
    contextFiles: [],
    workspaceRoot: '/workspace',
    taskContract: semanticTaskContract(['source-change', 'verification-result']),
    targetPaths: ['src/math.js'],
  });

  assert.equal(contract.mode, 'change');
  assert.deepEqual(contract.deliverables.map(item => item.kind), [
    'source-change',
    'verification-result',
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
