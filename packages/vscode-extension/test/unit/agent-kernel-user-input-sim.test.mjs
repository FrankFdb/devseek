/**
 * Local self-loop simulation for basic user input classes.
 *
 * The test keeps Provider out of the loop while still exercising the same
 * front-door routing, canonical task-intent route, and AgentKernelService
 * composition seam used by the extension Surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const taskIntentBundle = path.join(rootDir, 'test/unit/agent-kernel-user-input-task-intent.bundle.cjs');
const chatControllerBundle = path.join(rootDir, 'test/unit/agent-kernel-user-input-chat-controller.bundle.cjs');
const kernelBundle = path.join(rootDir, 'test/unit/agent-kernel-user-input-service.bundle.cjs');

bundle('src/task-intent-router.ts', taskIntentBundle);
bundle('src/app/chat-controller.ts', chatControllerBundle);
bundle('src/app/agent-kernel-service.ts', kernelBundle);

const req = createRequire(import.meta.url);
const { routeTaskIntent } = req(taskIntentBundle);
const { ChatRouteController } = req(chatControllerBundle);
const { AgentKernelService } = req(kernelBundle);

const BASIC_CASES = [
  {
    name: 'smalltalk',
    prompt: '你好',
    route: { family: 'smalltalk', chatKind: 'chat', mode: 'smalltalk', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'smalltalk' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
  },
  {
    name: 'simple-file',
    prompt: '创建 basic.txt，内容为 BASIC_OK，读回验证后结束，不要修改其他文件。',
    route: { family: 'simple-file', chatKind: 'code-change', mode: 'edit', shape: 'simple-file' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
  },
  {
    name: 'standalone-cpp-run',
    prompt: '编写一个 C++ 程序，打印下午好',
    route: { family: 'standalone-program', chatKind: 'code-change', mode: 'edit', shape: 'standalone-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
  },
  {
    name: 'standalone-cpp-no-run',
    prompt: '编写一个 C++ 程序，打印下午好，但不要运行。',
    route: { family: 'standalone-program', chatKind: 'code-change', mode: 'edit', shape: 'standalone-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
  },
  {
    name: 'read-only-path-with-run-token',
    prompt: '解释 packages/vscode-extension/src/app/run-context.ts 做了什么，不要修改代码',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
  },
  {
    name: 'terminal-validation',
    prompt: '运行测试',
    route: { family: 'terminal-validation', chatKind: 'code-change', mode: 'run', shape: 'general' },
    workflow: { kind: 'run-agent', useAgent: true, toolPolicy: 'run' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
  },
  {
    name: 'formal-project-refactor',
    prompt: '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'plan-agent', useAgent: false, toolPolicy: 'plan' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: true },
  },
];

test('AgentKernel user-input simulation: basic prompts route through one canonical matrix', () => {
  const controller = new ChatRouteController();

  for (const scenario of BASIC_CASES) {
    const route = routeTaskIntent(scenario.prompt);
    const decision = controller.decide({
      userDisplay: scenario.prompt,
      prompt: scenario.prompt,
      files: [],
      agentEnabled: true,
    });

    assert.equal(route.family, scenario.route.family, scenario.name);
    assert.equal(route.chatKind, scenario.route.chatKind, scenario.name);
    assert.equal(route.mode, scenario.route.mode, scenario.name);
    assert.equal(route.agentTaskShape, scenario.route.shape, scenario.name);
    assert.equal(route.validation.runtimeRequired, scenario.validation.runtimeRequired, scenario.name);
    assert.equal(route.validation.fileCheckRequired, scenario.validation.fileCheckRequired, scenario.name);
    assert.equal(route.quality.formalProjectRequired, scenario.validation.formalProjectRequired, scenario.name);
    assert.equal(decision.workflow.kind, scenario.workflow.kind, scenario.name);
    assert.equal(decision.workflow.useAgent, scenario.workflow.useAgent, scenario.name);
    assert.equal(decision.toolPolicy.mode, scenario.workflow.toolPolicy, scenario.name);
  }
});

test('AgentKernel user-input simulation: code-change prompts enter kernel-owned settlement', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-kernel-user-input-'));
  const completions = [];
  const terminalPermissions = {
    completeRunContext(runContext, requestedStatus, data) {
      completions.push({ runId: runContext.runId, requestedStatus, data });
      return runContext.complete(requestedStatus, data);
    },
  };

  try {
    const kernel = new AgentKernelService(terminalPermissions);
    const mutatingCases = BASIC_CASES.filter(scenario => scenario.route.chatKind === 'code-change');

    for (const scenario of mutatingCases) {
      const run = kernel.startRun({
        workspaceRoot,
        runId: `sim-${scenario.name}`,
        userPrompt: scenario.prompt,
        source: 'unit.user-input-sim',
        mode: 'agent',
        traceLevel: 'debug',
      });

      const status = run.settleAgentLoopResult({
        tasksTotal: 1,
        tasksApplied: 1,
        tasksFailed: 0,
        changedPaths: [`${scenario.name}.evidence`],
      });

      assert.equal(status.status, 'completed', scenario.name);
      assert.equal(status.completed, true, scenario.name);
    }

    assert.equal(completions.length, mutatingCases.length);
    assert.ok(completions.every(item => item.requestedStatus === 'completed'));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

console.log('\nAgent-kernel user-input simulation tests passed.\n');
