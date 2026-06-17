/**
 * Unit tests for app/interaction-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/interaction-service.bundle.cjs');
const intentBundlePath = path.join(rootDir, 'test/unit/interaction-service.intent-router.bundle.cjs');
const workflowBundlePath = path.join(rootDir, 'test/unit/interaction-service.workflow-service.bundle.cjs');

execSync(
  `npx esbuild src/app/interaction-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/intent-router.ts --bundle ` +
  `--outfile=${intentBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/workflow-service.ts --bundle ` +
  `--outfile=${workflowBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildPreExecutionInteraction } = req(bundlePath);
const { decideChatIntent } = req(intentBundlePath);
const { selectWorkflow } = req(workflowBundlePath);

function route(prompt, files = [], intentConfirmed = false) {
  const intent = decideChatIntent(prompt);
  const workflow = selectWorkflow({ intent, files, agentEnabled: true, intentConfirmed });
  return { intent, workflow };
}

test('InteractionService: vague create request asks for clarification', () => {
  const prompt = '编写程序';
  const { intent, workflow } = route(prompt);
  const request = buildPreExecutionInteraction({ userText: prompt, prompt, files: [], intent, workflow });

  assert.equal(request?.kind, 'clarify');
  assert.equal(request.options[0].id, 'clarify');
  assert.equal(request.options[1].id, 'plan');
  assert.equal(request.options[2].id, 'continue');
});

test('InteractionService: concrete 3D creation request can execute directly', () => {
  const prompt = '在code目录下，3d_world目录下，编写程序，展示三维世界，可以通过鼠标操作';
  const { intent, workflow } = route(prompt);
  const request = buildPreExecutionInteraction({ userText: prompt, prompt, files: [], intent, workflow });

  assert.equal(request, null);
});

test('InteractionService: destructive request requires visible confirmation', () => {
  const prompt = '删除 code/main.cpp';
  const { intent, workflow } = route(prompt, ['/tmp/main.cpp']);
  const request = buildPreExecutionInteraction({ userText: prompt, prompt, files: ['/tmp/main.cpp'], intent, workflow });

  assert.equal(request?.kind, 'confirm');
  assert.equal(request.options[0].id, 'continue');
  assert.equal(request.options[0].intentConfirmed, true);
});

test('InteractionService: confirmed request does not ask again', () => {
  const prompt = '删除 code/main.cpp';
  const { intent, workflow } = route(prompt, ['/tmp/main.cpp'], true);
  const request = buildPreExecutionInteraction({
    userText: prompt,
    prompt,
    files: ['/tmp/main.cpp'],
    intent,
    workflow,
    intentConfirmed: true,
  });

  assert.equal(request, null);
});

console.log('\nInteraction service tests passed.\n');
