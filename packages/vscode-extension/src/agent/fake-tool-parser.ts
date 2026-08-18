import {
  listCodingToolNames as listAgentToolNames,
  normalizeCodingToolName as normalizeAgentToolName,
} from '@devseek-netai/shared';
import {
  findFirstModelToolProtocolStart,
  isolateModelToolRequestText,
  parseModelToolProtocol,
  stripModelToolProtocolBlocks,
  type ModelToolProtocolDialect,
} from './model-tool-protocol-adapter';
import { createStructuredToolEnvelopeDialects } from './structured-tool-envelope-dialects';
import { createLegacyToolCallXmlDialect } from './legacy-tool-call-xml-dialect';
import { createBareToolCommandDialect } from './bare-tool-command-dialect';
import {
  createBareJsonToolCallDialect,
  createFencedAnonymousJsonToolDialect,
} from './bare-json-tool-call-dialect';
import { normalizeFakeTool, normalizeToolInput } from './fake-tool-input-normalizer';
import { createFakeToolJsonUtils, decodeLooseJsonString, findJsonArrayEnd, findJsonObjectEnd, type FakeTool } from './fake-tool-json-utils';
import { decodeXmlishText, stripJsonFence } from './tool-protocol-text';
import {
  createXmlToolDialects,
  parseXmlToolParameterBody,
  primaryScalarInputKeyForTool,
} from './xml-tool-dialects';

export { findJsonArrayEnd, findJsonObjectEnd };
export type { FakeTool } from './fake-tool-json-utils';

export const KNOWN_FAKE_TOOL_NAMES = new Set(listAgentToolNames());

function makeRawNamedToolAttemptRegex(flags = 'gi'): RegExp {
  return new RegExp(String.raw`<\s*TOOL\s+name\s*=\s*(["'])([A-Za-z0-9_]+)\1\s*>\s*\{`, flags);
}

function findRawNamedToolAttemptStart(text: string): number {
  const regex = makeRawNamedToolAttemptRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = normalizeAgentToolName(match[2]);
    if (KNOWN_FAKE_TOOL_NAMES.has(name) || /^mcp__[A-Za-z0-9_]+$/.test(name)) return match.index;
  }
  return -1;
}

function stripRawNamedToolAttempts(text: string): { text: string; removed: boolean } {
  const regex = makeRawNamedToolAttemptRegex();
  let output = '';
  let cursor = 0;
  let removed = false;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = normalizeAgentToolName(match[2]);
    if (!KNOWN_FAKE_TOOL_NAMES.has(name) && !/^mcp__[A-Za-z0-9_]+$/.test(name)) continue;
    output += text.slice(cursor, match.index).replace(/[ \t]+$/, '');
    const close = /<\/\s*TOOL\s*>/gi;
    close.lastIndex = regex.lastIndex;
    const closeMatch = close.exec(text);
    cursor = closeMatch ? close.lastIndex : text.length;
    regex.lastIndex = cursor;
    removed = true;
  }
  if (!removed) return { text, removed: false };
  output += text.slice(cursor);
  return { text: output, removed: true };
}

const SHELL_TRANSCRIPT_NAMES = new Set([
  'bash', 'shell', 'sh', 'zsh', 'console', 'terminal', 'cmd', 'powershell', 'pwsh',
]);

const DSML_BAR_PATTERN = '[|｜]{1,2}';
const DSML_MARKER_PATTERN = `${DSML_BAR_PATTERN}\\s*DSML\\s*${DSML_BAR_PATTERN}`;
const DSML_OPEN_PREFIX_PATTERN = '(?:<|&lt;)\\s*';
const DSML_CLOSE_PREFIX_PATTERN = '(?:<\\/|&lt;\\/)\\s*';
const DSML_START_NAMES_PATTERN = '(?:tool_calls|invoke|parameter)';
const TOOL_CALL_OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL_CALL\\s*(?:>|&gt;)';
const TOOL_CALL_CLOSE_PATTERN = '(?:<\\/|&lt;\\/)\\s*TOOL_CALL\\s*(?:>|&gt;)';
const TOOL_CALL_INCOMPLETE_TAIL_PATTERN = /(?:<|&lt;)\s*(?:T|TO|TOO|TOOL|TOOL_|TOOL_C|TOOL_CA|TOOL_CAL|TOOL_CALL)?$/i;
const DSML_INCOMPLETE_TAIL_PATTERN = new RegExp(
  `${DSML_OPEN_PREFIX_PATTERN}(?:${DSML_BAR_PATTERN}\\s*(?:D(?:S(?:M(?:L)?)?)?(?:\\s*${DSML_BAR_PATTERN})?)?)?$`,
  'i',
);
const CALLING_MARKDOWN_MARKER_PATTERN = '[*_]{0,3}';
const CALLING_LABEL_PATTERN = [
  '(?:\\[\\s*)?',
  CALLING_MARKDOWN_MARKER_PATTERN,
  '(?:(?:Calling|Call)(?![A-Za-z_])|调用)',
  '(?:[ \\t]*[:：]?[ \\t]*tool\\b|[ \\t]+tool\\b)?',
  '[ \\t]*[:：]?',
  `[ \\t]*${CALLING_MARKDOWN_MARKER_PATTERN}[ \\t]*`,
].join('');
const MARKDOWN_TOOL_LINK_SCALAR_NAMES = new Set([
  'read_file',
  'list_dir',
  'file_search',
  'search_file',
  'grep_search',
  'semantic_search',
  'fetch_webpage',
]);

function makeCallingToolNamePattern(includeShellNames = false): string {
  const names = listAgentToolNames(true);
  if (includeShellNames) names.push(...Array.from(SHELL_TRANSCRIPT_NAMES));
  const escapedNames = names
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const mcpPattern = 'mcp__[A-Za-z0-9_]+';
  return `\\[?\`?(${escapedNames ? `(?:${escapedNames}|${mcpPattern})` : `(?:${mcpPattern})`})\`?\\]?`;
}

function makeDsmlStartRegex(flags = 'gi'): RegExp {
  return new RegExp(`${DSML_OPEN_PREFIX_PATTERN}${DSML_MARKER_PATTERN}\\s*${DSML_START_NAMES_PATTERN}\\b`, flags);
}

function makeDsmlCloseRegex(name: string): RegExp {
  return new RegExp(`${DSML_CLOSE_PREFIX_PATTERN}${DSML_MARKER_PATTERN}\\s*${escapeRegExp(name)}\\s*(?:>|&gt;)`, 'i');
}

function dsmlOpenTagPattern(name: string): string {
  return `<\\s*${DSML_MARKER_PATTERN}\\s*${name}\\b`;
}

function dsmlCloseTagPattern(name: string): string {
  return `<\\/\\s*${DSML_MARKER_PATTERN}\\s*${name}\\s*>`;
}

function makeCallingRegex(): RegExp {
  return new RegExp(`${CALLING_LABEL_PATTERN}${makeCallingToolNamePattern(false)}`, 'gi');
}

function makeAnyCallingRegex(): RegExp {
  return new RegExp(`${CALLING_LABEL_PATTERN}(?:${makeCallingToolNamePattern(true)})?`, 'gi');
}

function makeCallingLineRegex(): RegExp {
  return new RegExp(`^${CALLING_LABEL_PATTERN}(?:${makeCallingToolNamePattern(true)})?`, 'i');
}

export function makeIncompleteCallingTailRegex(): RegExp {
  return new RegExp(`${CALLING_LABEL_PATTERN}(?:${makeCallingToolNamePattern(true)})?\\s*$`, 'i');
}

function makeMarkdownToolLinkRegex(flags = 'gi'): RegExp {
  const names = listAgentToolNames(true)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const mcpPattern = 'mcp__[A-Za-z0-9_]+';
  return new RegExp(
    `\\[\\s*(?:Tool[ \\t_-]*Call|工具调用|调用工具)\\s*[:：]\\s*\`?((?:${names ? `${names}|` : ''}${mcpPattern}))\`?\\s*\\]\\(\\s*([^\\)\\r\\n]+?)\\s*\\)`,
    flags,
  );
}

function makeToolArgumentsRegex(): RegExp {
  const names = listAgentToolNames(true)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(
    `[*_]{0,3}\\s*Tool\\s*:\\s*\`?(${names}|mcp__[A-Za-z0-9_]+)\`?\\s*[*_]{0,3}\\s*` +
    `(?:(?:Arguments?|Args|参数)\\s*[:：]\\s*)?`,
    'gi',
  );
}

function makeFunctionStyleToolCallRegex(): RegExp {
  const names = listAgentToolNames(true)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`(${names}|mcp__[A-Za-z0-9_]+)\\s*\\(\\s*\\{`, 'g');
}

function makeToolCallEnvelopeOpenRegex(flags = 'gi'): RegExp {
  return new RegExp(TOOL_CALL_OPEN_PATTERN, flags);
}

function makeToolCallEnvelopeBlockRegex(flags = 'gi'): RegExp {
  return new RegExp(`${TOOL_CALL_OPEN_PATTERN}([\\s\\S]*?)${TOOL_CALL_CLOSE_PATTERN}`, flags);
}

function makeToolCallEnvelopePairRegex(flags = 'gi'): RegExp {
  return new RegExp(
    `${TOOL_CALL_OPEN_PATTERN}([\\s\\S]*?)${TOOL_CALL_CLOSE_PATTERN}\\s*` +
    `${TOOL_CALL_OPEN_PATTERN}([\\s\\S]*?)${TOOL_CALL_CLOSE_PATTERN}`,
    flags,
  );
}

function isRegisteredFakeToolName(name: string): boolean {
  return KNOWN_FAKE_TOOL_NAMES.has(normalizeAgentToolName(name)) || name.startsWith('mcp__');
}

function isShellTranscriptName(name: string): boolean {
  return SHELL_TRANSCRIPT_NAMES.has(String(name || '').toLowerCase());
}

const fakeToolJsonUtils = createFakeToolJsonUtils({
  normalizeToolName: normalizeAgentToolName,
  jsonObjectToFakeTool,
  normalizeFakeTool,
});
const {
  findToolInputObjectEnd,
  hasUnclosedToolCallEnvelopePrefixBeforeJson,
  jsonArrayToFakeTools,
  jsonObjectToImplicitArrayFakeTool,
  jsonValueContainsToolPayload,
  jsonValueToFakeTools,
  parseLooseToolInput,
} = fakeToolJsonUtils;

function looksLikeNonShellTranscriptLine(line: string): boolean {
  const first = line.trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  if (!first) return true;
  if (/^\|.*\|\s*$/.test(first)) return true;
  if (/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(first)) return true;
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
  if (looksLikeStructuredJsonBlock(text)) return false;
  return text.split(/\r?\n/).some(line => isShellCommandLine(line));
}

function looksLikeStructuredJsonBlock(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[{\[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return /^\{\s*"(?:tool_calls|toolCalls|tools|function_call|functionCall|tool_call|toolCall)"\s*:/s.test(trimmed)
      || /^\[\s*\{\s*"(?:tool|name|type|function)"\s*:/s.test(trimmed);
  }
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
      out += text.slice(i, m.index);
      break;
    }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) {
      out += text.slice(i, m.index);
      break;
    }
    out += text.slice(i, m.index);
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function extractFunctionStyleToolCall(
  text: string,
  match: RegExpExecArray,
): { tool: FakeTool; start: number; end: number } | null {
  const name = match[1];
  if (!isRegisteredFakeToolName(name)) return null;
  const start = match.index;
  if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) return null;
  const jsonStart = match.index + match[0].lastIndexOf('{');
  const jsonEnd = findToolInputObjectEnd(text, name, jsonStart);
  if (jsonEnd < 0) return null;
  let next = jsonEnd + 1;
  while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
  if (text[next] === ')') next++;
  const jsonText = text.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { tool: { name, input: normalizeToolInput(name, parsed as Record<string, unknown>) }, start, end: next };
  } catch {
    const looseInput = parseLooseToolInput(name, jsonText);
    return looseInput ? { tool: { name, input: normalizeToolInput(name, looseInput) }, start, end: next } : null;
  }
}

function parseFunctionStyleToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const callRe = makeFunctionStyleToolCallRegex();
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const extracted = extractFunctionStyleToolCall(text, m);
    if (!extracted) continue;
    tools.push(extracted.tool);
    callRe.lastIndex = extracted.end;
  }
  return tools.map(normalizeFakeTool);
}

function parseToolCallEnvelopeInput(name: string, rawBody: string): Record<string, unknown> | null {
  const body = stripJsonFence(decodeXmlishText(rawBody));
  if (!body.startsWith('{')) return {};
  const jsonEnd = findToolInputObjectEnd(body, name, 0);
  if (jsonEnd < 0) return null;
  const jsonText = body.slice(0, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return parseLooseToolInput(name, jsonText);
  }
}

function parseToolArgumentsRecord(name: string, value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return parseLooseToolInput(name, trimmed);
  }
}

const structuredToolEnvelopes = createStructuredToolEnvelopeDialects<FakeTool>({
  isRegisteredName: isRegisteredFakeToolName,
  normalizeName: normalizeAgentToolName,
  parseInput: parseToolArgumentsRecord,
  createTool: (name, input) => normalizeFakeTool({ name, input: normalizeToolInput(name, input) }),
});

function jsonFunctionEnvelopeToFakeTool(obj: Record<string, unknown>): FakeTool | null {
  const fn = obj.function;
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return null;
  const fnObj = fn as Record<string, unknown>;
  const rawName = typeof fnObj.name === 'string' ? fnObj.name.trim() : '';
  if (!rawName || !isRegisteredFakeToolName(rawName)) return null;
  const name = normalizeAgentToolName(rawName);
  const input = parseToolArgumentsRecord(name, fnObj.arguments ?? obj.arguments ?? obj.params ?? obj.parameters ?? obj.args);
  if (!input) return null;
  return { name, input: normalizeToolInput(name, input) };
}

function extractMalformedFunctionEnvelopeName(body: string, startAt = 0): { name: string; afterName: number; functionStart: number } | null {
  const fnStartRe = /"function"\s*:\s*\{/g;
  fnStartRe.lastIndex = startAt;
  const fnStart = fnStartRe.exec(body);
  if (!fnStart) return null;
  const nameRe = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  nameRe.lastIndex = fnStart.index + fnStart[0].length;
  const match = nameRe.exec(body);
  if (!match) return null;
  const name = decodeLooseJsonString(match[1] || '').trim();
  if (!name || !isRegisteredFakeToolName(name)) return null;
  return { name: normalizeAgentToolName(name), afterName: nameRe.lastIndex, functionStart: fnStart.index };
}

function findMalformedFunctionArgumentsObjectStart(body: string, afterName: number): number {
  const argsRe = /"arguments"\s*:\s*/g;
  argsRe.lastIndex = afterName;
  const match = argsRe.exec(body);
  if (!match) return -1;
  let index = argsRe.lastIndex;
  while (index < body.length && /[ \t\r\n]/.test(body[index])) index++;
  if (body[index] === '"') {
    index++;
    while (index < body.length && /[ \t\r\n]/.test(body[index])) index++;
  }
  return body[index] === '{' ? index : -1;
}

function parseMalformedFunctionEnvelopeToolSpans(body: string): Array<{ index: number; end: number; tool: FakeTool }> {
  const spans: Array<{ index: number; end: number; tool: FakeTool }> = [];
  let searchAt = 0;
  while (searchAt < body.length) {
    const named = extractMalformedFunctionEnvelopeName(body, searchAt);
    if (!named) break;
    const argsStart = findMalformedFunctionArgumentsObjectStart(body, named.afterName);
    if (argsStart < 0) {
      searchAt = named.afterName;
      continue;
    }
    const argsEnd = findToolInputObjectEnd(body, named.name, argsStart);
    if (argsEnd < 0) {
      searchAt = argsStart + 1;
      continue;
    }
    const argsText = body.slice(argsStart, argsEnd + 1);
    const input = parseToolArgumentsRecord(named.name, argsText);
    if (input) {
      spans.push({
        index: malformedFunctionEnvelopePayloadStart(body, named.functionStart),
        end: malformedFunctionEnvelopePayloadEnd(body, argsEnd),
        tool: { name: named.name, input: normalizeToolInput(named.name, input) },
      });
    }
    searchAt = argsEnd + 1;
  }
  return spans;
}

function parseMalformedFunctionEnvelopeTool(body: string): FakeTool | null {
  return parseMalformedFunctionEnvelopeToolSpans(body)[0]?.tool ?? null;
}

function malformedFunctionEnvelopePayloadStart(body: string, functionStart: number): number {
  const before = body.slice(0, functionStart);
  const wrapperKey = Math.max(
    before.lastIndexOf('"tool_calls"'),
    before.lastIndexOf('"toolCalls"'),
    before.lastIndexOf('"tools"'),
    before.lastIndexOf('"function_call"'),
    before.lastIndexOf('"functionCall"'),
    before.lastIndexOf('"tool_call"'),
    before.lastIndexOf('"toolCall"'),
  );
  const searchEnd = wrapperKey >= 0 ? wrapperKey : functionStart;
  const objectStart = before.lastIndexOf('{', searchEnd);
  return objectStart >= 0 ? objectStart : functionStart;
}

function malformedFunctionEnvelopePayloadEnd(body: string, argsEnd: number): number {
  let end = argsEnd + 1;
  while (end < body.length && /[ \t"'\\}\],]/.test(body[end])) end++;
  return end;
}

function parseNamedParameterToolCallEnvelopeBody(rawBody: string): FakeTool | null {
  const body = stripJsonFence(decodeXmlishText(rawBody)).trim();
  const nameMatch = /<\s*name\b[^<>]*>([\s\S]*?)<\/\s*name\s*>/i.exec(body);
  if (!nameMatch) return null;

  const name = normalizeAgentToolName(decodeXmlishText(nameMatch[1] || '').trim());
  if (!isRegisteredFakeToolName(name)) return null;

  const bodyWithoutName = `${body.slice(0, nameMatch.index)}${body.slice(nameMatch.index + nameMatch[0].length)}`;
  const parameterMatch = /<\s*parameters?\b[^<>]*>([\s\S]*?)<\/\s*parameters?\s*>/i.exec(bodyWithoutName);
  let input: Record<string, unknown> | null = null;

  if (parameterMatch) {
    const parameterBody = stripJsonFence(decodeXmlishText(parameterMatch[1] || '')).trim();
    if (!parameterBody) {
      input = {};
    } else {
      input = parseToolArgumentsRecord(name, parameterBody);
      if (!input && parameterBody.startsWith('<')) {
        const nested = parseXmlToolParameterBody(parameterBody, parseDsmlParameterValue);
        if (Object.keys(nested).length > 0) input = nested;
      }
      if (!input) {
        const scalarKey = primaryScalarInputKeyForTool(name);
        if (scalarKey && !/[<>]/.test(parameterBody)) {
          input = { [scalarKey]: parseDsmlParameterValue(parameterBody) };
        }
      }
    }
  } else {
    const nested = parseXmlToolParameterBody(bodyWithoutName, parseDsmlParameterValue);
    if (Object.keys(nested).length > 0) input = nested;
  }

  return input ? { name, input: normalizeToolInput(name, input) } : null;
}

function parseToolCallEnvelopeCalls(text: string): FakeTool[] {
  const tools: Array<{ index: number; tool: FakeTool }> = [];
  let match: RegExpExecArray | null;

  const pairRe = makeToolCallEnvelopePairRegex();
  while ((match = pairRe.exec(text)) !== null) {
    const name = decodeXmlishText(match[1] || '').trim();
    if (!isRegisteredFakeToolName(name)) continue;
    const input = parseToolCallEnvelopeInput(name, match[2] || '');
    if (!input) continue;
    tools.push({ index: match.index, tool: { name, input: normalizeToolInput(name, input) } });
  }

  if (tools.length === 0) {
    const blockRe = makeToolCallEnvelopeBlockRegex();
    while ((match = blockRe.exec(text)) !== null) {
      const body = stripJsonFence(decodeXmlishText(match[1] || ''));
      const namedParameterTool = parseNamedParameterToolCallEnvelopeBody(body);
      if (namedParameterTool) {
        tools.push({ index: match.index, tool: namedParameterTool });
        continue;
      }
      const named = structuredToolEnvelopes.parseGenericBody(body);
      if (named) {
        tools.push({ index: match.index, tool: named });
        continue;
      }
      if (!body.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const converted = jsonFunctionEnvelopeToFakeTool(parsed as Record<string, unknown>)
          ?? jsonObjectToFakeTool(parsed as Record<string, unknown>);
        if (converted) tools.push({ index: match.index, tool: converted });
      } catch {
        const converted = parseMalformedFunctionEnvelopeTool(body);
        if (converted) tools.push({ index: match.index, tool: converted });
      }
    }
  }

  return tools.sort((a, b) => a.index - b.index).map(item => normalizeFakeTool(item.tool));
}

function findNextToolCallEnvelopeStart(text: string, startAt = 0): number {
  const re = makeToolCallEnvelopeOpenRegex();
  re.lastIndex = startAt;
  const match = re.exec(text);
  return match ? match.index : -1;
}

function toolCallEnvelopeBlockEnd(text: string, start: number): number {
  const blockRe = makeToolCallEnvelopeBlockRegex();
  blockRe.lastIndex = start;
  let end = start;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    if (match.index > end && text.slice(end, match.index).trim()) break;
    if (match.index < end) continue;
    end = blockRe.lastIndex;
    found = true;
  }
  return found ? end : text.length;
}

function stripToolCallEnvelopeBlocks(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = findNextToolCallEnvelopeStart(text, cursor);
    if (start < 0) {
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, start).replace(/[ \t]+$/, '');
    cursor = toolCallEnvelopeBlockEnd(text, start);
  }
  return out.replace(TOOL_CALL_INCOMPLETE_TAIL_PATTERN, '').trimEnd();
}

function findNextFunctionStyleToolCallStart(text: string, startAt = 0): number {
  const callRe = makeFunctionStyleToolCallRegex();
  callRe.lastIndex = startAt;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(text)) !== null) {
    const extracted = extractFunctionStyleToolCall(text, m);
    if (extracted) return extracted.start;
    const name = m[1];
    if (isRegisteredFakeToolName(name) && (m.index === 0 || !/[A-Za-z0-9_]/.test(text[m.index - 1]))) return m.index;
  }
  return -1;
}

function stripFunctionStyleToolCallBlocks(text: string): string {
  let out = '';
  let i = 0;
  const callRe = makeFunctionStyleToolCallRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) {
      out += text.slice(i);
      break;
    }
    const start = m.index;
    const name = m[1];
    const extracted = extractFunctionStyleToolCall(text, m);
    if (!extracted) {
      if (isRegisteredFakeToolName(name)) {
        out += text.slice(i, start).replace(/[ \t]+$/, '');
        break;
      }
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    out += text.slice(i, extracted.start).replace(/[ \t]+$/, '');
    i = extracted.end;
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
  const end = toolPayloadEnd(text, argsStart, jsonStart, jsonEnd);
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { tool: { name, input: parsed as Record<string, unknown> }, end };
    }
  } catch {
    const looseInput = parseLooseToolInput(name, jsonText);
    if (looseInput) return { tool: { name, input: looseInput }, end };
  }
  return null;
}

function toolPayloadEnd(text: string, argsStart: number, jsonStart: number, jsonEnd: number): number {
  const beforeJson = text.slice(argsStart, jsonStart);
  if (!beforeJson.includes('```')) return jsonEnd + 1;
  const closeFence = text.indexOf('```', jsonEnd + 1);
  return closeFence >= 0 ? lineEndAfter(text, closeFence + 3) : jsonEnd + 1;
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
  return tools.map(normalizeFakeTool);
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
  const callLineRe = makeCallingLineRegex();
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
  const functionCall = obj.function_call ?? obj.functionCall;
  if (functionCall && typeof functionCall === 'object' && !Array.isArray(functionCall)) {
    const tool = jsonFunctionEnvelopeToFakeTool({ function: functionCall });
    if (tool) return tool;
  }
  const functionTool = jsonFunctionEnvelopeToFakeTool(obj);
  if (functionTool) return functionTool;
  const rawName = typeof obj.tool === 'string'
    ? obj.tool
    : typeof obj.name === 'string'
      ? obj.name
      : typeof obj.type === 'string'
        ? obj.type
        : '';
  const name = rawName.trim();
  if (!name || !isRegisteredFakeToolName(name)) return null;
  const canonicalName = normalizeAgentToolName(name);
  const maybeArgs = obj.arguments ?? obj.parameters ?? obj.params ?? obj.args ?? obj.input;
  let input: Record<string, unknown>;
  const parsedArgs = parseToolArgumentsRecord(canonicalName, maybeArgs);
  if (parsedArgs) {
    input = parsedArgs;
  } else {
    input = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!['tool', 'name', 'type', 'arguments', 'parameters', 'params', 'args', 'input'].includes(k)) input[k] = v;
    }
  }
  return { name: canonicalName, input: normalizeToolInput(canonicalName, input) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    } catch {
      if (parseMalformedFunctionEnvelopeToolSpans(trimmed).length > 0) return '';
    }
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
      const malformedSpan = parseMalformedFunctionEnvelopeToolSpans(result.slice(start))[0];
      if (malformedSpan) {
        i = start + malformedSpan.end;
        continue;
      }
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
    } catch {
      stripped = parseMalformedFunctionEnvelopeToolSpans(candidate).length > 0;
    }
    if (!stripped) out += candidate;
    i = end + 1;
  }
  return out;
}

function findNextDsmlToolCallStart(text: string, startAt = 0): number {
  const re = makeDsmlStartRegex();
  re.lastIndex = startAt;
  const match = re.exec(text);
  return match ? match.index : -1;
}

function dsmlToolCallBlockEnd(text: string, start: number): number {
  const tail = text.slice(start);
  const toolCallsClose = makeDsmlCloseRegex('tool_calls').exec(tail);
  if (toolCallsClose) return start + toolCallsClose.index + toolCallsClose[0].length;
  const invokeClose = makeDsmlCloseRegex('invoke').exec(tail);
  if (invokeClose) return start + invokeClose.index + invokeClose[0].length;
  const parameterClose = makeDsmlCloseRegex('parameter').exec(tail);
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
  return out.replace(DSML_INCOMPLETE_TAIL_PATTERN, '').trimEnd();
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
  const normalizedText = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  const tools: FakeTool[] = [];
  const dsmlAnyOpen = `<\\s*${DSML_MARKER_PATTERN}`;
  const invokeOpen = dsmlOpenTagPattern('invoke');
  const parameterOpen = dsmlOpenTagPattern('parameter');
  const invokeRe = new RegExp(
    `${invokeOpen}([^<>]*\\bname\\s*=\\s*["']([^"']+)["'][^<>]*)(?:>|(?=${dsmlAnyOpen}))([\\s\\S]*?)${dsmlCloseTagPattern('invoke')}`,
    'gi',
  );
  let im: RegExpExecArray | null;
  while ((im = invokeRe.exec(normalizedText)) !== null) {
    const name = im[2].trim();
    if (!isRegisteredFakeToolName(name)) continue;
    const input: Record<string, unknown> = {};
    const body = im[3] || '';

    const blockParamRe = new RegExp(
      `${parameterOpen}([^<>]*\\bname\\s*=\\s*["']([^"']+)["'][^<>]*)(?:>|(?=${dsmlAnyOpen}))([\\s\\S]*?)${dsmlCloseTagPattern('parameter')}`,
      'gi',
    );
    let pm: RegExpExecArray | null;
    while ((pm = blockParamRe.exec(body)) !== null) {
      input[pm[2].trim()] = parseDsmlParameterValue(pm[3] || '');
    }

    const valueParamRe = new RegExp(
      `${parameterOpen}([^<>]*\\bname\\s*=\\s*["']([^"']+)["'][^<>]*\\bvalue\\s*=\\s*["']([^"']*)["'][^<>]*)(?:\\/?>|(?=${dsmlAnyOpen}))`,
      'gi',
    );
    while ((pm = valueParamRe.exec(body)) !== null) {
      const key = pm[2].trim();
      if (!(key in input)) input[key] = parseDsmlParameterValue(pm[3] || '');
    }

    tools.push({ name, input: normalizeToolInput(name, input) });
  }
  return tools;
}

function findBracketToolStart(text: string): number {
  return text.indexOf('[TOOL:');
}

function parseBracketToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const re = /\[TOOL:(\w+)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let jsonStart = m.index + m[0].length;
    if (text[jsonStart] === ']') jsonStart++;
    while (jsonStart < text.length && /[ \t\n\r]/.test(text[jsonStart])) jsonStart++;
    if (text[jsonStart] !== '{') continue;
    const jsonEnd = findToolInputObjectEnd(text, name, jsonStart);
    if (jsonEnd < 0) continue;
    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      tools.push({ name, input: JSON.parse(jsonStr) });
    } catch {
      const looseInput = parseLooseToolInput(name, jsonStr);
      if (looseInput) tools.push({ name, input: looseInput });
    }
    re.lastIndex = jsonEnd + 1;
  }
  return tools;
}

function stripBracketToolBlocks(text: string): string {
  let result = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    if (text[i] === '[') {
      const lookahead = text.slice(i, Math.min(i + 60, len));
      const m = lookahead.match(/^\[TOOL:(\w+)\s*(?:\]?\s*)\{/);
      if (m) {
        const bracePos = text.indexOf('{', i);
        if (bracePos < 0) {
          result += text[i];
          i++;
          continue;
        }
        const jsonEnd = findToolInputObjectEnd(text, m[1], bracePos);
        if (jsonEnd < 0) break;
        let next = jsonEnd + 1;
        while (next < len && /[ \t]/.test(text[next])) next++;
        if (text[next] === ']') next++;
        i = next;
        continue;
      }
      if (/^\[TOOL:(\w+)\b/.test(lookahead)) break;
    }
    result += text[i];
    i++;
  }
  return result.replace(/\[TOOL:\w+\]\s*\{[^]*?\}(?:\n|$)/gm, '');
}

function parseCallingToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
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
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      tools.push(jsonObjectToFakeTool(parsed) ?? { name, input: parsed });
      callRe.lastIndex = jsonEnd + 1;
    } catch {
      const looseInput = parseLooseToolInput(name, jsonText);
      if (looseInput) {
        tools.push({ name, input: looseInput });
        callRe.lastIndex = jsonEnd + 1;
      }
    }
  }
  return tools;
}

function parseMarkdownToolLinkCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const linkRe = makeMarkdownToolLinkRegex();
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text)) !== null) {
    const name = normalizeAgentToolName(match[1]);
    if (!isRegisteredFakeToolName(name) || !MARKDOWN_TOOL_LINK_SCALAR_NAMES.has(name)) continue;
    const scalarKey = primaryScalarInputKeyForTool(name);
    if (!scalarKey) continue;
    const value = normalizeMarkdownToolLinkTarget(match[2]);
    if (!value) continue;
    tools.push({
      name,
      input: normalizeToolInput(name, { [scalarKey]: value }),
    });
  }
  return tools.map(normalizeFakeTool);
}

function normalizeMarkdownToolLinkTarget(rawValue: string): string {
  let value = decodeXmlishText(rawValue || '').trim();
  if (/^<[^<>]+>$/.test(value)) value = value.slice(1, -1).trim();
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function findMarkdownToolLinkProtocolStart(text: string): number {
  const linkRe = makeMarkdownToolLinkRegex();
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text)) !== null) {
    if (isRegisteredFakeToolName(match[1])) return match.index;
  }
  return -1;
}

function stripMarkdownToolLinkBlocks(text: string): string {
  const linkRe = makeMarkdownToolLinkRegex();
  return text.replace(linkRe, (full, name) => (
    isRegisteredFakeToolName(name) ? '' : full
  )).trimEnd();
}

function findCallingProtocolStart(text: string): number {
  const callRe = makeAnyCallingRegex();
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    const name = cm[1];
    const shellTranscript = extractShellTranscriptCommand(text, callRe.lastIndex);
    if ((name && isRegisteredFakeToolName(name)) || (((!name || isShellTranscriptName(name))) && shellTranscript)) {
      return cm.index;
    }
  }
  return -1;
}

function findToolArgumentsProtocolStart(text: string): number {
  const toolArgsRe = makeToolArgumentsRegex();
  let tm: RegExpExecArray | null;
  while ((tm = toolArgsRe.exec(text)) !== null) {
    if (isRegisteredFakeToolName(tm[1])) {
      const labelOffset = tm[0].search(/Tool/i);
      return tm.index + Math.max(0, labelOffset);
    }
  }
  return -1;
}

function findJsonToolPayloadStart(text: string): number {
  let searchAt = 0;
  while (searchAt < text.length) {
    const start = findNextJsonStart(text, searchAt);
    if (start < 0) break;
    if (hasUnclosedToolCallEnvelopePrefixBeforeJson(text, start)) {
      searchAt = start + 1;
      continue;
    }
    const end = text[start] === '[' ? findJsonArrayEnd(text, start) : findJsonObjectEnd(text, start);
    if (end < 0) {
      const tail = text.slice(start);
      if (parseMalformedFunctionEnvelopeToolSpans(tail).length > 0) return start;
      if (/"(?:tool|name|type)"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) return start;
      searchAt = start + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (jsonValueContainsToolPayload(parsed)) return start;
    } catch {
      if (parseMalformedFunctionEnvelopeToolSpans(text.slice(start, end + 1)).length > 0) return start;
    }
    searchAt = end + 1;
  }
  return -1;
}

function parseJsonObjectToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  let searchAt = 0;
  while (searchAt < text.length) {
    const start = findNextJsonStart(text, searchAt);
    if (start < 0) break;
    if (text[start] !== '{') {
      searchAt = start + 1;
      continue;
    }
    if (looksLikeJsonArrayElementObjectStart(text, start)) {
      searchAt = start + 1;
      continue;
    }
    if (hasUnclosedToolCallEnvelopePrefixBeforeJson(text, start)) {
      searchAt = start + 1;
      continue;
    }
    const end = findJsonObjectEnd(text, start);
    if (end < 0) {
      const malformed = parseMalformedFunctionEnvelopeToolSpans(text.slice(start));
      if (malformed.length > 0) {
        tools.push(...malformed.map(span => span.tool));
        searchAt = start + malformed[malformed.length - 1].end;
        continue;
      }
      searchAt = start + 1;
      continue;
    }
    const candidate = text.slice(start, end + 1);
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const converted = jsonValueToFakeTools(obj);
      if (converted.length > 0) {
        tools.push(...converted);
      } else if (Array.isArray(obj.todoList)) {
        tools.push({ name: 'manage_todo_list', input: { todoList: obj.todoList } });
      } else if (typeof obj.summary === 'string' && /(?:完成|结束|complete|done)/i.test(text) && !hasShellTranscriptMarker(text)) {
        tools.push({ name: 'task_complete', input: { summary: obj.summary } });
      }
    } catch {
      const malformed = parseMalformedFunctionEnvelopeToolSpans(candidate);
      if (malformed.length > 0) tools.push(...malformed.map(span => span.tool));
    }
    searchAt = end + 1;
  }
  return tools.map(normalizeFakeTool);
}

function looksLikeJsonArrayElementObjectStart(text: string, objectStart: number): boolean {
  let previous = objectStart - 1;
  while (previous >= 0 && /[ \t\r\n]/.test(text[previous])) previous--;
  if (previous < 0 || (text[previous] !== '[' && text[previous] !== ',')) return false;

  const lineStart = text.lastIndexOf('\n', objectStart - 1) + 1;
  const linePrefix = text.slice(lineStart, objectStart);
  return !/^\s*\d+\.\s*$/.test(linePrefix);
}

function parseJsonToolPayloadToolCalls(text: string): FakeTool[] {
  const arrayTools = parseJsonArrayToolCalls(text);
  return arrayTools.length > 0 ? arrayTools : parseJsonObjectToolCalls(text);
}

function parseLegacyJsonArrayBlockToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
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
      const toolName = typeof obj.tool === 'string' ? obj.tool : null;
      if (!toolName) continue;
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k !== 'tool') input[k] = v;
      }
      tools.push({ name: toolName, input });
    }
  }
  return tools;
}

function parseLegacyInvokeXmlCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
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
  return tools;
}

function findLegacyInvokeXmlStart(text: string): number {
  return text.search(/<invoke\s+name="/i);
}

function makeReactActionRegex(): RegExp {
  return /\bAction\s*[:：]\s*`?([A-Za-z_]\w*?)`?(?=\s*(?:Action\s*Input\s*[:：]|$|[\r\n]))/gi;
}

function makeReactActionInputRegex(): RegExp {
  return /Action\s*Input\s*[:：]\s*/gi;
}

function findReactActionInput(text: string, startAt: number): RegExpExecArray | null {
  const inputRe = makeReactActionInputRegex();
  inputRe.lastIndex = startAt;
  return inputRe.exec(text);
}

function reactSingleValueInput(name: string, raw: string): Record<string, unknown> | null {
  const value = raw.trim().replace(/^```[A-Za-z]*\s*/, '').replace(/```$/, '').replace(/^["'`]|["'`]$/g, '').trim();
  if (!value) return null;
  const canonicalName = normalizeAgentToolName(name);
  if (['read_file', 'list_dir'].includes(canonicalName)) return { path: value };
  if (canonicalName === 'file_search') return { glob: value };
  if (canonicalName === 'grep_search') return { pattern: value };
  if (canonicalName === 'semantic_search') return { query: value };
  if (canonicalName === 'run_terminal') return { command: value };
  return { input: value };
}

function extractReactActionToolCall(
  text: string,
  match: RegExpExecArray,
): { tool: FakeTool; start: number; end: number } | null {
  const name = match[1];
  if (!isRegisteredFakeToolName(name)) return null;
  const afterAction = match.index + match[0].length;
  const realInputMatch = findReactActionInput(text, afterAction);
  if (!realInputMatch) return null;
  const nextActionRe = makeReactActionRegex();
  nextActionRe.lastIndex = afterAction;
  const nextAction = nextActionRe.exec(text);
  if (nextAction && nextAction.index < realInputMatch.index) return null;

  let payloadStart = realInputMatch.index + realInputMatch[0].length;
  while (payloadStart < text.length && /[ \t\r\n`]/.test(text[payloadStart])) payloadStart++;
  if (text.slice(payloadStart, payloadStart + 4).toLowerCase() === 'json') payloadStart += 4;
  while (payloadStart < text.length && /[ \t\r\n]/.test(text[payloadStart])) payloadStart++;
  if (text[payloadStart] === '{') {
    const jsonEnd = findToolInputObjectEnd(text, name, payloadStart);
    if (jsonEnd < 0) return null;
    const jsonText = text.slice(payloadStart, jsonEnd + 1);
    try {
      return { tool: { name, input: JSON.parse(jsonText) }, start: match.index, end: jsonEnd + 1 };
    } catch {
      const looseInput = parseLooseToolInput(name, jsonText);
      return looseInput ? { tool: { name, input: looseInput }, start: match.index, end: jsonEnd + 1 } : null;
    }
  }

  const rawEnd = lineEndAfter(text, payloadStart);
  const rawInput = text.slice(payloadStart, rawEnd);
  const input = reactSingleValueInput(name, rawInput);
  return input ? { tool: { name, input }, start: match.index, end: rawEnd } : null;
}

function parseReactActionToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  const actionRe = makeReactActionRegex();
  let match: RegExpExecArray | null;
  while ((match = actionRe.exec(text)) !== null) {
    const extracted = extractReactActionToolCall(text, match);
    if (!extracted) continue;
    tools.push(extracted.tool);
    actionRe.lastIndex = extracted.end;
  }
  return tools;
}

function findNextReactActionStart(text: string, startAt = 0): number {
  const actionRe = makeReactActionRegex();
  actionRe.lastIndex = startAt;
  let match: RegExpExecArray | null;
  while ((match = actionRe.exec(text)) !== null) {
    const name = match[1];
    if (!isRegisteredFakeToolName(name)) continue;
    const inputMatch = findReactActionInput(text, match.index + match[0].length);
    if (inputMatch) return match.index;
    if (!text.slice(match.index + match[0].length).trim()) return match.index;
  }
  return -1;
}

function reactActionBlockEnd(text: string, start: number): number {
  const actionRe = makeReactActionRegex();
  actionRe.lastIndex = start;
  const match = actionRe.exec(text);
  if (!match || match.index !== start) return start;
  const inputMatch = findReactActionInput(text, match.index + match[0].length);
  if (!inputMatch) return text.length;
  let payloadStart = inputMatch.index + inputMatch[0].length;
  while (payloadStart < text.length && /[ \t\r\n`]/.test(text[payloadStart])) payloadStart++;
  if (text.slice(payloadStart, payloadStart + 4).toLowerCase() === 'json') payloadStart += 4;
  while (payloadStart < text.length && /[ \t\r\n]/.test(text[payloadStart])) payloadStart++;
  if (text[payloadStart] === '{') {
    const jsonEnd = findToolInputObjectEnd(text, match[1], payloadStart);
    if (jsonEnd < 0) return text.length;
    let end = jsonEnd + 1;
    const closeFence = /^[ \t\r\n]*```/.exec(text.slice(end));
    if (closeFence) return lineEndAfter(text, end + closeFence[0].length);
    while (end < text.length && /[ \t`]/.test(text[end])) end++;
    return end;
  }
  return lineEndAfter(text, payloadStart);
}

function stripReactActionBlocks(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = findNextReactActionStart(text, cursor);
    if (start < 0) {
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, start).replace(/[ \t]+$/, '');
    const end = reactActionBlockEnd(text, start);
    cursor = end > start ? end : text.length;
  }
  return out.trimEnd();
}

export function findFirstToolCallStart(text: string): number {
  const requestText = isolateModelToolRequestText(text).text;
  const parsedStart = findFirstModelToolProtocolStart(requestText, MODEL_TOOL_PROTOCOL_DIALECTS);
  const rawStart = findRawNamedToolAttemptStart(requestText);
  if (parsedStart < 0) return rawStart;
  if (rawStart < 0) return parsedStart;
  return Math.min(parsedStart, rawStart);
}

export function containsFakeToolCallProtocol(text: string): boolean {
  return findFirstToolCallStart(text) >= 0;
}

export function stripToolCallBlocks(text: string): string {
  const { text: requestText } = isolateModelToolRequestText(text);
  const { text: stripped, removed } = stripModelToolProtocolBlocks(requestText, MODEL_TOOL_PROTOCOL_DIALECTS);
  const raw = stripRawNamedToolAttempts(stripped);
  const cleaned = raw.text.replace(/\n{3,}/g, '\n\n').trim();
  return removed || raw.removed ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
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
  const callLineRe = makeCallingLineRegex();
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

const xmlToolDialects = createXmlToolDialects({
  isRegisteredName: isRegisteredFakeToolName,
  findInputObjectEnd: findToolInputObjectEnd,
  parseArguments: parseToolArgumentsRecord,
  parseLooseInput: parseLooseToolInput,
  parseScalar: parseDsmlParameterValue,
});

const MODEL_TOOL_PROTOCOL_DIALECTS: readonly ModelToolProtocolDialect<FakeTool>[] = [
  {
    name: 'bracket-tool',
    parse: parseBracketToolCalls,
    findStart: findBracketToolStart,
    strip: stripBracketToolBlocks,
  },
  ...structuredToolEnvelopes.dialects,
  {
    name: 'tool-call-envelope',
    parse: parseToolCallEnvelopeCalls,
    findStart: (text: string) => {
      const complete = findNextToolCallEnvelopeStart(text);
      const incomplete = TOOL_CALL_INCOMPLETE_TAIL_PATTERN.exec(text);
      if (complete < 0) return incomplete?.index ?? -1;
      return incomplete ? Math.min(complete, incomplete.index) : complete;
    },
    strip: stripToolCallEnvelopeBlocks,
  },
  {
    name: 'react-action',
    parse: parseReactActionToolCalls,
    findStart: findNextReactActionStart,
    strip: stripReactActionBlocks,
  },
  {
    name: 'markdown-tool-link',
    parse: parseMarkdownToolLinkCalls,
    findStart: findMarkdownToolLinkProtocolStart,
    strip: stripMarkdownToolLinkBlocks,
  },
  {
    name: 'calling',
    parse: parseCallingToolCalls,
    findStart: findCallingProtocolStart,
    strip: stripCallingToolBlocks,
  },
  {
    name: 'calling-shell-transcript',
    parse: parseShellTranscriptToolCalls,
    findStart: findCallingProtocolStart,
    strip: stripCallingShellTranscriptBlocks,
  },
  {
    name: 'tool-arguments',
    parse: parseToolArgumentsToolCalls,
    findStart: findToolArgumentsProtocolStart,
    strip: stripToolArgumentsBlocks,
  },
  {
    name: 'function-style',
    parse: parseFunctionStyleToolCalls,
    findStart: findNextFunctionStyleToolCallStart,
    strip: stripFunctionStyleToolCallBlocks,
  },
  ...xmlToolDialects,
  createBareJsonToolCallDialect<FakeTool>({
    isRegisteredName: isRegisteredFakeToolName,
    normalizeName: normalizeAgentToolName,
    normalizeInput: normalizeToolInput,
    createTool: (name, input) => ({ name, input }),
  }),
  createFencedAnonymousJsonToolDialect({
    parseImplicit: jsonObjectToImplicitArrayFakeTool,
    normalize: normalizeFakeTool,
  }),
  {
    name: 'json-tool-payload',
    parse: parseJsonToolPayloadToolCalls,
    findStart: findJsonToolPayloadStart,
    strip: stripJsonToolPayloads,
  },
  {
    name: 'dsml',
    parse: parseDsmlToolCalls,
    findStart: findNextDsmlToolCallStart,
    strip: stripDsmlToolCallBlocks,
  },
  {
    name: 'legacy-json-array-block',
    parse: parseLegacyJsonArrayBlockToolCalls,
    findStart: findJsonToolPayloadStart,
    strip: (text: string) => text,
  },
  createLegacyToolCallXmlDialect<FakeTool>({
    isRegisteredName: isRegisteredFakeToolName,
    normalizeName: normalizeAgentToolName,
    normalizeInput: normalizeToolInput,
    createTool: (name, input) => ({ name, input }),
  }),
  createBareToolCommandDialect<FakeTool>({
    isRegisteredName: isRegisteredFakeToolName,
    normalizeName: normalizeAgentToolName,
    normalizeInput: normalizeToolInput,
    createTool: (name, input) => ({ name, input }),
  }),
  {
    name: 'legacy-invoke-xml',
    parse: parseLegacyInvokeXmlCalls,
    findStart: findLegacyInvokeXmlStart,
    strip: (text: string) => text,
  },
];

export function parseFakeToolCalls(text: string): FakeTool[] {
  const normalized = parseModelToolProtocol(
    isolateModelToolRequestText(text).text,
    MODEL_TOOL_PROTOCOL_DIALECTS,
  ).map(normalizeFakeTool);
  return collapseSupersededFullFileWrites(normalized);
}

function collapseSupersededFullFileWrites(tools: FakeTool[]): FakeTool[] {
  const fullFileWriteNames = new Set(['create_file', 'write_file', 'replace_file']);
  const lastWriteByPath = new Map<string, number>();
  tools.forEach((tool, index) => {
    if (!fullFileWriteNames.has(tool.name)) return;
    const path = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
    if (path) lastWriteByPath.set(path, index);
  });
  return tools.filter((tool, index) => {
    if (!fullFileWriteNames.has(tool.name)) return true;
    const path = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
    return !path || lastWriteByPath.get(path) === index;
  });
}

export function hasIncompleteFakeToolCallProtocol(text: string): boolean {
  const requestText = isolateModelToolRequestText(text).text;
  if (structuredToolEnvelopes.hasIncomplete(requestText)) return true;
  return (findFirstModelToolProtocolStart(requestText, MODEL_TOOL_PROTOCOL_DIALECTS) >= 0
      || findRawNamedToolAttemptStart(requestText) >= 0)
    && parseModelToolProtocol(requestText, MODEL_TOOL_PROTOCOL_DIALECTS).length === 0;
}
