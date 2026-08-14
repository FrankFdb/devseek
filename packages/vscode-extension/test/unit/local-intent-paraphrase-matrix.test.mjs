/**
 * Provider-free local intent paraphrase matrix.
 *
 * These cases exercise local semantic hints at the same front door used by the
 * extension. Hints never pre-route execution; the main model owns the turn.
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
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['runtime-error-repair-request', 'conditional-repair-on-failure'],
    validation: { commandEvidenceRequired: true },
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
  {
    name: 'run-to-repair-en-test-failure',
    prompt: 'Run npm test, and if it fails fix the issue.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'validation-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'run-to-repair-cn-compile-error',
    prompt: '请编译，执行，如果有编译错误，请修正。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'validation-repair-request'],
    validation: { commandEvidenceRequired: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'health-repair-en-ci-green',
    prompt: 'CI is red, get it green.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'validation-repair-request', 'validation-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'health-repair-en-tests-pass',
    prompt: 'The tests are failing, make them pass.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'validation-repair-request', 'validation-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'health-repair-cn-tests-pass',
    prompt: '测试挂了，帮我过掉。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'validation-repair-request', 'validation-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'project-health-repair-en-app-working',
    prompt: 'The app is broken, make it work again.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'project-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'project-health-repair-en-login-flow',
    prompt: 'The login flow regressed, can you get it working again?',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'project-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'project-health-repair-cn-login-flow',
    prompt: '登录流程坏了，帮我恢复可用。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'project-health-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'project-health-read-only-question',
    prompt: 'The app is broken, can I get an explanation?',
    route: { family: 'qa', chatKind: 'chat', mode: 'qa', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'runtime-error-repair-en-stack-take-care',
    prompt: 'Here is the stack trace from login: TypeError: Cannot read properties of undefined. Can you take care of it?',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'runtime-error-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'runtime-error-repair-en-console-go-away',
    prompt: 'The console shows TypeError in src/profile.ts when opening profile. Please make it go away.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'runtime-error-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'runtime-error-repair-cn-white-screen',
    prompt: '用户反馈登录后白屏，麻烦看一下并处理。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'runtime-error-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'runtime-error-read-only-question',
    prompt: 'What does TypeError: config is undefined mean?',
    route: { family: 'qa', chatKind: 'chat', mode: 'qa', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'user-symptom-repair-en-signin',
    prompt: 'Users cannot sign in after entering the correct password. Please sort it out.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'user-symptom-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'user-symptom-repair-cn-save',
    prompt: '用户反馈点击保存没有反应，帮我修一下。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    signals: ['conditional-repair-on-failure', 'user-symptom-repair-request'],
    validation: { commandEvidenceRequired: true, testRequested: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'user-symptom-read-only-question',
    prompt: 'The login button does nothing. Why might that happen?',
    route: { family: 'qa', chatKind: 'chat', mode: 'qa', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'self-help-repair-question-with-path',
    prompt: 'How do I fix src/login.ts if users cannot sign in?',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    signals: ['self-help-repair-question'],
    validation: { commandEvidenceRequired: false, testRequested: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'run-only-negated-repair',
    prompt: 'Run tests, but do not fix failures.',
    route: { family: 'terminal-validation', chatKind: 'code-change', mode: 'run', shape: 'validation-repair' },
    workflow: { kind: 'run-agent', useAgent: true, toolPolicy: 'run' },
    validation: { commandEvidenceRequired: true, testRequested: true },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'health-repair-negated-read-only',
    prompt: 'CI is red, tell me why, but do not change files.',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'inspect' },
    validation: { commandEvidenceRequired: false, testRequested: false },
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

    assert.equal(decision.workflow.kind, 'model-agent', scenario.name);
    assert.equal(decision.workflow.useAgent, true, scenario.name);
    assert.equal(decision.toolPolicy.mode, 'model-led', scenario.name);
  }
});

console.log('\nLocal intent paraphrase matrix tests passed.\n');
