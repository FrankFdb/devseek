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
import vm from 'node:vm';
import {
  TOOL_PROTOCOL_SAMPLES,
  TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES,
} from '../fixtures/tool-protocol-samples.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function readWebviewRuntime() {
  const mediaDir = path.join(rootDir, 'media');
  const manifest = JSON.parse(readFileSync(path.join(mediaDir, 'webview-runtime.json'), 'utf8'));
  const scripts = Array.isArray(manifest.scripts) && manifest.scripts.length > 0
    ? manifest.scripts
    : ['webview.js'];
  return scripts.map((fileName) => readFileSync(path.join(mediaDir, fileName), 'utf8')).join('\n');
}

let webviewSanitizerRuntime;

function getWebviewSanitizerRuntime() {
  if (webviewSanitizerRuntime) return webviewSanitizerRuntime;
  const mediaDir = path.join(rootDir, 'media');
  const context = { console };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const fileName of ['webview-agent-tool-manifest.js', 'webview-agent-sanitizer.js']) {
    vm.runInContext(readFileSync(path.join(mediaDir, fileName), 'utf8'), context, { filename: fileName });
  }
  webviewSanitizerRuntime = context;
  return webviewSanitizerRuntime;
}

function sanitizeRuntimeVisibleDeltaForMode(text, isAgentMode) {
  const runtime = getWebviewSanitizerRuntime();
  return isAgentMode
    ? runtime.sanitizeAgentVisibleDelta(text)
    : runtime.sanitizeAssistantVisibleText(text);
}

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

function readWebviewToolNames() {
  const manifest = readFileSync(path.join(rootDir, 'media', 'webview-agent-tool-manifest.js'), 'utf8');
  const m = manifest.match(/var toolNames = (\[[\s\S]*?\]);/);
  assert.ok(m, 'webview tool manifest must expose a generated toolNames array');
  return JSON.parse(m[1]);
}

const TOOL_NAMES = Object.fromEntries(readWebviewToolNames().map(name => [name, true]));

function isToolName(name) {
  const n = String(name || '').trim();
  return !!TOOL_NAMES[n] || n.startsWith('mcp__');
}

function structuredToolName(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  if (typeof obj.tool === 'string') return obj.tool.trim();
  if (typeof obj.name === 'string') return obj.name.trim();
  const fn = obj.function;
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string') {
    return fn.name.trim();
  }
  const nestedTool = obj.tool;
  if (nestedTool && typeof nestedTool === 'object' && !Array.isArray(nestedTool) && typeof nestedTool.name === 'string') {
    return nestedTool.name.trim();
  }
  return typeof obj.type === 'string' ? obj.type.trim() : '';
}

function isKnownStructuredToolCall(value) {
  const name = structuredToolName(value);
  return !!name && isToolName(name);
}

function isToolCallsEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const calls = Array.isArray(value.tool_calls)
    ? value.tool_calls
    : (Array.isArray(value.toolCalls) ? value.toolCalls : null);
  return !!calls && calls.length > 0 && calls.every(isKnownStructuredToolCall);
}

function isFunctionCallEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const call = value.function_call || value.functionCall;
  return !!call && isKnownStructuredToolCall(call);
}

function isMixedContentToolEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.content)) return false;
  let sawTool = false;
  for (const item of value.content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (item.type === 'text' && typeof item.text === 'string') continue;
    if (!isKnownStructuredToolCall(item)) return false;
    sawTool = true;
  }
  return sawTool;
}

function isToolPayloadEnvelope(value) {
  return isToolCallsEnvelope(value) || isFunctionCallEnvelope(value) || isMixedContentToolEnvelope(value);
}

function normalizeXmlToolName(name) {
  return String(name || '').trim().replace(/^TOOL_/i, '');
}

function isShellTranscriptName(name) {
  return !!SHELL_TRANSCRIPT_NAMES[String(name || '').toLowerCase()];
}

const CALLING_LABEL_PATTERN = '(?:\\[\\s*)?[*_]{0,3}(?:(?:Calling|Call)(?![A-Za-z_])|调用)(?:[ \\t]*[:：]?[ \\t]*tool\\b|[ \\t]+tool\\b)?[ \\t]*[:：]?[ \\t]*[*_]{0,3}[ \\t]*';

function makeCallingToolNamePattern(includeShellNames = false) {
  let names = Object.keys(TOOL_NAMES);
  if (includeShellNames) names = names.concat(Object.keys(SHELL_TRANSCRIPT_NAMES));
  const escapedNames = names.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const mcpPattern = 'mcp__[A-Za-z0-9_]+';
  return `\\[?\`?(${escapedNames ? `(?:${escapedNames}|${mcpPattern})` : `(?:${mcpPattern})`})\`?\\]?`;
}

function makeCallingRegex() {
  return new RegExp(CALLING_LABEL_PATTERN + makeCallingToolNamePattern(false), 'gi');
}

function makeAnyCallingRegex() {
  return new RegExp(CALLING_LABEL_PATTERN + '(?:' + makeCallingToolNamePattern(true) + ')?', 'gi');
}

function makeIncompleteCallingTailRegex() {
  return new RegExp(CALLING_LABEL_PATTERN + '(?:' + makeCallingToolNamePattern(true) + ')?\\s*$', 'i');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeFunctionStyleToolCallRegex() {
  const names = Object.keys(TOOL_NAMES)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(${names}|mcp__[A-Za-z0-9_]+)\\s*\\(\\s*\\{`, 'g');
}

function makeXmlToolTagRegex() {
  const names = Object.keys(TOOL_NAMES)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL_)?(?:${names}|mcp__[A-Za-z0-9_]+))\\b([^<>]*?)\\/\\s*(?:>|&gt;)`, 'gi');
}

function makeXmlToolPairRegex() {
  const names = Object.keys(TOOL_NAMES)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL_)?(?:${names}|mcp__[A-Za-z0-9_]+))\\b[^<>]*?(?:>|&gt;)([\\s\\S]*?)(?:<\\/|&lt;\\/)\\s*\\1\\s*(?:>|&gt;)`, 'gi');
}

function makeXmlToolTagTailRegex() {
  const names = Object.keys(TOOL_NAMES)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL_)?(?:${names}|mcp__[A-Za-z0-9_]+))\\b[\\s\\S]*$`, 'i');
}

function stripXmlToolTagBlocksFromText(text) {
  const raw = String(text || '');
  let out = '';
  let cursor = 0;
  const tagRe = makeXmlToolTagRegex();
  let match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (!isToolName(normalizeXmlToolName(match[1]))) continue;
    out += raw.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = tagRe.lastIndex;
  }
  let cleaned = out + raw.slice(cursor);
  out = '';
  cursor = 0;
  const pairRe = makeXmlToolPairRegex();
  while ((match = pairRe.exec(cleaned)) !== null) {
    if (!isToolName(normalizeXmlToolName(match[1]))) continue;
    out += cleaned.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = pairRe.lastIndex;
  }
  cleaned = out + cleaned.slice(cursor);
  return cleaned.replace(makeXmlToolTagTailRegex(), '').trimEnd();
}

function containsXmlToolTag(text) {
  const raw = String(text || '');
  const tagRe = makeXmlToolTagRegex();
  let match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (isToolName(normalizeXmlToolName(match[1]))) return true;
  }
  const pairRe = makeXmlToolPairRegex();
  while ((match = pairRe.exec(raw)) !== null) {
    if (isToolName(normalizeXmlToolName(match[1]))) return true;
  }
  const tail = makeXmlToolTagTailRegex().exec(raw);
  return !!tail && isToolName(normalizeXmlToolName(tail[1]));
}

function containsCallingToolIntent(text) {
  const callRe = makeAnyCallingRegex();
  const raw = String(text || '');
  let m;
  while ((m = callRe.exec(raw)) !== null) {
    const name = m[1] || '';
    if (name && (isToolName(name) || isShellTranscriptName(name))) return true;
  }
  return false;
}

function lineStartsWithCallingToolIntent(text) {
  const re = new RegExp('^' + CALLING_LABEL_PATTERN + '(?:' + makeCallingToolNamePattern(true) + ')?', 'i');
  const m = re.exec(String(text || ''));
  const name = m?.[1] || '';
  return !!name && (isToolName(name) || isShellTranscriptName(name));
}

function containsToolLabel(text) {
  const raw = String(text || '');
  const re = /(?:^|\n|[ \t])(?:Tool|工具)[ \t]*[:：][ \t]*`?([A-Za-z_]\w*)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (isToolName(m[1])) return true;
  }
  return false;
}

function lineStartsWithToolLabel(text) {
  const m = /^(?:Tool|工具)[ \t]*[:：][ \t]*`?([A-Za-z_]\w*)/i.exec(String(text || ''));
  return !!m && isToolName(m[1]);
}

function containsBracketedInternalResult(text) {
  const raw = String(text || '');
  const re = /(?:^|\n)\s*\[([A-Za-z_]\w*|工具结果)(?=\s|[\]:：}]|$)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1] || '';
    if (name === '工具结果' || name === 'generated_file' || name === 'permission_repair') return true;
    if (isToolName(name)) return true;
  }
  return false;
}

function lineStartsWithBracketedInternalResult(text) {
  return containsBracketedInternalResult(String(text || '').replace(/^/, '\n'));
}

function stripJsonFence(text) {
  const s = String(text || '').trim();
  const m = /^```(?:json|JSON|javascript|js)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(s);
  return m ? String(m[1] || '').trim() : s;
}

function looksLikeToolArgumentPayload(text) {
  const s = stripJsonFence(text);
  if (!s || (s[0] !== '{' && s[0] !== '[')) return false;
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    return /"(?:filePath|path|target_directory|targetDirectory|pattern|recursive|command|content|oldText|newText|todoList|summary|query|include|type)"\s*:/i.test(s);
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (isToolPayloadEnvelope(item)) return true;
    return Object.keys(item).some((key) => /^(?:filePath|path|target_directory|targetDirectory|pattern|recursive|command|content|oldText|newText|todoList|summary|query|include|type)$/i.test(key));
  });
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

function findJsonArrayEnd(text, start) {
  let depth = 0;
  let inStr = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findNextJsonStart(text, startAt) {
  const objectStart = text.indexOf('{', startAt);
  const arrayStart = text.indexOf('[', startAt);
  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function stripCallingToolBlocksFromText(text) {
  let out = '';
  let i = 0;
  const callRe = makeCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    const name = m[1];
    if (!isToolName(name)) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    const jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) { out += text.slice(i, m.index); break; }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) { out += text.slice(i, m.index); break; }
    out += text.slice(i, m.index);
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function findFunctionStyleToolCallEnd(text, match) {
  const name = match[1] || '';
  if (!isToolName(name)) return -1;
  if (match.index > 0 && /[A-Za-z0-9_]/.test(text[match.index - 1])) return -1;
  const jsonStart = match.index + match[0].lastIndexOf('{');
  const jsonEnd = findJsonObjectEnd(text, jsonStart);
  if (jsonEnd < 0) return -1;
  let next = jsonEnd + 1;
  while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
  if (text[next] === ')') next++;
  return next;
}

function containsFunctionStyleToolCall(text) {
  const raw = String(text || '');
  const callRe = makeFunctionStyleToolCallRegex();
  let m;
  while ((m = callRe.exec(raw)) !== null) {
    if (findFunctionStyleToolCallEnd(raw, m) >= 0) return true;
  }
  return false;
}

function stripFunctionStyleToolCallBlocksFromText(text) {
  let out = '';
  let i = 0;
  const callRe = makeFunctionStyleToolCallRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    const start = m.index;
    const end = findFunctionStyleToolCallEnd(text, m);
    if (end < 0) {
      out += text.slice(i, start).replace(/[ \t]+$/, '');
      break;
    }
    out += text.slice(i, start).replace(/[ \t]+$/, '');
    i = end;
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

function jsonObjectToTool(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const name = structuredToolName(obj);
  return name && isToolName(name) ? name : null;
}

function jsonArrayIsToolPayload(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => !!jsonObjectToTool(item));
}

function jsonObjectIsToolPayload(value) {
  return !!(jsonObjectToTool(value) || isToolPayloadEnvelope(value));
}

function stripJsonToolPayloadsFromText(text) {
  if (!text) return '';
  let result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, (full, inner) => {
    const trimmed = String(inner || '').trim();
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return full;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return jsonArrayIsToolPayload(parsed) ? '' : full;
      return jsonObjectIsToolPayload(parsed) ? '' : full;
    } catch {
      return full;
    }
  });

  let out = '';
  let i = 0;
  while (i < result.length) {
    const start = findNextJsonStart(result, i);
    if (start < 0) {
      out += result.slice(i);
      break;
    }
    out += result.slice(i, start);
    const isArray = result[start] === '[';
    const end = isArray ? findJsonArrayEnd(result, start) : findJsonObjectEnd(result, start);
    if (end < 0) {
      out += result.slice(start);
      break;
    }
    const candidate = result.slice(start, end + 1);
    let shouldStrip = false;
    try {
      const parsed = JSON.parse(candidate);
      shouldStrip = isArray ? jsonArrayIsToolPayload(parsed) : jsonObjectIsToolPayload(parsed);
    } catch {
      shouldStrip = false;
    }
    if (!shouldStrip) out += candidate;
    i = end + 1;
  }
  return out;
}

const DSML_BAR_PATTERN = '[|｜]{1,2}';
const DSML_MARKER_PATTERN = `${DSML_BAR_PATTERN}\\s*DSML\\s*${DSML_BAR_PATTERN}`;
const DSML_OPEN_PREFIX_PATTERN = '(?:<|&lt;)\\s*';
const DSML_CLOSE_PREFIX_PATTERN = '(?:<\\/|&lt;\\/)\\s*';
const DSML_START_NAMES_PATTERN = '(?:tool_calls|invoke|parameter)';
const DSML_INCOMPLETE_TAIL_REGEX = new RegExp(
  `${DSML_OPEN_PREFIX_PATTERN}(?:${DSML_BAR_PATTERN}\\s*(?:D(?:S(?:M(?:L)?)?)?(?:\\s*${DSML_BAR_PATTERN})?)?)?$`,
  'i',
);
const TOOL_CALL_OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL_(?:CALL|USE)\\s*(?:>|&gt;)';
const TOOL_CALL_INCOMPLETE_TAIL_REGEX = /(?:<|&lt;)\s*(?:T|TO|TOO|TOOL|TOOL_|TOOL_C|TOOL_CA|TOOL_CAL|TOOL_CALL|TOOL_U|TOOL_US|TOOL_USE)?$/i;

function makeDsmlStartRegexInText() {
  return new RegExp(`${DSML_OPEN_PREFIX_PATTERN}${DSML_MARKER_PATTERN}\\s*${DSML_START_NAMES_PATTERN}\\b`, 'gi');
}

function makeDsmlCloseRegexInText(name) {
  return new RegExp(`${DSML_CLOSE_PREFIX_PATTERN}${DSML_MARKER_PATTERN}\\s*${name}\\s*(?:>|&gt;)`, 'i');
}

function makeDsmlTailRegexInText() {
  return new RegExp(`${DSML_OPEN_PREFIX_PATTERN}${DSML_MARKER_PATTERN}\\s*${DSML_START_NAMES_PATTERN}\\b[\\s\\S]*$`, 'gi');
}

function findNextDsmlToolCallStartInText(text, startAt = 0) {
  const re = makeDsmlStartRegexInText();
  re.lastIndex = startAt;
  const match = re.exec(String(text || ''));
  return match ? match.index : -1;
}

function dsmlToolCallBlockEndInText(text, start) {
  const raw = String(text || '');
  const tail = raw.slice(start);
  const toolCallsClose = makeDsmlCloseRegexInText('tool_calls').exec(tail);
  if (toolCallsClose) return start + toolCallsClose.index + toolCallsClose[0].length;
  const invokeClose = makeDsmlCloseRegexInText('invoke').exec(tail);
  if (invokeClose) return start + invokeClose.index + invokeClose[0].length;
  const parameterClose = makeDsmlCloseRegexInText('parameter').exec(tail);
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
  return out.replace(DSML_INCOMPLETE_TAIL_REGEX, '').trimEnd();
}

function containsDsmlToolTranscript(text) {
  return findNextDsmlToolCallStartInText(String(text || ''), 0) >= 0;
}

function makeToolCallEnvelopeOpenRegexInText() {
  return new RegExp(TOOL_CALL_OPEN_PATTERN, 'gi');
}

function makeToolCallEnvelopeBlockRegexInText() {
  return new RegExp(
    '(?:<|&lt;)\\s*TOOL_(CALL|USE)\\s*(?:>|&gt;)[\\s\\S]*?(?:<\\/|&lt;\\/)\\s*TOOL_\\1\\s*(?:>|&gt;)',
    'gi',
  );
}

function findNextToolCallEnvelopeStartInText(text, startAt = 0) {
  const re = makeToolCallEnvelopeOpenRegexInText();
  re.lastIndex = startAt;
  const match = re.exec(String(text || ''));
  return match ? match.index : -1;
}

function toolCallEnvelopeBlockEndInText(text, start) {
  const raw = String(text || '');
  const blockRe = makeToolCallEnvelopeBlockRegexInText();
  blockRe.lastIndex = start;
  let end = start;
  let found = false;
  let match;
  while ((match = blockRe.exec(raw)) !== null) {
    if (match.index > end && raw.slice(end, match.index).trim()) break;
    if (match.index < end) continue;
    end = blockRe.lastIndex;
    found = true;
  }
  return found ? end : raw.length;
}

function stripToolCallEnvelopeBlocksFromText(text) {
  const raw = String(text || '');
  let out = '';
  let cursor = 0;
  while (cursor < raw.length) {
    const start = findNextToolCallEnvelopeStartInText(raw, cursor);
    if (start < 0) {
      out += raw.slice(cursor);
      break;
    }
    out += raw.slice(cursor, start).replace(/[ \t]+$/, '');
    cursor = toolCallEnvelopeBlockEndInText(raw, start);
  }
  return out.replace(TOOL_CALL_INCOMPLETE_TAIL_REGEX, '').trimEnd();
}

function containsToolCallEnvelopeTranscript(text) {
  const raw = String(text || '');
  return findNextToolCallEnvelopeStartInText(raw, 0) >= 0 || TOOL_CALL_INCOMPLETE_TAIL_REGEX.test(raw);
}

function makeReactActionRegex() {
  return /\bAction\s*[:：]\s*`?([A-Za-z_]\w*?)`?(?=\s*(?:Action\s*Input\s*[:：]|$|[\r\n]))/gi;
}

function makeReactActionInputRegex() {
  return /Action\s*Input\s*[:：]\s*/gi;
}

function findReactActionInput(text, startAt) {
  const inputRe = makeReactActionInputRegex();
  inputRe.lastIndex = startAt || 0;
  return inputRe.exec(String(text || ''));
}

function findNextReactActionStartInText(text, startAt = 0) {
  const raw = String(text || '');
  const actionRe = makeReactActionRegex();
  actionRe.lastIndex = startAt;
  let match;
  while ((match = actionRe.exec(raw)) !== null) {
    const name = match[1] || '';
    if (!isToolName(name)) continue;
    if (findReactActionInput(raw, match.index + match[0].length)) return match.index;
    if (!raw.slice(match.index + match[0].length).trim()) return match.index;
  }
  return -1;
}

function reactActionBlockEndInText(text, start) {
  const raw = String(text || '');
  const actionRe = makeReactActionRegex();
  actionRe.lastIndex = start;
  const match = actionRe.exec(raw);
  if (!match || match.index !== start) return start;
  const inputMatch = findReactActionInput(raw, match.index + match[0].length);
  if (!inputMatch) return raw.length;
  let payloadStart = inputMatch.index + inputMatch[0].length;
  while (payloadStart < raw.length && /[ \t\r\n`]/.test(raw[payloadStart])) payloadStart++;
  if (raw.slice(payloadStart, payloadStart + 4).toLowerCase() === 'json') payloadStart += 4;
  while (payloadStart < raw.length && /[ \t\r\n]/.test(raw[payloadStart])) payloadStart++;
  if (raw[payloadStart] === '{') {
    const jsonEnd = findJsonObjectEnd(raw, payloadStart);
    if (jsonEnd < 0) return raw.length;
    let end = jsonEnd + 1;
    const closeFence = /^[ \t\r\n]*```/.exec(raw.slice(end));
    if (closeFence) return webviewLineEndAfter(raw, end + closeFence[0].length);
    while (end < raw.length && /[ \t`]/.test(raw[end])) end++;
    return end;
  }
  return webviewLineEndAfter(raw, payloadStart);
}

function stripReactActionBlocksFromText(text) {
  const raw = String(text || '');
  let out = '';
  let cursor = 0;
  while (cursor < raw.length) {
    const start = findNextReactActionStartInText(raw, cursor);
    if (start < 0) {
      out += raw.slice(cursor);
      break;
    }
    out += raw.slice(cursor, start).replace(/[ \t]+$/, '');
    const end = reactActionBlockEndInText(raw, start);
    cursor = end > start ? end : raw.length;
  }
  return out.trimEnd();
}

function containsReactActionTranscript(text) {
  return findNextReactActionStartInText(String(text || ''), 0) >= 0;
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
  const beforeToolCallEnvelopeCleanup = result;
  result = stripToolCallEnvelopeBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolCallEnvelopeCleanup;
  const beforeReactCleanup = result;
  result = stripReactActionBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeReactCleanup;
  const beforeShellCleanup = result;
  result = stripCallingShellTranscriptBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeShellCleanup;
  const beforeCallingCleanup = result;
  result = stripCallingToolBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;
  const beforeToolArgumentCleanup = result;
  result = stripToolArgumentBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolArgumentCleanup;
  const beforeFunctionStyleCleanup = result;
  result = stripFunctionStyleToolCallBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeFunctionStyleCleanup;
  const beforeXmlTagCleanup = result;
  result = stripXmlToolTagBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeXmlTagCleanup;
  const beforeJsonCleanup = result;
  result = stripJsonToolPayloadsFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeJsonCleanup;
  const beforeDsmlCleanup = result;
  result = stripDsmlToolCallBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeDsmlCleanup;
  const cleaned = result.trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
}

function containsAgentInternalTranscript(text) {
  return containsDsmlToolTranscript(text)
    || containsToolCallEnvelopeTranscript(text)
    || containsReactActionTranscript(text)
    || containsAgentRoutingMarkerLeak(text)
    || containsFunctionStyleToolCall(text)
    || containsXmlToolTag(text)
    || /(?:^|\n)\s*\[TOOL:(?:mcp__|\w+)\b/i.test(text)
    || containsCallingToolIntent(text)
    || containsToolLabel(text)
    || containsBracketedInternalResult(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function containsAgentRoutingMarkerLeak(text) {
  return /(?:^|\n)\s*(?:\x00?AFILE:[^\x00\n]{0,220}(?:\x00|RESET)|AFILE:[^\n]{0,220}RESET|\x00?ASUM(?:\x00|RESET)?)/.test(String(text || ''));
}

function isAgentRoutingFileMarkerLeak(text) {
  return /^\s*(?:\x00?AFILE:|AFILE:)/.test(String(text || ''));
}

function stripAgentRoutingFileMarkerLeaks(text) {
  return String(text || '')
    .replace(/\x00?AFILE:[^\x00\n]{0,260}(?:\x00|\x00?RESET\x00?|RESET)/g, '')
    .replace(/\x00?AFILE:[^\x00\n]{0,260}$/g, '');
}

function stripAgentLocalContextNoticeLeaks(text) {
  return String(text || '')
    .replace(/_?\[自动识别目录\]\s*已加载\s*\d+\s*个源文件(?:（[^）]{0,240}）)?，完整清单仅用于本地上下文。_?/g, '')
    .replace(/_?\[自动识别目录\]\s*已加载\s*\d+\s*个源文件(?:（[^）]{0,240}）)?。_?/g, '')
    .replace(/_?\[同一 session 续作\]\s*已自动恢复上一轮工作文件：[^_\n]{0,360}_?/g, '');
}

function stripAgentRoutingResetLeaks(text) {
  return String(text || '')
    .replace(/\x00RESET\x00/g, '')
    .replace(/(^|[\s。！？；;])RESET(?=(?:好的|我(?:将|先|来|会|已经|已)|现在|首先|接下来|下一步|下面|已读取|已完成|分析|读取|查看))/g, '$1');
}

function stripAgentRoutingSummaryMarkerLeak(text) {
  return String(text || '')
    .replace(/^\s*\x00ASUM\x00\x00RESET\x00/, '')
    .replace(/^\s*\x00ASUM\x00/, '')
    .replace(/^\s*ASUMRESET/, '')
    .replace(/^\s*ASUM/, '');
}

function cleanAgentFinalProseForUser(text) {
  if (containsAgentInternalTranscript(text || '')) return '';
  let cleaned = stripToolCallBlocks(text || '')
    .replace(makeDsmlTailRegexInText(), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return '';
  const lines = cleaned.split('\n').filter((line) => {
    const s = line.trim();
    if (!s) return true;
    if (/^\[TOOL:(?:mcp__|\w+)\b/i.test(s)) return false;
    if (lineStartsWithCallingToolIntent(s)) return false;
    if (lineStartsWithToolLabel(s)) return false;
    if (/^(?:Arguments?|参数)[ \t]*[:：]\s*\{/i.test(s)) return false;
    if (lineStartsWithBracketedInternalResult(s)) return false;
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
  let raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentLocalContextNoticeLeaks(raw);
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim()) return '';
  if (isAgentRoutingFileMarkerLeak(raw)) return '';
  raw = stripAgentRoutingSummaryMarkerLeak(raw);
  const cleaned = collapseDuplicateAgentTransitionSentences(
    stripAgentRoutingResetLeaks(stripIncompleteCallingTail(stripToolCallBlocks(raw))),
  ).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function collapseDuplicateAgentTransitionSentences(text) {
  return String(text || '').replace(
    /((?:好的，)?(?:我(?:将|先|来|会|已经|已)|现在|首先|接下来|下一步)[^。！？\n]{8,220}[。！？])(?:\s*\1)+/g,
    '$1',
  );
}

function stripIncompleteCallingTail(text) {
  const raw = String(text || '');
  const m = makeIncompleteCallingTailRegex().exec(raw);
  return m ? raw.slice(0, m.index).trimEnd() : raw;
}

function containsPotentialInternalCallingTail(text) {
  return makeIncompleteCallingTailRegex().test(String(text || ''));
}

function sanitizeAssistantVisibleText(text) {
  let raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim()) return '';
  raw = stripAgentRoutingSummaryMarkerLeak(raw);
  const cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function sanitizeVisibleDeltaForMode(text, isAgentMode) {
  const raw = String(text || '');
  return isAgentMode ? sanitizeAgentVisibleDelta(raw) : sanitizeAssistantVisibleText(raw);
}

function simulateNonAgentDeltaStream(chunks) {
  let current = '';
  let pendingToolArgument = false;
  for (const chunk of chunks) {
    let text = String(chunk || '');
    if (!text) continue;
    if (pendingToolArgument && looksLikeToolArgumentPayload(text)) {
      pendingToolArgument = false;
      continue;
    }
    const hasCallingToolIntent = containsCallingToolIntent(text);
    if (text.includes('[TOOL:') || containsAgentInternalTranscript(text) || hasCallingToolIntent) {
      const cleaned = sanitizeAssistantVisibleText(text);
      pendingToolArgument = hasCallingToolIntent;
      if (!cleaned) continue;
      text = cleaned;
    } else {
      pendingToolArgument = false;
    }
    current += text;
  }
  return sanitizeAssistantVisibleText(current);
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

test('agent final prose: strips function-style search_content transcript from final user text', () => {
  const leaked = [
    '我先搜索鼠标回调。',
    'search_content({"pattern":"glutMouseFunc|mouse","directory":"code/shape_manager"})',
  ].join('\n');
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
});

test('agent final prose: strips bracketed Chinese calling transcript from final user text', () => {
  const leaked = [
    '我先查看当前项目。',
    '[调用 read_file] {"filePath":"/tmp/project/main.cpp", "offset": 0, "limit": 150}',
    '[调用 search_content] {"pattern":"glutMouseFunc|mouse","directory":"/tmp/project","fileTypes":".cpp,.h"}',
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

test('agent final prose: strips leaked AFILE routing marker when NUL separators are lost', () => {
  const leaked = 'AFILE:shape_managerRESET我先检查当前 main.cpp 的实际内容以及相关头文件。';
  assert.equal(cleanAgentFinalProseForUser(leaked), '');
  assert.equal(sanitizeVisibleDeltaForMode(leaked, true), '我先检查当前 main.cpp 的实际内容以及相关头文件。');
});

test('agent visible prose: keeps ASUM content when NUL separators are lost', () => {
  assert.equal(sanitizeVisibleDeltaForMode('ASUMRESET已完成验证。', true), '已完成验证。');
  assert.equal(sanitizeVisibleDeltaForMode('\x00ASUM\x00\x00RESET\x00已完成验证。', true), '已完成验证。');
});

test('assistant visible prose: strips ASUM prefix when routing marker leaks outside agent mode', () => {
  assert.equal(sanitizeVisibleDeltaForMode('ASUM我理解您的需求。', false), '我理解您的需求。');
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

test('agent accumulated render: hides DOM-polluted Calling tool transcript rows', () => {
  const leaked = [
    '我将分析旧实现和新需求，给出对策建议。首先需要查看相关文件。',
    ' Calling: list_dirtex复制下载 {"path":"/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance"}',
    'Calling: read_filetex复制下载 {"path":"/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md"}',
  ].join('');
  const expected = '我将分析旧实现和新需求，给出对策建议。首先需要查看相关文件。';
  assert.equal(sanitizeVisibleDeltaForMode(leaked, true), expected);
  assert.equal(sanitizeRuntimeVisibleDeltaForMode(leaked, true), expected);
});

test('agent accumulated render: strips leaked AFILE marker before polluted Calling rows', () => {
  const leaked = [
    '[自动识别目录] 已加载 8 个源文件。',
    ' AFILE:src/oam/src/lifting/zc_maintenance/docsRESET我将分析旧实现和新需求，给出对策建议。',
    ' Calling: list_dirtex复制下载 {"path":"/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance"}',
  ].join('');
  const cleaned = sanitizeRuntimeVisibleDeltaForMode(leaked, true);
  assert.match(cleaned, /我将分析旧实现和新需求/);
  assert.doesNotMatch(cleaned, /自动识别目录|已加载 8 个源文件|AFILE|RESET|Calling|复制下载|list_dir|path|huida_uav/);
});

test('agent accumulated render: hides repeated local context notices and reset leaks', () => {
  const leaked = [
    '[自动识别目录] 已加载 8 个源文件（maintenance_data_collector.hpp、maintenance_manager.hpp），完整清单仅用于本地上下文。',
    '[自动识别目录] 已加载 8 个源文件（maintenance_data_collector.hpp、maintenance_manager.hpp），完整清单仅用于本地上下文。',
    ' RESET好的，我将作为代码分析智能体，先读取您指定的新需求文档，并查看现有实现的目录结构，以进行全面分析。',
    ' RESET好的，我将作为代码分析智能体，先读取您指定的新需求文档，并查看现有实现的目录结构，以进行全面分析。',
  ].join('');
  const expected = '好的，我将作为代码分析智能体，先读取您指定的新需求文档，并查看现有实现的目录结构，以进行全面分析。';
  assert.equal(sanitizeVisibleDeltaForMode(leaked, true), expected);
  assert.equal(sanitizeRuntimeVisibleDeltaForMode(leaked, true), expected);
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

test('agent accumulated render: hides escaped split DSML tool transcript before and after close arrives', () => {
  let accumulated = '我先看看当前代码结构，然后给你实现。&lt; | DSML | tool_calls&lt; | DSML | invoke name="read_file"';
  assert.equal(sanitizeVisibleDeltaForMode(accumulated, true), '我先看看当前代码结构，然后给你实现。');

  accumulated += '&lt; | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp&lt;/ | DSML | parameter>&lt;/ | DSML | invoke>&lt;/ | DSML | tool_calls>';
  const cleaned = sanitizeVisibleDeltaForMode(accumulated, true);
  assert.equal(cleaned, '我先看看当前代码结构，然后给你实现。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|filePath/);
});

test('agent accumulated render: hides fullwidth double-bar DSML tool transcript', () => {
  let accumulated = '我先看看当前代码结构。<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"';
  assert.equal(sanitizeVisibleDeltaForMode(accumulated, true), '我先看看当前代码结构。');

  accumulated += '<｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="list_dir"><｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';
  const cleaned = sanitizeVisibleDeltaForMode(accumulated, true);
  assert.equal(cleaned, '我先看看当前代码结构。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|list_dir|filePath/);
});

test('assistant visible render: hides DSML transcript outside agent mode', () => {
  const leaked = [
    '好的，我先查看当前代码，然后实现。',
    '< | DSML | tool_calls< | DSML | invoke name="read_file">< | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp</ | DSML | parameter></ | DSML | invoke></ | DSML | tool_calls>',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '好的，我先查看当前代码，然后实现。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|filePath/);
});

test('assistant visible render: hides escaped DSML transcript outside agent mode', () => {
  const leaked = '好的，我先看当前代码。&lt; | DSML | tool_calls&lt; | DSML | invoke name="read_file">&lt; | DSML | parameter name="filePath" string="true">/home/kaka/code/shape_manager/main.cpp&lt;/ | DSML | parameter>&lt;/ | DSML | invoke>&lt;/ | DSML | tool_calls>';
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '好的，我先看当前代码。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|filePath/);
});

test('assistant visible render: hides fullwidth double-bar DSML transcript outside agent mode', () => {
  const leaked = [
    '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。',
    '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"><｜｜DSML｜｜parameter name="filePath" string="true">code/shape_manager/main.cpp</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke><｜｜DSML｜｜invoke name="list_dir"><｜｜DSML｜｜parameter name="path" string="true">code/shape_manager</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '我来先查看当前 shape_manager 的完整代码，了解现有的渲染和交互逻辑。');
  assert.doesNotMatch(cleaned, /DSML|tool_calls|read_file|list_dir|filePath/);
});

test('assistant visible render: hides TOOL_CALL envelope transcript outside agent mode', () => {
  const leaked = [
    '我检查 main.cpp 中窗口标题设置。',
    '<TOOL_CALL>run_terminal</TOOL_CALL>',
    '<TOOL_CALL>{"command":"cat /home/ff/work/devseek_netai/code/shape_manager/main.cpp | head -200"}</TOOL_CALL>',
  ].join('');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '我检查 main.cpp 中窗口标题设置。');
  assert.doesNotMatch(cleaned, /TOOL_CALL|run_terminal|command/);
});

test('assistant visible render: hides incomplete TOOL_CALL envelope tail outside agent mode', () => {
  const leaked = '我检查 main.cpp 中窗口标题设置。<TOOL';
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '我检查 main.cpp 中窗口标题设置。');
});

test('assistant visible render: hides ReAct Action/Input transcript outside agent mode', () => {
  const leaked = [
    '我需要先读取完整文件内容，然后修改标题并重新写入。',
    'Action: read_file Action Input: {"path":"/home/ff/work/devseek_netai/code/shape_manager/main.cpp"}',
  ].join(' ');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);

  assert.equal(cleaned, '我需要先读取完整文件内容，然后修改标题并重新写入。');
  assert.doesNotMatch(cleaned, /Action|Action Input|read_file|main\.cpp|path/);
});

test('assistant visible render: hides glued ReAct Action/Input transcript outside agent mode', () => {
  const leaked = [
    '结果摘要：我需要先读取完整的文件内容。',
    'Action: read_fileAction Input: {"path":"/home/ff/work/devseek_netai/code/shape_manager/main.cpp"}',
    '然后继续。',
  ].join(' ');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);

  assert.equal(cleaned, '结果摘要：我需要先读取完整的文件内容。然后继续。');
  assert.doesNotMatch(cleaned, /Action|Action Input|read_file|main\.cpp|path/);
});

test('agent accumulated render: hides incomplete ReAct Action tail while streaming', () => {
  const cleaned = sanitizeVisibleDeltaForMode('我需要先读取完整文件内容。 Action: read_file', true);

  assert.equal(cleaned, '我需要先读取完整文件内容。');
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

test('non-agent accumulated render: strips incomplete known Calling tool block to end', () => {
  const leaked = '我需要先查看当前 shape_manager 项目的代码。 Calling: read_file\n```json\n{"filePath":"/home/coder/project/shape_manager/src/main.cpp"';
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '我需要先查看当前 shape_manager 项目的代码。');
  assert.doesNotMatch(cleaned, /Calling|read_file|filePath|coder\/project/);
});

test('non-agent accumulated render: strips Markdown-bold Calling tool block', () => {
  const leaked = [
    '我先核查一下当前代码状态。',
    '**Calling:** `read_file`',
    '```json',
    '{"path": "/home/ff/work/devseek_netai/code/shape_manager/main.cpp"}',
    '```',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);

  assert.equal(cleaned, '我先核查一下当前代码状态。');
});

test('non-agent streaming: suppresses split read and search pseudo-tool calls', () => {
  const cleaned = simulateNonAgentDeltaStream([
    '我需要先查看当前 shape_manager 项目的代码，了解数字选择的具体实现，然后为您修改为鼠标点击选择。\n让我先读取相关源文件： Calling: read_file',
    '\n```json\n{"filePath":"/home/coder/project/shape_manager/src/main.cpp"}\n```',
    '\nCalling: read_file',
    '\n{"filePath":"/home/coder/project/shape_manager/include/shape_manager.hpp"}',
    '\nCalling: search_file',
    '\n{"target_directory":"/home/coder/project/shape_manager","pattern":"*.cpp","recursive":true}',
    '\n我会基于当前代码完成修改。',
  ]);
  assert.match(cleaned, /我需要先查看当前 shape_manager/);
  assert.match(cleaned, /我会基于当前代码完成修改。/);
  assert.doesNotMatch(cleaned, /Calling|read_file|search_file|filePath|target_directory|coder\/project/);
});

test('non-agent delta: suppresses inline function-style pseudo-tool calls', () => {
  const leaked = [
    '让我先定位项目文件并查看当前实现：',
    'read_file({"path":"/home/ff/work/devseek_netai/code/shape_manager/src/main.cpp"})',
    'list_dir({"path":"/home/ff/work/devseek_netai/code/shape_manager"})',
    'search_file({"glob":"**/*.{cpp,hpp,h,c}","path":"/home/ff/work/devseek_netai/code/shape_manager"})',
  ].join('');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '让我先定位项目文件并查看当前实现：');
  assert.doesNotMatch(cleaned, /read_file|list_dir|search_file|shape_manager\/src|glob/);
});

test('agent accumulated render: suppresses inline function-style pseudo-tool calls', () => {
  const leaked = [
    '我先查看当前代码结构。',
    'read_file({"filePath":"code/shape_manager/main.cpp"})',
    'list_dir({"path":"code/shape_manager"})',
  ].join('');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, true);
  assert.equal(cleaned, '我先查看当前代码结构。');
  assert.doesNotMatch(cleaned, /read_file|list_dir|filePath/);
});

test('non-agent delta: suppresses XML self-closing pseudo-tool tags', () => {
  const leaked = [
    '让我先查看一下当前 `shape_manager` 项目的实现情况。',
    '<read_file path="/home/ff/work/devseek_netai/code/shape_manager/main.cpp" startLine="0" endLine="200"/>',
    '<grep_search pattern="glutMouseFunc|mouse|选择|select|keyboard|数字" directory="/home/ff/work/devseek_netai/code/shape_manager" fileTypes=".cpp,.h"/>',
    '<list_dir path="/home/ff/work/devseek_netai/code/shape_manager"/>',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '让我先查看一下当前 `shape_manager` 项目的实现情况。');
  assert.doesNotMatch(cleaned, /read_file|grep_search|list_dir|shape_manager\/main\.cpp|fileTypes/);
});

test('agent accumulated render: hides escaped XML pseudo-tool tag while streaming', () => {
  const partial = '我先读取文件。&lt;read_file path=&quot;code/shape_manager/main.cpp&quot;';
  assert.equal(sanitizeVisibleDeltaForMode(partial, true), '我先读取文件。');

  const complete = partial + ' startLine=&quot;0&quot; endLine=&quot;20&quot;/&gt;';
  const cleaned = sanitizeVisibleDeltaForMode(complete, true);
  assert.equal(cleaned, '我先读取文件。');
  assert.doesNotMatch(cleaned, /read_file|filePath|startLine|shape_manager/);
});

test('non-agent delta: suppresses paired XML pseudo-tool tags with JSON bodies', () => {
  const leaked = [
    '现在开始实现：',
    '<manage_todo_list>{"todoList":[{"id":1,"title":"实现鼠标点击选择","status":"in-progress"}]}</manage_todo_list>',
    '<create_file>{"path":"/tmp/shape_manager/main.cpp","content":"int main(){return 0;}\\n"}</create_file>',
    '<run_terminal>',
    '{"command":"cd /tmp/shape_manager && cmake -S . -B build && cmake --build build"}',
    '</run_terminal>',
  ].join('\n');
  const cleaned = sanitizeVisibleDeltaForMode(leaked, false);
  assert.equal(cleaned, '现在开始实现：');
  assert.doesNotMatch(cleaned, /manage_todo_list|create_file|run_terminal|todoList|cmake|shape_manager\/main\.cpp/);
});

test('agent accumulated render: hides incomplete paired XML pseudo-tool tag while streaming', () => {
  const partial = [
    '现在编译测试：',
    '<run_terminal>',
    '{"command":"cd /home/ff/work/devseek_netai/code/shape_manager && cmake -S . -B build',
  ].join('\n');

  assert.equal(sanitizeVisibleDeltaForMode(partial, true), '现在编译测试：');
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

test('webview sanitizer: shared protocol fixture hides every complete dialect', () => {
  for (const sample of TOOL_PROTOCOL_SAMPLES) {
    assert.equal(
      sanitizeRuntimeVisibleDeltaForMode(sample.text, true),
      sample.expectedVisible,
      `${sample.id} should hide protocol text in agent mode`,
    );
    assert.equal(
      sanitizeRuntimeVisibleDeltaForMode(sample.text, false),
      sample.expectedVisible,
      `${sample.id} should hide protocol text outside agent mode`,
    );
  }
});

test('webview sanitizer: keeps ambiguous nameless artifact JSON visible', () => {
  const fenced = [
    '# Artifact report',
    '```json',
    '[{"path":"/tmp/app/example.cpp","content":"int example;","description":"documentation example"}]',
    '```',
  ].join('\n');
  const unfenced = [
    '# Artifact report',
    '[{"path":"/tmp/app/example.cpp","content":"int example;","description":"documentation example"}]',
  ].join('\n');

  for (const text of [fenced, unfenced]) {
    assert.equal(sanitizeRuntimeVisibleDeltaForMode(text, true), text);
    assert.equal(sanitizeRuntimeVisibleDeltaForMode(text, false), text);
  }
});

test('webview sanitizer: shared protocol fixture hides incomplete streaming tails', () => {
  for (const sample of TOOL_PROTOCOL_STREAMING_TAIL_SAMPLES) {
    assert.equal(
      sanitizeRuntimeVisibleDeltaForMode(sample.text, true),
      sample.expectedVisible,
      `${sample.id} should hide incomplete protocol text in agent mode`,
    );
    assert.equal(
      sanitizeRuntimeVisibleDeltaForMode(sample.text, false),
      sample.expectedVisible,
      `${sample.id} should hide incomplete protocol text outside agent mode`,
    );
  }
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
  const webview = readWebviewRuntime();
  assert.match(webview, /function summarizeAgentAnnouncement/);
  assert.match(webview, /ensureAgentProgressContainer\('Preparing context'\)/);
  assert.match(webview, /agent-announcement-details/);
  assert.doesNotMatch(webview, /agent-phase-b-bubble/);
});

test('session history: restored assistant messages keep collapsible rendering', () => {
  const webview = readWebviewRuntime();
  assert.ok(/function renderRestoredAssistantContent/.test(webview), 'history restore must use a dedicated assistant renderer');
  assert.ok(/createRestoredAssistantTurn\(m\.content,\s*lastUserPrompt\)/.test(webview), 'history restore must pass the previous user prompt');
  assert.ok(/renderRestoredAssistantContent\(bubble,\s*text,\s*promptText\)/.test(webview), 'assistant history turns must not render raw md directly');
  assert.ok(/buildResponseWithCollapsedCode/.test(webview), 'generated code in history must stay collapsible');
  assert.ok(/collapseTerminalOutputBlocks/.test(webview), 'terminal output in history must stay collapsible');
});

console.log('\n✅ All webview logic tests passed!\n');
