import {
  decodeLooseJsonString,
  findJsonArrayEnd,
  findJsonObjectEnd,
} from './loose-json-text';
import type { FakeTool, FakeToolJsonUtilsContext } from './fake-tool-types';

export { decodeLooseJsonString, findJsonArrayEnd, findJsonObjectEnd } from './loose-json-text';
export type { FakeTool, FakeToolJsonUtilsContext } from './fake-tool-types';

const LOOSE_FILE_WRITE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file']);
const LOOSE_FILE_WRITE_PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'];
const LOOSE_FILE_WRITE_CONTENT_KEYS = [
  'content', 'contents', 'text', 'body',
  'fileContent', 'file_content', 'source', 'code', 'newContent', 'new_content',
];
const LOOSE_REPLACE_OLD_KEYS = [
  'old_str', 'oldString', 'old_string', 'oldText', 'old_text', 'search', 'find', 'target',
];
const LOOSE_REPLACE_NEW_KEYS = [
  'new_str', 'newString', 'new_string', 'newText', 'new_text', 'replace', 'replacement', 'with',
];
const LOOSE_REPLACE_TRAILING_KEYS = new Set(['replaceAll']);
const IMPLICIT_FILE_WRITE_KEYS = new Set([
  ...LOOSE_FILE_WRITE_PATH_KEYS,
  ...LOOSE_FILE_WRITE_CONTENT_KEYS,
]);
const LOOSE_TERMINAL_TRAILING_KEYS = new Set([
  'workdir', 'cwd', 'maxOutputLines', 'timeout', 'timeoutMs',
  'is_background', 'isBackground', 'requires_approval', 'requiresApproval',
]);
const IMPLICIT_TERMINAL_KEYS = new Set([
  'command', 'cmd',
  ...LOOSE_TERMINAL_TRAILING_KEYS,
]);
const TOOL_ARRAY_WRAPPER_KEYS = ['tool_calls', 'toolCalls', 'tools'];
const TOOL_SINGLE_WRAPPER_KEYS = ['function_call', 'functionCall', 'tool_call', 'toolCall'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJsonWithRepairedInvalidEscapes(jsonText: string): Record<string, unknown> | null {
  const repaired = jsonText.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
  if (repaired === jsonText) return null;
  try {
    const parsed = JSON.parse(repaired) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isEscapedQuote(text: string, quoteIndex: number, valueStart: number): boolean {
  let slashCount = 0;
  for (let i = quoteIndex - 1; i >= valueStart && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}

function extractLooseJsonStringField(
  jsonText: string,
  key: string,
  allowedFollowingKeys?: ReadonlySet<string>,
): string | undefined {
  const keyRe = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"`, 'i');
  const match = keyRe.exec(jsonText);
  if (!match) return undefined;
  const valueStart = match.index + match[0].length;
  let valueEnd = -1;

  for (let i = valueStart; i < jsonText.length; i++) {
    if (jsonText[i] !== '"' || isEscapedQuote(jsonText, i, valueStart)) continue;
    const afterQuote = jsonText.slice(i + 1);
    const nextField = /^\s*,\s*"([A-Za-z_][\w-]*)"\s*:/.exec(afterQuote);
    const closesObject = /^\s*}\s*$/.test(afterQuote);
    if (closesObject || (nextField && (!allowedFollowingKeys || allowedFollowingKeys.has(nextField[1])))) {
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
  if (/^<\/?\s*(?:TOOL_CALL|TOOL)\s*>/i.test(text.slice(i))) return closeBrace;
  if (text.startsWith('[TOOL:', i) || text.startsWith('```', i)) return closeBrace;
  if (/^(?:Calling|Call|调用)\b/i.test(text.slice(i, i + 20))) return closeBrace;
  if (/^Action\s*[:：]\s*`?[A-Za-z_]\w*/i.test(text.slice(i, i + 80))) return closeBrace;
  return -1;
}

function firstStringObjectField(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return undefined;
}

function looksLikeToolPathValue(value: string): boolean {
  return /^(?:\/|~\/|\.\.?\/|[A-Za-z]:[\\/])/.test(value);
}

function looksLikeDirectoryPathValue(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.endsWith('/')) return true;
  const base = normalized.split('/').filter(Boolean).pop() || '';
  return !/\.[A-Za-z0-9]+$/.test(base);
}

export function createFakeToolJsonUtils(context: FakeToolJsonUtilsContext) {
  const normalizeToolName = context.normalizeToolName;

  function findLooseReplaceObjectEnd(text: string, name: string, jsonStart: number): number {
    if (normalizeToolName(name) !== 'replace_in_file' || text[jsonStart] !== '{') return -1;
    if (findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_FILE_WRITE_PATH_KEYS) < 0) return -1;
    if (findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_REPLACE_OLD_KEYS) < 0) return -1;
    const newValueStart = findLooseJsonStringFieldValueStart(text, jsonStart, LOOSE_REPLACE_NEW_KEYS);
    if (newValueStart < 0) return -1;

    for (let i = newValueStart; i < text.length; i++) {
      if (text[i] !== '"' || isEscapedQuote(text, i, newValueStart)) continue;
      const close = findLooseObjectCloseAfterString(text, i + 1);
      if (close >= 0) return close;
    }
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

  function findLooseManageTodoListObjectEnd(text: string, name: string, jsonStart: number): number {
    if (normalizeToolName(name) !== 'manage_todo_list' || text[jsonStart] !== '{') return -1;
    const todoKey = /"todoList"\s*:\s*"?/gi;
    todoKey.lastIndex = jsonStart;
    const match = todoKey.exec(text);
    if (!match) return -1;
    const arrayStart = text.indexOf('[', todoKey.lastIndex);
    if (arrayStart < 0) return -1;
    const arrayEnd = findJsonArrayEnd(text, arrayStart);
    if (arrayEnd < 0) return -1;
    let i = arrayEnd + 1;
    while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
    if (text[i] === '"') i++;
    while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
    return text[i] === '}' ? i : -1;
  }

  function findLooseTaskCompleteObjectEnd(text: string, name: string, jsonStart: number): number {
    if (normalizeToolName(name) !== 'task_complete' || text[jsonStart] !== '{') return -1;
    const summaryValueStart = findLooseJsonStringFieldValueStart(text, jsonStart, ['summary']);
    if (summaryValueStart < 0) return -1;

    for (let i = summaryValueStart; i < text.length; i++) {
      if (text[i] !== '"' || isEscapedQuote(text, i, summaryValueStart)) continue;
      const close = findLooseObjectCloseAfterString(text, i + 1);
      if (close >= 0) return close;
    }
    return -1;
  }

  function findToolInputObjectEnd(text: string, name: string, jsonStart: number): number {
    const strictEnd = findJsonObjectEnd(text, jsonStart);
    if (strictEnd < 0) {
      return Math.max(
        findLooseFileWriteObjectEnd(text, name, jsonStart),
        findLooseReplaceObjectEnd(text, name, jsonStart),
        findLooseManageTodoListObjectEnd(text, name, jsonStart),
        findLooseTaskCompleteObjectEnd(text, name, jsonStart),
      );
    }
    try {
      JSON.parse(text.slice(jsonStart, strictEnd + 1));
      return strictEnd;
    } catch {
      const looseEnd = Math.max(
        findLooseFileWriteObjectEnd(text, name, jsonStart),
        findLooseReplaceObjectEnd(text, name, jsonStart),
        findLooseManageTodoListObjectEnd(text, name, jsonStart),
        findLooseTaskCompleteObjectEnd(text, name, jsonStart),
      );
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

  function parseLooseRunTerminalToolInput(name: string, jsonText: string): Record<string, unknown> | null {
    if (normalizeToolName(name) !== 'run_terminal') return null;
    const command = extractLooseJsonStringField(jsonText, 'command', LOOSE_TERMINAL_TRAILING_KEYS)
      ?? extractLooseJsonStringField(jsonText, 'cmd', LOOSE_TERMINAL_TRAILING_KEYS);
    if (typeof command !== 'string' || !command.trim()) return null;

    const input: Record<string, unknown> = { command };
    const workdir = extractLooseJsonStringField(jsonText, 'workdir')
      ?? extractLooseJsonStringField(jsonText, 'cwd');
    if (typeof workdir === 'string' && workdir.trim()) input.workdir = workdir.trim();
    return input;
  }

  function parseLooseReplaceInFileToolInput(name: string, jsonText: string): Record<string, unknown> | null {
    if (normalizeToolName(name) !== 'replace_in_file') return null;

    let path: string | undefined;
    for (const key of LOOSE_FILE_WRITE_PATH_KEYS) {
      const value = extractLooseJsonStringField(jsonText, key);
      if (typeof value === 'string' && value.trim()) {
        path = value.trim();
        break;
      }
    }

    let oldStr: string | undefined;
    const newFieldKeys = new Set(LOOSE_REPLACE_NEW_KEYS);
    for (const key of LOOSE_REPLACE_OLD_KEYS) {
      const value = extractLooseJsonStringField(jsonText, key, newFieldKeys);
      if (typeof value === 'string') {
        oldStr = value;
        break;
      }
    }

    let newStr: string | undefined;
    for (const key of LOOSE_REPLACE_NEW_KEYS) {
      const value = extractLooseJsonStringField(jsonText, key, LOOSE_REPLACE_TRAILING_KEYS);
      if (typeof value === 'string') {
        newStr = value;
        break;
      }
    }

    if (!path || typeof oldStr !== 'string' || typeof newStr !== 'string') return null;
    const input: Record<string, unknown> = { path, old_str: oldStr, new_str: newStr };
    const replaceAll = /"replaceAll"\s*:\s*(true|false)/i.exec(jsonText);
    if (replaceAll) input.replaceAll = replaceAll[1].toLowerCase() === 'true';
    return input;
  }

  function parseLooseTaskCompleteToolInput(name: string, jsonText: string): Record<string, unknown> | null {
    if (normalizeToolName(name) !== 'task_complete') return null;
    const summary = extractLooseJsonStringField(jsonText, 'summary');
    if (typeof summary !== 'string' || !summary.trim()) return null;
    return { summary };
  }

  function parseLooseManageTodoListToolInput(name: string, jsonText: string): Record<string, unknown> | null {
    if (normalizeToolName(name) !== 'manage_todo_list') return null;
    const key = /"todoList"\s*:\s*"?/i.exec(jsonText);
    if (!key) return null;
    const arrayStart = jsonText.indexOf('[', key.index + key[0].length);
    if (arrayStart < 0) return null;
    const arrayEnd = findJsonArrayEnd(jsonText, arrayStart);
    if (arrayEnd < 0) return null;
    try {
      const parsed = JSON.parse(jsonText.slice(arrayStart, arrayEnd + 1)) as unknown;
      return Array.isArray(parsed) ? { todoList: parsed } : null;
    } catch {
      return null;
    }
  }

  function parseLooseToolInput(name: string, jsonText: string): Record<string, unknown> | null {
    return parseJsonWithRepairedInvalidEscapes(jsonText)
      ?? parseLooseManageTodoListToolInput(name, jsonText)
      ?? parseLooseFileWriteToolInput(name, jsonText)
      ?? parseLooseReplaceInFileToolInput(name, jsonText)
      ?? parseLooseRunTerminalToolInput(name, jsonText)
      ?? parseLooseTaskCompleteToolInput(name, jsonText);
  }

  function jsonObjectToImplicitArrayFakeTool(obj: Record<string, unknown>): FakeTool | null {
    const objectKeys = Object.keys(obj);
    const command = firstStringObjectField(obj, ['command', 'cmd']);
    if (command?.trim()) {
      if (!objectKeys.every(key => IMPLICIT_TERMINAL_KEYS.has(key))) return null;
      const input: Record<string, unknown> = { command: command.trim() };
      const workdir = firstStringObjectField(obj, ['workdir', 'cwd']);
      if (workdir?.trim()) input.workdir = workdir.trim();
      return { name: 'run_terminal', input };
    }

    const pathValue = (firstStringObjectField(obj, LOOSE_FILE_WRITE_PATH_KEYS) ?? '').trim();
    if (!pathValue || !looksLikeToolPathValue(pathValue)) return null;
    const content = firstStringObjectField(obj, LOOSE_FILE_WRITE_CONTENT_KEYS);
    if (content !== undefined) {
      if (!objectKeys.every(key => IMPLICIT_FILE_WRITE_KEYS.has(key))) return null;
      return { name: 'write_file', input: { path: pathValue, content } };
    }

    const harmlessKeys = new Set(['path', 'filePath', 'filepath', 'recursive', 'maxDepth', 'startLine', 'endLine']);
    if (!objectKeys.every(key => harmlessKeys.has(key))) return null;
    const name = looksLikeDirectoryPathValue(pathValue) ? 'list_dir' : 'read_file';
    return { name, input: { path: pathValue } };
  }

  function jsonArrayToFakeTools(value: unknown): FakeTool[] {
    if (!Array.isArray(value) || value.length === 0) return [];
    const tools: FakeTool[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const obj = item as Record<string, unknown>;
      const tool = context.jsonObjectToFakeTool(obj) ?? jsonObjectToImplicitArrayFakeTool(obj);
      if (!tool) return [];
      tools.push(tool);
    }
    return tools.map(context.normalizeFakeTool);
  }

  function jsonValueToFakeTools(value: unknown, depth = 0, allowMixedArray = false): FakeTool[] {
    if (depth > 4) return [];
    if (Array.isArray(value)) {
      const direct = jsonArrayToFakeTools(value);
      if (direct.length > 0) return direct;
      if (!allowMixedArray) return [];

      const collected: FakeTool[] = [];
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const nested = jsonValueToFakeTools(item, depth + 1);
        if (nested.length > 0) collected.push(...nested);
      }
      return collected.map(context.normalizeFakeTool);
    }

    if (!value || typeof value !== 'object') return [];
    const obj = value as Record<string, unknown>;
    const direct = context.jsonObjectToFakeTool(obj);
    if (direct) return [context.normalizeFakeTool(direct)];

    for (const key of TOOL_ARRAY_WRAPPER_KEYS) {
      const wrapped = obj[key];
      if (!Array.isArray(wrapped)) continue;
      const tools = jsonArrayToFakeTools(wrapped);
      if (tools.length > 0) return tools;
    }

    for (const key of TOOL_SINGLE_WRAPPER_KEYS) {
      const wrapped = obj[key];
      if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) continue;
      const tools = jsonValueToFakeTools(wrapped, depth + 1);
      if (tools.length > 0) return tools;
    }

    for (const choice of Array.isArray(obj.choices) ? obj.choices : []) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) continue;
      const choiceObj = choice as Record<string, unknown>;
      for (const key of ['message', 'delta']) {
        const nested = choiceObj[key];
        if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
        const tools = jsonValueToFakeTools(nested, depth + 1);
        if (tools.length > 0) return tools;
      }
    }

    for (const key of ['content', 'output']) {
      const wrapped = obj[key];
      if (!Array.isArray(wrapped)) continue;
      const tools = jsonValueToFakeTools(wrapped, depth + 1, true);
      if (tools.length > 0) return tools;
    }

    return [];
  }

  function jsonValueContainsToolPayload(value: unknown): boolean {
    return jsonValueToFakeTools(value).length > 0;
  }

  function hasUnclosedToolCallEnvelopePrefixBeforeJson(text: string, jsonStart: number): boolean {
    const prefix = text.slice(0, jsonStart);
    const openRe = /(?:<|&lt;)\s*tool_call\b[^>]*(?:>|&gt;)/gi;
    const closeRe = /(?:<\/|&lt;\/)\s*tool_call\s*(?:>|&gt;)/gi;
    let lastOpen = -1;
    let match: RegExpExecArray | null;
    while ((match = openRe.exec(prefix)) !== null) lastOpen = match.index;
    if (lastOpen < 0) return false;

    let lastClose = -1;
    while ((match = closeRe.exec(prefix)) !== null) lastClose = match.index;
    if (lastClose > lastOpen) return false;
    return !closeRe.test(text.slice(jsonStart));
  }

  return {
    findToolInputObjectEnd,
    hasUnclosedToolCallEnvelopePrefixBeforeJson,
    jsonArrayToFakeTools,
    jsonObjectToImplicitArrayFakeTool,
    jsonValueContainsToolPayload,
    jsonValueToFakeTools,
    parseLooseToolInput,
  };
}
