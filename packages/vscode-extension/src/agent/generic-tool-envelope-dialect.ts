import { findJsonObjectEnd } from './fake-tool-json-utils';
import type { ModelToolProtocolDialect } from './model-tool-protocol-adapter';
import { decodeXmlishText, stripJsonFence } from './tool-protocol-text';

const OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL\\s*(?:>|&gt;)';
const CLOSE_PATTERN = '(?:<\\/|&lt;\\/)\\s*TOOL\\s*(?:>|&gt;)';
const PREFIX_TAIL_RE = /(?:<|&lt;)\s*(?:T(?:O(?:O(?:L)?)?)?)?$/i;

export interface GenericToolEnvelopeAdapter<TTool> {
  isRegisteredName(name: string): boolean;
  normalizeName(name: string): string;
  parseCompatibleInput(name: string, rawInput: string): Record<string, unknown> | null;
  createTool(name: string, input: Record<string, unknown>): TTool;
}

export interface GenericToolEnvelopeDialect<TTool> extends ModelToolProtocolDialect<TTool> {
  hasIncomplete(text: string): boolean;
  parseBody(rawBody: string): TTool | null;
}

interface EnvelopeHeader {
  name: string;
  inputStart: number;
}

interface EnvelopeCall<TTool> {
  index: number;
  end: number;
  tool: TTool;
}

export function createGenericToolEnvelopeDialect<TTool>(
  adapter: GenericToolEnvelopeAdapter<TTool>,
): GenericToolEnvelopeDialect<TTool> {
  function parseBody(rawBody: string): TTool | null {
    const body = stripJsonFence(decodeXmlishText(rawBody)).trim();
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\b/.exec(body);
    if (!nameMatch || !adapter.isRegisteredName(nameMatch[1])) return null;
    const name = adapter.normalizeName(nameMatch[1]);
    const rawInput = body.slice(nameMatch[0].length).trim();
    const input = rawInput ? adapter.parseCompatibleInput(name, rawInput) : {};
    return input ? adapter.createTool(name, input) : null;
  }

  function parse(text: string): TTool[] {
    const calls: Array<{ index: number; tool: TTool }> = [];
    const blockRe = makeBlockRegex();
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(text)) !== null) {
      const tool = parseBody(match[1] || '');
      if (tool) calls.push({ index: match.index, tool });
    }
    for (const call of parseOpenJsonCalls(text)) {
      calls.push({ index: call.index, tool: call.tool });
    }
    return calls.sort((a, b) => a.index - b.index).map(item => item.tool);
  }

  function parseOpenJsonCalls(text: string): EnvelopeCall<TTool>[] {
    const calls: EnvelopeCall<TTool>[] = [];
    const openRe = makeOpenRegex();
    let marker: RegExpExecArray | null;
    while ((marker = openRe.exec(text)) !== null) {
      const header = headerAt(text, marker.index);
      if (!header || text[header.inputStart] !== '{') continue;
      const jsonEnd = findJsonObjectEnd(text, header.inputStart);
      if (jsonEnd < 0) continue;
      const input = parseStrictJsonObject(text.slice(header.inputStart, jsonEnd + 1));
      if (!input) {
        openRe.lastIndex = jsonEnd + 1;
        continue;
      }

      const boundary = skipWhitespace(text, jsonEnd + 1);
      const closeEnd = closeEndAt(text, boundary);
      if (closeEnd >= 0) {
        openRe.lastIndex = closeEnd;
        continue;
      }
      if (boundary < text.length && !headerAt(text, boundary)) {
        openRe.lastIndex = jsonEnd + 1;
        continue;
      }

      calls.push({
        index: marker.index,
        end: boundary,
        tool: adapter.createTool(header.name, input),
      });
      openRe.lastIndex = boundary;
    }
    return calls;
  }

  function removeCompleteBlocks(text: string): string {
    const withoutClosedBlocks = text.replace(makeBlockRegex(), '');
    const calls = parseOpenJsonCalls(withoutClosedBlocks);
    if (calls.length === 0) return withoutClosedBlocks;
    let out = '';
    let cursor = 0;
    for (const call of calls) {
      out += withoutClosedBlocks.slice(cursor, call.index);
      cursor = call.end;
    }
    return out + withoutClosedBlocks.slice(cursor);
  }

  function findStart(text: string, startAt = 0): number {
    const openRe = makeOpenRegex();
    openRe.lastIndex = startAt;
    const open = openRe.exec(text);
    const tail = startAt === 0 ? PREFIX_TAIL_RE.exec(text) : null;
    if (!open) return tail?.index ?? -1;
    return tail ? Math.min(open.index, tail.index) : open.index;
  }

  function strip(text: string): string {
    let cleaned = removeCompleteBlocks(text);
    const incompleteStart = findStart(cleaned);
    if (incompleteStart >= 0) cleaned = cleaned.slice(0, incompleteStart);
    return cleaned.replace(PREFIX_TAIL_RE, '').trimEnd();
  }

  function headerAt(text: string, markerStart: number): EnvelopeHeader | null {
    const openRe = makeOpenRegex('iy');
    openRe.lastIndex = markerStart;
    const marker = openRe.exec(text);
    if (!marker || marker.index !== markerStart) return null;
    let cursor = skipWhitespace(text, openRe.lastIndex);
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(cursor));
    if (!nameMatch || !adapter.isRegisteredName(nameMatch[0])) return null;
    const nameEnd = cursor + nameMatch[0].length;
    if (nameEnd < text.length && !/[ \t\r\n{]/.test(text[nameEnd])) return null;
    cursor = skipWhitespace(text, nameEnd);
    return { name: adapter.normalizeName(nameMatch[0]), inputStart: cursor };
  }

  return {
    name: 'generic-tool-envelope',
    parse,
    findStart,
    strip,
    parseBody,
    hasIncomplete: (text: string) => findStart(removeCompleteBlocks(text)) >= 0,
  };
}

function makeOpenRegex(flags = 'gi'): RegExp {
  return new RegExp(OPEN_PATTERN, flags);
}

function makeBlockRegex(flags = 'gi'): RegExp {
  return new RegExp(`${OPEN_PATTERN}([\\s\\S]*?)${CLOSE_PATTERN}`, flags);
}

function closeEndAt(text: string, start: number): number {
  const match = new RegExp(`^${CLOSE_PATTERN}`, 'i').exec(text.slice(start));
  return match ? start + match[0].length : -1;
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor++;
  return cursor;
}

function parseStrictJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
