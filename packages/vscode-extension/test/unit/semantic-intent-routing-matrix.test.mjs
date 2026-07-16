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

function semantic(overrides) {
  return {
    version: 'devseek.semantic-intent/v1',
    source: 'test',
    mode: 'qa',
    taskKind: 'question-answer',
    confidence: 0.9,
    mutation: 'none',
    targetPaths: [],
    requiresWorkspace: false,
    requiresTerminal: false,
    requiresExternalEffect: false,
    requiresClarification: false,
    reason: 'external coding-agent workflow case',
    ...overrides,
  };
}

const cases = [
  {
    id: 'SEM-QA-001',
    prompt: 'What test framework does this repository use?',
    files: [],
    semanticIntent: semantic({ mode: 'qa', taskKind: 'question-answer' }),
    expect: { mode: 'qa', workflow: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
  },
  {
    id: 'SEM-INSPECT-001',
    prompt: 'Explain src/auth.ts without changing files.',
    files: ['/tmp/project/src/auth.ts'],
    semanticIntent: semantic({
      mode: 'inspect',
      taskKind: 'read-only-analysis',
      targetPaths: ['/tmp/project/src/auth.ts'],
      requiresWorkspace: true,
    }),
    expect: { mode: 'inspect', workflow: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
  },
  {
    id: 'SEM-PLAN-001',
    prompt: 'Plan a refactor for src/router.ts, do not edit yet.',
    files: ['/tmp/project/src/router.ts'],
    semanticIntent: semantic({
      mode: 'plan',
      taskKind: 'planning',
      targetPaths: ['/tmp/project/src/router.ts'],
      requiresWorkspace: true,
    }),
    expect: { mode: 'plan', workflow: 'plan-agent', useAgent: true, toolPolicy: 'plan' },
  },
  {
    id: 'SEM-REVIEW-001',
    prompt: 'Review this change and list the highest-risk issues only.',
    files: ['/tmp/project/src/payment.ts'],
    semanticIntent: semantic({
      mode: 'inspect',
      taskKind: 'code-review',
      targetPaths: ['/tmp/project/src/payment.ts'],
      requiresWorkspace: true,
    }),
    expect: { mode: 'inspect', workflow: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
  },
  {
    id: 'SEM-STANDALONE-001',
    prompt: 'Write a small C++ program that prints good afternoon and run it.',
    files: [],
    semanticIntent: semantic({
      mode: 'edit',
      taskKind: 'standalone-program',
      mutation: 'create-file',
      requiresWorkspace: true,
      requiresTerminal: true,
    }),
    expect: { mode: 'edit', workflow: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
  },
  {
    id: 'SEM-FILE-001',
    prompt: 'Create docs/migration-plan.md summarizing the migration steps.',
    files: [],
    semanticIntent: semantic({
      mode: 'edit',
      taskKind: 'file-artifact',
      mutation: 'create-file',
      targetPaths: ['docs/migration-plan.md'],
      requiresWorkspace: true,
    }),
    expect: { mode: 'edit', workflow: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
  },
  {
    id: 'SEM-EXISTING-EDIT-001',
    prompt: 'Fix the parser bug in src/parser.ts and add a focused test.',
    files: ['/tmp/project/src/parser.ts'],
    semanticIntent: semantic({
      mode: 'edit',
      taskKind: 'existing-project-edit',
      mutation: 'modify-source',
      targetPaths: ['/tmp/project/src/parser.ts'],
      requiresWorkspace: true,
      requiresTerminal: true,
    }),
    expect: { mode: 'edit', workflow: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
  },
  {
    id: 'SEM-RUN-001',
    prompt: 'Run the test suite and report the failures, do not change files.',
    files: ['/tmp/project/package.json'],
    semanticIntent: semantic({
      mode: 'run',
      taskKind: 'terminal-validation',
      mutation: 'run-only',
      requiresWorkspace: true,
      requiresTerminal: true,
    }),
    expect: { mode: 'run', workflow: 'run-agent', useAgent: true, toolPolicy: 'run' },
  },
  {
    id: 'SEM-EXTERNAL-001',
    prompt: 'Commit the current changes and push the branch.',
    files: ['/tmp/project/src/parser.ts'],
    semanticIntent: semantic({
      mode: 'run',
      taskKind: 'external-effect',
      mutation: 'external-effect',
      requiresWorkspace: true,
      requiresTerminal: true,
      requiresExternalEffect: true,
    }),
    expect: { mode: 'run', workflow: 'confirmation-required', useAgent: false, toolPolicy: 'run' },
  },
  {
    id: 'SEM-DESTRUCTIVE-001',
    prompt: 'Delete the generated build directory.',
    files: ['/tmp/project/build'],
    semanticIntent: semantic({
      mode: 'destructive',
      taskKind: 'destructive',
      mutation: 'delete',
      targetPaths: ['/tmp/project/build'],
      requiresWorkspace: true,
    }),
    expect: { mode: 'destructive', workflow: 'confirmation-required', useAgent: false, toolPolicy: 'destructive' },
  },
];

for (const item of cases) {
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
  });
}

test('Semantic intent routing matrix: ambiguity becomes clarification, not execution', () => {
  const prompt = 'Handle the auth thing.';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: ['/tmp/project/src/auth.ts'],
    agentEnabled: true,
    semanticIntent: semantic({
      mode: 'plan',
      taskKind: 'ambiguous',
      mutation: 'none',
      targetPaths: ['/tmp/project/src/auth.ts'],
      requiresWorkspace: true,
      requiresClarification: true,
    }),
  });
  const request = buildPreExecutionInteraction({
    userText: prompt,
    prompt,
    files: ['/tmp/project/src/auth.ts'],
    intent: decision.intent,
    workflow: decision.workflow,
  });

  assert.equal(decision.intent.blockers.includes('semantic-clarification-needed'), true);
  assert.equal(request?.kind, 'clarify');
});

console.log('\nSemantic intent routing matrix tests passed.\n');
