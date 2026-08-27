import type { FakeTool } from '../agent/fake-tool-types';

const MAX_PROVIDER_NATIVE_TEXT_TOOLS = 16;
const CALLING_HEADER_RE = /(?:^|\n)[ \t]*\*\*Calling:\*\*[ \t]*`([A-Za-z0-9_]+)`[ \t]*(?:\r?\n[ \t]*)+```(?:json)?[ \t]*\r?\n/gi;
const CLOSING_FENCE_RE = /(?:^|\r?\n)[ \t]*```[ \t]*(?=\r?\n|$)/g;

export interface ProviderNativeTextToolResponse {
  readonly prose: string;
  readonly tools: readonly FakeTool[];
}

/**
 * Projects the complete Calling format rendered by the DeepSeek web surface.
 * The caller still owns provider admission and canonical tool authorization.
 */
export function projectProviderNativeTextToolResponse(
  text: string,
): ProviderNativeTextToolResponse | undefined {
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
