/**
 * Contract tests for ARCH-05 Phase 9 WebView protocol and event adapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, name) {
  const out = path.join(rootDir, `test/unit/${name}.bundle.cjs`);
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${out} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return createRequire(import.meta.url)(out);
}

const protocol = bundle('src/ui/webview-protocol.ts', 'webview-protocol');
const adapter = bundle('src/ui/webview-event-adapter.ts', 'webview-event-adapter');
const sessionDisplay = bundle('src/app/session-display-service.ts', 'session-display-service');
const taskHistory = bundle('src/app/task-history-ui-service.ts', 'task-history-ui-service');

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get(key, defaultValue) {
      return data.has(key) ? data.get(key) : defaultValue;
    },
    update(key, value) {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
  };
}

function taskRecord(id, patch = {}) {
  const now = 1000;
  return {
    id,
    workspaceId: 'ws',
    title: `Task ${id}`,
    userGoal: `Goal ${id}`,
    provider: { type: 'bridge' },
    status: 'paused',
    workflowMode: 'edit',
    todos: [{ title: 'todo', status: 'completed' }],
    changedFiles: ['src/a.ts'],
    operationRefs: [],
    changeSetRefs: [],
    validationRefs: [],
    checkpointRef: `cp-${id}`,
    evidenceRefs: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

test('WebView protocol: task history commands are explicit and snapshot-stable', () => {
  assert.deepEqual(protocol.WEBVIEW_TASK_HISTORY_COMMANDS, [
    'listTasks',
    'openTask',
    'continueTask',
    'archiveTask',
    'deleteTask',
    'exportTask',
  ]);
});

test('WebViewEventAdapter: maps domain events to WebView messages', () => {
  assert.deepEqual(adapter.toWebviewMessage({
    kind: 'workflow',
    status: { phase: 'validate', state: 'failed', title: '验证失败' },
  }), { type: 'workflowStatus', phase: 'validate', state: 'failed', title: '验证失败' });

  assert.deepEqual(adapter.toWebviewMessage({
    kind: 'agent',
    event: { type: 'agentNotice', kind: 'warn', text: 'blocked' },
  }), { type: 'agentNotice', kind: 'warn', text: 'blocked' });

  assert.deepEqual(adapter.toWebviewMessage({
    kind: 'checkpointAvailable',
    message: { type: 'agentCheckpointAvailable', resumeTaskIndex: 1, totalTasks: 2, userPrompt: '继续', savedAt: 123 },
  }), { type: 'agentCheckpointAvailable', resumeTaskIndex: 1, totalTasks: 2, userPrompt: '继续', savedAt: 123 });
});

test('WebViewEventAdapter: strips split DSML transcripts at the outbound UI boundary', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: false });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '好的，我先查看当前代码。< | DS',
  });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: 'ML | tool_calls< | DSML | invoke name="read_file">< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
  });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '\n继续实现。',
  });

  const visibleText = sent.map((message) => message.text || '').join('');
  assert.equal(visibleText, '好的，我先查看当前代码。\n继续实现。');
  assert.doesNotMatch(visibleText, /DSML|tool_calls|read_file|filePath|^ML\s*\|/);
});

test('WebViewEventAdapter: strips fullwidth double-bar DSML transcripts at the outbound UI boundary', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: false });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '我来先查看当前 shape_manager 的完整代码。<｜｜DS',
  });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: 'ML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"><｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="list_dir"><｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
  });
  adapter.postWebviewMessage(target, { type: 'delta', text: '\n继续实现。' });

  const visibleText = sent.map((message) => message.text || '').join('');
  assert.equal(visibleText, '我来先查看当前 shape_manager 的完整代码。\n继续实现。');
  assert.doesNotMatch(visibleText, /DSML|tool_calls|read_file|list_dir|filePath|^ML/);
});

test('WebViewEventAdapter: strips TOOL_CALL envelope transcripts at the outbound UI boundary', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: false });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '我先检查标题。<TOOL_CALL>run_terminal</TOOL_CALL>',
  });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '<TOOL_CALL>{"command":"cat /tmp/main.cpp | head -200"}</TOOL_CALL>',
  });
  adapter.postWebviewMessage(target, { type: 'delta', text: '\n继续修改。' });

  const visibleText = sent.map((message) => message.text || '').join('');
  assert.equal(visibleText, '我先检查标题。\n继续修改。');
  assert.doesNotMatch(visibleText, /TOOL_CALL|run_terminal|command|main\.cpp/);
});

test('WebViewEventAdapter: strips split ReAct Action/Input transcripts at the outbound UI boundary', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: false });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '我需要先读取完整文件内容。 Action: read_file',
  });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: ' Action Input: {"path":"/tmp/main.cpp"}',
  });
  adapter.postWebviewMessage(target, { type: 'delta', text: '\n继续修改。' });

  const visibleText = sent.map((message) => message.text || '').join('');
  assert.equal(visibleText, '我需要先读取完整文件内容。\n继续修改。');
  assert.doesNotMatch(visibleText, /Action|Action Input|read_file|main\.cpp|path/);
});

test('WebViewEventAdapter: strips glued ReAct Action/Input transcripts at the outbound UI boundary', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: false });
  adapter.postWebviewMessage(target, {
    type: 'delta',
    text: '我需要先读取完整文件内容。 Action: read_fileAction Input: {"path":"/tmp/main.cpp"}',
  });
  adapter.postWebviewMessage(target, { type: 'delta', text: '\n继续修改。' });

  const visibleText = sent.map((message) => message.text || '').join('');
  assert.equal(visibleText, '我需要先读取完整文件内容。\n继续修改。');
  assert.doesNotMatch(visibleText, /Action|Action Input|read_file|main\.cpp|path/);
});

test('WebViewEventAdapter: keeps agent raw deltas for tool parsing but sanitizes announcements', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  const rawDsml = '我先查看。< | DSML | tool_calls< | DSML | invoke name="read_file"></ | DSML | invoke></ | DSML | tool_calls>';

  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: true });
  adapter.postWebviewMessage(target, { type: 'delta', text: rawDsml });
  adapter.postWebviewMessage(target, { type: 'agentAnnouncement', text: rawDsml });

  assert.equal(sent[1].type, 'delta');
  assert.match(sent[1].text, /DSML/);
  assert.equal(sent[2].type, 'agentAnnouncement');
  assert.equal(sent[2].text, '我先查看。');
});

test('WebViewEventAdapter: keeps fullwidth DSML raw agent deltas but sanitizes announcements', () => {
  const sent = [];
  const target = { postMessage: (message) => { sent.push(message); } };
  const rawDsml = '我先查看。<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';

  adapter.postWebviewMessage(target, { type: 'startResponse', agentMode: true });
  adapter.postWebviewMessage(target, { type: 'delta', text: rawDsml });
  adapter.postWebviewMessage(target, { type: 'agentAnnouncement', text: rawDsml });

  assert.equal(sent[1].type, 'delta');
  assert.match(sent[1].text, /DSML/);
  assert.equal(sent[2].type, 'agentAnnouncement');
  assert.equal(sent[2].text, '我先查看。');
});

test('SessionDisplayService: builds clean UI payload and restored LLM context', () => {
  const history = [
    { role: 'user', content: '[上次会话背景，请基于此继续工作]\nold summary' },
    { role: 'assistant', content: '好的，我已了解上次的工作进展，可以继续。' },
    { role: 'user', content: '继续任务' },
  ];
  const payload = sessionDisplay.buildSessionLoadedPayload({
    id: 's1',
    history,
    summary: 'old summary',
    meta: { id: 's1', title: 'S1', createdAt: 10, changedFiles: ['a.ts'], messageCount: 3 },
  });

  assert.equal(payload.type, 'sessionLoaded');
  assert.deepEqual(payload.history, [{ role: 'user', content: '继续任务' }]);
  assert.equal(payload.summary, 'old summary');
  assert.deepEqual(payload.changedFiles, ['a.ts']);

  const restored = sessionDisplay.buildRestoredSessionLlmHistory(payload.history, payload.summary);
  assert.equal(restored[0].role, 'user');
  assert.match(restored[0].content, /上次会话背景/);
  assert.equal(restored[2].content, '继续任务');
});

test('TaskHistoryUiService: list, open, continue, archive, delete and export are store-backed', async () => {
  const store = memoryStore({ 'devseek.taskHistory': [taskRecord('a'), taskRecord('b', { status: 'completed' })] });
  const service = new taskHistory.TaskHistoryUiService(store);

  assert.equal(service.canHandle({ type: 'listTasks' }), true);
  assert.deepEqual((await service.handle({ type: 'listTasks' }))[0].tasks.map(task => task.id), ['a', 'b']);
  assert.equal((await service.handle({ type: 'openTask', id: 'a' }))[0].task.id, 'a');
  assert.equal((await service.handle({ type: 'continueTask', id: 'a' }))[0].checkpointRef, 'cp-a');
  assert.equal((await service.handle({ type: 'exportTask', id: 'a' }))[0].data.includes('"id": "a"'), true);

  const archiveResponses = await service.handle({ type: 'archiveTask', id: 'a' });
  assert.equal(archiveResponses[0].task.status, 'archived');

  const deleteResponses = await service.handle({ type: 'deleteTask', id: 'a' });
  assert.equal(deleteResponses[0].type, 'taskHistoryDeleted');
  assert.deepEqual(deleteResponses[1].tasks.map(task => task.id), ['b']);
});

test('R3-05E TaskHistoryUiService: list, open, and continue project Run Evidence facts before legacy store', async () => {
  const projectedTask = taskRecord('evidence-run', {
    status: 'failed',
    checkpointRef: 'run-evidence-checkpoint:evidence-run:3',
    evidenceRefs: ['run-evidence:1:abc'],
  });
  const timeline = [{ id: 'event-1', type: 'run.settled', status: 'failed', evidenceRef: 'run-evidence:1:abc', occurredAt: 10, summary: 'failed' }];
  const projectionService = {
    list: () => [projectedTask],
    get: (id) => id === 'evidence-run' ? { task: projectedTask, timeline } : undefined,
  };
  const store = memoryStore({ 'devseek.taskHistory': [taskRecord('legacy-only', { status: 'completed' })] });
  const service = new taskHistory.TaskHistoryUiService(store, { projectionService });

  assert.deepEqual((await service.handle({ type: 'listTasks' }))[0].tasks.map(task => task.id), ['evidence-run']);
  const detail = (await service.handle({ type: 'openTask', id: 'evidence-run' }))[0];
  assert.equal(detail.task.id, 'evidence-run');
  assert.equal(detail.timeline[0].type, 'run.settled');
  const continued = (await service.handle({ type: 'continueTask', id: 'evidence-run' }))[0];
  assert.equal(continued.checkpointRef, 'run-evidence-checkpoint:evidence-run:3');
});

test('R3-05F TaskHistoryUiService: lifecycle commands delegate to projection owner with receipts and blocked resume reasons', async () => {
  const projectedTask = taskRecord('evidence-run', {
    status: 'recoverable',
    checkpointRef: 'run-evidence-checkpoint:evidence-run:3',
    evidenceRefs: ['run-evidence:1:abc'],
  });
  const lifecycleReceipt = {
    id: 'receipt-1',
    taskId: 'evidence-run',
    action: 'continue',
    status: 'blocked',
    reason: 'checkpoint-version-incompatible',
    source: 'run-evidence',
    sourceRef: 'run-evidence:evidence-run:abc',
    evidenceRefs: ['run-evidence:1:abc'],
    createdAt: 10,
    idempotencyKey: 'continue:evidence-run',
  };
  const projectionService = {
    list: () => [projectedTask],
    get: (id) => id === 'evidence-run' ? { task: projectedTask, timeline: [] } : undefined,
    archive: async () => ({ task: { ...projectedTask, status: 'archived' }, lifecycleReceipt: { ...lifecycleReceipt, action: 'archive', status: 'applied', reason: 'archived' } }),
    delete: async () => ({ task: projectedTask, lifecycleReceipt: { ...lifecycleReceipt, action: 'delete', status: 'applied', reason: 'ui-delete-tombstone-evidence-retained' } }),
    exportRecord: async () => '{"protocol":"devseek.task-history-export/v1","redaction":{"redacted":true}}',
    requestContinue: async () => ({ status: 'blocked', task: projectedTask, checkpointRef: undefined, blockedReason: 'checkpoint-version-incompatible', lifecycleReceipt }),
  };
  const store = memoryStore({ 'devseek.taskHistory': [taskRecord('legacy-only', { status: 'completed' })] });
  const service = new taskHistory.TaskHistoryUiService(store, { projectionService });

  const continued = (await service.handle({ type: 'continueTask', id: 'evidence-run' }))[0];
  assert.equal(continued.resumeStatus, 'blocked');
  assert.equal(continued.blockedReason, 'checkpoint-version-incompatible');
  assert.equal(continued.lifecycleReceipt.reason, 'checkpoint-version-incompatible');

  const archived = (await service.handle({ type: 'archiveTask', id: 'evidence-run' }))[0];
  assert.equal(archived.task.status, 'archived');
  assert.equal(archived.lifecycleReceipt.action, 'archive');

  const deleted = (await service.handle({ type: 'deleteTask', id: 'evidence-run' }))[0];
  assert.match(deleted.lifecycleReceipt.reason, /evidence-retained/);

  const exported = (await service.handle({ type: 'exportTask', id: 'evidence-run' }))[0];
  assert.match(exported.data, /task-history-export/);
});

console.log('\nWebView protocol tests passed.\n');
