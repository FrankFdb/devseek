/**
 * Provider-free local intent paraphrase matrix.
 *
 * These cases exercise the same front-door route and workflow selection used by
 * the extension, but intentionally provide no model semanticIntent override.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, outfile) {
  execSync(
    `npx esbuild ${entry} --bundle ` +
    `--outfile=${outfile} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const taskIntentBundle = path.join(rootDir, 'test/unit/local-intent-paraphrase-task-intent.bundle.cjs');
const chatControllerBundle = path.join(rootDir, 'test/unit/local-intent-paraphrase-chat-controller.bundle.cjs');

bundle('src/task-intent-router.ts', taskIntentBundle);
bundle('src/app/chat-controller.ts', chatControllerBundle);

const req = createRequire(import.meta.url);
const { routeTaskIntent } = req(taskIntentBundle);
const { ChatRouteController } = req(chatControllerBundle);

const CASES = [
  {
    name: 'smalltalk-polished-thanks',
    prompt: 'Great, thank you!',
    route: { family: 'smalltalk', chatKind: 'chat', mode: 'smalltalk', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'smalltalk' },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'smalltalk-acknowledgement',
    prompt: 'ok got it',
    route: { family: 'smalltalk', chatKind: 'chat', mode: 'smalltalk', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'smalltalk' },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'smalltalk-cn-acknowledgement',
    prompt: '好的，明白了',
    route: { family: 'smalltalk', chatKind: 'chat', mode: 'smalltalk', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'smalltalk' },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'inspect-look-through-no-edits',
    prompt: 'Could you look through src/payment.ts for risky logic? No edits.',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    readTargets: ['src/payment.ts'],
    validation: { commandEvidenceRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'inspect-cn-see-summary',
    prompt: '帮我看下 src/order.ts 的职责，只说结论别改。',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    readTargets: ['src/order.ts'],
    validation: { commandEvidenceRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'plan-cn-repair-idea-no-code',
    prompt: '先给我 src/cache.ts 的修复思路，不要动代码。',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'plan', shape: 'read-only-analysis' },
    workflow: { kind: 'plan-agent', useAgent: true, toolPolicy: 'plan' },
    validation: { commandEvidenceRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'review-diff-test-coverage-language',
    prompt: 'Review the current diff for security regressions and missing tests.',
    files: [],
    route: { family: 'review', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    signals: ['workspace-diff-review'],
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'edit-cn-indirect-repair',
    prompt: '登录页空密码会崩，帮忙处理一下 src/login.ts。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: ['src/login.ts'] },
  },
  {
    name: 'artifact-release-notes-not-release-command',
    prompt: 'Draft docs/release-notes.md with the user-visible changes.',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    externalEffect: 'none',
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['docs/release-notes.md'] },
  },
  {
    name: 'artifact-cn-test-results-summary',
    prompt: '整理一份 docs/qa-summary.md，总结这次测试结果，不要改源码。',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['docs/qa-summary.md'] },
  },
  {
    name: 'external-effect-en-push-branch',
    prompt: 'Push this branch after committing the fix.',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    externalEffect: 'requested',
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'external-effect-cn-commit-push',
    prompt: '提交并推送当前分支。',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    externalEffect: 'requested',
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'terminal-run-output',
    prompt: 'Run npm test and show me the output.',
    route: { family: 'terminal-validation', chatKind: 'code-change', mode: 'run', shape: 'general' },
    workflow: { kind: 'run-agent', useAgent: true, toolPolicy: 'run' },
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
];

test('local intent paraphrase matrix: provider-free user input routes semantically', () => {
  const controller = new ChatRouteController();

  for (const scenario of CASES) {
    const route = routeTaskIntent(scenario.prompt);
    const decision = controller.decide({
      userDisplay: scenario.prompt,
      prompt: scenario.prompt,
      files: scenario.files ?? [],
      agentEnabled: true,
    });

    assert.equal(route.family, scenario.route.family, scenario.name);
    assert.equal(route.chatKind, scenario.route.chatKind, scenario.name);
    assert.equal(route.mode, scenario.route.mode, scenario.name);
    assert.equal(route.agentTaskShape, scenario.route.shape, scenario.name);

    assert.equal(route.mutation.requested, scenario.mutation.requested, scenario.name);
    assert.equal(route.mutation.sourceChange, scenario.mutation.sourceChange, scenario.name);
    assert.equal(route.mutation.fileArtifact, scenario.mutation.fileArtifact, scenario.name);
    assert.deepEqual([...route.mutation.targets].sort(), [...scenario.mutation.targets].sort(), scenario.name);

    for (const target of scenario.readTargets ?? []) {
      assert.ok(route.semanticContract.read.targets.includes(target), `${scenario.name}: missing read target ${target}`);
    }

    if (scenario.validation?.commandEvidenceRequired !== undefined) {
      assert.equal(
        route.validation.commandEvidenceRequired,
        scenario.validation.commandEvidenceRequired,
        scenario.name,
      );
    }
    if (scenario.validation?.testRequested !== undefined) {
      assert.equal(route.validation.testRequested, scenario.validation.testRequested, scenario.name);
    }

    for (const signal of scenario.signals ?? []) {
      assert.ok(route.signals.includes(signal), `${scenario.name}: missing signal ${signal}`);
    }
    if (scenario.externalEffect) {
      assert.equal(route.semanticContract.intent.context.externalEffect, scenario.externalEffect, scenario.name);
    }

    assert.equal(decision.workflow.kind, scenario.workflow.kind, scenario.name);
    assert.equal(decision.workflow.useAgent, scenario.workflow.useAgent, scenario.name);
    assert.equal(decision.toolPolicy.mode, scenario.workflow.toolPolicy, scenario.name);
  }
});

console.log('\nLocal intent paraphrase matrix tests passed.\n');
