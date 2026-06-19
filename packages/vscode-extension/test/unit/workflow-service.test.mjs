/**
 * Unit tests for app/workflow-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workflow-service.bundle.cjs');
const intentBundlePath = path.join(rootDir, 'test/unit/workflow-service.intent-router.bundle.cjs');

execSync(
  `npx esbuild src/app/workflow-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);
execSync(
  `npx esbuild src/intent-router.ts --bundle ` +
  `--outfile=${intentBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { decideChatIntent } = req(intentBundlePath);
const { selectWorkflow, WorkflowStateMachine } = req(bundlePath);

test('WorkflowService: smalltalk stays plain chat', () => {
  const intent = decideChatIntent('hello');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.state, 'plain_chat');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: inspect requires context before agent', () => {
  const intent = decideChatIntent('分析这段代码');
  assert.equal(selectWorkflow({ intent, files: [], agentEnabled: true }).useAgent, false);
  const selected = selectWorkflow({ intent, files: ['/tmp/main.ts'], agentEnabled: true });
  assert.equal(selected.kind, 'inspect-agent');
  assert.equal(selected.toolPolicyMode, 'inspect');
});

test('WorkflowService: edit routes to edit agent when enabled', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.state, 'editing');
  assert.equal(selected.useAgent, true);
});

test('WorkflowService: complex refactor enters plan review with plan policy', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const intent = decideChatIntent(prompt);
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, prompt });

  assert.equal(selected.kind, 'plan-agent');
  assert.equal(selected.state, 'plan_review');
  assert.equal(selected.requiresPlanReview, true);
  assert.equal(selected.toolPolicyMode, 'plan');
  assert.ok(selected.allowedTransitions.some(t => t.event === 'approve-plan' && t.to === 'editing'));
});

test('WorkflowService: approved plan review can transition to editing', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const intent = decideChatIntent(prompt);
  const machine = new WorkflowStateMachine();
  const selected = machine.select({ intent, files: [], agentEnabled: true, prompt });
  const next = machine.transition(selected, 'approve-plan');

  assert.equal(next.kind, 'edit-agent');
  assert.equal(next.state, 'editing');
  assert.equal(next.toolPolicyMode, 'edit');
  assert.equal(next.requiresPlanReview, false);
});

test('WorkflowService: forceNoAgent wins over edit intent', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, forceNoAgent: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'force-no-agent');
  assert.equal(selected.toolPolicyMode, 'edit');
});

test('WorkflowService: destructive requests require confirmation outside agent', () => {
  const intent = decideChatIntent('删除 code/main.cpp');
  const selected = selectWorkflow({ intent, files: ['/tmp/main.cpp'], agentEnabled: true });
  assert.equal(selected.kind, 'confirmation-required');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: confirmed destructive requests route to edit agent', () => {
  const intent = decideChatIntent('删除 code/main.cpp');
  const selected = selectWorkflow({ intent, files: ['/tmp/main.cpp'], agentEnabled: true, intentConfirmed: true });
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.useAgent, true);
  assert.equal(selected.reason, 'confirmed-destructive-workflow');
});

console.log('\nWorkflow service tests passed.\n');
