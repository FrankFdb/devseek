import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/subagent-contract-service.bundle.cjs');

execSync(
  `npx esbuild src/app/subagent-contract-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  SubagentContractService,
  SUBAGENT_CONTRACT_PROTOCOL,
  SUBAGENT_CHILD_OUTPUT_PROTOCOL,
  SUBAGENT_PARALLEL_MERGE_PROTOCOL,
  SUBAGENT_CANCEL_RECEIPT_PROTOCOL,
} = req(bundlePath);

test('R3-06A SubagentContractService: child contract isolates context, budget, permission, and evidence-only output', () => {
  const service = new SubagentContractService({ now: () => 42 });
  const contract = service.createContract({
    parentRunId: 'run-1',
    childId: 'child-review-1',
    role: 'reviewer',
    taskBrief: 'Review src/app.ts with token=supersecretvalue12345',
    contextRefs: [
      { kind: 'file', uri: 'file:///repo/src/app.ts', label: 'app', rawContent: 'authorization: Bearer abcdefgh1234567890' },
      { kind: 'session', uri: 'session://parent/full-transcript', label: 'parent transcript', rawContent: 'private parent chain' },
    ],
    evidenceRefs: ['run-evidence:1:abc', 'run-evidence:1:abc'],
    budget: { maxTurns: 999, maxToolCalls: 999, maxTokens: 500_000, maxElapsedMs: 100_000_000 },
  });

  assert.equal(contract.protocol, SUBAGENT_CONTRACT_PROTOCOL);
  assert.equal(contract.outputContract.protocol, SUBAGENT_CHILD_OUTPUT_PROTOCOL);
  assert.equal(contract.settlementAuthority, 'parent-kernel');
  assert.equal(contract.outputContract.terminalClaimsAllowed, false);
  assert.equal(contract.outputContract.directEffectsAllowed, false);
  assert.match(contract.input.taskBrief, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(contract), /supersecretvalue12345|abcdefgh1234567890|private parent chain/);
  assert.deepEqual(contract.input.evidenceRefs, ['run-evidence:1:abc']);
  assert.ok(contract.budget.maxTurns <= 8);
  assert.ok(contract.budget.maxToolCalls <= 40);
  assert.equal(service.decideToolPermission(contract, { kind: 'read', toolName: 'read_file' }).action, 'allow');
  assert.equal(service.decideToolPermission(contract, { kind: 'edit', toolName: 'write_file', mutatesWorkspace: true }).action, 'deny');
  assert.equal(service.decideToolPermission(contract, { kind: 'terminal', toolName: 'bash', mutatesWorkspace: true }).action, 'deny');

  const result = service.acceptChildResult(contract, {
    status: 'completed',
    evidenceRefs: ['run-evidence:2:def'],
    proposals: [
      {
        kind: 'patch-proposal',
        targetRef: 'file:///repo/src/app.ts',
        summary: 'Change looks safe but secret=topsecretvalue12345 must be hidden',
        evidenceRefs: ['run-evidence:2:def'],
        patch: 'direct patch content must not become an effect',
      },
    ],
    terminalClaim: { status: 'completed', changedFiles: ['src/app.ts'] },
    changedFiles: ['src/app.ts'],
  });

  assert.equal(result.protocol, SUBAGENT_CHILD_OUTPUT_PROTOCOL);
  assert.equal(result.status, 'blocked');
  assert.equal(result.settlementAuthority, 'parent-kernel');
  assert.ok(result.violations.includes('child-terminal-claim-rejected'));
  assert.ok(result.violations.includes('child-direct-effect-rejected'));
  assert.equal('terminalClaim' in result, false);
  assert.equal('changedFiles' in result, false);
  assert.equal(result.proposals[0].kind, 'patch-proposal');
  assert.equal(result.proposals[0].patch, undefined);
  assert.match(result.proposals[0].summary, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(result), /topsecretvalue12345/);
  assert.deepEqual(result.evidenceRefs, ['run-evidence:2:def']);
});

test('R3-06B SubagentContractService: parent Kernel owns parallel merge conflicts, orphan rejection, and cancel receipts', () => {
  const service = new SubagentContractService({ now: () => 84 });
  const contractA = service.createContract({
    parentRunId: 'run-merge-1',
    childId: 'child-a',
    role: 'reviewer',
    taskBrief: 'Review app target',
  });
  const contractB = service.createContract({
    parentRunId: 'run-merge-1',
    childId: 'child-b',
    role: 'verifier',
    taskBrief: 'Verify app target',
  });
  const resultA = service.acceptChildResult(contractA, {
    status: 'proposed',
    evidenceRefs: ['run-evidence:a'],
    proposals: [
      {
        kind: 'patch-proposal',
        targetRef: 'file:///repo/src/app.ts',
        summary: 'A proposes safe edit',
        evidenceRefs: ['run-evidence:a'],
      },
    ],
  });
  const resultB = service.acceptChildResult(contractB, {
    status: 'proposed',
    evidenceRefs: ['run-evidence:b'],
    proposals: [
      {
        kind: 'patch-proposal',
        targetRef: 'file:///repo/src/app.ts',
        summary: 'B proposes competing edit',
        evidenceRefs: ['run-evidence:b'],
      },
    ],
  });

  const conflict = service.mergeChildResults({
    parentRunId: 'run-merge-1',
    parentVersion: 'run-v2',
    contracts: [contractA, contractB],
    results: [resultA, resultB],
  });

  assert.equal(conflict.protocol, SUBAGENT_PARALLEL_MERGE_PROTOCOL);
  assert.equal(conflict.settlementAuthority, 'parent-kernel');
  assert.equal(conflict.status, 'blocked');
  assert.equal(conflict.acceptedProposals.length, 0);
  assert.equal(conflict.conflicts[0].targetRef, 'file:///repo/src/app.ts');
  assert.deepEqual(conflict.conflicts[0].childIds, ['child-a', 'child-b']);
  assert.ok(conflict.violations.includes('parallel-write-conflict'));
  assert.equal(conflict.parentKernelMergeDecision.status, 'blocked');
  assert.deepEqual(conflict.evidenceRefs, ['run-evidence:a', 'run-evidence:b']);

  const orphan = service.mergeChildResults({
    parentRunId: 'run-merge-1',
    parentVersion: 'run-v2',
    contracts: [contractA],
    results: [resultB],
  });
  assert.equal(orphan.status, 'blocked');
  assert.deepEqual(orphan.orphanChildIds, ['child-b']);
  assert.equal(orphan.acceptedProposals.length, 0);
  assert.ok(orphan.violations.includes('orphan-child-result-rejected'));

  const cancelReceipt = service.cancelParallelRun({
    parentRunId: 'run-merge-1',
    parentVersion: 'run-v3',
    childIds: ['child-b', 'child-a', 'child-a'],
    reason: 'user-cancelled',
  });
  assert.equal(cancelReceipt.protocol, SUBAGENT_CANCEL_RECEIPT_PROTOCOL);
  assert.equal(cancelReceipt.settlementAuthority, 'parent-kernel');
  assert.equal(cancelReceipt.postCancelEffectsAllowed, false);
  assert.deepEqual(cancelReceipt.childIds, ['child-a', 'child-b']);
  assert.equal(
    service.cancelParallelRun({
      parentRunId: 'run-merge-1',
      parentVersion: 'run-v3',
      childIds: ['child-a', 'child-b'],
      reason: 'user-cancelled',
    }).receiptId,
    cancelReceipt.receiptId,
  );

  const afterCancel = service.acceptChildResultAfterCancel(cancelReceipt, contractA, {
    status: 'proposed',
    evidenceRefs: ['run-evidence:late'],
    proposals: [
      {
        kind: 'patch-proposal',
        targetRef: 'file:///repo/src/late.ts',
        summary: 'late work must not land',
        evidenceRefs: ['run-evidence:late'],
      },
    ],
  });
  assert.equal(afterCancel.status, 'blocked');
  assert.equal(afterCancel.proposals.length, 0);
  assert.ok(afterCancel.violations.includes('child-result-after-cancel-rejected'));

  const mergeAfterCancel = service.mergeChildResults({
    parentRunId: 'run-merge-1',
    parentVersion: 'run-v3',
    contracts: [contractA, contractB],
    results: [resultA],
    cancelReceipt,
  });
  assert.equal(mergeAfterCancel.status, 'cancelled');
  assert.equal(mergeAfterCancel.acceptedProposals.length, 0);
  assert.ok(mergeAfterCancel.violations.includes('child-result-after-cancel-rejected'));
});

console.log('\nSubagent contract service tests passed.\n');
