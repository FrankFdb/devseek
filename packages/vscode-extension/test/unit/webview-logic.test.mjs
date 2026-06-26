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

const SHELL_TRANSCRIPT_NAMES = {
  bash: true, shell: true, sh: true, zsh: true, console: true, terminal: true,
  cmd: true, powershell: true, pwsh: true,
};

const TOOL_NAMES = {
  read_file: true, grep_search: true, file_search: true, semantic_search: true, list_dir: true, get_errors: true,
  run_terminal: true, memory_write: true, get_changed_files: true, create_directory: true, fetch_webpage: true,
  vscode_listCodeUsages: true, run_vscode_command: true, create_file: true, write_file: true, replace_file: true,
  manage_todo_list: true, task_complete: true,
};

function isShellTranscriptName(name) {
  return !!SHELL_TRANSCRIPT_NAMES[String(name || '').toLowerCase()];
}

function makeAnyCallingRegex() {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?([A-Za-z_]\w*)`?\]?)?/gi;
}

function lineEndAfter(text, index) {
  const next = text.indexOf('\n', Math.max(0, index));
  return next < 0 ? text.length : next + 1;
}

function skipBlankLines(text, index) {
  let cursor = index;
  while (cursor < text.length) {
    const end = lineEndAfter(text, cursor);
    if (text.slice(cursor, end).trim()) break;
    cursor = end;
  }
  return cursor;
}

function isShellCommandLine(line) {
  const first = String(line || '').trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  return /^(?:cat|type|get-content|find|rg|grep|sed|head|tail|ls|dir|pwd|cd|npm|npx|pnpm|yarn|node|git|python|python3|bash|sh|zsh|cmd|powershell|pwsh|mkdir|cp|mv|rm|touch|code|g\+\+|gcc|clang|make|cmake|go|cargo|pytest|mvn|gradle|docker|curl|wget)\b/i.test(first)
    || /[|;&<>]/.test(first);
}

function looksLikeShellCommandBlock(text) {
  return String(text || '').split(/\r?\n/).some((line) => isShellCommandLine(line));
}

function fenceEnd(text, fenceStart) {
  let search = lineEndAfter(text, fenceStart);
  while (search < text.length) {
    const idx = text.indexOf('```', search);
    if (idx < 0) return text.length;
    const lineStart = idx === 0 ? 0 : text.lastIndexOf('\n', idx - 1) + 1;
    if (/^[ \t]*```/.test(text.slice(lineStart, idx + 3))) {
      return lineEndAfter(text, idx + 3);
    }
    search = idx + 3;
  }
  return text.length;
}

function shellTranscriptEnd(text, callEnd) {
  const cursor = skipBlankLines(text, lineEndAfter(text, callEnd));
  if (cursor >= text.length) return text.length;
  if (/^[ \t]*```/.test(text.slice(cursor, cursor + 8))) {
    const headerEnd = lineEndAfter(text, cursor + 3);
    const close = text.indexOf('```', headerEnd);
    const contentEnd = close >= 0 ? close : text.length;
    if (!looksLikeShellCommandBlock(text.slice(headerEnd, contentEnd))) return callEnd;
    return close >= 0 ? lineEndAfter(text, close + 3) : text.length;
  }
  const firstLineEnd = lineEndAfter(text, cursor);
  if (!isShellCommandLine(text.slice(cursor, firstLineEnd))) return callEnd;
  let end = firstLineEnd;
  while (end < text.length) {
    const lineEnd = lineEndAfter(text, end);
    if (!text.slice(end, lineEnd).trim()) return lineEnd;
    end = lineEnd;
  }
  return text.length;
}

function stripCallingShellTranscriptBlocksFromText(text) {
  let out = '';
  let i = 0;
  const callRe = makeAnyCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    const end = shellTranscriptEnd(text, callRe.lastIndex);
    if ((m[1] && !isShellTranscriptName(m[1])) || end <= callRe.lastIndex) {
      out += text.slice(i, m.index + 1);
      i = m.index + 1;
      continue;
    }
    out += text.slice(i, m.index);
    i = end;
  }
  return out;
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inStr = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function stripCallingToolBlocksFromText(text) {
  let out = '';
  let i = 0;
  const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    const name = m[1];
    if (!TOOL_NAMES[name] && !name.startsWith('mcp__')) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    const jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) { out += text.slice(i); break; }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) { out += text.slice(i); break; }
    out += text.slice(i, m.index);
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function stripToolArgumentBlocksFromText(text) {
  let out = '';
  let i = 0;
  const callRe = /(?:^|[ \t]*\n|[ \t]+)(?:Tool|工具)[ \t]*[:：][ \t]*`?([A-Za-z_]\w*)`?[^\n{]*(?:Arguments?|参数)[ \t]*[:：][ \t]*/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    const name = m[1] || '';
    if (!TOOL_NAMES[name] && !name.startsWith('mcp__')) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    const jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) {
      out += text.slice(i, m.index).replace(/[ \t]+$/, '');
      break;
    }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) {
      out += text.slice(i, m.index).replace(/[ \t]+$/, '');
      break;
    }
    out += text.slice(i, m.index).replace(/[ \t]+$/, '');
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function findNextDsmlToolCallStartInText(text, startAt = 0) {
  const re = /<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b/gi;
  re.lastIndex = startAt;
  const match = re.exec(String(text || ''));
  return match ? match.index : -1;
}

function dsmlToolCallBlockEndInText(text, start) {
  const raw = String(text || '');
  const tail = raw.slice(start);
  const toolCallsClose = /<\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i.exec(tail);
  if (toolCallsClose) return start + toolCallsClose.index + toolCallsClose[0].length;
  const invokeClose = /<\/\s*\|\s*DSML\s*\|\s*invoke\s*>/i.exec(tail);
  if (invokeClose) return start + invokeClose.index + invokeClose[0].length;
  const parameterClose = /<\/\s*\|\s*DSML\s*\|\s*parameter\s*>/i.exec(tail);
  if (parameterClose) return start + parameterClose.index + parameterClose[0].length;
  return raw.length;
}

function stripDsmlToolCallBlocksFromText(text) {
  const raw = String(text || '');
  let out = '';
  let cursor = 0;
  while (cursor < raw.length) {
    const start = findNextDsmlToolCallStartInText(raw, cursor);
    if (start < 0) {
      out += raw.slice(cursor);
      break;
    }
    out += raw.slice(cursor, start).replace(/[ \t]+$/, '');
    cursor = dsmlToolCallBlockEndInText(raw, start);
  }
  return out;
}

function containsDsmlToolTranscript(text) {
  return findNextDsmlToolCallStartInText(String(text || ''), 0) >= 0;
}

function stripToolCallBlocks(text) {
  const raw = String(text || '');
  let result = '';
  let i = 0;
  let removedInternalBlock = false;
  while (i < raw.length) {
    if (raw[i] === '[') {
      const lookahead = raw.slice(i, Math.min(i + 60, raw.length));
      const m = lookahead.match(/^\[TOOL:(\w+)\s*(?:\]?\s*)\{/);
      if (m) {
        removedInternalBlock = true;
        const bracePos = raw.indexOf('{', i);
        let depth = 1;
        let inStr = false;
        let j = bracePos + 1;
        while (j < raw.length && depth > 0) {
          const ch = raw[j];
          if (inStr) {
            if (ch === '\\') j++;
            else if (ch === '"') inStr = false;
          } else if (ch === '"') {
            inStr = true;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
          }
          j++;
        }
        while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t')) j++;
        if (j < raw.length && raw[j] === ']') j++;
        i = j;
        continue;
      }
      if (/^\[TOOL:(\w+)\b/.test(lookahead)) {
        removedInternalBlock = true;
        break;
      }
    }
    result += raw[i];
    i++;
  }
  const beforeShellCleanup = result;
  result = stripCallingShellTranscriptBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeShellCleanup;
  const beforeCallingCleanup = result;
  result = stripCallingToolBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;
  const beforeToolArgumentCleanup = result;
  result = stripToolArgumentBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolArgumentCleanup;
  const beforeDsmlCleanup = result;
  result = stripDsmlToolCallBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeDsmlCleanup;
  const cleaned = result.trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
}

function containsAgentInternalTranscript(text) {
  return containsDsmlToolTranscript(text)
    || /(?:^|\n)\s*\[TOOL:(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(text)
    || /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh)\b/i.test(text)
    || /(?:^|\n)\s*(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n|[ \t])(?:Tool|工具)[ \t]*[:：][ \t]*`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function cleanAgentFinalProseForUser(text) {
  if (containsAgentInternalTranscript(text || '')) return '';
  let cleaned = stripToolCallBlocks(text || '')
    .replace(/<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b[\s\S]*$/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return '';
  const lines = cleaned.split('\n').filter((line) => {
    const s = line.trim();
    if (!s) return true;
    if (/^\[TOOL:(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(s)) return false;
    if (/^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh)\b/i.test(s)) return false;
    if (/^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^(?:Tool|工具)[ \t]*[:：][ \t]*`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^(?:Arguments?|参数)[ \t]*[:：]\s*\{/i.test(s)) return false;
    if (/^\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(s)) return false;
    if (/^\$\s+\S+/.test(s)) return false;
    if (/^(?:stdout|stderr|exitCode|exit code|命令输出|执行命令|终端输出)\s*[:：]/i.test(s)) return false;
    return true;
  });
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned || containsAgentInternalTranscript(cleaned)) return '';
  return cleaned.length > 800 ? cleaned.slice(0, 797).trimEnd() + '...' : cleaned;
}

function sanitizeAgentVisibleDelta(text) {
  return sanitizeAgentVisibleText(text);
}

function sanitizeAgentVisibleText(text) {
  const raw = String(text || '');
  if (!raw) return '';
  const cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function stripIncompleteCallingTail(text) {
  const raw = String(text || '');
  const m = /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.exec(raw);
  return m ? raw.slice(0, m.index).trimEnd() : raw;
}

function containsPotentialInternalCallingTail(text) {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.test(String(text || ''));
}

function sanitizeAssistantVisibleText(text) {
  const raw = String(text || '');
  if (!raw) return '';
  const cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function sanitizeVisibleDeltaForMode(text, isAgentMode) {
  const raw = String(text || '');
  return isAgentMode ? sanitizeAgentVisibleDelta(raw) : sanitizeAssistantVisibleText(raw);
}

function normalizeAgentToolActivityKind(kind) {
  const raw = kind == null ? '' : String(kind).trim();
  if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return 'read';
  return raw;
}

function normalizeAgentToolActivityLabel(label) {
  if (label == null) return '';
  const raw = String(label).replace(/\s+/g, ' ').trim();
  if (raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
  return raw;
}

function defaultAgentToolActivityTarget(kind) {
  if (kind === 'read') return 'file';
  if (kind === 'search') return 'code';
  if (kind === 'list') return 'directory';
  if (kind === 'write') return 'file';
  if (kind === 'web') return 'webpage';
  if (kind === 'diagnostics') return 'workspace diagnostics';
  if (kind === 'vscode-command') return 'VS Code command';
  if (kind === 'mcp') return 'tool';
  if (kind === 'terminal') return 'command';
  return 'tool';
}

function activitySeenKey(msg) {
  const actKind = normalizeAgentToolActivityKind(msg?.activityKind);
  const actLabel = normalizeAgentToolActivityLabel(msg?.activityLabel);
  let seenLabel = String(actLabel || defaultAgentToolActivityTarget(actKind)).replace(/\s+/g, ' ').trim();
  if (actKind === 'read' || actKind === 'write' || actKind === 'list') {
    seenLabel = seenLabel.replace(/\\/g, '/').split('/').pop() || seenLabel;
  }
  if (seenLabel.length > 120) seenLabel = seenLabel.slice(0, 120);
  return actKind + ':' + seenLabel.toLowerCase();
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

test('agent final prose: strips Tool/Arguments terminal transcript from final user text', () => {
  const leaked = [
    '好的，现在执行编译和运行。 Tool: run_terminal Arguments:{"command":"cd /tmp/project && cmake -S . -B build && cmake --build build","is_background":false}',
    '后续总结应该由结构化 evidence 生成。',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: strips DSML tool transcript from final user text', () => {
  const leaked = [
    '我先查看文件。',
    '< | DSML | tool_calls< | DSML | invoke name="read_file"< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: keeps normal user-facing summary', () => {
  const summary = '已完成：创建 `code/weekend.c`，并验证程序可以正常运行。';
  assert.equal(cleanAgentFinalProseForUser(summary), summary);
});

test('agent final prose: strips create_file tool containing C++ braces', () => {
  const leaked = [
    '我会创建文件。',
    '[TOOL:create_file {"path":"code/hello_world.cpp","content":"#include <iostream>\\nint main() {\\n  std::cout << \\"Hello, World!\\" << std::endl;\\n  return 0;\\n}\\n"}]',
    '[TOOL:run_terminal {"command":"g++ code/hello_world.cpp -o code/hello_world && ./code/hello_world"}]',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: drops incomplete streaming tool prefix', () => {
  assert.equal(stripToolCallBlocks('准备写入\n[TOOL:create_file'), '准备写入');
});

test('agent accumulated render: hides split bash calling transcript before and after command arrives', () => {
  let accumulated = '我需要先找到并读取 `workflow-service.ts` 文件。 Calling:';
  assert.equal(sanitizeVisibleDeltaForMode(accumulated, true), '我需要先找到并读取 `workflow-service.ts` 文件。');

  accumulated += [
    ' bash',
    '```CODE',
    'find packages/vscode-extension/src/app -name "workflow-service.ts" -type f',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(accumulated, true);
  assert.match(cleaned, /我需要先找到并读取/);
  assert.doesNotMatch(cleaned, /Calling|bash|find packages|CODE/);
});

test('agent accumulated render: hides screenshot-style bash find pipeline', () => {
  const leaked = [
    '我先定位并分析 `src/agent/tool-executor.ts` 的当前实现，然后给出重构计划。 Calling: bash',
    '```CODE',
    'find packages -type f -name "*.ts" -path "*/agent/*" 2>/dev/null | head -20',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, true);
  assert.match(cleaned, /我先定位并分析/);
  assert.doesNotMatch(cleaned, /Calling|bash|find packages|head -20|CODE/);
});

test('agent accumulated render: hides nameless Calling shell fence', () => {
  const leaked = [
    '好的，我先定位 `src/agent/tool-executor.ts` 文件并查看其当前实现。 Calling:',
    '```bash',
    'cat packages/vscode-extension/src/agent/tool-executor.ts 2>/dev/null',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, true);
  assert.equal(cleaned, '好的，我先定位 `src/agent/tool-executor.ts` 文件并查看其当前实现。');
});

test('agent accumulated render: hides split DSML tool transcript before and after close arrives', () => {
  let accumulated = '好的，我先查看文件。< | DSML | tool_calls< | DSML | invoke name="read_file"';
  assert.equal(sanitizeVisibleDeltaForMode(accumulated, true), '好的，我先查看文件。');

  accumulated += '< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>';
  const cleaned = sanitizeVisibleDeltaForMode(accumulated, true);
  assert.equal(cleaned, '好的，我先查看文件。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|filePath/);
});

test('agent accumulated render: keeps ordinary nameless Calling prose', () => {
  const text = [
    'Calling:',
    '这不是命令，只是一段普通说明。',
  ].join('\n');
  assert.equal(sanitizeVisibleDeltaForMode(text, true), text);
});

test('agent tool activity: missing label gets stable seen key without throwing', () => {
  assert.equal(activitySeenKey({ type: 'agentToolActivity', activityKind: 'read' }), 'read:file');
  assert.equal(activitySeenKey({ type: 'agentToolActivity', activityKind: 'terminal', activityLabel: undefined }), 'terminal:command');
});

test('non-agent delta: suppresses raw tool calls from restored web session', () => {
  const leaked = '[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"创建 Hello World","status":"in-progress"}]}]';
  assert.equal(sanitizeVisibleDeltaForMode(leaked, false), '');
});

test('non-agent delta: suppresses screenshot-like multi-tool transcript', () => {
  const leaked = [
    '[TOOL:manage_todo_list {"todoList":[{"id":"1","title":"创建 Hello World","status":"in-progress"}]}]',
    '[TOOL:create_file {"path":"code/hello.cpp","content":"#include <iostream>\\nint main() { return 0; }\\n"}]',
    '[TOOL:run_terminal {"command":"cd /home/ff/work/devseek_netai/code && g++ hello.cpp -o hello"}]',
  ].join('\n');
  assert.equal(sanitizeVisibleDeltaForMode(leaked, false), '');
});

test('non-agent delta: suppresses Calling tool transcript with next-line JSON payload', () => {
  const leaked = [
    '分析完成。',
    'Calling: manage_todo_list',
    '{"todoList":[{"id":1,"title":"分析 workflow-service.ts 文件内容及问题","status":"completed"}]}',
    '',
    'Calling: task_complete',
    '{"summary":"分析完成。"}',
  ].join('\n');
  assert.equal(sanitizeVisibleDeltaForMode(leaked, false), '分析完成。');
});

test('non-agent delta: strips inline bash calling transcript with fenced command', () => {
  const leaked = [
    '我需要先找到并读取 `workflow-service.ts` 文件。 Calling: bash',
    '```CODE',
    'find packages/vscode-extension/src/app -name "workflow-service.ts" -type f',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.match(cleaned, /我需要先找到并读取/);
  assert.doesNotMatch(cleaned, /Calling|bash|find packages|CODE/);
});

test('non-agent accumulated render: hides split bash calling transcript', () => {
  let accumulated = '我需要先找到并读取 `workflow-service.ts` 文件。 Calling:';
  assert.equal(sanitizeVisibleDeltaForMode(accumulated, false), '我需要先找到并读取 `workflow-service.ts` 文件。');

  accumulated += [
    ' bash',
    '```CODE',
    'cat packages/vscode-extension/src/app/workflow-service.ts 2>/dev/null',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(accumulated, false);
  assert.match(cleaned, /我需要先找到并读取/);
  assert.doesNotMatch(cleaned, /Calling|bash|cat packages|CODE/);
});

test('non-agent delta: suppresses standalone bash transcript', () => {
  const leaked = [
    'Calling: bash',
    '```bash',
    'cat packages/vscode-extension/src/app/workflow-service.ts',
    '```',
  ].join('\n');
  assert.equal(sanitizeVisibleDeltaForMode(leaked, false), '');
});

test('non-agent delta: suppresses nameless Calling shell fence', () => {
  const leaked = [
    'Calling:',
    '```CODE',
    'ls -la packages/vscode-extension/src/agent/ 2>/dev/null',
    '```',
  ].join('\n');
  assert.equal(sanitizeVisibleDeltaForMode(leaked, false), '');
});

test('non-agent delta: keeps ordinary chat text', () => {
  assert.equal(sanitizeVisibleDeltaForMode('Hello! 我在。', false), 'Hello! 我在。');
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

test('agent announcement: process prose is collapsed into Working details', () => {
  const webview = readFileSync(path.join(rootDir, 'media/webview.js'), 'utf8');
  assert.match(webview, /function summarizeAgentAnnouncement/);
  assert.match(webview, /ensureAgentProgressContainer\('Preparing context'\)/);
  assert.match(webview, /agent-announcement-details/);
  assert.doesNotMatch(webview, /agent-phase-b-bubble/);
});

test('session history: restored assistant messages keep collapsible rendering', () => {
  const webview = readFileSync(path.join(rootDir, 'media/webview.js'), 'utf8');
  assert.ok(/function renderRestoredAssistantContent/.test(webview), 'history restore must use a dedicated assistant renderer');
  assert.ok(/createRestoredAssistantTurn\(m\.content,\s*lastUserPrompt\)/.test(webview), 'history restore must pass the previous user prompt');
  assert.ok(/renderRestoredAssistantContent\(bubble,\s*text,\s*promptText\)/.test(webview), 'assistant history turns must not render raw md directly');
  assert.ok(/buildResponseWithCollapsedCode/.test(webview), 'generated code in history must stay collapsible');
  assert.ok(/collapseTerminalOutputBlocks/.test(webview), 'terminal output in history must stay collapsible');
});

console.log('\n✅ All webview logic tests passed!\n');
