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

function stripCallingToolBlocks(text: string): string {
  let out = '';
  let i = 0;
  const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) {
      out += text.slice(i);
      break;
    }
    const name = m[1];
    if (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__')) {
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

function stripCallingFenceBlocks(text: string): string {
  return text
    .replace(
      /(?:^|\n)[ \t]*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(bash|shell|sh|zsh|console)`?\]?[^\n]*\n[ \t]*```(?:bash|shell|sh|zsh|console)?\s*\n[\s\S]*?```/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)[ \t]*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(bash|shell|sh|zsh|console)`?\]?[^\n]*(?=\n|$)/gi,
      '\n',
    );
}

export function jsonObjectToFakeTool(obj: Record<string, unknown>): FakeTool | null {
  const rawName = typeof obj.tool === 'string'
    ? obj.tool
    : typeof obj.name === 'string'
      ? obj.name
      : '';
  const name = rawName.trim();
  if (!name || (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__'))) return null;
  const maybeArgs = obj.arguments ?? obj.parameters ?? obj.args;
  let input: Record<string, unknown>;
  if (maybeArgs && typeof maybeArgs === 'object' && !Array.isArray(maybeArgs)) {
    input = maybeArgs as Record<string, unknown>;
  } else {
    input = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!['tool', 'name', 'arguments', 'parameters', 'args'].includes(k)) input[k] = v;
    }
  }
  return { name, input };
}

function stripJsonToolPayloads(text: string): string {
  const result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, (full, inner) => {
    const trimmed = String(inner || '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return full;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.some(item => item && typeof item === 'object' && jsonObjectToFakeTool(item as Record<string, unknown>)) ? '' : full;
      }
      if (parsed && typeof parsed === 'object' && jsonObjectToFakeTool(parsed as Record<string, unknown>)) return '';
    } catch { /* keep non-tool JSON */ }
    return full;
  });

  let i = 0;
  let out = '';
  while (i < result.length) {
    const start = result.indexOf('{', i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    const end = findJsonObjectEnd(result, start);
    if (end < 0) { out += result.slice(start); break; }
    const candidate = result.slice(start, end + 1);
    let stripped = false;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && jsonObjectToFakeTool(parsed as Record<string, unknown>)) {
        stripped = true;
      }
    } catch { /* keep non-tool JSON */ }
    if (!stripped) out += candidate;
    i = end + 1;
  }
  return out;
}

export function findFirstToolCallStart(text: string): number {
  const indexes: number[] = [];
  const bracket = text.indexOf('[TOOL:');
  if (bracket >= 0) indexes.push(bracket);
  const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    const name = cm[1];
    if (KNOWN_FAKE_TOOL_NAMES.has(name) || name.startsWith('mcp__')) indexes.push(cm.index);
  }
  let searchAt = 0;
  while (searchAt < text.length) {
    const start = text.indexOf('{', searchAt);
    if (start < 0) break;
    const end = findJsonObjectEnd(text, start);
    if (end < 0) {
      const tail = text.slice(start);
      if (/"tool"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) indexes.push(start);
      break;
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && jsonObjectToFakeTool(parsed as Record<string, unknown>)) {
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
  result = stripCallingFenceBlocks(result);
  result = stripCallingToolBlocks(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;

  const beforeJsonCleanup = result;
  result = stripJsonToolPayloads(result);
  removedInternalBlock = removedInternalBlock || result !== beforeJsonCleanup;

  const beforeXmlCleanup = result;
  const noXml = result
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '');
  removedInternalBlock = removedInternalBlock || noXml !== beforeXmlCleanup;

  const cleaned = noXml.replace(/\n{3,}/g, '\n\n').trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
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
    let depth = 0; let inStr = false; let j = jsonStart;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') { j++; }
        else if (ch === '"') { inStr = false; }
      } else {
        if (ch === '"') { inStr = true; }
        else if (ch === '{') { depth++; }
        else if (ch === '}') { depth--; if (depth === 0) break; }
      }
    }
    if (depth !== 0) continue;
    const jsonStr = text.slice(jsonStart, j + 1);
    try {
      tools.push({ name, input: JSON.parse(jsonStr) });
    } catch { /* ignore malformed JSON */ }
  }

  if (tools.length === 0) {
    const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(text)) !== null) {
      const name = cm[1];
      if (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__')) continue;
      let jsonStart = text.indexOf('{', callRe.lastIndex);
      if (jsonStart < 0) continue;
      const fenceEnd = text.indexOf('```', callRe.lastIndex);
      if (fenceEnd >= 0 && fenceEnd < jsonStart) {
        const afterFenceNewline = text.indexOf('\n', fenceEnd);
        const fencedJsonStart = afterFenceNewline >= 0 ? text.indexOf('{', afterFenceNewline) : -1;
        if (fencedJsonStart >= 0) jsonStart = fencedJsonStart;
      }
      const jsonEnd = findJsonObjectEnd(text, jsonStart);
      if (jsonEnd < 0) continue;
      try {
        tools.push({ name, input: JSON.parse(text.slice(jsonStart, jsonEnd + 1)) });
        callRe.lastIndex = jsonEnd + 1;
      } catch { /* ignore malformed */ }
    }
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
          } else if (typeof obj.summary === 'string' && /(?:完成|结束|complete|done)/i.test(text)) {
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
