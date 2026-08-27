import type { FakeTool } from '../agent/fake-tool-types';
import { findJsonObjectEnd } from '../agent/loose-json-text';

const MAX_PROVIDER_NATIVE_TEXT_TOOLS = 16;
const CALLING_HEADER_RE = /(?:^|\n)[ \t]*\*\*Calling:\*\*[ \t]*`([A-Za-z0-9_]+)`[ \t]*(?:\r?\n[ \t]*)+```(?:json)?[ \t]*\r?\n/gi;
const CLOSING_FENCE_RE = /(?:^|\r?\n)[ \t]*```[ \t]*(?=\r?\n|$)/g;
const TOOL_ARGUMENTS_HEADER_RE = /Tool:[ \t]*`?([A-Za-z0-9_]+)`?[ \t]*Arguments:[ \t]*/g;
const BARE_JSON_HEADER_RE = /([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)[ \t]+(?=\{)/g;
const CALLING_MARKER_RE = /\*\*Calling:\*\*/i;
const TOOL_ARGUMENTS_MARKER_RE = /Tool:[ \t]*`?[A-Za-z0-9_]+`?[ \t]*Arguments:/i;
const BARE_JSON_MARKER_RE = /[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+[ \t]+\{/;

export interface ProviderNativeTextToolResponse {
  readonly prose: string;
  readonly tools: readonly FakeTool[];
}

/**
 * Projects complete native tool formats rendered by the DeepSeek web surface.
 * The caller still owns provider admission and canonical tool authorization.
 */
export function projectProviderNativeTextToolResponse(
  text: string,
): ProviderNativeTextToolResponse | undefined {
  const hasCalling = CALLING_MARKER_RE.test(text);
  const hasToolArguments = TOOL_ARGUMENTS_MARKER_RE.test(text);
  if (hasCalling && hasToolArguments) return undefined;
  if ((hasCalling || hasToolArguments) && BARE_JSON_MARKER_RE.test(text)) return undefined;
  if (hasCalling) return projectCallingResponse(text);
  return projectInlineJsonResponse(
    text,
    hasToolArguments ? TOOL_ARGUMENTS_HEADER_RE : BARE_JSON_HEADER_RE,
  );
}

function projectCallingResponse(text: string): ProviderNativeTextToolResponse | undefined {
  const tools: FakeTool[] = [];
  const header = new RegExp(CALLING_HEADER_RE.source, CALLING_HEADER_RE.flags);
  let cursor = 0;
  let prose = '';

  while (cursor < text.length) {
    header.lastIndex = cursor;
    const match = header.exec(text);
    if (!match) break;

    if (tools.length === 0) {
      prose = text.slice(0, match.index).trim();
    } else if (text.slice(cursor, match.index).trim()) {
      return undefined;
    }

    const close = new RegExp(CLOSING_FENCE_RE.source, CLOSING_FENCE_RE.flags);
    close.lastIndex = header.lastIndex;
    const closeMatch = close.exec(text);
    if (!closeMatch) return undefined;

    const input = parseStrictInput(text.slice(header.lastIndex, closeMatch.index));
    if (!input) return undefined;
    tools.push(Object.freeze({ name: match[1], input: Object.freeze(input) }));
    if (tools.length > MAX_PROVIDER_NATIVE_TEXT_TOOLS) return undefined;
    cursor = close.lastIndex;
  }

  if (tools.length === 0 || text.slice(cursor).trim()) return undefined;
  return Object.freeze({ prose, tools: Object.freeze(tools) });
}

function projectInlineJsonResponse(
  text: string,
  headerPattern: RegExp,
): ProviderNativeTextToolResponse | undefined {
  const tools: FakeTool[] = [];
  const header = new RegExp(headerPattern.source, headerPattern.flags);
  let cursor = 0;
  let prose = '';

  while (cursor < text.length) {
    header.lastIndex = cursor;
    const match = header.exec(text);
    if (!match) break;

    if (tools.length === 0) {
      prose = text.slice(0, match.index).trim();
    } else if (text.slice(cursor, match.index).trim()) {
      return undefined;
    }

    const jsonStart = skipWhitespace(text, header.lastIndex);
    if (text[jsonStart] !== '{') return undefined;
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) return undefined;
    const input = parseStrictInput(text.slice(jsonStart, jsonEnd + 1));
    if (!input) return undefined;

    tools.push(Object.freeze({ name: match[1], input: Object.freeze(input) }));
    if (tools.length > MAX_PROVIDER_NATIVE_TEXT_TOOLS) return undefined;
    cursor = jsonEnd + 1;
  }

  if (tools.length === 0 || text.slice(cursor).trim()) return undefined;
  return Object.freeze({ prose, tools: Object.freeze(tools) });
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function parseStrictInput(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
