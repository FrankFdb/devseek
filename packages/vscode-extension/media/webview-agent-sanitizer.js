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

var WEBVIEW_TOOL_NAMES = {
  read_file: true, grep_search: true, search_content: true, search_file: true, file_search: true, semantic_search: true, list_dir: true, get_errors: true,
  run_terminal: true, memory_write: true, get_changed_files: true, create_directory: true, fetch_webpage: true,
  vscode_listCodeUsages: true, run_vscode_command: true, create_file: true, write_file: true, replace_file: true,
  manage_todo_list: true, task_complete: true,
};

var WEBVIEW_SHELL_TRANSCRIPT_NAMES = {
  bash: true, shell: true, sh: true, zsh: true, console: true, terminal: true,
  cmd: true, powershell: true, pwsh: true,
};

function isWebviewToolName(name) {
  var n = String(name || '').trim();
  return !!WEBVIEW_TOOL_NAMES[n] || n.indexOf('mcp__') === 0;
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

function makeWebviewAnyCallingRegex() {
  return /(?:\[\s*)?(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?([A-Za-z_]\w*)`?\]?)?/gi;
}

function escapeWebviewRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeWebviewFunctionStyleToolCallRegex() {
  var names = Object.keys(WEBVIEW_TOOL_NAMES)
    .sort(function(a, b) { return b.length - a.length; })
    .map(escapeWebviewRegExp)
    .join('|');
  return new RegExp('(' + names + '|mcp__[A-Za-z0-9_]+)\\s*\\(\\s*\\{', 'g');
}

function makeWebviewXmlToolTagRegex() {
  var names = Object.keys(WEBVIEW_TOOL_NAMES)
    .sort(function(a, b) { return b.length - a.length; })
    .map(escapeWebviewRegExp)
    .join('|');
  return new RegExp('(?:<|&lt;)\\s*(' + names + '|mcp__[A-Za-z0-9_]+)\\b([^<>]*?)\\/\\s*(?:>|&gt;)', 'gi');
}

function makeWebviewXmlToolTagTailRegex() {
  var names = Object.keys(WEBVIEW_TOOL_NAMES)
    .sort(function(a, b) { return b.length - a.length; })
    .map(escapeWebviewRegExp)
    .join('|');
  return new RegExp('(?:<|&lt;)\\s*(' + names + '|mcp__[A-Za-z0-9_]+)\\b[^<>]*$', 'i');
}

function stripXmlToolTagBlocksFromText(text) {
  var raw = String(text || '');
  var out = '';
  var cursor = 0;
  var tagRe = makeWebviewXmlToolTagRegex();
  var match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (!isWebviewToolName(match[1])) continue;
    out += raw.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = tagRe.lastIndex;
  }
  return (out + raw.slice(cursor)).replace(makeWebviewXmlToolTagTailRegex(), '').trimEnd();
}

function containsWebviewXmlToolTag(text) {
  var raw = String(text || '');
  var tagRe = makeWebviewXmlToolTagRegex();
  var match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (isWebviewToolName(match[1])) return true;
  }
  var tail = makeWebviewXmlToolTagTailRegex().exec(raw);
  return !!tail && isWebviewToolName(tail[1]);
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
  var callRe = /(?:\[\s*)?(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
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
  var rawName = typeof obj.tool === 'string' ? obj.tool : (typeof obj.name === 'string' ? obj.name : '');
  var name = rawName.trim();
  if (!name || (!WEBVIEW_TOOL_NAMES[name] && name.indexOf('mcp__') !== 0)) return null;
  return name;
}

function stripJsonToolPayloadsFromText(text) {
  if (!text) return '';
  var result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, function(full, inner) {
    var trimmed = String(inner || '').trim();
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return full;
    try {
      var parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.some(function(item) { return jsonObjectToWebviewTool(item); }) ? '' : full;
      }
      return jsonObjectToWebviewTool(parsed) ? '' : full;
    } catch (_) {
      return /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(trimmed) ? '' : full;
    }
  });

  var out = '';
  var i = 0;
  while (i < result.length) {
    var start = result.indexOf('{', i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    var end = findJsonObjectEndInText(result, start);
    if (end < 0) {
      var tail = result.slice(start);
      if (/"tool"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) break;
      out += tail;
      break;
    }
    var candidate = result.slice(start, end + 1);
    var shouldStrip = false;
    try {
      var obj = JSON.parse(candidate);
      shouldStrip = !!jsonObjectToWebviewTool(obj);
    } catch (_) {
      shouldStrip = /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(candidate);
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

function makeDsmlStartRegexInText() {
  return new RegExp(DSML_OPEN_PREFIX_PATTERN + DSML_MARKER_PATTERN + '\\s*' + DSML_START_NAMES_PATTERN + '\\b', 'gi');
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
  var m = /(?:\[\s*)?(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.exec(raw);
  return m ? raw.slice(0, m.index).trimEnd() : raw;
}

function containsPotentialInternalCallingTail(text) {
  return /(?:\[\s*)?(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.test(String(text || ''));
}

function sanitizeAgentVisibleDelta(text) {
  return sanitizeAgentVisibleText(text);
}

function sanitizeAgentVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  if (isAgentRoutingFileMarkerLeak(raw)) return '';
  raw = stripAgentRoutingSummaryMarkerLeak(raw);
  var cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function sanitizeAssistantVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
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
    || containsAgentRoutingMarkerLeak(text)
    || containsWebviewFunctionStyleToolCall(text)
    || containsWebviewXmlToolTag(text)
    || /(?:^|\n)\s*\[TOOL:(?:run_terminal|read_file|grep_search|search_content|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(text)
    || /(?:\[\s*)?(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh)\b/i.test(text)
    || /(?:^|\n)\s*(?:\[\s*)?(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:run_terminal|read_file|grep_search|search_content|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n|[ \t])(?:Tool|工具)[ \t]*[:：][ \t]*`?(?:run_terminal|read_file|grep_search|search_content|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|search_content|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
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
