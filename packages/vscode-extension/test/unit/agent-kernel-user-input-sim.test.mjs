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

const USER_INPUT_CASES = [
  {
    name: 'smalltalk',
    prompt: '你好',
    route: { family: 'smalltalk', chatKind: 'chat', mode: 'smalltalk', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'smalltalk' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'qa-external-effect-question',
    prompt: '如何发布当前扩展？',
    route: { family: 'qa', chatKind: 'chat', mode: 'qa', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'network-question',
    prompt: '查询 npm 上 express 最新版本',
    route: { family: 'qa', chatKind: 'chat', mode: 'qa', shape: 'general' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'qa' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'simple-file',
    prompt: '创建 basic.txt，内容为 BASIC_OK，读回验证后结束，不要修改其他文件。',
    route: { family: 'simple-file', chatKind: 'code-change', mode: 'edit', shape: 'simple-file' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['basic.txt'] },
  },
  {
    name: 'standalone-cpp-run',
    prompt: '编写一个 C++ 程序，打印下午好',
    route: { family: 'standalone-program', chatKind: 'code-change', mode: 'edit', shape: 'standalone-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'standalone-cpp-no-run',
    prompt: '编写一个 C++ 程序，打印下午好，但不要运行。',
    route: { family: 'standalone-program', chatKind: 'code-change', mode: 'edit', shape: 'standalone-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'existing-file-fix',
    prompt: '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: {
      requested: true,
      sourceChange: true,
      fileArtifact: false,
      targets: ['packages/vscode-extension/src/app/workflow-service.ts'],
    },
  },
  {
    name: 'report-from-source-read-input',
    prompt: '读取 src/a.ts 并生成 report.md，总结主要函数。',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['report.md'] },
  },
  {
    name: 'copy-noncode-output-target',
    prompt: '把 README.md 复制到 docs/README-copy.md',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['docs/README-copy.md'] },
  },
  {
    name: 'translate-noncode-output-target',
    prompt: '读取 README.md 并翻译成 docs/readme.zh.md',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['docs/readme.zh.md'] },
  },
  {
    name: 'summarize-source-to-doc-output',
    prompt: '读取 src/a.ts 并总结到 docs/a-summary.md',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['docs/a-summary.md'] },
  },
  {
    name: 'rename-noncode-file',
    prompt: '把 old.txt 重命名为 new.txt，读回确认',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['old.txt', 'new.txt'] },
  },
  {
    name: 'append-noncode-file',
    prompt: '向 notes.txt 追加一行 DONE',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['notes.txt'] },
  },
  {
    name: 'delete-line-inside-noncode-file',
    prompt: '删除 notes.txt 里的 DEBUG 行',
    route: { family: 'file-artifact', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: true, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: false, fileArtifact: true, targets: ['notes.txt'] },
  },
  {
    name: 'move-source-file',
    prompt: '把 src/a.ts 移动到 src/b.ts',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: ['src/a.ts', 'src/b.ts'] },
  },
  {
    name: 'explain-error-and-fix-file',
    prompt: '解释这个报错并修复 packages/vscode-extension/src/task-intent-router.ts',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: {
      requested: true,
      sourceChange: true,
      fileArtifact: false,
      targets: ['packages/vscode-extension/src/task-intent-router.ts'],
    },
  },
  {
    name: 'advisory-code-no-file-write',
    prompt: '给我一个 C++ hello 示例，不要写入文件',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'plain-chat', useAgent: false, toolPolicy: 'inspect' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'scoped-formal-source-delivery',
    prompt: '请在 /tmp/out/src 交付代码副本，不要修改正式源码目录，参考 /repo/src/oam/src/license 模块通讯方式并实现接口。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'read-only-path-with-run-token',
    prompt: '解释 packages/vscode-extension/src/app/run-context.ts 做了什么，不要修改代码',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'artifact-path-query',
    prompt: '刚才生成的可执行文件在哪里？',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'review-no-change',
    prompt: 'review packages/vscode-extension/src/task-intent-router.ts，不要修改代码',
    route: { family: 'review', chatKind: 'chat', mode: 'inspect', shape: 'read-only-analysis' },
    workflow: { kind: 'inspect-agent', useAgent: true, toolPolicy: 'inspect' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'plan-only',
    prompt: '给 packages/vscode-extension/src/task-intent-router.ts 一个重构计划，不要修改代码',
    route: { family: 'read-only-advisory', chatKind: 'chat', mode: 'plan', shape: 'read-only-analysis' },
    workflow: { kind: 'plan-agent', useAgent: true, toolPolicy: 'plan' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'terminal-validation',
    prompt: '运行测试',
    route: { family: 'terminal-validation', chatKind: 'code-change', mode: 'run', shape: 'general' },
    workflow: { kind: 'run-agent', useAgent: true, toolPolicy: 'run' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'terminal-validation-no-repair',
    prompt: '只运行 npm test，不要修复',
    route: { family: 'terminal-validation', chatKind: 'code-change', mode: 'run', shape: 'general' },
    workflow: { kind: 'run-agent', useAgent: true, toolPolicy: 'run' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'conditional-run-repair',
    prompt: '运行 npm test，如果失败请修复',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'implicit-ci-health-repair',
    prompt: 'CI is red, get it green.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'implicit-test-health-repair-cn',
    prompt: '测试挂了，帮我过掉。',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'implicit-project-health-repair',
    prompt: 'The app is broken, make it work again.',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'validation-repair' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: true, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
  {
    name: 'release-external-effect',
    prompt: '发布当前扩展到生产环境',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'git-commit-external-effect',
    prompt: '提交当前修改，commit message 用 intent matrix',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'git-push-external-effect',
    prompt: '推送当前分支到远端',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'npm-install-external-effect',
    prompt: '安装 npm 包 axios',
    route: { family: 'release-external-effect', chatKind: 'code-change', mode: 'edit', shape: 'general' },
    workflow: { kind: 'edit-agent', useAgent: true, toolPolicy: 'edit' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'destructive-requires-confirmation',
    prompt: '删除 build 目录',
    route: { family: 'destructive', chatKind: 'code-change', mode: 'destructive', shape: 'general', requiresConfirmation: true },
    workflow: { kind: 'confirmation-required', useAgent: false, toolPolicy: 'destructive' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: false },
    mutation: { requested: false, sourceChange: false, fileArtifact: false, targets: [] },
  },
  {
    name: 'formal-project-refactor',
    prompt: '重构整个项目代码，拆分 workflow runtime 和 provider 权限模块',
    route: { family: 'existing-project-edit', chatKind: 'code-change', mode: 'edit', shape: 'existing-project' },
    workflow: { kind: 'plan-agent', useAgent: false, toolPolicy: 'plan' },
    validation: { runtimeRequired: false, fileCheckRequired: false, formalProjectRequired: true },
    mutation: { requested: true, sourceChange: true, fileArtifact: false, targets: [] },
  },
];

test('AgentKernel user-input simulation: broad user prompts route through one canonical matrix', () => {
  const controller = new ChatRouteController();

  for (const scenario of USER_INPUT_CASES) {
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
    assert.equal(route.requiresConfirmation, scenario.route.requiresConfirmation ?? false, scenario.name);
    assert.equal(route.validation.runtimeRequired, scenario.validation.runtimeRequired, scenario.name);
    assert.equal(route.validation.fileCheckRequired, scenario.validation.fileCheckRequired, scenario.name);
    assert.equal(route.quality.formalProjectRequired, scenario.validation.formalProjectRequired, scenario.name);
    assert.equal(route.mutation.requested, scenario.mutation.requested, scenario.name);
    assert.equal(route.mutation.sourceChange, scenario.mutation.sourceChange, scenario.name);
    assert.equal(route.mutation.fileArtifact, scenario.mutation.fileArtifact, scenario.name);
    assert.deepEqual([...route.mutation.targets].sort(), [...scenario.mutation.targets].sort(), scenario.name);
    assert.equal(decision.workflow.kind, scenario.workflow.kind, scenario.name);
    assert.equal(decision.workflow.useAgent, scenario.workflow.useAgent, scenario.name);
    assert.equal(decision.toolPolicy.mode, scenario.workflow.toolPolicy, scenario.name);
  }
});

test('AgentKernel user-input simulation: agent-owned prompts enter kernel-owned settlement', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-kernel-user-input-'));
  const completions = [];
  const terminalPermissions = {
    completeRunContext(runContext, requestedStatus, data) {
      completions.push({ runId: runContext.runId, requestedStatus, data });
      return runContext.complete(requestedStatus, data);
    },
  };

  try {
    const kernel = new AgentKernelService(terminalPermissions, {
      async execute() {
        throw new Error('unexpected kernel execution in settlement simulation');
      },
    });
    const mutatingCases = USER_INPUT_CASES.filter(scenario => scenario.workflow.useAgent);

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
