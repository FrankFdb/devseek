import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCanonicalToolLoopFixture } from '../helpers/canonical-tool-loop-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-model-led-user-simulation-${process.pid}.cjs`);

await build({
  absWorkingDir: rootDir,
  entryPoints: ['src/agent/agentic-loop.ts'],
  outfile: bundlePath,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],
  plugins: [{
    name: 'model-led-loop-chat',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/loop-chat$/ }, args => (
        args.importer.endsWith('/agent/agentic-loop.ts')
          ? { path: 'loop-chat-stub', namespace: 'devseek-model-led-test' }
          : undefined
      ));
      builder.onLoad({ filter: /.*/, namespace: 'devseek-model-led-test' }, () => ({
        loader: 'ts',
        contents: `
          export async function chatWithMessages(messages, mode, onDelta, signal, newSession) {
            const handler = globalThis.__DEVSEEK_MODEL_LED_CHAT_STUB__;
            if (typeof handler !== 'function') throw new Error('model-led chat stub is not installed');
            const response = await handler(messages, { mode, onDelta, signal, newSession });
            return typeof response === 'string' ? { text: response, tools: [] } : response;
          }
        `,
      }));
    },
  }],
});

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }

  static file(fsPath) {
    return new Uri(fsPath);
  }

  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeWorkspace = {
  workspaceFolders: [],
  getConfiguration() {
    return { get(_key, defaultValue) { return defaultValue; } };
  },
  getWorkspaceFolder(uri) {
    return this.workspaceFolders.find(folder => {
      const relative = path.relative(folder.uri.fsPath, uri.fsPath);
      return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    });
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return { Uri, workspace: fakeWorkspace };
  return originalLoad.call(this, request, parent, isMain);
};
const { runAgenticLoop } = createRequire(import.meta.url)(bundlePath);
Module._load = originalLoad;

const ALLOW_FILE_WRITE = Object.freeze({
  decision: 'allow',
  reason: 'model-led-user-simulation-file-write',
  evidenceRefs: Object.freeze(['test:model-led-user-simulation']),
});

function createHarness(root, prompt) {
  const statuses = [];
  const changes = [];
  const activities = [];
  const todos = [];
  const callbacks = withCanonicalToolLoopFixture({
    onDelta() {},
    onWorkflowStatus() {},
    onAgentStatus(status) { statuses.push(status); },
    onAppliedChange(change) { changes.push(change); },
    onReadFile(filePath, workdir) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workdir || root, filePath);
      return readFileSync(absolutePath, 'utf8');
    },
    onResponseMeta() {},
    onTodoUpdate(items) { todos.push(items); },
    onTaskCheckpoint() {},
    onToolActivity(kind, label) { activities.push({ kind, label }); },
    onResolveFileWriteConstraint: async () => ALLOW_FILE_WRITE,
  }, {
    workspaceRoot: root,
    userPrompt: prompt,
    executionMode: 'model-led',
    authorityStrategy: 'model-led',
  });
  return { callbacks, statuses, changes, activities, todos };
}

async function runSimulation(prompt, provider, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-model-led-user-'));
  const harness = createHarness(root, prompt);
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'model-led-user', index: 0 }];
  globalThis.__DEVSEEK_MODEL_LED_CHAT_STUB__ = provider;
  if (options.onUserSteer) harness.callbacks.onUserSteer = options.onUserSteer;
  if (options.runDisplayAction) harness.callbacks.runDisplayAction = options.runDisplayAction;
  try {
    const result = await runAgenticLoop(prompt, [], root, 'fast', harness.callbacks, '', 'model-led', []);
    return { root, harness, result };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  } finally {
    delete globalThis.__DEVSEEK_MODEL_LED_CHAT_STUB__;
  }
}

test('ModelLedUserSimulation: noisy Chinese is understood by the main model and executed with evidence', async () => {
  const prompt = '麻烦再当前项目里创见 src/noisy-intent.txt，里头只放 NOISY_INTENT_OK，写玩读会确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    const target = path.join(root, 'src', 'noisy-intent.txt');
    assert.match(messages[0].content, new RegExp(prompt));
    assert.match(messages[0].content, /错别字、同音字、口语、省略和中英混输/u);
    return {
      text: '理解为创建指定文件、写入精确内容并读回。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'NOISY_INTENT_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
      ],
    };
  });
  try {
    const target = path.join(simulation.root, 'src', 'noisy-intent.txt');
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(readFileSync(target, 'utf8'), 'NOISY_INTENT_OK\n');
    assert.deepEqual(simulation.result.changedPaths, [target]);
    assert.match(
      simulation.result.toolExecutionReceipts?.find(receipt => receipt.tool === 'create_file')?.permission.reason ?? '',
      /model-led-allows/u,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: exact simple-file input cannot bypass the main model or predeclare a side effect', async () => {
  const prompt = '创建 result.txt，内容为：MODEL_FIRST_OK';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    assert.match(messages[0].content, new RegExp(prompt));
    return {
      text: '创建并读回精确内容。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'MODEL_FIRST_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'), 'MODEL_FIRST_OK\n');
    assert.equal(
      simulation.harness.statuses.find(status => status.phase === 'execute')?.taskAction,
      'explore',
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: inline historical wording cannot resurrect a superseded target', async () => {
  const prompt = '这是一次多轮需求的最终轮：前面曾说写 INITIAL_REQUIREMENT，但现在改为 FINAL_REQUIREMENT_OK。请只按最新要求创建 journey-result.txt，文件内容必须精确包含一行 FINAL_REQUIREMENT_OK。完成写入和读回验证后结束任务，不要创建旧要求文件。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'journey-result.txt');
    return {
      text: '按最新要求创建并读回目标文件。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'FINAL_REQUIREMENT_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `已按最新要求创建并读回 ${target}。` } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'journey-result.txt'), 'utf8'), 'FINAL_REQUIREMENT_OK\n');
    assert.equal(existsSync(path.join(simulation.root, 'INITIAL_REQUIREMENT')), false);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: a noisy explanatory question completes without forced tools or todos', async () => {
  const prompt = 'run test 到底是森么意寺？先给我讲清除，憋执行也憋改文件。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    assert.match(messages[0].content, /简单问答直接回答/u);
    assert.doesNotMatch(messages[0].content, /第一轮必须先输出/u);
    return { text: '`run test` 通常表示运行项目测试；本次只解释，没有执行命令或修改文件。', tools: [] };
  });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(simulation.harness.changes.length, 0);
    assert.equal(simulation.harness.todos.length, 0);
    assert.equal(simulation.result.tasksApplied, 0);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: one read tool plus task_complete settles without a synthetic todo', async () => {
  const prompt = '只读取 health.txt 并告诉我结果，不要修改其他文件。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'health.txt');
    writeFileSync(target, 'HEALTHY\n');
    return {
      text: '读取现有健康状态并直接结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: 'health.txt 的内容为 HEALTHY；未修改文件。' } },
      ],
    };
  });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(simulation.harness.todos.length, 0);
    assert.deepEqual(simulation.result.changedPaths, []);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: an in-flight correction discards stale tools and applies only the latest target', async () => {
  const prompt = '创建 alpha.txt，内容为 OLD。';
  const correction = '改一下，别创建 alpha.txt，改为只创建 beta.txt，内容为 LATEST。';
  let calls = 0;
  let steerPolls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    if (calls === 1) {
      return {
        text: '先按原要求创建 alpha.txt。',
        tools: [{ name: 'create_file', input: { path: path.join(root, 'alpha.txt'), content: 'OLD\n' } }],
      };
    }
    assert.match(messages.at(-1).content, /只创建 beta\.txt/u);
    const target = path.join(root, 'beta.txt');
    return {
      text: '已按最新纠正切换目标。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'LATEST\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
      ],
    };
  }, {
    onUserSteer() {
      steerPolls += 1;
      return steerPolls === 2 ? [correction] : [];
    },
  });
  try {
    assert.equal(calls, 2, simulation.result.historyText);
    assert.equal(existsSync(path.join(simulation.root, 'alpha.txt')), false);
    assert.equal(readFileSync(path.join(simulation.root, 'beta.txt'), 'utf8'), 'LATEST\n');
    assert.deepEqual(simulation.result.changedPaths, [path.join(simulation.root, 'beta.txt')]);
    assert.equal(simulation.harness.activities.some(item => item.label.includes('最新要求')), true);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});
