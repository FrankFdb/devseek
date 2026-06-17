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
const { selectWorkflow } = req(bundlePath);

test('WorkflowService: smalltalk stays plain chat', () => {
  const intent = decideChatIntent('hello');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.useAgent, false);
});

test('WorkflowService: inspect requires context before agent', () => {
  const intent = decideChatIntent('分析这段代码');
  assert.equal(selectWorkflow({ intent, files: [], agentEnabled: true }).useAgent, false);
  assert.equal(selectWorkflow({ intent, files: ['/tmp/main.ts'], agentEnabled: true }).kind, 'inspect-agent');
});

test('WorkflowService: edit routes to edit agent when enabled', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true });
  assert.equal(selected.kind, 'edit-agent');
  assert.equal(selected.useAgent, true);
});

test('WorkflowService: forceNoAgent wins over edit intent', () => {
  const intent = decideChatIntent('修复这个 bug');
  const selected = selectWorkflow({ intent, files: [], agentEnabled: true, forceNoAgent: true });
  assert.equal(selected.kind, 'plain-chat');
  assert.equal(selected.reason, 'force-no-agent');
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
