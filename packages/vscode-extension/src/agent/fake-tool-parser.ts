export interface FakeTool {
  name: string;
  input: Record<string, unknown>;
}

export const KNOWN_FAKE_TOOL_NAMES = new Set([
  'read_file', 'grep_search', 'file_search', 'semantic_search', 'list_dir', 'get_errors',
  'run_terminal', 'memory_write', 'get_changed_files', 'create_directory', 'fetch_webpage',
  'vscode_listCodeUsages', 'run_vscode_command', 'create_file', 'write_file', 'replace_file',
  'manage_todo_list', 'task_complete',
]);

const SHELL_TRANSCRIPT_NAMES = new Set([
  'bash', 'shell', 'sh', 'zsh', 'console', 'terminal', 'cmd', 'powershell', 'pwsh',
]);

const LOOSE_FILE_WRITE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file']);
const LOOSE_FILE_WRITE_PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'];
const LOOSE_FILE_WRITE_CONTENT_KEYS = [
  'content', 'contents', 'text', 'body',
  'fileContent', 'file_content', 'source', 'code', 'newContent', 'new_content',
];

function makeCallingRegex(): RegExp {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?([A-Za-z_]\w*)`?\]?/gi;
}

function makeAnyCallingRegex(): RegExp {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?([A-Za-z_]\w*)`?\]?)?/gi;
}

function makeToolArgumentsRegex(): RegExp {
  const names = [...KNOWN_FAKE_TOOL_NAMES]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`Tool\\s*:\\s*\`?(${names}|mcp__[A-Za-z0-9_]+)\`?\\s*(?:Arguments?|Args|参数)\\s*:\\s*`, 'gi');
}

function isRegisteredFakeToolName(name: string): boolean {
  return KNOWN_FAKE_TOOL_NAMES.has(name) || name.startsWith('mcp__');
}

function isShellTranscriptName(name: string): boolean {
  return SHELL_TRANSCRIPT_NAMES.has(String(name || '').toLowerCase());
}

function looksLikeNonShellTranscriptLine(line: string): boolean {
  const first = line.trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  if (!first) return true;
  if (/^(?:\/\/|\/\*|\*\/|\*)/.test(first)) return true;
  if (/^[{\[]/.test(first)) return true;
  if (/^(?:const|let|var|return|if|for|while|switch|function|export|import|class|interface|type)\b/.test(first)) return true;
  if (/^[\u3400-\u9fff]/.test(first)) return true;
  return false;
}

function isShellCommandLine(line: string): boolean {
  const first = line.trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  if (!first) return false;
  if (looksLikeNonShellTranscriptLine(first)) return false;
  return /^(?:\.\/|\.\.\/|cat|type|get-content|find|rg|grep|sed|head|tail|ls|dir|pwd|cd|npm|npx|pnpm|yarn|node|git|python|python3|bash|sh|zsh|cmd|powershell|pwsh|mkdir|cp|mv|rm|touch|code|g\+\+|gcc|clang|make|cmake|go|cargo|pytest|mvn|gradle|docker|curl|wget)\b/i.test(first)
    || /(?:^|\s)(?:&&|\|\||[|;])(?:\s|$)/.test(first)
    || /(?:^|\s)\d?>&?\S/.test(first);
}

function looksLikeShellCommandBlock(text: string): boolean {
  const payload = shellJsonCommandPayload(text);
  if (payload) return looksLikeShellCommandBlock(payload.command);
  return text.split(/\r?\n/).some(line => isShellCommandLine(line));
}

export function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
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

export function findJsonArrayEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
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

function findNextJsonStart(text: string, startAt: number): number {
  const objectStart = text.indexOf('{', startAt);
  const arrayStart = text.indexOf('[', startAt);
  if (objectStart < 0) return arrayStart;
  if (arrayStart < 0) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function stripCallingToolBlocks(text: string): string {
  let out = '';
  let i = 0;
  const callRe = makeCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) {
      out += text.slice(i);
      break;
    }
    const name = m[1];
    if (!isRegisteredFakeToolName(name)) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    const jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) {
      out += text.slice(i);
      break;
    }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, m.index);
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function extractToolArgumentsPayload(
  text: string,
  name: string,
  argsStart: number,
): { tool: FakeTool; end: number } | null {
  const jsonStart = text.indexOf('{', argsStart);
  if (jsonStart < 0) return null;
  const jsonEnd = findToolInputObjectEnd(text, name, jsonStart);
  if (jsonEnd < 0) return null;
  const jsonText = text.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { tool: { name, input: parsed as Record<string, unknown> }, end: jsonEnd + 1 };
    }
  } catch {
    const looseInput = parseLooseFileWriteToolInput(name, jsonText);
    if (looseInput) return { tool: { name, input: looseInput }, end: jsonEnd + 1 };
  }
  return null;
}

function parseToolArgumentsToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const toolRe = makeToolArgumentsRegex();
  let m: RegExpExecArray | null;
  while ((m = toolRe.exec(text)) !== null) {
    const name = m[1];
    if (!isRegisteredFakeToolName(name)) continue;
    const extracted = extractToolArgumentsPayload(text, name, toolRe.lastIndex);
    if (!extracted) continue;
    tools.push(extracted.tool);
    toolRe.lastIndex = extracted.end;
  }
  return tools;
}

function stripToolArgumentsBlocks(text: string): string {
  let out = '';
  let last = 0;
  const toolRe = makeToolArgumentsRegex();
  let m: RegExpExecArray | null;
  while ((m = toolRe.exec(text)) !== null) {
    const name = m[1];
    if (!isRegisteredFakeToolName(name)) continue;
    const extracted = extractToolArgumentsPayload(text, name, toolRe.lastIndex);
    if (!extracted) {
      const tail = text.slice(toolRe.lastIndex).trim();
      if (!tail || tail.startsWith('{')) {
        out += text.slice(last, m.index).replace(/[ \t]+$/, '');
        last = text.length;
      }
      break;
    }
    out += text.slice(last, m.index).replace(/[ \t]+$/, '');
    last = extracted.end;
    toolRe.lastIndex = extracted.end;
  }
  return out + text.slice(last);
}

function lineEndAfter(text: string, index: number): number {
  const lineEnd = text.indexOf('\n', index);
  return lineEnd < 0 ? text.length : lineEnd + 1;
}

function skipBlankLines(text: string, index: number): number {
  let pos = index;
  while (pos < text.length) {
    const end = lineEndAfter(text, pos);
    const line = text.slice(pos, end).trim();
    if (line) break;
    pos = end;
  }
  return pos;
}

function findShellTranscriptEnd(text: string, callEnd: number): number {
  let pos = lineEndAfter(text, callEnd);
  pos = skipBlankLines(text, pos);

  if (text.startsWith('```', pos)) {
    const headerEnd = lineEndAfter(text, pos + 3);
    const close = text.indexOf('```', headerEnd);
    return close >= 0 ? lineEndAfter(text, close + 3) : text.length;
  }

  const firstLineEnd = lineEndAfter(text, pos);
  const firstLine = text.slice(pos, firstLineEnd);
  if (!isShellCommandLine(firstLine)) {
    return lineEndAfter(text, callEnd);
  }

  let end = pos;
  const callLineRe = /^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?[A-Za-z_]\w*`?\]?/i;
  while (end < text.length) {
    const next = lineEndAfter(text, end);
    const line = text.slice(end, next);
    const trimmed = line.trim();
    if (!trimmed || callLineRe.test(trimmed)) break;
    end = next;
  }
  return end;
}

function stripCallingShellTranscriptBlocks(text: string): string {
  let out = '';
  let last = 0;
  const callRe = makeAnyCallingRegex();
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    if (m[1] && !isShellTranscriptName(m[1])) continue;
    const extracted = extractShellTranscriptCommand(text, callRe.lastIndex);
    if (!extracted) continue;
    out += text.slice(last, m.index).replace(/[ \t]+$/, '');
    const end = extracted.end;
    if (out && !out.endsWith('\n') && end > callRe.lastIndex && end < text.length) {
      out += '\n';
    }
    last = end;
    callRe.lastIndex = end;
  }
  return out + text.slice(last);
}

function hasShellTranscriptMarker(text: string): boolean {
  const callRe = makeAnyCallingRegex();
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    if (m[1] && isShellTranscriptName(m[1])) return true;
  }
  return false;
}

export function jsonObjectToFakeTool(obj: Record<string, unknown>): FakeTool | null {
  const rawName = typeof obj.tool === 'string'
    ? obj.tool
    : typeof obj.name === 'string'
      ? obj.name
      : typeof obj.type === 'string'
        ? obj.type
        : '';
  const name = rawName.trim();
  if (!name || !isRegisteredFakeToolName(name)) return null;
  const maybeArgs = obj.arguments ?? obj.parameters ?? obj.args;
  let input: Record<string, unknown>;
  if (maybeArgs && typeof maybeArgs === 'object' && !Array.isArray(maybeArgs)) {
    input = maybeArgs as Record<string, unknown>;
  } else {
    input = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!['tool', 'name', 'type', 'arguments', 'parameters', 'args'].includes(k)) input[k] = v;
    }
  }
  return { name, input };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeLooseJsonString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_match, escaped: string) => {
    switch (escaped) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default:
        if (/^u[0-9a-fA-F]{4}$/.test(escaped)) {
          return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
        }
        return escaped;
    }
  });
}

function isEscapedQuote(text: string, quoteIndex: number, valueStart: number): boolean {
  let slashCount = 0;
  for (let i = quoteIndex - 1; i >= valueStart && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}

function extractLooseJsonStringField(jsonText: string, key: string): string | undefined {
  const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'i');
  const match = keyRe.exec(jsonText);
  if (!match) return undefined;
  const valueStart = match.index + match[0].length;
  let valueEnd = -1;

  for (let i = valueStart; i < jsonText.length; i++) {
    if (jsonText[i] !== '"' || isEscapedQuote(jsonText, i, valueStart)) continue;
    const afterQuote = jsonText.slice(i + 1);
    if (/^\s*(?:,\s*"[A-Za-z_][\w-]*"\s*:|}\s*$)/.test(afterQuote)) {
      valueEnd = i;
      break;
    }
  }

  if (valueEnd < 0) return undefined;
  return decodeLooseJsonString(jsonText.slice(valueStart, valueEnd));
}

function findLooseJsonStringFieldValueStart(text: string, objectStart: number, keys: readonly string[]): number {
  const header = text.slice(objectStart, Math.min(text.length, objectStart + 4000));
  for (const key of keys) {
    const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'i');
    const match = keyRe.exec(header);
    if (match) return objectStart + match.index + match[0].length;
  }
  return -1;
}

function findLooseObjectCloseAfterString(text: string, afterStringQuote: number): number {
  let i = afterStringQuote;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
  if (text[i] !== '}') return -1;
  const closeBrace = i;
  i++;
  let sawLineBreak = false;
  while (i < text.length && /[ \t\r\n]/.test(text[i])) {
    if (text[i] === '\n' || text[i] === '\r') sawLineBreak = true;
    i++;
  }
  if (i >= text.length || text[i] === ']' || sawLineBreak) return closeBrace;
  if (text.startsWith('[TOOL:', i) || text.startsWith('```', i)) return closeBrace;
  if (/^(?:Calling|Call|调用)\b/i.test(text.slice(i, i + 20))) return closeBrace;
  return -1;
}

function findLooseFileWriteObjectEnd(text: string, name: string, jsonStart: number): number {
  if (!LOOSE_FILE_WRITE_TOOL_NAMES.has(name) || text[jsonStart] !== '{') return -1;
  if (findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_FILE_WRITE_PATH_KEYS) < 0) return -1;
  const contentValueStart = findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_FILE_WRITE_CONTENT_KEYS);
  if (contentValueStart < 0) return -1;

  for (let i = contentValueStart; i < text.length; i++) {
    if (text[i] !== '"' || isEscapedQuote(text, i, contentValueStart)) continue;
    const close = findLooseObjectCloseAfterString(text, i + 1);
    if (close >= 0) return close;
  }
  return -1;
}

function findToolInputObjectEnd(text: string, name: string, jsonStart: number): number {
  const strictEnd = findJsonObjectEnd(text, jsonStart);
  if (strictEnd < 0) return findLooseFileWriteObjectEnd(text, name, jsonStart);
  try {
    JSON.parse(text.slice(jsonStart, strictEnd + 1));
    return strictEnd;
  } catch {
    const looseEnd = findLooseFileWriteObjectEnd(text, name, jsonStart);
    return looseEnd > strictEnd ? looseEnd : strictEnd;
  }
}

function parseLooseFileWriteToolInput(name: string, jsonText: string): Record<string, unknown> | null {
  if (!LOOSE_FILE_WRITE_TOOL_NAMES.has(name)) return null;
  const input: Record<string, unknown> = {};
  for (const key of LOOSE_FILE_WRITE_PATH_KEYS) {
    const value = extractLooseJsonStringField(jsonText, key);
    if (typeof value === 'string' && value.trim()) {
      input.path = value.trim();
      break;
    }
  }
  for (const key of LOOSE_FILE_WRITE_CONTENT_KEYS) {
    const value = extractLooseJsonStringField(jsonText, key);
    if (typeof value === 'string') {
      input.content = value;
      break;
    }
  }
  return typeof input.path === 'string' && typeof input.content === 'string' ? input : null;
}

function jsonArrayToFakeTools(value: unknown): FakeTool[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const tools: FakeTool[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const tool = jsonObjectToFakeTool(item as Record<string, unknown>);
    if (!tool) return [];
    tools.push(tool);
  }
  return tools;
}

function jsonValueContainsToolPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(item => item && typeof item === 'object' && !Array.isArray(item)
      && jsonObjectToFakeTool(item as Record<string, unknown>));
  }
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && jsonObjectToFakeTool(value as Record<string, unknown>));
}

function parseJsonArrayToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const fencedRe = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let fm: RegExpExecArray | null;
  while ((fm = fencedRe.exec(text)) !== null) {
    const trimmed = String(fm[1] || '').trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      tools.push(...jsonArrayToFakeTools(JSON.parse(trimmed) as unknown));
    } catch { /* ignore non-tool JSON */ }
  }
  if (tools.length > 0) return tools;

  let searchAt = 0;
  while (searchAt < text.length) {
    const start = text.indexOf('[', searchAt);
    if (start < 0) break;
    const end = findJsonArrayEnd(text, start);
    if (end < 0) {
      searchAt = start + 1;
      continue;
    }
    try {
      const converted = jsonArrayToFakeTools(JSON.parse(text.slice(start, end + 1)) as unknown);
      if (converted.length > 0) tools.push(...converted);
    } catch { /* ignore non-tool JSON */ }
    searchAt = end + 1;
  }
  return tools;
}

function stripJsonToolPayloads(text: string): string {
  const result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, (full, inner) => {
    const trimmed = String(inner || '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return full;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (jsonValueContainsToolPayload(parsed)) return '';
    } catch { /* keep non-tool JSON */ }
    return full;
  });

  let i = 0;
  let out = '';
  while (i < result.length) {
    const start = findNextJsonStart(result, i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    const end = result[start] === '[' ? findJsonArrayEnd(result, start) : findJsonObjectEnd(result, start);
    if (end < 0) {
      if (result[start] === '[') {
        out += result[start];
        i = start + 1;
        continue;
      }
      out += result.slice(start);
      break;
    }
    const candidate = result.slice(start, end + 1);
    let stripped = false;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (jsonValueContainsToolPayload(parsed)) {
        stripped = true;
      }
    } catch { /* keep non-tool JSON */ }
    if (!stripped) out += candidate;
    i = end + 1;
  }
  return out;
}

function findNextDsmlToolCallStart(text: string, startAt = 0): number {
  const re = /<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b/gi;
  re.lastIndex = startAt;
  const match = re.exec(text);
  return match ? match.index : -1;
}

function dsmlToolCallBlockEnd(text: string, start: number): number {
  const tail = text.slice(start);
  const toolCallsClose = /<\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i.exec(tail);
  if (toolCallsClose) return start + toolCallsClose.index + toolCallsClose[0].length;
  const invokeClose = /<\/\s*\|\s*DSML\s*\|\s*invoke\s*>/i.exec(tail);
  if (invokeClose) return start + invokeClose.index + invokeClose[0].length;
  const parameterClose = /<\/\s*\|\s*DSML\s*\|\s*parameter\s*>/i.exec(tail);
  if (parameterClose) return start + parameterClose.index + parameterClose[0].length;
  return text.length;
}

function stripDsmlToolCallBlocks(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = findNextDsmlToolCallStart(text, cursor);
    if (start < 0) {
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, start).replace(/[ \t]+$/, '');
    cursor = dsmlToolCallBlockEnd(text, start);
  }
  return out;
}

function normalizeDsmlToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };
  if (typeof normalized.path !== 'string') {
    const path = normalized.filePath ?? normalized.filepath ?? normalized.filename ?? normalized.targetPath ?? normalized.directory;
    if (typeof path === 'string' && path.trim()) normalized.path = path.trim();
  }
  if (toolName === 'run_terminal' && typeof normalized.command !== 'string' && typeof normalized.cmd === 'string') {
    normalized.command = normalized.cmd;
  }
  return normalized;
}

function parseDsmlParameterValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?|\{|\[|")/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { /* keep raw string */ }
  }
  return trimmed;
}

function parseDsmlToolCalls(text: string): FakeTool[] {
  if (findNextDsmlToolCallStart(text) < 0) return [];
  const tools: FakeTool[] = [];
  const invokeRe = /<\s*\|\s*DSML\s*\|\s*invoke\b([^<>]*\bname\s*=\s*["']([^"']+)["'][^<>]*)(?:>|(?=<\s*\|\s*DSML\s*\|))([\s\S]*?)<\/\s*\|\s*DSML\s*\|\s*invoke\s*>/gi;
  let im: RegExpExecArray | null;
  while ((im = invokeRe.exec(text)) !== null) {
    const name = im[2].trim();
    if (!isRegisteredFakeToolName(name)) continue;
    const input: Record<string, unknown> = {};
    const body = im[3] || '';

    const blockParamRe = /<\s*\|\s*DSML\s*\|\s*parameter\b([^<>]*\bname\s*=\s*["']([^"']+)["'][^<>]*)(?:>|(?=<\s*\|\s*DSML\s*\|))([\s\S]*?)<\/\s*\|\s*DSML\s*\|\s*parameter\s*>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = blockParamRe.exec(body)) !== null) {
      input[pm[2].trim()] = parseDsmlParameterValue(pm[3] || '');
    }

    const valueParamRe = /<\s*\|\s*DSML\s*\|\s*parameter\b([^<>]*\bname\s*=\s*["']([^"']+)["'][^<>]*\bvalue\s*=\s*["']([^"']*)["'][^<>]*)(?:\/?>|(?=<\s*\|\s*DSML\s*\|))/gi;
    while ((pm = valueParamRe.exec(body)) !== null) {
      const key = pm[2].trim();
      if (!(key in input)) input[key] = parseDsmlParameterValue(pm[3] || '');
    }

    tools.push({ name, input: normalizeDsmlToolInput(name, input) });
  }
  return tools;
}

export function findFirstToolCallStart(text: string): number {
  const indexes: number[] = [];
  const bracket = text.indexOf('[TOOL:');
  if (bracket >= 0) indexes.push(bracket);
  const dsml = findNextDsmlToolCallStart(text);
  if (dsml >= 0) indexes.push(dsml);
  const callRe = makeAnyCallingRegex();
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    const name = cm[1];
    const shellTranscript = extractShellTranscriptCommand(text, callRe.lastIndex);
    if ((name && isRegisteredFakeToolName(name)) || (((!name || isShellTranscriptName(name))) && shellTranscript)) {
      indexes.push(cm.index);
    }
  }
  const toolArgsRe = makeToolArgumentsRegex();
  let tm: RegExpExecArray | null;
  while ((tm = toolArgsRe.exec(text)) !== null) {
    if (isRegisteredFakeToolName(tm[1])) indexes.push(tm.index);
  }
  let searchAt = 0;
  while (searchAt < text.length) {
    const start = findNextJsonStart(text, searchAt);
    if (start < 0) break;
    const end = text[start] === '[' ? findJsonArrayEnd(text, start) : findJsonObjectEnd(text, start);
    if (end < 0) {
      const tail = text.slice(start);
      if (/"(?:tool|name|type)"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) indexes.push(start);
      else if (text[start] === '[') {
        searchAt = start + 1;
        continue;
      }
      break;
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (jsonValueContainsToolPayload(parsed)) {
        indexes.push(start);
      }
    } catch { /* ignore non-tool JSON */ }
    searchAt = end + 1;
  }
  return indexes.length ? Math.min(...indexes) : -1;
}

export function stripToolCallBlocks(text: string): string {
  let result = '';
  let i = 0;
  const len = text.length;
  let removedInternalBlock = false;
  while (i < len) {
    if (text[i] === '[') {
      const lookahead = text.slice(i, Math.min(i + 60, len));
      const m = lookahead.match(/^\[TOOL:(\w+)\s*(?:\]?\s*)\{/);
      if (m) {
        removedInternalBlock = true;
        const bracePos = text.indexOf('{', i);
        if (bracePos < 0) { result += text[i]; i++; continue; }
        let depth = 1;
        let inStr = false;
        let j = bracePos + 1;
        while (j < len && depth > 0) {
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
          }
          j++;
        }
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
  const beforeBracketCleanup = result;
  result = result.replace(/\[TOOL:\w+\]\s*\{[^]*?\}(?:\n|$)/gm, '');
  removedInternalBlock = removedInternalBlock || result !== beforeBracketCleanup;

  const beforeCallingCleanup = result;
  result = stripCallingShellTranscriptBlocks(result);
  result = stripCallingToolBlocks(result);
  result = stripToolArgumentsBlocks(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;

  const beforeJsonCleanup = result;
  result = stripJsonToolPayloads(result);
  removedInternalBlock = removedInternalBlock || result !== beforeJsonCleanup;

  const beforeDsmlCleanup = result;
  result = stripDsmlToolCallBlocks(result);
  removedInternalBlock = removedInternalBlock || result !== beforeDsmlCleanup;

  const beforeXmlCleanup = result;
  const noXml = result
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '');
  removedInternalBlock = removedInternalBlock || noXml !== beforeXmlCleanup;

  const cleaned = noXml.replace(/\n{3,}/g, '\n\n').trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
}

function shellToken(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    return (end >= 0 ? text.slice(1, end) : text.slice(1)).trim();
  }
  const match = text.match(/^[^\s|;&<>]+/);
  return (match?.[0] ?? '').trim();
}

function cleanShellCommand(command: string): string {
  return command
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\$\s*/, '').replace(/^>\s*/, ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function cleanShellPath(path: string): string {
  return path
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\.\//, '')
    .replace(/^\$?{?workspaceRoot}?\//, '')
    .replace(/^\$?{?workspaceFolder}?\//, '');
}

function globJoin(root: string, name: string): string {
  const cleanRoot = cleanShellPath(root).replace(/\/+$/, '');
  const cleanName = cleanShellPath(name);
  if (!cleanRoot || cleanRoot === '.') return `**/${cleanName}`;
  return `${cleanRoot}/**/${cleanName}`;
}

function shellJsonCommandPayload(command: string): { command: string; workdir?: string } | null {
  const trimmed = command.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const rawCommand = typeof obj.command === 'string'
      ? obj.command
      : typeof obj.cmd === 'string'
        ? obj.cmd
        : '';
    const shellCommand = rawCommand.trim();
    if (!shellCommand) return null;
    const workdir = typeof obj.workdir === 'string' && obj.workdir.trim()
      ? obj.workdir.trim()
      : undefined;
    return { command: shellCommand, workdir };
  } catch {
    return null;
  }
}

function shellCommandToFakeTool(command: string): FakeTool | null {
  let cleaned = cleanShellCommand(command);
  const payload = shellJsonCommandPayload(cleaned);
  const workdir = payload?.workdir;
  if (payload) cleaned = cleanShellCommand(payload.command);
  if (!looksLikeShellCommandBlock(cleaned)) return null;
  const firstLine = cleaned.split(/\r?\n/).find(Boolean) ?? cleaned;

  const catMatch = firstLine.match(/^(?:cat|type|Get-Content)\s+(.+)$/i);
  if (catMatch) {
    const target = cleanShellPath(shellToken(catMatch[1]));
    if (target) return { name: 'read_file', input: { path: target } };
  }

  const findMatch = firstLine.match(/^find\s+(.+?)\s+-name\s+(['"]?)([^'"\s]+)\2/i);
  if (findMatch) {
    return { name: 'file_search', input: { glob: globJoin(findMatch[1], findMatch[3]) } };
  }

  const rgMatch = firstLine.match(/^rg\s+(?:-[A-Za-z0-9]+\s+)*(['"])(.*?)\1(?:\s+(.+))?$/i);
  if (rgMatch) {
    return {
      name: 'grep_search',
      input: {
        pattern: rgMatch[2],
        ...(rgMatch[3] ? { path: cleanShellPath(shellToken(rgMatch[3])) } : {}),
      },
    };
  }

  return { name: 'run_terminal', input: { command: cleaned, ...(workdir ? { workdir } : {}) } };
}

function extractShellTranscriptCommand(text: string, callEnd: number): { command: string; end: number } | null {
  let pos = lineEndAfter(text, callEnd);
  pos = skipBlankLines(text, pos);

  if (text.startsWith('```', pos)) {
    const headerEnd = lineEndAfter(text, pos + 3);
    const close = text.indexOf('```', headerEnd);
    const contentEnd = close >= 0 ? close : text.length;
    const command = text.slice(headerEnd, contentEnd).trim();
    const end = close >= 0 ? lineEndAfter(text, close + 3) : text.length;
    return command && looksLikeShellCommandBlock(command) ? { command, end } : null;
  }

  const lines: string[] = [];
  const callLineRe = /^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?[A-Za-z_]\w*`?\]?/i;
  let end = pos;
  while (end < text.length) {
    const next = lineEndAfter(text, end);
    const line = text.slice(end, next);
    const trimmed = line.trim();
    if (!trimmed || callLineRe.test(trimmed)) break;
    lines.push(line);
    end = next;
  }
  const command = lines.join('').trim();
  return command && looksLikeShellCommandBlock(command) ? { command, end } : null;
}

function parseShellTranscriptToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const callRe = makeAnyCallingRegex();
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    if (cm[1] && !isShellTranscriptName(cm[1])) continue;
    const extracted = extractShellTranscriptCommand(text, callRe.lastIndex);
    if (!extracted) continue;
    const tool = shellCommandToFakeTool(extracted.command);
    if (tool) tools.push(tool);
    callRe.lastIndex = extracted.end;
  }
  return tools;
}

export function parseFakeToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const re = /\[TOOL:(\w+)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let jsonStart = m.index + m[0].length;
    if (text[jsonStart] === ']') jsonStart++;
    while (jsonStart < text.length && (text[jsonStart] === ' ' || text[jsonStart] === '\t' || text[jsonStart] === '\n' || text[jsonStart] === '\r')) jsonStart++;
    if (text[jsonStart] !== '{') continue;
    const jsonEnd = findToolInputObjectEnd(text, name, jsonStart);
    if (jsonEnd < 0) continue;
    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      tools.push({ name, input: JSON.parse(jsonStr) });
    } catch {
      const looseInput = parseLooseFileWriteToolInput(name, jsonStr);
      if (looseInput) tools.push({ name, input: looseInput });
    }
    re.lastIndex = jsonEnd + 1;
  }

  if (tools.length === 0) {
    const callRe = makeCallingRegex();
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(text)) !== null) {
      const name = cm[1];
      if (!isRegisteredFakeToolName(name)) continue;
      let jsonStart = text.indexOf('{', callRe.lastIndex);
      if (jsonStart < 0) continue;
      const fenceEnd = text.indexOf('```', callRe.lastIndex);
      if (fenceEnd >= 0 && fenceEnd < jsonStart) {
        const afterFenceNewline = text.indexOf('\n', fenceEnd);
        const fencedJsonStart = afterFenceNewline >= 0 ? text.indexOf('{', afterFenceNewline) : -1;
        if (fencedJsonStart >= 0) jsonStart = fencedJsonStart;
      }
      const jsonEnd = findToolInputObjectEnd(text, name, jsonStart);
      if (jsonEnd < 0) continue;
      const jsonText = text.slice(jsonStart, jsonEnd + 1);
      try {
        tools.push({ name, input: JSON.parse(jsonText) });
        callRe.lastIndex = jsonEnd + 1;
      } catch {
        const looseInput = parseLooseFileWriteToolInput(name, jsonText);
        if (looseInput) {
          tools.push({ name, input: looseInput });
          callRe.lastIndex = jsonEnd + 1;
        }
      }
    }
  }

  if (tools.length === 0) {
    tools.push(...parseToolArgumentsToolCalls(text));
  }

  if (tools.length === 0) {
    tools.push(...parseDsmlToolCalls(text));
  }

  if (tools.length === 0) {
    tools.push(...parseShellTranscriptToolCalls(text));
  }

  if (tools.length === 0) {
    tools.push(...parseJsonArrayToolCalls(text));
  }

  if (tools.length === 0) {
    const start = text.indexOf('{');
    if (start >= 0) {
      const end = findJsonObjectEnd(text, start);
      if (end >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
          const toolObj = jsonObjectToFakeTool(obj);
          if (toolObj) {
            tools.push(toolObj);
          } else if (Array.isArray(obj.todoList)) {
            tools.push({ name: 'manage_todo_list', input: { todoList: obj.todoList } });
          } else if (typeof obj.summary === 'string' && /(?:完成|结束|complete|done)/i.test(text) && !hasShellTranscriptMarker(text)) {
            tools.push({ name: 'task_complete', input: { summary: obj.summary } });
          }
        } catch { /* ignore non-tool JSON */ }
      }
    }
  }

  if (tools.length === 0) {
    const jsonBlockRe = /(?:```json\s*)(\[[\s\S]*?\])(?:\s*```)|(?<![A-Za-z\[])(\[[\s\S]{2,3000}?\])/g;
    let bm: RegExpExecArray | null;
    while ((bm = jsonBlockRe.exec(text)) !== null) {
      const jsonCandidate = (bm[1] || bm[2] || '').trim();
      if (!jsonCandidate.startsWith('[')) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(jsonCandidate); } catch { continue; }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed as unknown[]) {
        if (typeof item !== 'object' || item === null) continue;
        const obj = item as Record<string, unknown>;
        const converted = jsonObjectToFakeTool(obj);
        if (converted) {
          tools.push(converted);
          continue;
        }
        const toolName = typeof obj['tool'] === 'string' ? (obj['tool'] as string) : null;
        if (!toolName) continue;
        const input: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k !== 'tool') input[k] = v;
        }
        tools.push({ name: toolName, input });
      }
    }
  }

  if (tools.length === 0) {
    const xmlRe = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let xm: RegExpExecArray | null;
    while ((xm = xmlRe.exec(text)) !== null) {
      const inner = xm[1].trim();
      if (inner.startsWith('{')) {
        try {
          const obj = JSON.parse(inner) as Record<string, unknown>;
          const tName = typeof obj['name'] === 'string' ? obj['name'] as string : null;
          if (tName) {
            const inp = (obj['arguments'] ?? obj['parameters'] ?? obj['args'] ?? {}) as Record<string, unknown>;
            tools.push({ name: tName, input: inp });
            continue;
          }
        } catch { /* fall through to Format A */ }
      }
      const nl = inner.indexOf('\n');
      if (nl < 0) continue;
      const tName = inner.slice(0, nl).trim();
      const jsonPart = inner.slice(nl + 1).trim();
      if (!tName || !jsonPart.startsWith('{')) continue;
      try {
        tools.push({ name: tName, input: JSON.parse(jsonPart) });
      } catch { /* ignore malformed */ }
    }
  }

  if (tools.length === 0) {
    const invokeRe = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    let im: RegExpExecArray | null;
    while ((im = invokeRe.exec(text)) !== null) {
      const tName = im[1].trim();
      const body = im[2];
      const input: Record<string, unknown> = {};
      const selfRe = /<parameter\s+name="([^"]+)"\s+value="([\s\S]*?)"\s*\/>/gi;
      let pm: RegExpExecArray | null;
      while ((pm = selfRe.exec(body)) !== null) {
        const pName = pm[1];
        const pVal = pm[2];
        try { input[pName] = JSON.parse(pVal); } catch { input[pName] = pVal; }
      }
      const blockRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
      while ((pm = blockRe.exec(body)) !== null) {
        const pName = pm[1];
        const pVal = pm[2].trim();
        try { input[pName] = JSON.parse(pVal); } catch { input[pName] = pVal; }
      }
      tools.push({ name: tName, input });
    }
  }

  return tools;
}
