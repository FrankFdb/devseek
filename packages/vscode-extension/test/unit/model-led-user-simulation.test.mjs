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

function prepareTerminalCommand(host) {
  return async (command, workdir) => ({
    constraint: {
      decision: 'require-confirmation',
      reason: 'model-led-user-simulation-terminal-confirmed',
      confirmationRef: `test:model-led-user-simulation:terminal:${command}`,
      evidenceRefs: [`test:model-led-user-simulation:terminal-constraint:${command}`],
    },
    execute: async () => {
      try {
        return {
          status: 'completed',
          result: await host(command, workdir),
          evidenceRefs: [`test:model-led-user-simulation:terminal-execution:${command}`],
        };
      } catch (error) {
        return {
          status: 'failed',
          result: error instanceof Error ? error.message : String(error),
          errorCode: 'model-led-user-simulation-terminal-failed',
          evidenceRefs: [`test:model-led-user-simulation:terminal-execution:${command}:failed`],
        };
      }
    },
  });
}

function createHarness(root, prompt, options = {}) {
  const statuses = [];
  const changes = [];
  const activities = [];
  const todos = [];
  const callbacks = withCanonicalToolLoopFixture({
    onDelta() {},
    onWorkflowStatus() {},
    onAgentStatus(status) { statuses.push(status); },
    onAppliedChange(change) { changes.push(change); },
    onReadFile(filePath, workdir, range = {}) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workdir || root, filePath);
      const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/u);
      const startLine = Math.max(1, range.startLine ?? 1);
      const endLine = Math.min(lines.length, range.endLine ?? lines.length);
      return [
        '[file_context]',
        `returnedLines=${startLine}-${endLine}/${lines.length}`,
        '[/file_context]',
        ...lines.slice(startLine - 1, endLine),
      ].join('\n');
    },
    onResponseMeta() {},
    onTodoUpdate(items) { todos.push(items); },
    onTaskCheckpoint() {},
    onToolActivity(kind, label) { activities.push({ kind, label }); },
    onResolveFileWriteConstraint: async () => ALLOW_FILE_WRITE,
    ...(options.terminalHost
      ? { onPrepareTerminalCommand: prepareTerminalCommand(options.terminalHost) }
      : {}),
  }, {
    workspaceRoot: root,
    userPrompt: prompt,
    executionMode: 'model-led',
    authorityStrategy: 'model-led',
    verificationRequired: options.verificationRequired,
  });
  return { callbacks, statuses, changes, activities, todos };
}

async function runSimulation(prompt, provider, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-model-led-user-'));
  const harness = createHarness(root, prompt, options);
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'model-led-user', index: 0 }];
  globalThis.__DEVSEEK_MODEL_LED_CHAT_STUB__ = provider;
  if (options.onUserSteer) harness.callbacks.onUserSteer = options.onUserSteer;
  if (options.onUserSteerCompletionFence) {
    harness.callbacks.onUserSteerCompletionFence = options.onUserSteerCompletionFence;
  }
  if (options.onReopenUserSteering) {
    harness.callbacks.onReopenUserSteering = options.onReopenUserSteering;
  }
  if (options.runDisplayAction) harness.callbacks.runDisplayAction = options.runDisplayAction;
  try {
    const result = await runAgenticLoop(
      prompt,
      [],
      root,
      'fast',
      harness.callbacks,
      options.sessionContextText || '',
      [],
      options.semanticContract,
    );
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

test('ModelLedUserSimulation: out-of-envelope ReAct actions are quarantined and safely reissued', async () => {
  const prompt = '创建 result.txt，内容为 AUTHORIZED_REISSUE_OK，并读回确认。';
  let calls = 0;
  const providerSessions = [];
  const simulation = await runSimulation(prompt, async (messages, providerContext) => {
    calls += 1;
    providerSessions.push(providerContext.newSession);
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    if (calls === 1) {
      return {
        text: `我先创建目标文件。\nAction: create_file\nAction Input: {"path":"${target}","content":"AUTHORIZED_REISSUE_OK\\n"}`,
        tools: [],
      };
    }

    if (calls === 2) {
      assert.match(messages.at(-1).content, /授权信封之外/u);
      assert.match(messages.at(-1).content, /尝试调用 create_file/u);
      return {
        text: '按当前授权协议重新发出唯一写入动作。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'AUTHORIZED_REISSUE_OK\n' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
        ],
      };
    }
    assert.match(messages.at(-1).content, /只执行一个具体工具/u);
    return {
      text: '被隔离的写入已恢复，现在读回并结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 3, simulation.result.historyText);
    assert.deepEqual(providerSessions, [true, false, false]);
    const resultPath = path.join(simulation.root, 'result.txt');
    assert.equal(existsSync(resultPath), true, simulation.result.historyText);
    assert.equal(readFileSync(resultPath, 'utf8'), 'AUTHORIZED_REISSUE_OK\n');
    const recoveryStates = simulation.harness.statuses
      .filter(status => (
        status.phase === 'repair'
        && status.recoveryReason === 'provider-response-corruption'
      ))
      .map(status => status.state);
    assert.deepEqual(recoveryStates, ['started', 'completed']);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: native XML mutation recovery retains verified read context in session', async () => {
  const prompt = '读取现有 source.txt，把 OLD_VALUE 修复为 NEW_VALUE，并读回确认。';
  let calls = 0;
  const providerSessions = [];
  const simulation = await runSimulation(prompt, async (messages, providerContext) => {
    calls += 1;
    providerSessions.push(providerContext.newSession);
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'source.txt');
    if (calls === 1) {
      writeFileSync(target, 'OLD_VALUE\n');
      return {
        text: '先读取现有内容。',
        tools: [{ name: 'read_file', input: { path: target } }],
      };
    }
    if (calls === 2) {
      assert.match(messages.at(-1).content, /OLD_VALUE/u);
      return {
        text: [
          '使用原生 XML 提交修复。',
          '<replace_in_file>',
          `<path>${target}</path>`,
          '<old_str><![CDATA[OLD_VALUE]]></old_str>',
          '<new_str><![CDATA[NEW_VALUE]]></new_str>',
          '</replace_in_file>',
        ].join('\n'),
        tools: [],
      };
    }
    if (calls === 3) {
      assert.equal(providerContext.newSession, false);
      assert.match(JSON.stringify(messages), /OLD_VALUE/u);
      assert.doesNotMatch(JSON.stringify(messages), /原生 XML 提交修复/u);
      assert.match(messages.at(-1).content, /当前 Provider 会话保留先前真实工具结果/u);
      return {
        text: '通过当前授权协议重发唯一修改。',
        tools: [
          { name: 'replace_in_file', input: { path: target, old_str: 'OLD_VALUE', new_str: 'NEW_VALUE' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: '修复并读回 source.txt。' } },
        ],
      };
    }
    return {
      text: '依据真实写入结果完成读回。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '修复并读回 source.txt。' } },
      ],
    };
  }, { runDisplayAction: 'repair' });
  try {
    assert.equal(calls, 4, simulation.result.historyText);
    assert.deepEqual(providerSessions, [true, false, false, false]);
    assert.equal(readFileSync(path.join(simulation.root, 'source.txt'), 'utf8'), 'NEW_VALUE\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: protocol recovery cannot settle from a prose-only retry', async () => {
  const prompt = '创建 recovered.txt，内容为 RECOVERY_PENDING_OK。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'recovered.txt');
    if (calls === 1) {
      return { text: `Action: create_file\nAction Input: {"path":"${target}","content":"RECOVERY_PENDING_OK"}`, tools: [] };
    }
    if (calls === 2) {
      return { text: '我接下来会创建文件。', tools: [] };
    }
    if (calls === 3) {
      return {
        text: '安全重发唯一写入动作。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'RECOVERY_PENDING_OK\n' } },
          { name: 'task_complete', input: { summary: '已完成恢复写入。' } },
        ],
      };
    }
    return {
      text: '依据写入结果完成读回。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已完成恢复写入。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 4, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'recovered.txt'), 'utf8'), 'RECOVERY_PENDING_OK\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => (
        status.phase === 'repair'
        && status.recoveryReason === 'provider-response-corruption'
        && status.state === 'completed'
      )),
      true,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: successful command evidence cannot settle a typo-closed pending mutation', async () => {
  const prompt = '先验证当前状态，再修复 result.txt 为 RECOVERED_AFTER_PROTOCOL_OK 并读回。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    if (calls === 1) {
      return {
        text: '先执行当前公开验证。',
        tools: [{ name: 'run_terminal', input: { command: "printf 'PUBLIC_CHECK_OK\\n'" } }],
      };
    }
    if (calls === 2) {
      const channelId = messages[0].content.match(/channel="([A-Za-z0-9_-]+)"/u)?.[1];
      assert.ok(channelId, messages[0].content);
      return {
        text: [
          '验证通过后提交修复。',
          `<devseek_tool_calls version="devseek.text-tools/v1" channel="${channelId}">`,
          `[TOOL:replace_in_file {"path":"${target}","old_str":"OLD","new_str":"RECOVERED_AFTER_PROTOCOL_OK"}]`,
          '</devsek_tool_calls>',
        ].join('\n'),
        tools: [],
      };
    }
    if (calls === 3) {
      assert.match(messages.at(-1).content, /仅识别到上一轮尝试调用 replace_in_file/u);
      return {
        text: '重新判断后以唯一授权动作落实修复。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'RECOVERED_AFTER_PROTOCOL_OK\n' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: '已完成协议恢复后的修复与读回。' } },
        ],
      };
    }
    return {
      text: '写入已经完成，现在读回并结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已完成协议恢复后的修复与读回。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 4, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'), 'RECOVERED_AFTER_PROTOCOL_OK\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: validation and reads cannot discharge a malformed mutation', async () => {
  const prompt = '修复 result.txt 为 MUTATION_DEBT_CLEARED，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    if (calls === 1) {
      const channelId = messages[0].content.match(/channel="([A-Za-z0-9_-]+)"/u)?.[1];
      writeFileSync(target, 'OLD');
      return {
        text: [
          `<devseek_tool_calls version="devseek.text-tools/v1" channel="${channelId}">`,
          `[TOOL:replace_in_file {"path":"${target}","old_str":"OLD","new_str":"value with "quotes""}]`,
          '</devseek_tool_calls>',
        ].join('\n'),
        tools: [],
      };
    }
    if (calls === 2) {
      assert.match(messages.at(-1).content, /本轮只恢复被隔离的动作/u);
      return {
        text: '先重跑验证。',
        tools: [{ name: 'run_terminal', input: { command: "printf 'PUBLIC_CHECK_OK\\n'" } }],
      };
    }
    if (calls === 3) {
      assert.match(messages.at(-1).content, /尚未解决上一轮被隔离的结构化动作/u);
      return {
        text: '精确重读目标。',
        tools: [{ name: 'read_file', input: { path: target } }],
      };
    }
    if (calls === 4) {
      assert.match(messages.at(-1).content, /尚未解决上一轮被隔离的结构化动作/u);
      return {
        text: '以唯一有效文件修改解决待处理动作。',
        tools: [
          { name: 'replace_in_file', input: { path: target, old_str: 'OLD', new_str: 'MUTATION_DEBT_CLEARED' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: '已完成修改并读回。' } },
        ],
      };
    }
    return {
      text: '修改已经落盘，现在读回并结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已完成修改并读回。' } },
      ],
    };
  }, { runDisplayAction: 'repair' });
  try {
    assert.equal(calls, 5, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'), 'MUTATION_DEBT_CLEARED');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.deepEqual(
      simulation.harness.statuses
        .filter(status => status.recoveryReason === 'provider-response-corruption')
        .map(status => status.state),
      ['started', 'completed'],
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: quarantined mutation recovery reaches a matching write without reopening investigation', async () => {
  const prompt = '调查现有实现后，把 result.txt 中的 OLD 修复为 RECOVERED_COHORT_OK，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    const target = path.join(root, 'result.txt');
    if (calls === 1) {
      writeFileSync(target, 'OLD');
      return {
        text: '先提交当前证据下的精确修改。',
        tools: [
          { name: 'read_file', input: { path: target } },
          { name: 'replace_in_file', input: { path: target, old_str: 'MISSING', new_str: 'RECOVERED_COHORT_OK' } },
        ],
      };
    }
    if (calls === 2) {
      return {
        text: '失败后精确刷新目标内容。',
        tools: [{ name: 'read_file', input: { path: target } }],
      };
    }
    if (calls <= 10) {
      const contextPath = path.join(root, `context-${calls}.txt`);
      writeFileSync(contextPath, `context ${calls}\n`);
      return {
        text: `读取实现上下文 ${calls}。`,
        tools: [{ name: 'read_file', input: { path: contextPath } }],
      };
    }
    if (calls === 11) {
      const channelId = messages[0].content.match(/channel="([A-Za-z0-9_-]+)"/u)?.[1];
      return {
        text: [
          `<devseek_tool_calls version="devseek.text-tools/v1" channel="${channelId}">`,
          `[TOOL:replace_in_file {"path":"${target}","old_str":"OLD","new_str":"value with "quotes""}]`,
          '</devseek_tool_calls>',
        ].join('\n'),
        tools: [],
      };
    }
    if (calls === 12) {
      assert.match(messages.at(-1).content, /本轮只恢复被隔离的动作/u);
      return {
        text: '重建会话后精确重读待修复目标。',
        tools: [{ name: 'read_file', input: { path: target } }],
      };
    }
    if (calls === 13) {
      assert.match(messages.at(-1).content, /必须匹配被隔离动作/u);
      return {
        text: '依据既有精确证据重新提交被隔离的修改。',
        tools: [
          { name: 'replace_in_file', input: { path: target, old_str: 'OLD', new_str: 'RECOVERED_COHORT_OK' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: '已完成恢复修改并读回。' } },
        ],
      };
    }
    return {
      text: '恢复修改已落盘，现在读回并结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已完成恢复修改并读回。' } },
      ],
    };
  }, { runDisplayAction: 'repair' });
  try {
    assert.equal(calls, 14, simulation.result.historyText);
    assert.equal(
      readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'),
      'RECOVERED_COHORT_OK',
      simulation.result.historyText,
    );
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.filter(
        status => status.title === '项目证据已收集，正在要求形成交付',
      ).length,
      3,
      JSON.stringify(simulation.harness.statuses, null, 2),
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: a current ranged read permits an exact targeted repair', async () => {
  const prompt = '读取 result.txt 的报错范围，把 BROKEN 精确修复为 FIXED，并读回。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    if (calls === 1) {
      writeFileSync(target, ['header', 'BROKEN', 'footer'].join('\n'));
      return {
        text: '先读取包含错误的局部范围。',
        tools: [{ name: 'read_file', input: { path: target, startLine: 2, endLine: 2 } }],
      };
    }
    return {
      text: '依据当前版本的局部基线实施唯一精确替换。',
      tools: [
        { name: 'replace_in_file', input: { path: target, old_str: 'BROKEN', new_str: 'FIXED' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已精确修复并读回。' } },
      ],
    };
  }, { runDisplayAction: 'repair' });
  try {
    assert.equal(calls, 2, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'), 'header\nFIXED\nfooter');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: invalid authenticated mutation recovers with its lossless write format', async () => {
  const prompt = '创建 recovered-format.txt，内容为 RECOVERED_FORMAT_OK，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'recovered-format.txt');
    if (calls === 1) {
      const channelId = messages[0].content.match(/channel="([A-Za-z0-9_-]+)"/u)?.[1];
      assert.ok(channelId, messages[0].content);
      return {
        text: [
          `<devseek_tool_calls version="devseek.text-tools/v1" channel="${channelId}">`,
          '<create_file>',
          `<path>${target}</path>`,
          '<content><![CDATA[RECOVERED_FORMAT_OK',
          ']]></content>',
          '</create_file>',
          `</devseek_tool_calls channel="${channelId}">`,
        ].join('\n'),
        tools: [],
      };
    }

    if (calls === 2) {
      const recoveryPrompt = messages.at(-1).content;
      assert.match(recoveryPrompt, /仅识别到上一轮尝试调用 create_file/u);
      assert.match(recoveryPrompt, /```xml[\s\S]*<create_file>/u);
      return {
        text: '按无损恢复协议重新落实唯一写入。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'RECOVERED_FORMAT_OK\n' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: '已创建并读回 recovered-format.txt。' } },
        ],
      };
    }
    return {
      text: '写入已完成，现在读回并结算。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已创建并读回 recovered-format.txt。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 3, simulation.result.historyText);
    assert.equal(
      readFileSync(path.join(simulation.root, 'recovered-format.txt'), 'utf8'),
      'RECOVERED_FORMAT_OK\n',
    );
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: provider transcript pollution rebuilds the session before clean settlement', async () => {
  const prompt = '读取 README.md，并告诉我标题。';
  let calls = 0;
  const newSessionFlags = [];
  const simulation = await runSimulation(prompt, async (_messages, request) => {
    calls += 1;
    newSessionFlags.push(request.newSession);
    const source = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'README.md');
    if (calls === 1) {
      writeFileSync(source, '# Trusted title\n');
      return {
        text: '先读取目标文件。',
        tools: [{ name: 'read_file', input: { path: source } }],
      };
    }
    if (calls === 2) {
      throw new Error(
        'RESPONSE_CORRUPTED:provider-authored-tool-transcript:reserved transcript marker',
      );
    }
    const recoveryPrompt = _messages.at(-1).content;
    assert.match(recoveryPrompt, /上一轮包含未解决的结构化动作/u);
    assert.match(recoveryPrompt, /本轮只输出 1 个工具调用/u);
    assert.match(recoveryPrompt, /devseek_tool_calls/u);
    return {
      text: 'README.md 的标题是 Trusted title。',
      tools: [{ name: 'task_complete', input: { summary: '已基于读回内容确认标题为 Trusted title。' } }],
    };
  });
  try {
    assert.equal(calls, 3, simulation.result.historyText);
    assert.equal(newSessionFlags[2], true, 'polluted Provider context must be replaced');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    const recoveryStates = simulation.harness.statuses
      .filter(status => (
        status.phase === 'repair'
        && status.recoveryReason === 'provider-response-corruption'
      ))
      .map(status => status.state);
    assert.deepEqual(recoveryStates, ['started', 'completed']);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: validated current file evidence completes without another provider turn', async () => {
  const prompt = '创建 report.md，内容为 EVIDENCE_SETTLED_OK，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'report.md');
    if (calls === 1) {
      return {
        text: '创建并读回报告。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'EVIDENCE_SETTLED_OK\n' } },
          { name: 'read_file', input: { path: target } },
          {
            name: 'manage_todo_list',
            input: { todoList: [{ id: 1, title: '创建并读回报告', status: 'completed' }] },
          },
        ],
      };
    }
    throw new Error(`validated write cohort unexpectedly requested another provider turn for ${target}`);
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'report.md'), 'utf8'), 'EVIDENCE_SETTLED_OK\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.recoveryReason === 'provider-response-corruption'),
      false,
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

test('ModelLedUserSimulation: a deferred action announcement must continue into real work', async () => {
  const prompt = '创建 math-visual.txt，内容为 MATH_VISUAL_READY，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'math-visual.txt');
    if (calls === 1) {
      return {
        text: '我将阅读用户故事并实现 Math Visual Lab 的第一版。让我先了解需求。',
        tools: [],
      };
    }
    return {
      text: '落实上一轮行动并读回交付文件。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'MATH_VISUAL_READY\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已创建并读回 math-visual.txt。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 2, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'math-visual.txt'), 'utf8'), 'MATH_VISUAL_READY\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.title === '等待行动提案落地'),
      true,
      simulation.result.historyText,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: repeated deferred actions fail instead of settling with zero delivery', async () => {
  const prompt = '检查现有程序，修复源码并运行验证。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    if (calls === 1) {
      return {
        text: '先读取工作区结构。',
        tools: [{ name: 'list_dir', input: { path: root } }],
      };
    }
    return {
      text: '我立即读取必要文件并执行修复。首先读取完整源码：',
      tools: [],
    };
  }, { runDisplayAction: 'fix' });
  try {
    assert.equal(calls, 4, simulation.result.historyText);
    assert.equal(simulation.result.tasksFailed, 1, simulation.result.historyText);
    assert.equal(simulation.result.changedPaths.length, 0);
    assert.match(simulation.result.historyText, /没有形成可执行工具调用/u);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: investigation prose from a repair turn cannot settle as completion', async () => {
  const prompt = '继续修复现有程序中的验证失败，修改生产实现并运行验证。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'repair-evidence.txt');
    if (calls === 1) {
      return {
        text: [
          '我已经理解了两个验证失败：状态结构不正确，图像输出也不充分。',
          '我需要先探查工作区现有文件结构和生产实现。让我开始调查。',
        ].join('\n'),
        tools: [],
      };
    }
    assert.match(messages.at(-1).content, /没有形成工具调用或完整直接答案/u);
    return {
      text: '落实调查并留下可读回的修复证据。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'REPAIR_EVIDENCE_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已完成修复动作并读回证据。' } },
      ],
    };
  });
  try {
    assert.equal(calls, 2, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'repair-evidence.txt'), 'utf8'), 'REPAIR_EVIDENCE_OK\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.title === '等待行动提案落地'),
      true,
      simulation.result.historyText,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: a Markdown shell proposal is reissued through the authorized tool protocol', async () => {
  const prompt = '检查项目后创建 shell-recovery.txt，内容为 SHELL_RECOVERY_READY，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    const target = path.join(root, 'shell-recovery.txt');
    if (calls === 1) {
      return {
        text: '先建立可继续修订的交付文件。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'SHELL_RECOVERY_DRAFT\n' } },
          { name: 'read_file', input: { path: target } },
        ],
      };
    }
    if (calls === 2) {
      return {
        text: ['接下来查看目标。', '```', 'ls -la', 'cat shell-recovery.txt', '```'].join('\n'),
        tools: [],
      };
    }
    assert.match(messages.at(-1).content, /普通 Markdown 代码块/u);
    assert.match(messages.at(-1).content, /run_terminal/u);
    assert.match(messages.at(-1).content, /devseek_tool_calls/u);
    return {
      text: '通过真实工具完成写入和读回。',
      tools: [
        { name: 'replace_in_file', input: { path: target, old_str: 'SHELL_RECOVERY_DRAFT', new_str: 'SHELL_RECOVERY_READY' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已创建并读回 shell-recovery.txt。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 3, simulation.result.historyText);
    const target = path.join(simulation.root, 'shell-recovery.txt');
    assert.equal(existsSync(target), true, simulation.result.historyText);
    assert.equal(readFileSync(target, 'utf8'), 'SHELL_RECOVERY_READY\n', simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.title === '等待 shell 动作通过工具执行'),
      true,
      simulation.result.historyText,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: late deferred prose after prior reads cannot end the turn', async () => {
  const prompt = '检查项目后创建 late-action.txt，内容为 LATE_ACTION_READY，并读回确认。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    const target = path.join(root, 'late-action.txt');
    if (calls === 1) {
      return {
        text: '先检查当前项目内容。',
        tools: [{ name: 'list_dir', input: { path: root } }],
      };
    }
    if (calls === 2) {
      const detailedAnalysis = Array.from({ length: 24 }, (_, index) => (
        `分析项 ${index + 1}：独立验证说明交互状态和渲染像素仍需结合生产实现核对。`
      )).join('');
      return {
        text: [
          detailedAnalysis,
          '当前目标已经整理完成。让我先读取项目文件了解当前实现状态。',
        ].join('\n\n'),
        tools: [],
      };
    }
    return {
      text: '落实已承诺的写入并读回交付文件。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'LATE_ACTION_READY\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已创建并读回 late-action.txt。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 3, simulation.result.historyText);
    assert.equal(readFileSync(path.join(simulation.root, 'late-action.txt'), 'utf8'), 'LATE_ACTION_READY\n');
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.title === '等待行动提案落地'),
      true,
      simulation.result.historyText,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: unclassified investigation is bounded before the model chooses delivery', async () => {
  const prompt = '检查现有项目后完成需要的实现，并把结果写入 convergence.txt。';
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    if (calls <= 7) {
      const source = path.join(root, `context-${calls}.txt`);
      writeFileSync(source, `context ${calls}\n`);
      return {
        text: `继续检查第 ${calls} 项项目上下文。`,
        tools: [{ name: 'read_file', input: { path: source } }],
      };
    }

    assert.match(messages.at(-1).content, /必须依据原始用户需求形成可结算交付/u);
    assert.match(messages.at(-1).content, /本提示不授权任何副作用/u);
    const target = path.join(root, 'convergence.txt');
    return {
      text: '已有证据足够，按原始需求落实交付。',
      tools: [
        { name: 'create_file', input: { path: target, content: 'DELIVERY_CONVERGED_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: '已创建并读回 convergence.txt。' } },
      ],
    };
  }, { runDisplayAction: 'create' });
  try {
    assert.equal(calls, 8, simulation.result.historyText);
    assert.equal(
      readFileSync(path.join(simulation.root, 'convergence.txt'), 'utf8'),
      'DELIVERY_CONVERGED_OK\n',
    );
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.some(status => status.title === '项目证据已收集，正在要求形成交付'),
      true,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: a recovered unclassified task gets a final bounded delivery turn', async () => {
  const prompt = 'Continue the interrupted implementation after validating the retained workspace.';
  let calls = 0;
  let terminalCalls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    if (calls <= 9) {
      const source = path.join(root, `recovery-context-${calls}.txt`);
      writeFileSync(source, `recovery context ${calls}\n`);
      return {
        text: `Inspect retained recovery context ${calls}.`,
        tools: [{ name: 'read_file', input: { path: source } }],
      };
    }

    if (calls === 10) {
      const source = path.join(root, 'validation-context.txt');
      const validation = path.join(root, 'recovery-validation.test.mjs');
      writeFileSync(source, 'validation context\n');
      writeFileSync(validation, [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "test('recovery validation', () => assert.equal(1, 1));",
        '',
      ].join('\n'));
      return {
        text: 'Run the newly selected validation entry point before the targeted change.',
        tools: [
          { name: 'run_terminal', input: { command: 'node --test recovery-validation.test.mjs' } },
          { name: 'read_file', input: { path: source } },
        ],
      };
    }

    assert.match(messages.at(-1).content, /recovery validation/u);
    const target = path.join(root, 'recovered-delivery.txt');
    return {
      text: 'The retained evidence is sufficient; applying the bounded delivery now.',
      tools: [
        { name: 'create_file', input: { path: target, content: 'RECOVERED_DELIVERY_OK\n' } },
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: 'Created and read back recovered-delivery.txt.' } },
      ],
    };
  }, {
    runDisplayAction: 'create',
    terminalHost: async command => {
      terminalCalls += 1;
      assert.equal(command, 'node --test recovery-validation.test.mjs');
      return 'ok 1 - recovery validation\n[exitCode=0]';
    },
  });
  try {
    assert.equal(calls, 11, JSON.stringify({
      historyText: simulation.result.historyText,
      terminalEvidence: simulation.result.terminalEvidence,
      toolExecutionReceipts: simulation.result.toolExecutionReceipts,
    }, null, 2));
    assert.equal(
      readFileSync(path.join(simulation.root, 'recovered-delivery.txt'), 'utf8'),
      'RECOVERED_DELIVERY_OK\n',
    );
    assert.equal(terminalCalls, 1, simulation.result.historyText);
    assert.match(simulation.result.historyText, /ok<\/code> run, code 0/u);
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.statuses.filter(
        status => status.title === '项目证据已收集，正在要求形成交付',
      ).length,
      3,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: repeated validation cannot keep unclassified investigation alive', async () => {
  const prompt = 'Inspect the retained workspace, validate it, and settle the requested delivery.';
  let calls = 0;
  let terminalCalls = 0;
  const validationCommand = 'node --test bounded-validation.test.mjs';
  const simulation = await runSimulation(prompt, async () => {
    calls += 1;
    const root = fakeWorkspace.workspaceFolders[0].uri.fsPath;
    const source = path.join(root, `bounded-context-${calls}.txt`);
    writeFileSync(source, `bounded context ${calls}\n`);
    if (calls <= 9) {
      return {
        text: `Inspect bounded context ${calls}.`,
        tools: [{ name: 'read_file', input: { path: source } }],
      };
    }
    writeFileSync(path.join(root, 'bounded-validation.test.mjs'), [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('bounded validation', () => assert.equal(1, 1));",
      '',
    ].join('\n'));
    return {
      text: 'Repeat the same validation while continuing investigation.',
      tools: [
        { name: 'run_terminal', input: { command: validationCommand } },
        { name: 'read_file', input: { path: source } },
      ],
    };
  }, {
    runDisplayAction: 'create',
    terminalHost: async command => {
      terminalCalls += 1;
      assert.equal(command, validationCommand);
      return 'ok 1 - bounded validation\n[exitCode=0]';
    },
  });
  try {
    assert.equal(calls, 11, simulation.result.historyText);
    assert.equal(terminalCalls, 1, simulation.result.historyText);
    assert.equal(simulation.result.tasksFailed, 1, simulation.result.historyText);
    assert.match(simulation.result.historyText, /3 次交付纠正/u);
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
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: concise concept answers settle across natural user phrasings', async () => {
  const cases = [
    {
      prompt: '解释gpu cpu',
      answer: 'CPU 擅长通用计算，GPU 擅长同时处理大量相似计算。',
    },
    {
      prompt: '讲下 gpu 和 cpu 有啥取别',
      answer: 'CPU 更通用，GPU 的大量核心更适合并行任务。',
    },
    {
      prompt: "What's CPU vs GPU? Keep it short.",
      answer: 'CPU is general-purpose; GPU is optimized for parallel workloads.',
    },
    {
      prompt: 'CPUとGPUの違いを短く説明して',
      answer: 'CPUは汎用処理向け、GPUは大規模な並列処理向けです。',
    },
    {
      prompt: '把这句话总结成五个字：今天测试全部通过',
      answer: '测试全通过',
    },
    {
      prompt: '把 hello world 翻译成中文',
      answer: '你好，世界。',
    },
    {
      prompt: '解释这段代码，不要改文件：const total = a + b',
      answer: '这段代码把 a 与 b 相加，并把结果赋给 total。',
    },
    {
      prompt: '1+1?',
      answer: '2',
    },
    {
      prompt: '帮我弄一下',
      answer: '你希望我处理哪个文件或问题？',
    },
  ];

  for (const scenario of cases) {
    let calls = 0;
    const simulation = await runSimulation(scenario.prompt, async messages => {
      calls += 1;
      assert.match(messages[0].content, /简单问答直接回答/u);
      assert.match(messages[0].content, /会话、工作区、记忆检索、路由和工具可用性是内部执行上下文/u);
      return { text: scenario.answer, tools: [] };
    });
    try {
      assert.equal(calls, 1, simulation.result.historyText);
      assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
      assert.equal(simulation.result.tasksApplied, 0);
      assert.deepEqual(simulation.result.changedPaths, []);
      assert.equal(simulation.harness.todos.length, 0);
    } finally {
      rmSync(simulation.root, { recursive: true, force: true });
    }
  }
});

test('ModelLedUserSimulation: an elliptical follow-up resolves its referent from the same-session turn', async () => {
  const prompt = '再详细说明他们的差异';
  const firstAnswer = 'CPU 擅长通用、低延迟任务；GPU 擅长同时处理大量相似计算。';
  const sessionContextText = [
    '[用户]',
    '说明gpu cpu',
    '[助手]',
    firstAnswer,
  ].join('\n');
  let calls = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    assert.match(messages[0].content, /【同一会话上下文】/u);
    assert.match(messages[0].content, /说明gpu cpu/u);
    assert.match(messages[0].content, /CPU 擅长通用、低延迟任务/u);
    assert.match(messages[0].content, /【当前用户消息】\n再详细说明他们的差异/u);
    return {
      text: 'CPU 核心较少但单核强、延迟低，适合操作系统和分支复杂的通用任务；GPU 核心多、吞吐量高，适合图形渲染、矩阵运算和模型训练。',
      tools: [],
    };
  }, { sessionContextText });
  try {
    assert.equal(calls, 1, simulation.result.historyText);
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(simulation.result.tasksApplied, 0);
    assert.deepEqual(simulation.result.changedPaths, []);
    assert.equal(
      simulation.harness.activities.filter(activity => activity.kind !== 'label').length,
      0,
      'a conversational follow-up may report provider wait progress but must not execute tools',
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});

test('ModelLedUserSimulation: an effect completion claim still needs a real effect receipt', async () => {
  const prompt = '创建 result.txt，内容为 EFFECT_REQUIRED。';
  const simulation = await runSimulation(prompt, async () => ({
    text: '已创建 result.txt。',
    tools: [
      { name: 'task_complete', input: { summary: '已创建 result.txt。' } },
    ],
  }));
  try {
    assert.equal(simulation.result.tasksFailed, 1, simulation.result.historyText);
    assert.equal(existsSync(path.join(simulation.root, 'result.txt')), false);
    assert.match(simulation.result.failedReason ?? '', /可交付|完成信号|证据/u);
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

test('ModelLedUserSimulation: a correction accepted at the completion fence reopens the same turn', async () => {
  const prompt = '创建 result.txt，内容为：MODEL_FIRST_OK';
  const correction = '完成前再改一下：result.txt 的最终内容必须是 MODEL_LATEST_OK。';
  let calls = 0;
  let fencePolls = 0;
  let reopenCalls = 0;
  let correctionWrites = 0;
  const simulation = await runSimulation(prompt, async messages => {
    calls += 1;
    const target = path.join(fakeWorkspace.workspaceFolders[0].uri.fsPath, 'result.txt');
    if (calls === 1) {
      return {
        text: '先完成初始要求。',
        tools: [
          { name: 'create_file', input: { path: target, content: 'MODEL_FIRST_OK\n' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: `已创建并读回 ${target}。` } },
        ],
      };
    }
    assert.equal(
      messages.some(message => /最终内容必须是 MODEL_LATEST_OK/u.test(message.content)),
      true,
      'the reopened provider context must retain the completion-fence revision',
    );
    if (correctionWrites === 0) {
      correctionWrites += 1;
      return {
        text: '按完成前收到的最新要求修订结果。',
        tools: [
          { name: 'write_file', input: { path: target, content: 'MODEL_LATEST_OK\n' } },
          { name: 'read_file', input: { path: target } },
          { name: 'task_complete', input: { summary: `已将 ${target} 更新为 MODEL_LATEST_OK 并读回确认。` } },
        ],
      };
    }
    return {
      text: '补充最终文件读回证据，不重复写入。',
      tools: [
        { name: 'read_file', input: { path: target } },
        { name: 'task_complete', input: { summary: `${target} 的最终内容为 MODEL_LATEST_OK。` } },
      ],
    };
  }, {
    onUserSteerCompletionFence() {
      fencePolls += 1;
      return fencePolls === 1 ? [correction] : [];
    },
    onReopenUserSteering() {
      reopenCalls += 1;
      return true;
    },
    runDisplayAction: 'create',
    verificationRequired: false,
  });
  try {
    assert.equal(calls >= 2, true, simulation.result.historyText);
    assert.equal(correctionWrites, 1);
    assert.equal(reopenCalls, 1);
    assert.equal(
      readFileSync(path.join(simulation.root, 'result.txt'), 'utf8'),
      'MODEL_LATEST_OK\n',
      simulation.result.historyText,
    );
    assert.equal(simulation.result.tasksFailed, 0, simulation.result.historyText);
    assert.equal(
      simulation.harness.activities.some(item => item.label.includes('完成前收到最新要求')),
      true,
    );
  } finally {
    rmSync(simulation.root, { recursive: true, force: true });
  }
});
