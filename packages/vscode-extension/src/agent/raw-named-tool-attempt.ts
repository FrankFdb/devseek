import {
  listCodingToolNames,
  normalizeCodingToolName,
} from '@devseek-netai/shared';

export const KNOWN_TEXT_TOOL_NAMES = new Set(listCodingToolNames());

function rawNamedToolAttemptRegex(flags = 'gi'): RegExp {
  return new RegExp(String.raw`<\s*TOOL\s+name\s*=\s*(["'])([A-Za-z0-9_]+)\1\s*>\s*\{`, flags);
}

function isKnownToolName(name: string): boolean {
  const normalized = normalizeCodingToolName(name);
  return KNOWN_TEXT_TOOL_NAMES.has(normalized) || /^mcp__[A-Za-z0-9_]+$/u.test(normalized);
}

export function findRawNamedToolAttemptStart(text: string): number {
  const regex = rawNamedToolAttemptRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (isKnownToolName(match[2])) return match.index;
  }
  return -1;
}

export function stripRawNamedToolAttempts(text: string): { text: string; removed: boolean } {
  const regex = rawNamedToolAttemptRegex();
  let output = '';
  let cursor = 0;
  let removed = false;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!isKnownToolName(match[2])) continue;
    output += text.slice(cursor, match.index).replace(/[ \t]+$/u, '');
    const close = /<\/\s*TOOL\s*>/giu;
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
