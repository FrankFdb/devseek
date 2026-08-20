import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-context-compaction.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-context-compaction.ts --bundle `
  + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { compactAgenticMessageHistory, compactCanonicalAgenticHistory } = req(bundlePath);
const {
  CanonicalCheckpointService,
  CanonicalContextCompactionService,
  CanonicalContextGraphService,
  CanonicalMemoryPolicyService,
  CanonicalTaskContractService,
} = req('@devseek-netai/shared');

const textToolProtocol = Object.freeze({
  version: 'devseek.text-tools/v1',
  channelId: 'agentic-compaction-test-channel',
});

function session() {
  const taskContract = new CanonicalTaskContractService().build({
    goal: 'Refactor src/resume.ts and run focused tests',
    mode: 'change',
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/resume.ts' }],
    acceptance: [{
      id: 'tests',
      statement: 'Focused tests pass.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'resume-test-suite',
        scope: ['src/resume.ts'],
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
    seed: { files: [{ path: 'src/resume.ts', contentSample: 'export {};' }] },
  });
  const memoryPolicy = new CanonicalMemoryPolicyService().selectContext({
    workspaceRoot: '/repo',
    candidates: [],
  });
  const checkpoint = new CanonicalCheckpointService().bind({
    runId: 'agentic-compaction-run',
    surface: 'vscode',
    workspaceRoot: '/repo',
    taskContract,
    contextGraph,
    memoryPolicySha256: memoryPolicy.decisionSha256,
  });
  return new CanonicalContextCompactionService().bind({
    taskContract,
    contextGraph,
    memoryPolicy,
    checkpoint,
  });
}

function messages() {
  return [
    { role: 'user', content: 'Task contract and prompt' },
    { role: 'assistant', content: '<read_file>{"path":"/repo/src/resume.ts"}</read_file>' },
    { role: 'user', content: '[工具结果 Round 1]\nsource read' },
    { role: 'assistant', content: 'Investigating' },
    { role: 'user', content: '[工具结果 Round 2]\nmore evidence' },
    { role: 'assistant', content: 'Editing' },
    { role: 'user', content: '[工具结果 Round 3]\ntest pending' },
    { role: 'assistant', content: 'Continuing' },
  ];
}

test('agentic history budget delegates over-budget pruning to the canonical compaction session', () => {
  const compaction = session();
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index === 0 ? 'Task' : `Round ${index}`} ${'context '.repeat(6_000)}`,
  }));
  const total = compactAgenticMessageHistory({
    messages: history,
    session: compaction,
    currentTodos: [{ id: 1, title: 'Edit src/resume.ts', status: 'in-progress' }],
    workspaceRoot: '/repo',
    round: 3,
    evidenceRefs: [{ kind: 'read', label: 'resume source', evidenceId: 'evidence:resume' }],
    textToolProtocol,
  });

  assert.equal(compaction.receipts().length, 1);
  assert.ok(total > 0 && total <= 52_000);
  assert.match(history.map(message => message.content).join('\n'), /\[DevSeek Canonical Context Compaction\]/u);
  assert.deepEqual(compaction.receipts()[0].evidenceRefs, [
    'agentic:context-budget:round-3',
    'evidence:resume',
  ]);
});

test('agentic compaction keeps stable todo progress and a final revalidation unit', () => {
  const compaction = session();
  const history = messages();
  const first = compactCanonicalAgenticHistory({
    messages: history,
    session: compaction,
    currentTodos: [
      { id: 1, title: 'Edit src/resume.ts', status: 'in-progress' },
      { id: 2, title: 'Run focused tests', status: 'not-started' },
    ],
    workspaceRoot: '/repo',
    observedChars: 70_000,
    maxChars: 52_000,
    maxMessages: 6,
    round: 4,
  });
  assert.deepEqual(first.pendingUnits.map(unit => unit.id), [
    'agentic:todo:1',
    'agentic:todo:2',
    'agentic:finalize',
  ]);

  const second = compactCanonicalAgenticHistory({
    messages: history,
    session: compaction,
    currentTodos: [
      { id: 1, title: 'Edit src/resume.ts', status: 'completed' },
      { id: 2, title: 'Run focused tests', status: 'in-progress' },
    ],
    workspaceRoot: '/repo',
    observedChars: 72_000,
    maxChars: 52_000,
    maxMessages: 6,
    round: 7,
  });
  assert.equal(second.completedUnitCount, 1);
  assert.deepEqual(second.pendingUnits.map(unit => unit.id), ['agentic:todo:2', 'agentic:finalize']);
  assert.equal(second.parentReceiptSha256, first.receiptSha256);
});

test('agentic compaction fails closed on todo expansion or semantic drift between passes', () => {
  const compaction = session();
  const history = messages();
  compactCanonicalAgenticHistory({
    messages: history,
    session: compaction,
    currentTodos: [{ id: 1, title: 'Edit src/resume.ts', status: 'in-progress' }],
    workspaceRoot: '/repo',
    observedChars: 70_000,
    maxChars: 52_000,
    maxMessages: 6,
    round: 2,
  });

  assert.throws(() => compactCanonicalAgenticHistory({
    messages: history,
    session: compaction,
    currentTodos: [
      { id: 1, title: 'Edit src/resume.ts', status: 'in-progress' },
      { id: 2, title: 'Publish package', status: 'not-started' },
    ],
    workspaceRoot: '/repo',
    observedChars: 72_000,
    maxChars: 52_000,
    maxMessages: 6,
    round: 3,
  }), /agentic-context-compaction:pending-plan-expanded/u);
  assert.throws(() => compactCanonicalAgenticHistory({
    messages: history,
    session: compaction,
    currentTodos: [{ id: 1, title: 'Delete src/resume.ts', status: 'in-progress' }],
    workspaceRoot: '/repo',
    observedChars: 72_000,
    maxChars: 52_000,
    maxMessages: 6,
    round: 3,
  }), /agentic-context-compaction:pending-plan-drift/u);
});
