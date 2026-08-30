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
const {
  compactAgenticMessageHistory,
  compactCanonicalAgenticHistory,
  projectAgenticToolFeedback,
  rebuildAgenticHistoryForFreshProviderSession,
} = req(bundlePath);
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

test('fresh Provider rebuild keeps the task, canonical receipt, and latest actionable evidence', () => {
  const compaction = session();
  const history = messages();
  history[2].content += `\n${'old read evidence '.repeat(1_000)}`;
  history[3].content += `\n${'stale investigation '.repeat(400)}`;
  history[4].content += `\n${'old validation evidence '.repeat(1_000)}`;
  history[5].content += `\n${'stale edit intent '.repeat(400)}`;
  history.push({ role: 'user', content: 'Retry one concrete tool action now.' });

  const total = rebuildAgenticHistoryForFreshProviderSession({
    messages: history,
    session: compaction,
    currentTodos: [{ id: 1, title: 'Edit src/resume.ts', status: 'in-progress' }],
    workspaceRoot: '/repo',
    round: 4,
    evidenceRefs: [{ kind: 'terminal', label: 'latest validation', evidenceId: 'evidence:test' }],
    textToolProtocol,
  });

  assert.equal(history.length, 4);
  assert.equal(history[0].content, 'Task contract and prompt');
  assert.match(history[1].content, /\[DevSeek Canonical Context Compaction\]/u);
  assert.match(history.map(message => message.content).join('\n'), /\[工具结果 Round 3\]\ntest pending/u);
  assert.match(history.at(-1).content, /Retry one concrete tool action now/u);
  assert.doesNotMatch(history.map(message => message.content).join('\n'), /Round 1|Round 2/u);
  assert.equal(compaction.receipts().at(-1).trigger, 'provider-recovery');
  assert.ok(total > 0 && total <= 24_000);
});

test('fresh Provider rebuild drops stale in-budget rounds without claiming budget compaction', () => {
  const compaction = session();
  const history = messages();
  history.push({ role: 'user', content: 'Retry one concrete tool action now.' });

  rebuildAgenticHistoryForFreshProviderSession({
    messages: history,
    session: compaction,
    currentTodos: [{ id: 1, title: 'Edit src/resume.ts', status: 'in-progress' }],
    workspaceRoot: '/repo',
    round: 4,
    evidenceRefs: [],
    textToolProtocol,
  });

  assert.deepEqual(history.map(message => message.content), [
    'Task contract and prompt',
    '[工具结果 Round 3]\ntest pending',
    'Retry one concrete tool action now.',
  ]);
  assert.equal(compaction.receipts().length, 0);
});

test('agentic tool feedback fairly preserves every parallel read as a coherent continuation', () => {
  const segments = Array.from({ length: 9 }, (_, index) => readFileFeedback(
    `/repo/src/unit-${index + 1}.cpp`,
    140,
  ));

  const projected = projectAgenticToolFeedback(5, segments).message;

  assert.ok(projected.length <= 8_000);
  assert.match(projected, /^\[工具结果 Round 5\]/u);
  for (let index = 0; index < segments.length; index += 1) {
    assert.match(projected, new RegExp(`\\[read_file: /repo/src/unit-${index + 1}\\.cpp\\]`, 'u'));
    assert.match(projected, new RegExp(`DevSeek 读取结果 ${index + 1}/9 已压缩`, 'u'));
  }
  assert.equal((projected.match(/startLine=\d+, endLine=\d+/gu) ?? []).length, 9);
});

test('agentic tool feedback exposes only source lines actually delivered to the Provider', () => {
  const projection = projectAgenticToolFeedback(6, [readFileFeedback('/repo/src/main.cpp', 280)]);

  assert.ok(projection.message.length <= 8_000);
  assert.match(projection.message, /文件行 \d+-\d+ 存在但尚未交付给模型/u);
  assert.equal(projection.readExposures.length, 1);
  assert.deepEqual(projection.readExposures.map(exposure => exposure.path), ['/repo/src/main.cpp']);
  assert.equal(projection.readExposures[0].startLine, 1);
  assert.ok(projection.readExposures[0].endLine < 280);
  assert.equal(projection.readExposures[0].sourceRangeStartLine, 1);
  assert.equal(projection.readExposures[0].sourceRangeEndLine, 280);
  assert.deepEqual(projection.readExposures.map(exposure => exposure.sourceSegmentIndex), [0]);
  assert.match(projection.message, /line 1: source-context/u);
  assert.doesNotMatch(projection.message, /line 280: source-context/u);
});

test('agentic tool feedback retains source segment identity across empty feedback', () => {
  const projection = projectAgenticToolFeedback(7, [
    '',
    readFileFeedback('/repo/src/worker.cpp', 12),
  ]);

  assert.deepEqual(projection.readExposures.map(exposure => exposure.sourceSegmentIndex), [1]);
});

test('agentic tool feedback leaves an in-budget result byte-for-byte intact', () => {
  const segment = '[grep_search: TODO]\nsrc/main.cpp:12: TODO';
  assert.equal(
    projectAgenticToolFeedback(2, [segment]).message,
    `[工具结果 Round 2]\n${segment}`,
  );
});

test('agentic tool feedback redistributes unused budget without losing long result identities', () => {
  const short = '[list_dir: /repo]\nsrc\ntest';
  const longA = `[grep_search: alpha]\n${'alpha-result\n'.repeat(900)}`;
  const longB = `[grep_search: beta]\n${'beta-result\n'.repeat(900)}`;
  const projected = projectAgenticToolFeedback(3, [short, longA, longB]).message;

  assert.ok(projected.length <= 8_000);
  assert.ok(projected.includes(short));
  assert.match(projected, /\[grep_search: alpha\]/u);
  assert.match(projected, /\[grep_search: beta\]/u);
  assert.equal((projected.match(/DevSeek 工具结果 [23]\/3 已压缩/gu) ?? []).length, 2);
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

function readFileFeedback(filePath, lineCount) {
  const source = Array.from(
    { length: lineCount },
    (_, index) => `line ${index + 1}: ${'source-context '.repeat(10)}`,
  ).join('\n');
  return [
    `[read_file: ${filePath}]`,
    '[file_context]',
    `path=${filePath}`,
    `resolvedPath=${filePath}`,
    `lines=${lineCount}`,
    `returnedLines=1-${lineCount}/${lineCount}`,
    'complete=true',
    'truncated=false',
    '[/file_context]',
    source,
  ].join('\n');
}
