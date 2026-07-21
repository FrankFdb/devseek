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
const { SubagentContractService, SUBAGENT_CONTRACT_PROTOCOL, SUBAGENT_CHILD_OUTPUT_PROTOCOL } = req(bundlePath);

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

console.log('\nSubagent contract service tests passed.\n');
