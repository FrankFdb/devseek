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
  const workflow = selectWorkflow({ intent, files, agentEnabled: true, intentConfirmed, prompt, userText: prompt });
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

test('InteractionService: complex refactor asks for plan review first', () => {
  const prompt = '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块';
  const { intent, workflow } = route(prompt);
  const request = buildPreExecutionInteraction({ userText: prompt, prompt, files: [], intent, workflow });

  assert.equal(workflow.state, 'plan_review');
  assert.equal(request?.kind, 'planReview');
  assert.equal(request.options[0].id, 'plan');
  assert.equal(request.options[1].id, 'continue');
  assert.match(request.options[0].prompt, /推荐默认边界/);
  assert.match(request.options[0].prompt, /不要输出大量 A\/B\/C 问卷/);
  assert.match(request.details.join('\n'), /权限模式：plan/);
});

test('InteractionService: semantic clarification blocker asks before execution', () => {
  const prompt = '处理一下 auth';
  const intent = {
    ...decideChatIntent(prompt),
    mode: 'edit',
    kind: 'code-change',
    blockers: ['semantic-clarification-needed'],
    signals: ['semantic-task:ambiguous', 'semantic-mutation:none'],
    reason: 'semantic:ambiguous:target unclear',
  };
  const workflow = selectWorkflow({ intent, files: ['/tmp/src/auth.ts'], agentEnabled: true, prompt, userText: prompt });
  const request = buildPreExecutionInteraction({ userText: prompt, prompt, files: ['/tmp/src/auth.ts'], intent, workflow });

  assert.equal(request?.kind, 'clarify');
  assert.equal(request.title, '需要先澄清任务意图');
  assert.equal(request.options[0].id, 'clarify');
  assert.equal(request.options[1].id, 'plan');
  assert.match(request.details.join('\n'), /模型任务类型：ambiguous/);
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
