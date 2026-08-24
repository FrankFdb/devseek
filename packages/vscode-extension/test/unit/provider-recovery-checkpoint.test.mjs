import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CanonicalCheckpointService,
  CanonicalContextGraphService,
  CodingKernelExecutionError,
  buildCodingKernelTaskContract,
} from '../../../shared/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const tempRoot = mkdtempSync(path.join(rootDir, '.provider-recovery-checkpoint-'));
const bundlePath = path.join(tempRoot, 'provider-recovery-checkpoint.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/provider-recovery-checkpoint.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:@devseek-netai/shared',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const {
  buildProviderRecoveryCheckpointRecord,
  isCheckpointableProviderRecoveryError,
} = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('ProviderRecoveryCheckpoint seals provider failure facts into a scoped resumable record', () => {
  const taskContract = buildCodingKernelTaskContract({
    goal: '修改 src/main.ts 并验证',
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/main.ts' }],
    acceptance: [{
      id: 'tests',
      statement: 'The focused verification passes.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'provider-recovery-test-suite',
        scope: ['src/main.ts'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  const contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
    seed: { files: [{ path: 'src/main.ts' }] },
  });
  const checkpoint = new CanonicalCheckpointService().bind({
    runId: 'provider-failure-run',
    surface: 'vscode',
    workspaceRoot: '/repo',
    taskContract,
    contextGraph,
  });
  const error = new CodingKernelExecutionError(
    'RESPONSE_CORRUPTED:truncated',
    {},
    { evidenceRefs: ['provider:ResponseCorrupted'] },
    checkpoint,
    taskContract,
  );

  assert.equal(isCheckpointableProviderRecoveryError(error), true);
  assert.equal(isCheckpointableProviderRecoveryError(new Error(error.message)), false);

  const record = buildProviderRecoveryCheckpointRecord({
    error,
    prompt: taskContract.goal,
    displayPrompt: taskContract.goal,
    mode: 'r1',
    workspaceRootFsPath: '/repo',
    savedAt: 1_000,
    sessionId: 'session-1',
    recoveryKind: 'ResponseCorrupted',
    pauseReason: 'Provider response was truncated.',
  });

  assert.equal(record.wsRootFsPath, '/repo');
  assert.equal(record.sessionId, 'session-1');
  assert.equal(record.startFromIndex, 0);
  assert.equal(record.completedCount, 0);
  assert.deepEqual(record.canonicalCheckpoint.pendingUnits.map(unit => unit.id), record.allTasks.map(task => task.id));
  assert.equal(record.canonicalCheckpoint.workspaceRoot, '/repo');
  assert.equal(record.canonicalCheckpoint.originSurface, 'vscode');
  assert.deepEqual(record.canonicalTaskContract, taskContract);
  assert.deepEqual(record.canonicalCheckpoint.evidenceRefs, ['provider:ResponseCorrupted']);
  assert.match(record.canonicalCheckpoint.sealSha256, /^[a-f0-9]{64}$/u);
});
