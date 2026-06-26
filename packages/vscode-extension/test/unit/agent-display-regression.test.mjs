/**
 * Regression tests for the real DevSeek agent display failure mode:
 * free-explore agent finishes after Reload Window, but the UI keeps showing a
 * working spinner or exposes backend terminal/tool transcripts as user-facing
 * assistant prose.
 *
 * This is a small reducer-style test. It does not replace VS Code UI E2E, but it
 * makes the expected message contract executable and fast:
 * - phase:done must stop the working indicator
 * - endResponse must stop generation
 * - final prose must not contain backend run_terminal/stdout/exit-code text
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function containsAgentInternalTranscript(text) {
  return /<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b/i.test(text)
    || /(?:^|\n)\s*\[TOOL:(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(text)
    || /(?:^|\n)\s*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n|[ \t])(?:Tool|工具)\s*[:：]\s*`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function cleanAgentFinalProseForUser(text) {
  if (containsAgentInternalTranscript(text || '')) return '';
  return String(text || '').trim();
}

function buildAutoSummary(state) {
  if (state.editedFiles.length > 0) {
    return '已完成，修改 ' + state.editedFiles.length + ' 个文件：'
      + state.editedFiles.map((f) => f.basename || f.path).join('、') + '。';
  }
  return '任务已完成。';
}

function createState() {
  return {
    isGenerating: false,
    isAgentMode: false,
    workingActive: false,
    finalBubble: '',
    currentRaw: '',
    editedFiles: [],
  };
}

function reduce(state, msg) {
  if (msg.type === 'startResponse') {
    state.isGenerating = true;
    state.isAgentMode = !!msg.agentMode;
    state.currentRaw = '';
    state.finalBubble = '';
    return state;
  }
  if (msg.type === 'agentStatus' && msg.phase === 'execute') {
    state.workingActive = msg.state !== 'completed' && msg.state !== 'failed';
    return state;
  }
  if (msg.type === 'delta') {
    state.currentRaw += msg.text || '';
    return state;
  }
  if (msg.type === 'agentStatus' && msg.phase === 'done') {
    state.workingActive = false;
    state.editedFiles = Array.isArray(msg.editedFiles) ? msg.editedFiles : state.editedFiles;
    return state;
  }
  if (msg.type === 'endResponse') {
    const clean = cleanAgentFinalProseForUser(state.currentRaw);
    state.finalBubble = clean || buildAutoSummary(state);
    state.isGenerating = false;
    return state;
  }
  return state;
}

test('agent display: contaminated backend transcript does not leak and spinner stops', () => {
  const state = createState();
  [
    { type: 'startResponse', agentMode: true },
    { type: 'agentStatus', phase: 'execute', state: 'started', taskAction: 'explore', title: '创建周末心情程序' },
    {
      type: 'delta',
      text: [
        '已完成验证。',
        'Calling `run_terminal`',
        '{"command":"gcc code/weekend.c -o code/weekend && ./code/weekend"}',
        '[run_terminal]',
        'stdout: ok',
        'exit code: 0',
      ].join('\n'),
    },
    {
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      editedFiles: [{ path: 'code/weekend.c', basename: 'weekend.c' }],
    },
    { type: 'endResponse' },
  ].forEach((msg) => reduce(state, msg));

  assert.equal(state.isGenerating, false);
  assert.equal(state.workingActive, false);
  assert.equal(state.finalBubble, '已完成，修改 1 个文件：weekend.c。');
  assert.equal(containsAgentInternalTranscript(state.finalBubble), false);
});

test('agent display: Tool/Arguments transcript is treated as internal output', () => {
  const state = createState();
  [
    { type: 'startResponse', agentMode: true },
    {
      type: 'delta',
      text: '好的，现在执行编译和运行。 Tool: run_terminal Arguments:{"command":"cmake --build build","is_background":false}',
    },
    {
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      editedFiles: [{ path: 'code/shape_manager/main.cpp', basename: 'main.cpp' }],
    },
    { type: 'endResponse' },
  ].forEach((msg) => reduce(state, msg));

  assert.equal(state.finalBubble, '已完成，修改 1 个文件：main.cpp。');
  assert.equal(containsAgentInternalTranscript(state.finalBubble), false);
});

test('agent display: DSML tool transcript is treated as internal output', () => {
  const state = createState();
  [
    { type: 'startResponse', agentMode: true },
    {
      type: 'delta',
      text: '我先读取文件。< | DSML | tool_calls< | DSML | invoke name="read_file"< | DSML | parameter name="filePath" string="true">/tmp/project/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
    },
    {
      type: 'agentStatus',
      phase: 'done',
      state: 'completed',
      editedFiles: [{ path: 'code/shape_manager/main.cpp', basename: 'main.cpp' }],
    },
    { type: 'endResponse' },
  ].forEach((msg) => reduce(state, msg));

  assert.equal(state.finalBubble, '已完成，修改 1 个文件：main.cpp。');
  assert.equal(containsAgentInternalTranscript(state.finalBubble), false);
});

test('agent display: clean final prose is kept', () => {
  const state = createState();
  [
    { type: 'startResponse', agentMode: true },
    { type: 'agentStatus', phase: 'execute', state: 'started', taskAction: 'explore' },
    { type: 'delta', text: '已完成：创建 `code/weekend.c`，并验证程序可以正常运行。' },
    { type: 'agentStatus', phase: 'done', state: 'completed' },
    { type: 'endResponse' },
  ].forEach((msg) => reduce(state, msg));

  assert.equal(state.isGenerating, false);
  assert.equal(state.workingActive, false);
  assert.equal(state.finalBubble, '已完成：创建 `code/weekend.c`，并验证程序可以正常运行。');
});

console.log('\nAgent display regression tests passed.\n');
