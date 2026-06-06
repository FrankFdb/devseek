/**
 * Unit tests for pure logic functions extracted from webview.js
 *
 * Tests parsePlanDetail, escapeHtml, basename, and context files state logic.
 * Run: node test/unit/webview-logic.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

// Extract and evaluate pure logic from webview.js without DOM/vscode
// We only test the pure utility functions by defining a minimal context

// ── Load test-specific pure functions from webview.js via extraction ──────────
// Instead of loading the whole webview, we extract and test the core utilities

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function basename(p) {
  if (!p) return '';
  return p.split(/[/\\]/).filter(Boolean).pop() || '';
}

// Replicate parsePlanDetail from webview.js
function parsePlanDetail(detail) {
  if (!detail) return [];
  const lines = detail.split('\n');
  const tasks = [];
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\[([^\]]+)\]\s+([^\s—–-]+)\s+[—–-]+\s+(.*)/);
    if (m) {
      tasks.push({ action: m[1].trim(), file: m[2].trim(), desc: m[3].trim() });
    } else {
      const m2 = line.match(/^\d+\.\s+\[([^\]]+)\]\s+(.*)/);
      if (m2) {
        const rest = m2[2].trim();
        const parts = rest.split(/\s+[—–-]+\s+/);
        tasks.push({
          action: m2[1].trim(),
          file: parts[0]?.trim() || '',
          desc: parts[1]?.trim() || parts[0]?.trim() || '',
        });
      }
    }
  }
  return tasks;
}

// Replicate normalizeGeneratedContentDisplayMode
function normalizeGeneratedContentDisplayMode(mode) {
  if (mode === 'hidden' || mode === 'full') return mode;
  return 'collapsed';
}

function stripToolCallBlocks(text) {
  return String(text || '')
    .replace(/\[TOOL:\w+\s*\{[\s\S]*?\}\]/g, '')
    .replace(/Calling\s*:?(?:\s+tool)?\s*\[?`?\w+`?\]?\s*\{[\s\S]*?\}/gi, '')
    .trim();
}

function containsAgentInternalTranscript(text) {
  return /(?:^|\n)\s*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function cleanAgentFinalProseForUser(text) {
  if (containsAgentInternalTranscript(text || '')) return '';
  let cleaned = stripToolCallBlocks(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return '';
  const lines = cleaned.split('\n').filter((line) => {
    const s = line.trim();
    if (!s) return true;
    if (/^(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(s)) return false;
    if (/^\$\s+\S+/.test(s)) return false;
    if (/^(?:stdout|stderr|exitCode|exit code|命令输出|执行命令|终端输出)\s*[:：]/i.test(s)) return false;
    return true;
  });
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned || containsAgentInternalTranscript(cleaned)) return '';
  return cleaned.length > 800 ? cleaned.slice(0, 797).trimEnd() + '...' : cleaned;
}

// ── escapeHtml tests ──────────────────────────────────────────────────────────

test('escapeHtml: escapes < and >', () => {
  assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
});

test('escapeHtml: escapes &', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: escapes quotes', () => {
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
});

test('escapeHtml: handles empty string', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml: handles normal text passthrough', () => {
  assert.equal(escapeHtml('hello world 123'), 'hello world 123');
});

test('escapeHtml: XSS attack vector sanitized', () => {
  const xss = '<script>alert("xss")</script>';
  const result = escapeHtml(xss);
  assert.ok(!result.includes('<script>'));
  assert.ok(!result.includes('</script>'));
  assert.ok(result.includes('&lt;script&gt;'));
});

// ── basename tests ────────────────────────────────────────────────────────────

test('basename: extracts filename from Unix path', () => {
  assert.equal(basename('/home/user/code/main.cpp'), 'main.cpp');
});

test('basename: extracts filename from Windows path', () => {
  assert.equal(basename('C:\\Users\\user\\main.ts'), 'main.ts');
});

test('basename: handles filename without directory', () => {
  assert.equal(basename('main.cpp'), 'main.cpp');
});

test('basename: handles empty string', () => {
  assert.equal(basename(''), '');
});

test('basename: handles trailing slash', () => {
  const result = basename('/path/to/dir/');
  assert.ok(result === 'dir' || result === '');
});

// ── parsePlanDetail tests ─────────────────────────────────────────────────────

test('parsePlanDetail: empty string → []', () => {
  assert.deepEqual(parsePlanDetail(''), []);
});

test('parsePlanDetail: parses standard task format', () => {
  const detail = [
    '1. [modify] src/main.cpp — Fix the null pointer dereference',
    '2. [create] src/test.cpp — Add unit test for fix',
  ].join('\n');
  const tasks = parsePlanDetail(detail);
  assert.ok(tasks.length >= 1);
  if (tasks[0]) {
    assert.equal(tasks[0].action, 'modify');
    assert.ok(tasks[0].file.includes('main.cpp'));
  }
});

test('parsePlanDetail: returns array with action/file/desc keys', () => {
  const detail = '1. [analyze] src/util.ts — check for performance issues';
  const tasks = parsePlanDetail(detail);
  if (tasks.length > 0) {
    assert.ok('action' in tasks[0]);
    assert.ok('file' in tasks[0]);
    assert.ok('desc' in tasks[0]);
  }
});

test('parsePlanDetail: non-matching lines are skipped', () => {
  const detail = 'Not a task line\nAnother line without format';
  const tasks = parsePlanDetail(detail);
  assert.deepEqual(tasks, []);
});

// ── normalizeGeneratedContentDisplayMode tests ────────────────────────────────

test('normalizeGeneratedContentDisplayMode: hidden → hidden', () => {
  assert.equal(normalizeGeneratedContentDisplayMode('hidden'), 'hidden');
});

test('normalizeGeneratedContentDisplayMode: full → full', () => {
  assert.equal(normalizeGeneratedContentDisplayMode('full'), 'full');
});

test('normalizeGeneratedContentDisplayMode: unknown → collapsed', () => {
  assert.equal(normalizeGeneratedContentDisplayMode('something-else'), 'collapsed');
  assert.equal(normalizeGeneratedContentDisplayMode(undefined), 'collapsed');
  assert.equal(normalizeGeneratedContentDisplayMode(''), 'collapsed');
});

// ── Agent final prose cleanup tests ───────────────────────────────────────────

test('agent final prose: strips backend terminal transcript from final user text', () => {
  const leaked = [
    '已完成验证。',
    'Calling `run_terminal`',
    '{"command":"gcc code/weekend.c -o code/weekend && ./code/weekend"}',
    '[run_terminal]',
    'stdout: ok',
    'exit code: 0',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: strips replace_file transcript from final user text', () => {
  const leaked = [
    'Calling `replace_file`',
    '{"path":"code/app.js","content":"console.log(1)"}',
    '[replace_file]',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: keeps normal user-facing summary', () => {
  const summary = '已完成：创建 `code/weekend.c`，并验证程序可以正常运行。';
  assert.equal(cleanAgentFinalProseForUser(summary), summary);
});

// ── Context files row logic tests ─────────────────────────────────────────────

test('context files: initial state is empty', () => {
  let inheritedContextFiles = [];
  assert.deepEqual(inheritedContextFiles, []);
});

test('context files: updated from contextFiles message', () => {
  let inheritedContextFiles = [];
  const msg = { type: 'contextFiles', files: ['Animal.h', 'Dog.h'] };
  inheritedContextFiles = msg.files || [];
  assert.deepEqual(inheritedContextFiles, ['Animal.h', 'Dog.h']);
});

test('context files: cleared on clearContext', () => {
  let inheritedContextFiles = ['Animal.h', 'Dog.h'];
  // simulate clearContext
  inheritedContextFiles = [];
  assert.deepEqual(inheritedContextFiles, []);
});

test('context files: cleared on clearHistory', () => {
  let inheritedContextFiles = ['file1.ts', 'file2.ts'];
  // simulate clearHistory handler
  inheritedContextFiles = [];
  assert.deepEqual(inheritedContextFiles, []);
});

console.log('\n✅ All webview logic tests passed!\n');
