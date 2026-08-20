import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-contract.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-contract.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { hasSourceClaimArtifactContract } = createRequire(import.meta.url)(bundlePath);

test('source-claim grounding requires both the report deliverable and explicit contract flag', () => {
  assert.equal(hasSourceClaimArtifactContract(contract({
    deliverables: ['report'],
    requireSourceClaimGrounding: true,
  })), true);
  assert.equal(hasSourceClaimArtifactContract(contract({
    deliverables: ['source-change'],
    requireSourceClaimGrounding: true,
  })), false);
  assert.equal(hasSourceClaimArtifactContract(contract({
    deliverables: ['report'],
    requireSourceClaimGrounding: false,
  })), false);
});

test('task contract module contains structured facts and no raw-prompt intent parser', () => {
  const source = readFileSync(path.join(rootDir, 'src/agent/task-contract.ts'), 'utf8');

  assert.doesNotMatch(source, /parseTaskContract|extractTaskContract|prompt\s*:/);
  assert.doesNotMatch(source, /RegExp|\.match\(/);
  assert.match(source, /interface TaskContract/);
  assert.match(source, /deliverableTargets/);
  assert.match(source, /verificationContract/);
});

function contract({ deliverables, requireSourceClaimGrounding }) {
  return {
    taskShapes: [],
    objectives: [],
    inputs: [],
    deliverableTargets: [],
    deliverables,
    constraints: [],
    qualityObligations: [],
    evidenceRequirements: [],
    verificationContract: {
      requireSourceClaimGrounding,
      requireTitle: false,
      requiredSourcePaths: [],
      exactCodeBlocks: [],
      exactArtifactRequested: false,
      requireArtifactReadback: false,
    },
  };
}
