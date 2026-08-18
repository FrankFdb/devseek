import {
  listCodingToolNames,
  normalizeCodingToolName,
} from '@devseek-netai/shared';
import { normalizeFakeTool, normalizeToolInput } from './fake-tool-input-normalizer';
import type { FakeTool } from './fake-tool-types';
import { parseLosslessXmlMutationInput } from './lossless-xml-tool-input';
import type { ModelToolProtocolDialect } from './model-tool-protocol-adapter';
import { decodeXmlishText, stripJsonFence } from './tool-protocol-text';

export interface XmlToolDialectContext {
  isRegisteredName(name: string): boolean;
  findInputObjectEnd(text: string, name: string, start: number): number;
  parseArguments(name: string, value: unknown): Record<string, unknown> | null;
  parseLooseInput(name: string, text: string): Record<string, unknown> | null;
  parseScalar(value: string): unknown;
}

function parseXmlAttributes(
  rawAttributes: string,
  parseScalar: (raw: string) => unknown,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const attributes = decodeXmlishText(rawAttributes);
  const attributeRegex = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'/>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attributeRegex.exec(attributes)) !== null) {
    const key = match[1].trim();
    if (key) input[key] = parseScalar(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return input;
}

export function parseXmlToolParameterBody(
  rawBody: string,
  parseScalar: (raw: string) => unknown,
): Record<string, unknown> {
  return parseParameterBody(
    decodeXmlishText(rawBody),
    rawAttributes => parseXmlAttributes(rawAttributes, parseScalar),
    parseScalar,
  );
}

export function primaryScalarInputKeyForTool(name: string): string | undefined {
  return primaryScalarInputKey(name);
}

export function createXmlToolDialects(
  context: XmlToolDialectContext,
): readonly ModelToolProtocolDialect<FakeTool>[] {
  const parseAttributes = (rawAttributes: string): Record<string, unknown> =>
    parseXmlAttributes(rawAttributes, context.parseScalar);

  const normalizeXmlName = (name: string): string => normalizeCodingToolName(
    decodeXmlishText(name || '').trim().replace(/^TOOL[:_]/i, ''),
  );
  const isRegisteredXmlName = (name: string): boolean => context.isRegisteredName(normalizeXmlName(name));
  const parseBody = (name: string, rawBody: string): Record<string, unknown> => {
    const losslessMutation = parseLosslessXmlMutationInput(name, rawBody);
    if (losslessMutation) return losslessMutation;
    const body = stripJsonFence(decodeXmlishText(rawBody));
    if (!body) return {};
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      const looseInput = context.parseLooseInput(name, body);
      if (looseInput) return looseInput;
    }
    const nested = parseParameterBody(body, parseAttributes, context.parseScalar);
    if (Object.keys(nested).length > 0) return nested;
    const scalarKey = primaryScalarInputKey(name);
    return scalarKey && !/[<>]/.test(body) ? { [scalarKey]: context.parseScalar(body) } : {};
  };

  const xmlTagDialect: ModelToolProtocolDialect<FakeTool> = {
    name: 'xml-tool-tag',
    parse(text) {
      const tools: Array<{ index: number; tool: FakeTool }> = [];
      const tagRegex = makeXmlToolTagRegex();
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(text)) !== null) {
        const name = normalizeXmlName(match[1]);
        if (!context.isRegisteredName(name)) continue;
        tools.push({
          index: match.index,
          tool: { name, input: normalizeToolInput(name, parseAttributes(match[2] || '')) },
        });
      }
      const pairRegex = makeXmlToolPairRegex();
      while ((match = pairRegex.exec(text)) !== null) {
        const name = normalizeXmlName(match[1]);
        if (!context.isRegisteredName(name)) continue;
        tools.push({ index: match.index, tool: { name, input: normalizeToolInput(name, parseBody(name, match[2] || '')) } });
      }
      for (const item of parseOpenJsonCalls(text, context, normalizeXmlName)) {
        tools.push({ index: item.index, tool: item.tool });
      }
      return tools.sort((left, right) => left.index - right.index).map(item => normalizeFakeTool(item.tool));
    },
    findStart: text => findNextXmlStart(text, isRegisteredXmlName),
    strip: text => stripXmlBlocks(text, context, normalizeXmlName, isRegisteredXmlName),
  };

  const toolIdDialect: ModelToolProtocolDialect<FakeTool> = {
    name: 'tool-id-xml',
    parse(text) {
      const tools: FakeTool[] = [];
      const pairRegex = makeToolIdPairRegex();
      let match: RegExpExecArray | null;
      while ((match = pairRegex.exec(text)) !== null) {
        const name = resolveToolIdName(match[1] || '', parseAttributes);
        if (!context.isRegisteredName(name)) continue;
        tools.push(normalizeFakeTool({ name, input: normalizeToolInput(name, parseBody(name, match[2] || '')) }));
      }
      return tools;
    },
    findStart(text) {
      const openRegex = makeToolIdOpenRegex();
      let match: RegExpExecArray | null;
      while ((match = openRegex.exec(text)) !== null) {
        if (context.isRegisteredName(resolveToolIdName(match[1] || '', parseAttributes))) return match.index;
      }
      return -1;
    },
    strip(text) {
      let output = '';
      let cursor = 0;
      const pairRegex = makeToolIdPairRegex();
      let match: RegExpExecArray | null;
      while ((match = pairRegex.exec(text)) !== null) {
        if (!context.isRegisteredName(resolveToolIdName(match[1] || '', parseAttributes))) continue;
        output += text.slice(cursor, match.index).replace(/[ \t]+$/, '');
        cursor = pairRegex.lastIndex;
      }
      const complete = output + text.slice(cursor);
      const incompleteStart = toolIdDialect.findStart(complete);
      return incompleteStart < 0 ? complete.trimEnd() : complete.slice(0, incompleteStart).trimEnd();
    },
  };
  return [toolIdDialect, xmlTagDialect];
}

function toolNamesPattern(): string {
  return listCodingToolNames(true).sort((left, right) => right.length - left.length).map(escapeRegExp).join('|');
}

function makeXmlToolTagRegex(): RegExp {
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL[:_])?(?:${toolNamesPattern()}|mcp__[A-Za-z0-9_]+))\\b([^<>]*?)\\/\\s*(?:>|&gt;)`, 'gi');
}

function makeXmlToolPairRegex(): RegExp {
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL[:_])?(?:${toolNamesPattern()}|mcp__[A-Za-z0-9_]+))\\b[^<>]*?(?:>|&gt;)([\\s\\S]*?)(?:<\\/|&lt;\\/)\\s*\\1\\s*(?:>|&gt;)`, 'gi');
}

function makeXmlToolOpenJsonRegex(): RegExp {
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL[:_])?(?:${toolNamesPattern()}|mcp__[A-Za-z0-9_]+))\\b[^<>]*?(?:>|&gt;)\\s*\\{`, 'gi');
}

function makeXmlToolTailRegex(flags = 'i'): RegExp {
  return new RegExp(`(?:<|&lt;)\\s*((?:TOOL[:_])?(?:${toolNamesPattern()}|mcp__[A-Za-z0-9_]+))\\b[\\s\\S]*$`, flags);
}

function makeToolIdPairRegex(): RegExp {
  return /(?:<|&lt;)\s*tool\b([^<>]*?)(?:>|&gt;)([\s\S]*?)(?:<\/|&lt;\/)\s*tool\s*(?:>|&gt;)/g;
}

function makeToolIdOpenRegex(): RegExp {
  return /(?:<|&lt;)\s*tool\b([^<>]*?)(?:>|&gt;)/g;
}

function resolveToolIdName(
  rawAttributes: string,
  parseAttributes: (raw: string) => Record<string, unknown>,
): string {
  const attributes = parseAttributes(rawAttributes);
  const rawName = attributes.id ?? attributes.name ?? attributes.tool;
  return normalizeCodingToolName(typeof rawName === 'string' ? rawName : '');
}

function parseParameterBody(
  body: string,
  parseAttributes: (raw: string) => Record<string, unknown>,
  parseScalar: (raw: string) => unknown,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const parameterRegex = /<\s*([A-Za-z_][\w:-]*)\b([^<>]*?)>([\s\S]*?)<\/\s*\1\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = parameterRegex.exec(body)) !== null) {
    const attributes = parseAttributes(match[2] || '');
    const attributeName = typeof attributes.name === 'string' ? attributes.name.trim() : '';
    const key = /^(?:param|parameter)$/i.test(match[1]) && attributeName
      ? attributeName
      : match[1].replace(/^[^:]+:/, '');
    const attributeValue = attributes.value ?? attributes.string ?? attributes.text;
    if (key) input[key] = parseScalar(decodeXmlishText(attributeValue === undefined ? match[3] || '' : String(attributeValue)));
  }
  return input;
}

function primaryScalarInputKey(name: string): string | undefined {
  switch (normalizeCodingToolName(name)) {
    case 'read_file': case 'list_dir': case 'memory_read': return 'path';
    case 'file_search': case 'search_file': return 'glob';
    case 'grep_search': return 'pattern';
    case 'semantic_search': case 'memory_search': return 'query';
    case 'run_terminal': return 'command';
    case 'fetch_webpage': return 'url';
    case 'memory_write': return 'content';
    case 'task_complete': return 'summary';
    default: return undefined;
  }
}

function parseOpenJsonCalls(
  text: string,
  context: XmlToolDialectContext,
  normalizeName: (name: string) => string,
): Array<{ index: number; end: number; tool: FakeTool }> {
  const calls: Array<{ index: number; end: number; tool: FakeTool }> = [];
  const openRegex = makeXmlToolOpenJsonRegex();
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(text)) !== null) {
    const rawName = match[1] || '';
    const name = normalizeName(rawName);
    if (!context.isRegisteredName(name)) continue;
    const jsonStart = match.index + match[0].lastIndexOf('{');
    const jsonEnd = context.findInputObjectEnd(text, name, jsonStart);
    if (jsonEnd < 0 || hasCloseTagAfterJson(text, rawName, jsonEnd + 1)) continue;
    const input = context.parseArguments(name, text.slice(jsonStart, jsonEnd + 1));
    if (!input) continue;
    calls.push({ index: match.index, end: jsonEnd + 1, tool: { name, input: normalizeToolInput(name, input) } });
    openRegex.lastIndex = jsonEnd + 1;
  }
  return calls;
}

function hasCloseTagAfterJson(text: string, rawName: string, fromIndex: number): boolean {
  let cursor = fromIndex;
  while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor += 1;
  const name = escapeRegExp(decodeXmlishText(rawName || '').trim());
  return Boolean(name) && new RegExp(`^(?:<\\/|&lt;\\/)\\s*${name}\\s*(?:>|&gt;)`, 'i').test(text.slice(cursor));
}

function findNextXmlStart(text: string, isRegistered: (name: string) => boolean): number {
  let completeStart = -1;
  for (const regex of [makeXmlToolTagRegex(), makeXmlToolPairRegex(), makeXmlToolOpenJsonRegex()]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (!isRegistered(match[1])) continue;
      completeStart = completeStart < 0 ? match.index : Math.min(completeStart, match.index);
      break;
    }
  }
  const tailRegex = makeXmlToolTailRegex('gi');
  let tail: RegExpExecArray | null;
  while ((tail = tailRegex.exec(text)) !== null) {
    if (isRegistered(tail[1])) return completeStart < 0 ? tail.index : Math.min(completeStart, tail.index);
  }
  return completeStart;
}

function stripXmlBlocks(
  text: string,
  context: XmlToolDialectContext,
  normalizeName: (name: string) => string,
  isRegistered: (name: string) => boolean,
): string {
  let cleaned = stripRegexMatches(text, makeXmlToolTagRegex(), match => isRegistered(match[1]));
  cleaned = stripRegexMatches(cleaned, makeXmlToolPairRegex(), match => isRegistered(match[1]));
  const calls = parseOpenJsonCalls(cleaned, context, normalizeName).sort((left, right) => left.index - right.index);
  if (calls.length > 0) {
    let output = '';
    let cursor = 0;
    for (const call of calls) {
      if (call.index < cursor) continue;
      output += cleaned.slice(cursor, call.index).replace(/[ \t]+$/, '');
      cursor = call.end;
    }
    cleaned = output + cleaned.slice(cursor);
  }
  return cleaned.replace(makeXmlToolTailRegex(), '').trimEnd();
}

function stripRegexMatches(text: string, regex: RegExp, shouldStrip: (match: RegExpExecArray) => boolean): string {
  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!shouldStrip(match)) continue;
    output += text.slice(cursor, match.index).replace(/[ \t]+$/, '');
    cursor = regex.lastIndex;
  }
  return output + text.slice(cursor);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
