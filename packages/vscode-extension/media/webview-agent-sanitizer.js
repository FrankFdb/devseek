// Agent-visible text sanitization helpers for the DevSeek webview.
// Loaded before webview.js and intentionally kept DOM-free.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Strip [TOOL:name {...}] blocks from text before displaying in the prose bubble.
 * Uses brace-depth counting so nested JSON (e.g. manage_todo_list arrays) is
 * fully removed rather than leaving orphaned }] fragments.
 */
function extractTaskCompleteSummary(raw) {
  // Extract "summary" value from [TOOL:task_complete {"summary":"..."}]
  var m = raw.match(/\[TOOL:task_complete\s*\{[^}]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').trim();
}

function findJsonObjectEndInText(text, start) {
  var depth = 0;
  var inStr = false;
  for (var j = start; j < text.length; j++) {
    var ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return j;
      }
    }
  }
  return -1;
}

function findJsonArrayEndInText(text, start) {
  var depth = 0;
  var inStr = false;
  for (var j = start; j < text.length; j++) {
    var ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return j;
      }
    }
  }
  return -1;
}

function findNextWebviewJsonStart(text, startAt) {
  var objectStart = text.indexOf('{', startAt);
  var arrayStart = text.indexOf('[', startAt);
  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;
  return Math.min(objectStart, arrayStart);
}

var WEBVIEW_TOOL_NAMES = Object.create(null);
(function initWebviewToolNames() {
  var manifest = (typeof globalThis !== 'undefined' && globalThis.DevSeekAgentToolManifest)
    ? globalThis.DevSeekAgentToolManifest
    : null;
  var names = manifest && Array.isArray(manifest.toolNames) ? manifest.toolNames : [];
  for (var i = 0; i < names.length; i++) {
    WEBVIEW_TOOL_NAMES[String(names[i])] = true;
  }
})();

var WEBVIEW_SHELL_TRANSCRIPT_NAMES = {
  bash: true, shell: true, sh: true, zsh: true, console: true, terminal: true,
  cmd: true, powershell: true, pwsh: true,
};

function isWebviewToolName(name) {
  var n = String(name || '').trim();
  return !!WEBVIEW_TOOL_NAMES[n] || n.indexOf('mcp__') === 0;
}

function normalizeWebviewXmlToolName(name) {
  return String(name || '').trim().replace(/^TOOL_/i, '');
}

function isWebviewShellTranscriptName(name) {
  return !!WEBVIEW_SHELL_TRANSCRIPT_NAMES[String(name || '').toLowerCase()];
}

function containsWebviewCallingToolIntent(text) {
  var callRe = makeWebviewAnyCallingRegex();
  var raw = String(text || '');
  var m;
  while ((m = callRe.exec(raw)) !== null) {
    var name = m[1] || '';
    if (name && (isWebviewToolName(name) || isWebviewShellTranscriptName(name))) return true;
  }
  return false;
}

function stripWebviewJsonFence(text) {
  var s = String(text || '').trim();
  var m = /^```(?:json|JSON|javascript|js)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(s);
  return m ? String(m[1] || '').trim() : s;
}

function looksLikeWebviewToolArgumentPayload(text) {
  var s = stripWebviewJsonFence(text);
  if (!s || (s[0] !== '{' && s[0] !== '[')) return false;
  var parsed;
  try {
    parsed = JSON.parse(s);
  } catch (_) {
    return /"(?:filePath|path|target_directory|targetDirectory|pattern|recursive|command|content|oldText|newText|todoList|summary|query|include|type)"\s*:/i.test(s);
  }
  var items = Array.isArray(parsed) ? parsed : [parsed];
  return items.some(function(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return Object.keys(item).some(function(key) {
      return /^(?:filePath|path|target_directory|targetDirectory|pattern|recursive|command|content|oldText|newText|todoList|summary|query|include|type)$/i.test(key);
    });
  });
}

var WEBVIEW_CALLING_LABEL_PATTERN = '(?:\\[\\s*)?[*_]{0,3}(?:(?:Calling|Call)(?![A-Za-z_])|调用)(?:[ \\t]*[:：]?[ \\t]*tool\\b|[ \\t]+tool\\b)?[ \\t]*[:：]?[ \\t]*[*_]{0,3}[ \\t]*';

function makeWebviewCallingToolNamePattern(includeShellNames) {
  var names = Object.keys(WEBVIEW_TOOL_NAMES);
  if (includeShellNames) {
    names = names.concat(Object.keys(WEBVIEW_SHELL_TRANSCRIPT_NAMES));
  }
  var escapedNames = names
    .sort(function(a, b) { return b.length - a.length; })
    .map(escapeWebviewRegExp)
    .join('|');
  var mcpPattern = 'mcp__[A-Za-z0-9_]+';
  return '\\[?`?(' + (escapedNames ? '(?:' + escapedNames + '|' + mcpPattern + ')' : '(?:' + mcpPattern + ')') + ')`?\\]?';
}

function makeWebviewCallingRegex() {
  return new RegExp(WEBVIEW_CALLING_LABEL_PATTERN + makeWebviewCallingToolNamePattern(false), 'gi');
}

function makeWebviewAnyCallingRegex() {
  return new RegExp(WEBVIEW_CALLING_LABEL_PATTERN + '(?:' + makeWebviewCallingToolNamePattern(true) + ')?', 'gi');
}

function makeWebviewIncompleteCallingTailRegex() {
  return new RegExp(WEBVIEW_CALLING_LABEL_PATTERN + '(?:' + makeWebviewCallingToolNamePattern(true) + ')?\\s*$', 'i');
}

function escapeWebviewRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeWebviewToolNamePattern() {
  var names = Object.keys(WEBVIEW_TOOL_NAMES)
    .sort(function(a, b) { return b.length - a.length; })
    .map(escapeWebviewRegExp)
    .join('|');
  return names ? '(?:' + names + '|mcp__[A-Za-z0-9_]+)' : '(?:mcp__[A-Za-z0-9_]+)';
}

function makeWebviewFunctionStyleToolCallRegex() {
  return new RegExp('(' + makeWebviewToolNamePattern() + ')\\s*\\(\\s*\\{', 'g');
}

function makeWebviewXmlToolTagRegex() {
  return new RegExp('(?:<|&lt;)\\s*((?:TOOL_)?' + makeWebviewToolNamePattern() + ')\\b([^<>]*?)\\/\\s*(?:>|&gt;)', 'gi');
}

function makeWebviewXmlToolPairRegex() {
  return new RegExp('(?:<|&lt;)\\s*((?:TOOL_)?' + makeWebviewToolNamePattern() + ')\\b[^<>]*?(?:>|&gt;)([\\s\\S]*?)(?:<\\/|&lt;\\/)\\s*\\1\\s*(?:>|&gt;)', 'gi');
}

function makeWebviewXmlToolOpenJsonRegex() {
  return new RegExp('(?:<|&lt;)\\s*((?:TOOL_)?' + makeWebviewToolNamePattern() + ')\\b[^<>]*?(?:>|&gt;)\\s*\\{', 'gi');
}

function makeWebviewXmlToolTagTailRegex() {
  return new RegExp('(?:<|&lt;)\\s*((?:TOOL_)?' + makeWebviewToolNamePattern() + ')\\b[\\s\\S]*$', 'i');
}

function hasWebviewXmlCloseTagAfterJson(text, rawName, fromIndex) {
  var i = fromIndex;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  var name = escapeWebviewRegExp(String(rawName || '').trim());
  if (!name) return false;
  return new RegExp('^(?:<\\/|&lt;\\/)\\s*' + name + '\\s*(?:>|&gt;)', 'i').test(text.slice(i));
}

function stripXmlToolOpenJsonBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  var openRe = makeWebviewXmlToolOpenJsonRegex();
  var match;
  while ((match = openRe.exec(raw)) !== null) {
    if (!isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) continue;
    var jsonStart = match.index + match[0].lastIndexOf('{');
    var jsonEnd = findJsonObjectEndInText(raw, jsonStart);
    if (jsonEnd < 0) continue;
    if (hasWebviewXmlCloseTagAfterJson(raw, match[1], jsonEnd + 1)) continue;
    out += raw.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = jsonEnd + 1;
    openRe.lastIndex = jsonEnd + 1;
  }
  return out + raw.slice(cursor);
}

function stripXmlToolTagBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  var tagRe = makeWebviewXmlToolTagRegex();
  var match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (!isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) continue;
    out += raw.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = tagRe.lastIndex;
  }
  var cleaned = out + raw.slice(cursor);
  out = '';
  cursor = 0;
  var pairRe = makeWebviewXmlToolPairRegex();
  while ((match = pairRe.exec(cleaned)) !== null) {
    if (!isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) continue;
    out += cleaned.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = pairRe.lastIndex;
  }
  cleaned = out + cleaned.slice(cursor);
  cleaned = stripXmlToolOpenJsonBlocksFromText(cleaned);
  return cleaned.replace(makeWebviewXmlToolTagTailRegex(), '').trimEnd();
}

function containsWebviewXmlToolTag(text) {
  var raw = String(text || '');
  var tagRe = makeWebviewXmlToolTagRegex();
  var match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) return true;
  }
  var pairRe = makeWebviewXmlToolPairRegex();
  while ((match = pairRe.exec(raw)) !== null) {
    if (isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) return true;
  }
  var openJsonRe = makeWebviewXmlToolOpenJsonRegex();
  while ((match = openJsonRe.exec(raw)) !== null) {
    if (isWebviewToolName(normalizeWebviewXmlToolName(match[1]))) return true;
  }
  var tail = makeWebviewXmlToolTagTailRegex().exec(raw);
  return !!tail && isWebviewToolName(normalizeWebviewXmlToolName(tail[1]));
}

function webviewLineEndAfter(text, index) {
  var next = text.indexOf('\n', Math.max(0, index));
  return next < 0 ? text.length : next + 1;
}

function webviewSkipBlankLines(text, index) {
  var cursor = index;
  while (cursor < text.length) {
    var end = webviewLineEndAfter(text, cursor);
    if (text.slice(cursor, end).trim()) break;
    cursor = end;
  }
  return cursor;
}

function isWebviewShellCommandLine(line) {
  var first = String(line || '').trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  return /^(?:cat|type|get-content|find|rg|grep|sed|head|tail|ls|dir|pwd|cd|npm|npx|pnpm|yarn|node|git|python|python3|bash|sh|zsh|cmd|powershell|pwsh|mkdir|cp|mv|rm|touch|code|g\+\+|gcc|clang|make|cmake|go|cargo|pytest|mvn|gradle|docker|curl|wget)\b/i.test(first)
    || /[|;&<>]/.test(first);
}

function webviewLooksLikeShellCommandBlock(text) {
  return String(text || '').split(/\r?\n/).some(function(line) { return isWebviewShellCommandLine(line); });
}

function findWebviewFenceEnd(text, fenceStart) {
  var firstLineEnd = webviewLineEndAfter(text, fenceStart);
  var search = firstLineEnd;
  while (search < text.length) {
    var idx = text.indexOf('```', search);
    if (idx < 0) return text.length;
    var lineStart = idx === 0 ? 0 : text.lastIndexOf('\n', idx - 1) + 1;
    if (/^[ \t]*```/.test(text.slice(lineStart, idx + 3))) {
      return webviewLineEndAfter(text, idx + 3);
    }
    search = idx + 3;
  }
  return text.length;
}

function findWebviewShellTranscriptEnd(text, callEnd) {
  var cursor = webviewSkipBlankLines(text, webviewLineEndAfter(text, callEnd));
  if (cursor >= text.length) return text.length;

  if (/^[ \t]*```/.test(text.slice(cursor, cursor + 8))) {
    var headerEnd = webviewLineEndAfter(text, cursor + 3);
    var close = text.indexOf('```', headerEnd);
    var contentEnd = close >= 0 ? close : text.length;
    if (!webviewLooksLikeShellCommandBlock(text.slice(headerEnd, contentEnd))) return callEnd;
    return close >= 0 ? webviewLineEndAfter(text, close + 3) : text.length;
  }

  var firstLineEnd = webviewLineEndAfter(text, cursor);
  var firstLine = text.slice(cursor, firstLineEnd);
  if (!isWebviewShellCommandLine(firstLine)) {
    return callEnd;
  }

  var end = firstLineEnd;
  while (end < text.length) {
    var lineEnd = webviewLineEndAfter(text, end);
    if (!text.slice(end, lineEnd).trim()) return lineEnd;
    end = lineEnd;
  }
  return text.length;
}

function stripCallingShellTranscriptBlocksFromText(text) {
  var out = '';
  var i = 0;
  var callRe = makeWebviewAnyCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var end = findWebviewShellTranscriptEnd(text, callRe.lastIndex);
    if ((m[1] && !isWebviewShellTranscriptName(m[1])) || end <= callRe.lastIndex) {
      out += text.slice(i, m.index + 1);
      i = m.index + 1;
      continue;
    }
    out += text.slice(i, m.index);
    i = end;
  }
  return out;
}

function stripCallingToolBlocksFromText(text) {
  var out = '';
  var i = 0;
  var callRe = makeWebviewCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var name = m[1];
    if (!isWebviewToolName(name)) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    var jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) { out += text.slice(i, m.index); break; }
    var jsonEnd = findJsonObjectEndInText(text, jsonStart);
    if (jsonEnd < 0) { out += text.slice(i, m.index); break; }
    out += text.slice(i, m.index);
    var next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function findWebviewFunctionStyleToolCallEnd(text, match) {
  var name = match[1] || '';
  if (!isWebviewToolName(name)) return -1;
  if (match.index > 0 && /[A-Za-z0-9_]/.test(text[match.index - 1])) return -1;
  var jsonStart = match.index + match[0].lastIndexOf('{');
  var jsonEnd = findJsonObjectEndInText(text, jsonStart);
  if (jsonEnd < 0) return -1;
  var next = jsonEnd + 1;
  while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
  if (text[next] === ')') next++;
  return next;
}

function containsWebviewFunctionStyleToolCall(text) {
  var raw = String(text || '');
  var callRe = makeWebviewFunctionStyleToolCallRegex();
  var m;
  while ((m = callRe.exec(raw)) !== null) {
    if (findWebviewFunctionStyleToolCallEnd(raw, m) >= 0) return true;
  }
  return false;
}

function containsWebviewToolLabel(text) {
  var raw = String(text || '');
  var re = /(?:^|\n|[ \t])(?:Tool|工具)[ \t]*[:：][ \t]*`?([A-Za-z_]\w*)/gi;
  var m;
  while ((m = re.exec(raw)) !== null) {
    if (isWebviewToolName(m[1])) return true;
  }
  return false;
}

function containsWebviewBracketedInternalResult(text) {
  var raw = String(text || '');
  var re = /(?:^|\n)\s*\[([A-Za-z_]\w*|工具结果)(?=\s|[\]:：}]|$)/gi;
  var m;
  while ((m = re.exec(raw)) !== null) {
    var name = m[1] || '';
    if (name === '工具结果' || name === 'generated_file' || name === 'permission_repair') return true;
    if (isWebviewToolName(name)) return true;
  }
  return false;
}

function stripFunctionStyleToolCallBlocksFromText(text) {
  var out = '';
  var i = 0;
  var callRe = makeWebviewFunctionStyleToolCallRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var start = m.index;
    var end = findWebviewFunctionStyleToolCallEnd(text, m);
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
  var out = '';
  var i = 0;
  var callRe = /(?:^|[ \t]*\n|[ \t]+)(?:Tool|工具)[ \t]*[:：][ \t]*`?([A-Za-z_]\w*)`?[^\n{]*(?:Arguments?|参数)[ \t]*[:：][ \t]*/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var name = m[1] || '';
    if (!WEBVIEW_TOOL_NAMES[name] && name.indexOf('mcp__') !== 0) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    var jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) {
      out += text.slice(i, m.index).replace(/[ \t]+$/, '');
      break;
    }
    var jsonEnd = findJsonObjectEndInText(text, jsonStart);
    if (jsonEnd < 0) {
      out += text.slice(i, m.index).replace(/[ \t]+$/, '');
      break;
    }
    out += text.slice(i, m.index).replace(/[ \t]+$/, '');
    var next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function jsonObjectToWebviewTool(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var rawName = typeof obj.tool === 'string'
    ? obj.tool
    : (typeof obj.name === 'string' ? obj.name : (typeof obj.type === 'string' ? obj.type : ''));
  var name = rawName.trim();
  if (!name || (!WEBVIEW_TOOL_NAMES[name] && name.indexOf('mcp__') !== 0)) return null;
  return name;
}

var WEBVIEW_IMPLICIT_FILE_PATH_KEYS = {
  path: true, filePath: true, filepath: true, filename: true, targetPath: true,
};
var WEBVIEW_IMPLICIT_FILE_CONTENT_KEYS = {
  content: true, contents: true, text: true, body: true, fileContent: true,
  file_content: true, source: true, code: true, newContent: true, new_content: true,
};
var WEBVIEW_IMPLICIT_FILE_WRITE_KEYS = Object.assign(
  {},
  WEBVIEW_IMPLICIT_FILE_PATH_KEYS,
  WEBVIEW_IMPLICIT_FILE_CONTENT_KEYS,
);
var WEBVIEW_IMPLICIT_TERMINAL_KEYS = {
  command: true, cmd: true, workdir: true, cwd: true, maxOutputLines: true,
  timeout: true, timeoutMs: true, is_background: true, requires_approval: true,
};
var WEBVIEW_IMPLICIT_READ_KEYS = {
  path: true, filePath: true, filepath: true, recursive: true,
  maxDepth: true, startLine: true, endLine: true,
};

function firstWebviewStringField(obj, keys) {
  for (var key in keys) {
    if (Object.prototype.hasOwnProperty.call(keys, key) && typeof obj[key] === 'string') {
      return obj[key];
    }
  }
  return undefined;
}

function webviewObjectKeysAllowed(obj, allowed) {
  return Object.keys(obj).every(function(key) { return !!allowed[key]; });
}

function looksLikeWebviewToolPath(value) {
  return /^(?:\/|~\/|\.\.?\/|[A-Za-z]:[\\/])/.test(String(value || '').trim());
}

function jsonObjectToImplicitWebviewArrayTool(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  var command = firstWebviewStringField(obj, { command: true, cmd: true });
  if (command && command.trim()) {
    return webviewObjectKeysAllowed(obj, WEBVIEW_IMPLICIT_TERMINAL_KEYS) ? 'run_terminal' : null;
  }

  var path = firstWebviewStringField(obj, WEBVIEW_IMPLICIT_FILE_PATH_KEYS);
  if (!looksLikeWebviewToolPath(path)) return null;
  var content = firstWebviewStringField(obj, WEBVIEW_IMPLICIT_FILE_CONTENT_KEYS);
  if (content !== undefined) {
    return webviewObjectKeysAllowed(obj, WEBVIEW_IMPLICIT_FILE_WRITE_KEYS) ? 'write_file' : null;
  }
  return webviewObjectKeysAllowed(obj, WEBVIEW_IMPLICIT_READ_KEYS) ? 'read_file' : null;
}

function jsonArrayIsWebviewToolPayload(value) {
  return Array.isArray(value) && value.length > 0 && value.every(function(item) {
    return !!(jsonObjectToWebviewTool(item) || jsonObjectToImplicitWebviewArrayTool(item));
  });
}

function stripJsonToolPayloadsFromText(text) {
  if (!text) return '';
  var result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, function(full, inner) {
    var trimmed = String(inner || '').trim();
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return full;
    try {
      var parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return jsonArrayIsWebviewToolPayload(parsed) ? '' : full;
      }
      return jsonObjectToWebviewTool(parsed) ? '' : full;
    } catch (_) {
      return /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(trimmed) ? '' : full;
    }
  });

  var out = '';
  var i = 0;
  while (i < result.length) {
    var start = findNextWebviewJsonStart(result, i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    var isArray = result[start] === '[';
    var end = isArray
      ? findJsonArrayEndInText(result, start)
      : findJsonObjectEndInText(result, start);
    if (end < 0) {
      var tail = result.slice(start);
      if (!isArray && /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) break;
      out += tail;
      break;
    }
    var candidate = result.slice(start, end + 1);
    var shouldStrip = false;
    try {
      var parsed = JSON.parse(candidate);
      shouldStrip = isArray
        ? jsonArrayIsWebviewToolPayload(parsed)
        : !!jsonObjectToWebviewTool(parsed);
    } catch (_) {
      shouldStrip = !isArray && /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(candidate);
    }
    if (!shouldStrip) out += candidate;
    i = end + 1;
  }
  return out;
}

// ── Collapse terminal-output blocks in a rendered container ────────────────────────
// Wraps **[终端] $ `cmd`** paragraph + following <pre> in a <details> so
// intermediate tool noise is collapsed but accessible (Claude Code style).
function collapseTerminalOutputBlocks(container) {
  var children = Array.from(container.children);
  var pairs = [];
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    if (el.tagName !== 'P' && el.tagName !== 'DIV') continue;
    var text = el.textContent || '';
    if (!/^\[终端/.test(text.trim())) continue;
    var next = el.nextElementSibling;
    pairs.push({ header: el, code: next && next.tagName === 'PRE' ? next : null });
  }
  pairs.forEach(function(pair) {
    var details = document.createElement('details');
    details.className = 'terminal-collapse';
    var summary = document.createElement('summary');
    summary.className = 'terminal-collapse-summary';
    summary.innerHTML = pair.header.innerHTML;
    details.appendChild(summary);
    pair.header.parentNode.insertBefore(details, pair.header);
    pair.header.parentNode.removeChild(pair.header);
    if (pair.code) pair.code.parentNode && pair.code.parentNode.removeChild(pair.code);
    if (pair.code) details.appendChild(pair.code);
  });
}

var DSML_BAR_PATTERN = '[|｜]{1,2}';
var DSML_MARKER_PATTERN = DSML_BAR_PATTERN + '\\s*DSML\\s*' + DSML_BAR_PATTERN;
var DSML_OPEN_PREFIX_PATTERN = '(?:<|&lt;)\\s*';
var DSML_CLOSE_PREFIX_PATTERN = '(?:<\\/|&lt;\\/)\\s*';
var DSML_START_NAMES_PATTERN = '(?:tool_calls|invoke|parameter)';
var DSML_INCOMPLETE_TAIL_REGEX = new RegExp(
  DSML_OPEN_PREFIX_PATTERN + '(?:' + DSML_BAR_PATTERN + '\\s*(?:D(?:S(?:M(?:L)?)?)?(?:\\s*' + DSML_BAR_PATTERN + ')?)?)?$',
  'i'
);
var TOOL_CALL_OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL_CALL\\s*(?:>|&gt;)';
var TOOL_CALL_CLOSE_PATTERN = '(?:<\\/|&lt;\\/)\\s*TOOL_CALL\\s*(?:>|&gt;)';
var TOOL_CALL_INCOMPLETE_TAIL_REGEX = /(?:<|&lt;)\s*(?:T|TO|TOO|TOOL|TOOL_|TOOL_C|TOOL_CA|TOOL_CAL|TOOL_CALL)?$/i;
var GENERIC_TOOL_ENVELOPE_OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL\\s*(?:>|&gt;)';
var GENERIC_TOOL_ENVELOPE_CLOSE_PATTERN = '(?:<\\/|&lt;\\/)\\s*TOOL\\s*(?:>|&gt;)';
var GENERIC_TOOL_ENVELOPE_PREFIX_TAIL_REGEX = /(?:<|&lt;)\s*(?:T(?:O(?:O(?:L)?)?)?)?$/i;

function makeDsmlStartRegexInText() {
  return new RegExp(DSML_OPEN_PREFIX_PATTERN + DSML_MARKER_PATTERN + '\\s*' + DSML_START_NAMES_PATTERN + '\\b', 'gi');
}

function makeGenericToolEnvelopeOpenRegexInText() {
  return new RegExp(GENERIC_TOOL_ENVELOPE_OPEN_PATTERN, 'gi');
}

function makeGenericToolEnvelopeBlockRegexInText() {
  return new RegExp(
    GENERIC_TOOL_ENVELOPE_OPEN_PATTERN + '[\\s\\S]*?' + GENERIC_TOOL_ENVELOPE_CLOSE_PATTERN,
    'gi'
  );
}

function findNextGenericToolEnvelopeStartInText(text, startAt) {
  var raw = String(text || '');
  var openRe = makeGenericToolEnvelopeOpenRegexInText();
  openRe.lastIndex = startAt || 0;
  var open = openRe.exec(raw);
  var tail = (startAt || 0) === 0 ? GENERIC_TOOL_ENVELOPE_PREFIX_TAIL_REGEX.exec(raw) : null;
  if (!open) return tail ? tail.index : -1;
  return tail ? Math.min(open.index, tail.index) : open.index;
}

function stripGenericToolEnvelopeBlocksFromText(text) {
  var cleaned = String(text || '').replace(makeGenericToolEnvelopeBlockRegexInText(), '');
  var incompleteStart = findNextGenericToolEnvelopeStartInText(cleaned, 0);
  if (incompleteStart >= 0) cleaned = cleaned.slice(0, incompleteStart);
  return cleaned.replace(GENERIC_TOOL_ENVELOPE_PREFIX_TAIL_REGEX, '').trimEnd();
}

function containsGenericToolEnvelopeTranscript(text) {
  return findNextGenericToolEnvelopeStartInText(String(text || ''), 0) >= 0;
}

function makeDsmlCloseRegexInText(name) {
  return new RegExp(DSML_CLOSE_PREFIX_PATTERN + DSML_MARKER_PATTERN + '\\s*' + name + '\\s*(?:>|&gt;)', 'i');
}

function makeDsmlTailRegexInText() {
  return new RegExp(DSML_OPEN_PREFIX_PATTERN + DSML_MARKER_PATTERN + '\\s*' + DSML_START_NAMES_PATTERN + '\\b[\\s\\S]*$', 'gi');
}

function findNextDsmlToolCallStartInText(text, startAt) {
  var raw = String(text || '');
  var re = makeDsmlStartRegexInText();
  re.lastIndex = startAt || 0;
  var match = re.exec(raw);
  return match ? match.index : -1;
}

function dsmlToolCallBlockEndInText(text, start) {
  var raw = String(text || '');
  var tail = raw.slice(start);
  var toolCallsClose = makeDsmlCloseRegexInText('tool_calls').exec(tail);
  if (toolCallsClose) return start + toolCallsClose.index + toolCallsClose[0].length;
  var invokeClose = makeDsmlCloseRegexInText('invoke').exec(tail);
  if (invokeClose) return start + invokeClose.index + invokeClose[0].length;
  var parameterClose = makeDsmlCloseRegexInText('parameter').exec(tail);
  if (parameterClose) return start + parameterClose.index + parameterClose[0].length;
  return raw.length;
}

function stripDsmlToolCallBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  while (cursor < raw.length) {
    var start = findNextDsmlToolCallStartInText(raw, cursor);
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
  return new RegExp(TOOL_CALL_OPEN_PATTERN + '[\\s\\S]*?' + TOOL_CALL_CLOSE_PATTERN, 'gi');
}

function findNextToolCallEnvelopeStartInText(text, startAt) {
  var raw = String(text || '');
  var re = makeToolCallEnvelopeOpenRegexInText();
  re.lastIndex = startAt || 0;
  var match = re.exec(raw);
  return match ? match.index : -1;
}

function toolCallEnvelopeBlockEndInText(text, start) {
  var raw = String(text || '');
  var blockRe = makeToolCallEnvelopeBlockRegexInText();
  blockRe.lastIndex = start;
  var end = start;
  var found = false;
  var match;
  while ((match = blockRe.exec(raw)) !== null) {
    if (match.index > end && raw.slice(end, match.index).trim()) break;
    if (match.index < end) continue;
    end = blockRe.lastIndex;
    found = true;
  }
  return found ? end : raw.length;
}

function stripToolCallEnvelopeBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  while (cursor < raw.length) {
    var start = findNextToolCallEnvelopeStartInText(raw, cursor);
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
  var raw = String(text || '');
  return findNextToolCallEnvelopeStartInText(raw, 0) >= 0 || TOOL_CALL_INCOMPLETE_TAIL_REGEX.test(raw);
}

function makeReactActionRegex() {
  return /\bAction\s*[:：]\s*`?([A-Za-z_]\w*?)`?(?=\s*(?:Action\s*Input\s*[:：]|$|[\r\n]))/gi;
}

function makeReactActionInputRegex() {
  return /Action\s*Input\s*[:：]\s*/gi;
}

function findReactActionInput(text, startAt) {
  var inputRe = makeReactActionInputRegex();
  inputRe.lastIndex = startAt || 0;
  return inputRe.exec(String(text || ''));
}

function findNextReactActionStartInText(text, startAt) {
  var raw = String(text || '');
  var actionRe = makeReactActionRegex();
  actionRe.lastIndex = startAt || 0;
  var match;
  while ((match = actionRe.exec(raw)) !== null) {
    var name = match[1] || '';
    if (!isWebviewToolName(name)) continue;
    if (findReactActionInput(raw, match.index + match[0].length)) return match.index;
    if (!raw.slice(match.index + match[0].length).trim()) return match.index;
  }
  return -1;
}

function reactActionBlockEndInText(text, start) {
  var raw = String(text || '');
  var actionRe = makeReactActionRegex();
  actionRe.lastIndex = start;
  var match = actionRe.exec(raw);
  if (!match || match.index !== start) return start;
  var inputMatch = findReactActionInput(raw, match.index + match[0].length);
  if (!inputMatch) return raw.length;
  var payloadStart = inputMatch.index + inputMatch[0].length;
  while (payloadStart < raw.length && /[ \t\r\n`]/.test(raw[payloadStart])) payloadStart++;
  if (raw.slice(payloadStart, payloadStart + 4).toLowerCase() === 'json') payloadStart += 4;
  while (payloadStart < raw.length && /[ \t\r\n]/.test(raw[payloadStart])) payloadStart++;
  if (raw[payloadStart] === '{') {
    var jsonEnd = findJsonObjectEndInText(raw, payloadStart);
    if (jsonEnd < 0) return raw.length;
    var end = jsonEnd + 1;
    var closeFence = /^[ \t\r\n]*```/.exec(raw.slice(end));
    if (closeFence) return webviewLineEndAfter(raw, end + closeFence[0].length);
    while (end < raw.length && /[ \t`]/.test(raw[end])) end++;
    return end;
  }
  return webviewLineEndAfter(raw, payloadStart);
}

function stripReactActionBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  while (cursor < raw.length) {
    var start = findNextReactActionStartInText(raw, cursor);
    if (start < 0) {
      out += raw.slice(cursor);
      break;
    }
    out += raw.slice(cursor, start).replace(/[ \t]+$/, '');
    var end = reactActionBlockEndInText(raw, start);
    cursor = end > start ? end : raw.length;
  }
  return out.trimEnd();
}

function containsReactActionTranscript(text) {
  return findNextReactActionStartInText(String(text || ''), 0) >= 0;
}

function stripToolCallBlocks(text) {
  var result = '';
  var i = 0;
  var len = text.length;
  var removedInternalBlock = false;
  while (i < len) {
    // Detect [TOOL:<word> { start
    if (text[i] === '[') {
      var lookahead = text.slice(i, Math.min(i + 60, len));
      var m = lookahead.match(/^\[TOOL:(\w+)\s*(?:\]?\s*)\{/);
      if (m) {
        removedInternalBlock = true;
        // Find the opening brace position
        var bracePos = text.indexOf('{', i);
        if (bracePos < 0) { result += text[i]; i++; continue; }
        // Walk the brace tree to find the matching closing brace
        var depth = 1;
        var inStr = false;
        var j = bracePos + 1;
        while (j < len && depth > 0) {
          var ch = text[j];
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
        // j now points to char after closing }
        // skip optional whitespace then the mandatory closing ]
        while (j < len && (text[j] === ' ' || text[j] === '\t')) j++;
        if (j < len && text[j] === ']') j++;
        i = j;
        continue;
      }
      if (/^\[TOOL:(\w+)\b/.test(lookahead)) {
        removedInternalBlock = true;
        break;
      }
    }
    result += text[i];
    i++;
  }
  var beforeToolCallEnvelopeCleanup = result;
  result = stripGenericToolEnvelopeBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolCallEnvelopeCleanup;
  beforeToolCallEnvelopeCleanup = result;
  result = stripToolCallEnvelopeBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolCallEnvelopeCleanup;
  var beforeReactCleanup = result;
  result = stripReactActionBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeReactCleanup;
  // Also strip DeepSeek web pseudo tool calls:
  //   Calling `manage_todo_list`
  //   {"todoList":[...]}
  // These are internal tool transcripts and must never render as assistant prose.
  var beforeShellCleanup = result;
  result = stripCallingShellTranscriptBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeShellCleanup;
  var beforeCallingCleanup = result;
  result = stripCallingToolBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;
  var beforeToolArgumentCleanup = result;
  result = stripToolArgumentBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeToolArgumentCleanup;
  var beforeFunctionStyleCleanup = result;
  result = stripFunctionStyleToolCallBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeFunctionStyleCleanup;
  var beforeXmlTagCleanup = result;
  result = stripXmlToolTagBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeXmlTagCleanup;
  var beforeJsonCleanup = result;
  result = stripJsonToolPayloadsFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeJsonCleanup;
  var beforeDsmlCleanup = result;
  result = stripDsmlToolCallBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeDsmlCleanup;
  // Also strip <tool_call>...</tool_call> blocks (DeepSeek native format)
  var beforeXmlCleanup = result;
  var noXml = result
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '');
  removedInternalBlock = removedInternalBlock || noXml !== beforeXmlCleanup;
  var cleaned = noXml.replace(/\n{3,}/g, '\n\n').trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
}

function stripIncompleteCallingTail(text) {
  var raw = String(text || '');
  var m = makeWebviewIncompleteCallingTailRegex().exec(raw);
  return m ? raw.slice(0, m.index).trimEnd() : raw;
}

function containsPotentialInternalCallingTail(text) {
  return makeWebviewIncompleteCallingTailRegex().test(String(text || ''));
}

function sanitizeAgentVisibleDelta(text) {
  return sanitizeAgentVisibleText(text);
}

function sanitizeAgentVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentLocalContextNoticeLeaks(raw);
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim()) return '';
  if (isAgentRoutingFileMarkerLeak(raw)) return '';
  raw = stripAgentRoutingSummaryMarkerLeak(raw);
  var cleaned = collapseDuplicateAgentTransitionSentences(
    stripAgentRoutingResetLeaks(stripIncompleteCallingTail(stripToolCallBlocks(raw))),
  ).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function sanitizeAssistantVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim()) return '';
  raw = stripAgentRoutingSummaryMarkerLeak(raw);
  var cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function renderVisibleAssistantText(text) {
  return isAgentMode ? sanitizeAgentVisibleText(text || '') : sanitizeAssistantVisibleText(text || '');
}

function renderAssistantMarkdown(text) {
  return md(renderVisibleAssistantText(text || ''));
}

function renderAgentMarkdown(text) {
  return md(sanitizeAgentVisibleText(text || ''));
}

function containsAgentInternalTranscript(text) {
  return containsDsmlToolTranscript(text)
    || containsGenericToolEnvelopeTranscript(text)
    || containsToolCallEnvelopeTranscript(text)
    || containsReactActionTranscript(text)
    || containsAgentRoutingMarkerLeak(text)
    || containsWebviewFunctionStyleToolCall(text)
    || containsWebviewXmlToolTag(text)
    || /(?:^|\n)\s*\[TOOL:(?:mcp__|\w+)\b/i.test(text)
    || containsWebviewCallingToolIntent(text)
    || containsWebviewToolLabel(text)
    || containsWebviewBracketedInternalResult(text)
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

function collapseDuplicateAgentTransitionSentences(text) {
  return String(text || '').replace(
    /((?:好的，)?(?:我(?:将|先|来|会|已经|已)|现在|首先|接下来|下一步)[^。！？\n]{8,220}[。！？])(?:\s*\1)+/g,
    '$1',
  );
}

function stripAgentRoutingSummaryMarkerLeak(text) {
  return String(text || '')
    .replace(/^\s*\x00ASUM\x00\x00RESET\x00/, '')
    .replace(/^\s*\x00ASUM\x00/, '')
    .replace(/^\s*ASUMRESET/, '')
    .replace(/^\s*ASUM/, '');
}

function restoreAgentRoutingMarkerText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  if (raw.indexOf('\x00AFILE:') === 0 || raw.indexOf('\x00ASUM\x00') === 0) return raw;
  var markerBody = raw.replace(/^\s+/, '');
  if (markerBody.indexOf('ASUMRESET') === 0) return '\x00ASUM\x00\x00RESET\x00' + markerBody.slice('ASUMRESET'.length);
  if (markerBody.indexOf('ASUM') === 0) return '\x00ASUM\x00' + markerBody.slice('ASUM'.length);
  var fileReset = /^AFILE:([^\s\x00]{1,120}?)RESET([\s\S]*)$/.exec(raw);
  if (fileReset) return '\x00AFILE:' + fileReset[1] + '\x00\x00RESET\x00' + fileReset[2];
  if (/^AFILE:[^\s\x00]{1,180}/.test(raw)) return '\x00AFILE:unknown\x00';
  return raw;
}
