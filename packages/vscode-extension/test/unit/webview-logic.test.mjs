import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {
  TOOL_PROTOCOL_SAMPLES,
  TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES,
} from '../fixtures/tool-protocol-samples.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const mediaDir = path.join(rootDir, 'media');

function loadProductionPresentationRuntime() {
  const context = {
    console,
    isAgentMode: false,
    md: text => `rendered:${text}`,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const fileName of [
    'webview-agent-tool-manifest.js',
    'webview-agent-sanitizer.js',
    'webview-agent-todos.js',
  ]) {
    vm.runInContext(readFileSync(path.join(mediaDir, fileName), 'utf8'), context, { filename: fileName });
  }
  return context;
}

const runtime = loadProductionPresentationRuntime();
const webviewSource = readFileSync(path.join(mediaDir, 'webview.js'), 'utf8');
const sanitizerSource = readFileSync(path.join(mediaDir, 'webview-agent-sanitizer.js'), 'utf8');
const todoSource = readFileSync(path.join(mediaDir, 'webview-agent-todos.js'), 'utf8');
const terminalOutputSource = readFileSync(path.join(mediaDir, 'webview-terminal-output.js'), 'utf8');

function sanitize(text, agentMode) {
  return agentMode
    ? runtime.sanitizeAgentVisibleText(text)
    : runtime.sanitizeAssistantVisibleText(text);
}

test('production escapeHtml protects markup while preserving plain text', () => {
  assert.equal(runtime.escapeHtml('<script>a & b</script>'), '&lt;script&gt;a &amp; b&lt;/script&gt;');
  assert.equal(runtime.escapeHtml('CPU 与 GPU'), 'CPU 与 GPU');
  assert.equal(runtime.escapeHtml(null), '');
});

test('ordinary tool protocol examples remain visible in every presentation mode', () => {
  for (const sample of TOOL_PROTOCOL_SAMPLES) {
    assert.equal(sanitize(sample.text, true), sample.text, `${sample.id}: agent mode`);
    assert.equal(sanitize(sample.text, false), sample.text, `${sample.id}: chat mode`);
  }
});

test('incomplete protocol-looking prose remains visible while streaming', () => {
  for (const sample of TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES) {
    assert.equal(sanitize(sample.text, true), sample.text, `${sample.id}: agent mode`);
    assert.equal(sanitize(sample.text, false), sample.text, `${sample.id}: chat mode`);
  }
});

test('JSON, XML, ReAct, shell transcripts, and long code are presentation data', () => {
  const longCode = Array.from({ length: 80 }, (_, index) => `const value${index} = ${index};`).join('\n');
  const examples = [
    '{"todoList":[{"id":1,"title":"demo","status":"completed"}]}',
    '<tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</tool_call>',
    'Action: read_file\nAction Input: {"path":"README.md"}',
    'Calling: bash\n```bash\nnpm test\n```',
    `\`\`\`js\n${longCode}\n\`\`\``,
    'MODEL_LATEST_OK',
    '请解释 run_terminal、stdout、stderr 和 exitCode，不要执行。',
  ];
  for (const example of examples) {
    assert.equal(sanitize(example, true), example);
    assert.equal(sanitize(example, false), example);
    assert.equal(runtime.stripToolCallBlocks(example), example);
    assert.equal(runtime.containsAgentInternalTranscript(example), false);
  }
});

test('only DevSeek-owned routing frames are removed from visible prose', () => {
  assert.equal(
    sanitize('\x00AFILE:src/main.ts\x00\x00RESET\x00正在检查实现。', true),
    '正在检查实现。',
  );
  assert.equal(sanitize('\x00ASUM\x00\x00RESET\x00已完成验证。', true), '已完成验证。');
  assert.equal(sanitize('ASUMRESET已完成验证。', false), '已完成验证。');
  assert.equal(runtime.containsAgentInternalTranscript('\x00ASUM\x00summary'), true);
});

test('routing-marker restoration is deterministic and leaves ordinary prose untouched', () => {
  assert.equal(
    runtime.restoreAgentRoutingMarkerText('AFILE:main.cppRESET检查完成。'),
    '\x00AFILE:main.cpp\x00\x00RESET\x00检查完成。',
  );
  assert.equal(
    runtime.restoreAgentRoutingMarkerText('ASUMRESET最终结论。'),
    '\x00ASUM\x00\x00RESET\x00最终结论。',
  );
  assert.equal(runtime.restoreAgentRoutingMarkerText('说明 ASUM 和 AFILE 的格式。'), '说明 ASUM 和 AFILE 的格式。');
});

test('local context transport notices do not leak into assistant prose', () => {
  const text = [
    '[自动识别目录] 已加载 12 个源文件，完整清单仅用于本地上下文。',
    '[同一 session 续作] 已自动恢复上一轮工作文件：src/a.ts',
    '继续回答用户问题。',
  ].join('\n');
  assert.equal(sanitize(text, true), '继续回答用户问题。');
});

test('todo helper only formats typed host todo state', () => {
  assert.equal(runtime.findFailedAgentTodoLabel([
    { title: '实现功能', status: 'completed' },
    { title: '编译并验证失败状态不会伪装成成功', status: 'failed' },
  ]), '编译并验证失败状态不会伪装成成功');
  assert.equal(runtime.findFailedAgentTodoLabel([{ title: '完成', status: 'completed' }]), '');
  assert.doesNotMatch(todoSource, /extractTodoItemsFromModelText|JSON\.parse|manage_todo_list/i);
});

test('webview consumes typed todo events and has no prose-to-tool state path', () => {
  assert.match(webviewSource, /msg\.type === 'todoUpdate'/);
  assert.match(webviewSource, /handleTodoUpdate\(msg\.items \|\| \[\]\)/);
  assert.doesNotMatch(webviewSource, /maybeHandleTodoUpdateFromModelText|agentTodoParseBuffer/);
  assert.doesNotMatch(webviewSource, /containsWebviewCallingToolIntent|looksLikeWebviewToolArgumentPayload/);
  assert.doesNotMatch(webviewSource, /nonAgentPendingToolArgumentDelta/);
});

test('presentation sanitizer stays free of tool dialect and task-status inference', () => {
  assert.doesNotMatch(sanitizerSource, /WEBVIEW_TOOL_NAMES|manage_todo_list|task_complete|Action Input|TOOL_CALL/);
  assert.doesNotMatch(sanitizerSource, /stdout|stderr|exitCode|Calling|JSON\.parse/);
  assert.match(sanitizerSource, /containsAgentRoutingMarkerLeak/);
});

test('terminal output folding owns only rendered DOM presentation', () => {
  function createElement(tagName, textContent = '') {
    return {
      tagName: tagName.toUpperCase(),
      textContent,
      innerHTML: textContent,
      className: '',
      children: [],
      parentNode: null,
      nextElementSibling: null,
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
      },
    };
  }

  const context = {
    document: { createElement },
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(terminalOutputSource, context, { filename: 'webview-terminal-output.js' });

  const container = createElement('div');
  const header = createElement('p', '[终端] $ npm test');
  const output = createElement('pre', 'all pass');
  const prose = createElement('p', '普通回答');
  container.children = [header, output, prose];
  for (const child of container.children) child.parentNode = container;
  header.nextElementSibling = output;
  output.nextElementSibling = prose;
  container.insertBefore = function insertBefore(child, reference) {
    child.parentNode = this;
    this.children.splice(this.children.indexOf(reference), 0, child);
  };
  container.removeChild = function removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
  };

  context.collapseTerminalOutputBlocks(container);

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].tagName, 'DETAILS');
  assert.equal(container.children[0].className, 'terminal-collapse');
  assert.deepEqual(
    container.children[0].children.map(child => child.tagName),
    ['SUMMARY', 'PRE'],
  );
  assert.equal(container.children[1], prose);
  assert.doesNotMatch(terminalOutputSource, /task_complete|manage_todo_list|JSON\.parse/);
});

test('webview runtime loads presentation boundaries before the main script', () => {
  const manifest = JSON.parse(readFileSync(path.join(mediaDir, 'webview-runtime.json'), 'utf8'));
  const sanitizerIndex = manifest.scripts.indexOf('webview-agent-sanitizer.js');
  const todoIndex = manifest.scripts.indexOf('webview-agent-todos.js');
  const terminalOutputIndex = manifest.scripts.indexOf('webview-terminal-output.js');
  const generatedContentIndex = manifest.scripts.indexOf('webview-generated-content.js');
  const mainIndex = manifest.scripts.indexOf('webview.js');

  assert.ok(sanitizerIndex >= 0 && sanitizerIndex < mainIndex);
  assert.ok(todoIndex >= 0 && todoIndex < mainIndex);
  assert.ok(terminalOutputIndex >= 0 && terminalOutputIndex < generatedContentIndex);
});
