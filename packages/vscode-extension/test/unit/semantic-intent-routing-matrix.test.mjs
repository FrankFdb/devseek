/**
 * External-workflow-inspired semantic intent routing matrix.
 *
 * The cases mirror common coding-agent workflows documented by Codex,
 * Claude Code, VS Code agents, and Aider: ask, inspect, plan, review,
 * edit, run, external effect, destructive action, and ambiguity handling.
 * The test injects the LLM semantic result and verifies DevSeek governance,
 * without adding prompt keyword rules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EXTERNAL_INTENT_CORPUS,
  EXTERNAL_INTENT_SOURCES,
} from '../fixtures/external-intent-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const routeBundlePath = path.join(rootDir, 'test/unit/semantic-intent-routing.chat-controller.bundle.cjs');
const interactionBundlePath = path.join(rootDir, 'test/unit/semantic-intent-routing.interaction-service.bundle.cjs');

execSync(
  `npx esbuild src/app/chat-controller.ts --bundle ` +
  `--outfile=${routeBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/interaction-service.ts --bundle ` +
  `--outfile=${interactionBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ChatRouteController } = req(routeBundlePath);
const { buildPreExecutionInteraction } = req(interactionBundlePath);
const controller = new ChatRouteController();

const REQUIRED_TASK_KINDS = [
  'smalltalk',
  'question-answer',
  'read-only-analysis',
  'planning',
  'code-review',
  'standalone-program',
  'file-artifact',
  'existing-project-edit',
  'terminal-validation',
  'external-effect',
  'destructive',
  'ambiguous',
];

for (const item of EXTERNAL_INTENT_CORPUS) {
  test(`Semantic intent routing matrix: ${item.id}`, () => {
    const decision = controller.decide({
      userDisplay: item.prompt,
      prompt: item.prompt,
      files: item.files,
      agentEnabled: true,
      semanticIntent: item.semanticIntent,
    });

    assert.equal(decision.intent.mode, item.expect.mode);
    assert.equal(decision.workflow.kind, item.expect.workflow);
    assert.equal(decision.workflow.useAgent, item.expect.useAgent);
    assert.equal(decision.toolPolicy.mode, item.expect.toolPolicy);
    assert.ok(
      decision.intent.signals.includes('semantic-intent-provider')
        || decision.intent.signals.includes('semantic-intent-constrained'),
    );

    if (item.expect.interaction) {
      const request = buildPreExecutionInteraction({
        userText: item.prompt,
        prompt: item.prompt,
        files: item.files,
        intent: decision.intent,
        workflow: decision.workflow,
      });
      assert.equal(request?.kind, item.expect.interaction);
      assert.equal(decision.intent.blockers.includes('semantic-clarification-needed'), true);
    }

    assertSemanticContractProjection(decision, item);
  });
}

test('Semantic intent routing matrix: external corpus covers every task kind', () => {
  const counts = new Map(REQUIRED_TASK_KINDS.map(kind => [kind, 0]));
  for (const item of EXTERNAL_INTENT_CORPUS) {
    assert.ok(item.id.startsWith('EXT-'));
    assert.equal(item.taskKind, item.semanticIntent.taskKind);
    assert.ok(item.prompt.trim().length > 0);
    assert.ok(item.sourceRefs.length > 0, `${item.id} should cite at least one external source family`);
    for (const sourceRef of item.sourceRefs) {
      assert.ok(EXTERNAL_INTENT_SOURCES[sourceRef], `${item.id} has unknown source ${sourceRef}`);
    }
    counts.set(item.taskKind, (counts.get(item.taskKind) || 0) + 1);
  }

  const missing = [...counts.entries()].filter(([, count]) => count < 4);
  assert.deepEqual(missing, []);
});

test('Semantic intent routing matrix: external effects and destructive actions remain gated', () => {
  const gated = EXTERNAL_INTENT_CORPUS.filter(item =>
    item.taskKind === 'external-effect' || item.taskKind === 'destructive'
  );
  assert.ok(gated.length >= 8);
  for (const item of gated) {
    const decision = controller.decide({
      userDisplay: item.prompt,
      prompt: item.prompt,
      files: item.files,
      agentEnabled: true,
      semanticIntent: item.semanticIntent,
    });
    assert.equal(decision.workflow.kind, 'confirmation-required', item.id);
    assert.equal(decision.workflow.useAgent, false, item.id);
    assert.equal(decision.intent.requiresConfirmation, true, item.id);
  }
});

test('Semantic intent routing matrix: no-write run-only cases are executable but not mutating', () => {
  const runOnly = EXTERNAL_INTENT_CORPUS.filter(item =>
    item.taskKind === 'terminal-validation'
  );
  assert.ok(runOnly.length >= 4);
  for (const item of runOnly) {
    const decision = controller.decide({
      userDisplay: item.prompt,
      prompt: item.prompt,
      files: item.files,
      agentEnabled: true,
      semanticIntent: item.semanticIntent,
    });
    assert.equal(decision.intent.mode, 'run', item.id);
    assert.equal(decision.workflow.kind, 'run-agent', item.id);
    assert.equal(decision.toolPolicy.mode, 'run', item.id);
    assert.equal(decision.intent.blockers.includes('explicit-no-change'), false, item.id);
    assert.equal(decision.intent.semanticContract.mutation.requested, false, item.id);
    assert.equal(decision.intent.semanticContract.mutation.sourceChange, false, item.id);
    assert.equal(decision.intent.semanticContract.validation.runRequested, true, item.id);
  }
});

test('Semantic intent routing matrix: ambiguous corpus asks instead of executing edits', () => {
  const ambiguous = EXTERNAL_INTENT_CORPUS.filter(item => item.taskKind === 'ambiguous');
  assert.ok(ambiguous.length >= 4);
  for (const item of ambiguous) {
    const decision = controller.decide({
      userDisplay: item.prompt,
      prompt: item.prompt,
      files: item.files,
      agentEnabled: true,
      semanticIntent: item.semanticIntent,
    });
    const request = buildPreExecutionInteraction({
      userText: item.prompt,
      prompt: item.prompt,
      files: item.files,
      intent: decision.intent,
      workflow: decision.workflow,
    });
    assert.equal(request?.kind, 'clarify', item.id);
    assert.equal(decision.intent.blockers.includes('semantic-clarification-needed'), true, item.id);
    assert.equal(decision.intent.semanticContract.mutation.requested, false, item.id);
    assert.equal(decision.intent.semanticContract.mutation.sourceChange, false, item.id);
    assert.equal(decision.intent.semanticContract.validation.requested, false, item.id);
  }
});

function assertSemanticContractProjection(decision, item) {
  const contract = decision.intent.semanticContract;
  assert.ok(contract.signals.includes('semantic-intent-proposal'), item.id);

  if (item.taskKind === 'smalltalk' || item.taskKind === 'question-answer') {
    assert.equal(contract.mutation.requested, false, item.id);
    assert.equal(contract.mutation.sourceChange, false, item.id);
    assert.equal(contract.mutation.fileArtifact, false, item.id);
    assert.equal(contract.validation.requested, false, item.id);
    assert.equal(contract.taskContract.deliverables.includes('source-change'), false, item.id);
    return;
  }

  if (['read-only-analysis', 'planning', 'code-review'].includes(item.taskKind)) {
    assert.equal(contract.mutation.requested, false, item.id);
    assert.equal(contract.mutation.sourceChange, false, item.id);
    assert.equal(contract.mutation.fileArtifact, false, item.id);
    assert.equal(contract.taskContract.deliverables.includes('source-change'), false, item.id);
    assert.equal(decision.toolPolicy.allowedToolKinds.includes('edit'), false, item.id);
    if (item.semanticIntent.requiresWorkspace || item.semanticIntent.targetPaths.length > 0) {
      assert.equal(contract.read.requested, true, item.id);
    }
    assertTargetsIncluded(contract.read.targets, item.semanticIntent.targetPaths, item.id);
    return;
  }

  if (item.taskKind === 'standalone-program') {
    assert.equal(contract.kind, 'standalone-code', item.id);
    assert.equal(contract.scope, 'standalone', item.id);
    assert.equal(contract.mutation.requested, true, item.id);
    assert.equal(contract.mutation.sourceChange, true, item.id);
    assert.equal(contract.mutation.fileArtifact, false, item.id);
    assert.ok(contract.taskContract.deliverables.includes('source-change'), item.id);
    if (item.semanticIntent.requiresTerminal) {
      assert.equal(contract.validation.runRequested, true, item.id);
    }
    return;
  }

  if (item.taskKind === 'file-artifact') {
    assert.equal(contract.kind, 'file-artifact', item.id);
    assert.equal(contract.mutation.requested, true, item.id);
    assert.equal(contract.mutation.fileArtifact, true, item.id);
    assert.equal(contract.mutation.sourceChange, false, item.id);
    assert.equal(contract.validation.fileCheckRequested, true, item.id);
    assert.equal(contract.taskContract.verificationContract.requireArtifactReadback, true, item.id);
    assert.ok(contract.taskContract.deliverables.includes('report'), item.id);
    assertTargetsIncluded(contract.mutation.targets, item.semanticIntent.targetPaths, item.id);
    assertTargetsIncluded(contract.taskContract.deliverableTargets, item.semanticIntent.targetPaths, item.id);
    return;
  }

  if (item.taskKind === 'existing-project-edit') {
    assert.equal(contract.kind, 'existing-project-code', item.id);
    assert.equal(contract.scope, 'existing-project', item.id);
    assert.equal(contract.mutation.requested, true, item.id);
    assert.equal(contract.mutation.sourceChange, true, item.id);
    assert.equal(contract.mutation.fileArtifact, false, item.id);
    assert.ok(contract.taskContract.deliverables.includes('source-change'), item.id);
    assertTargetsIncluded(contract.mutation.targets, item.semanticIntent.targetPaths, item.id);
    if (item.semanticIntent.requiresTerminal) {
      assert.equal(contract.validation.runRequested || contract.validation.testRequested, true, item.id);
    }
    return;
  }

  if (item.taskKind === 'terminal-validation') {
    assert.equal(contract.kind, 'validation', item.id);
    assert.equal(contract.mutation.requested, false, item.id);
    assert.equal(contract.mutation.sourceChange, false, item.id);
    assert.equal(contract.mutation.fileArtifact, false, item.id);
    assert.equal(contract.validation.requested, true, item.id);
    assert.equal(contract.validation.runRequested, true, item.id);
    assert.ok(contract.taskContract.deliverables.includes('verification-result'), item.id);
  }
}

function assertTargetsIncluded(actual, expected, id) {
  for (const target of expected) {
    assert.ok(actual.includes(target), `${id} missing target ${target}`);
  }
}

console.log('\nSemantic intent routing matrix tests passed.\n');
