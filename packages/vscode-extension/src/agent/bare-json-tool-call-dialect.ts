import { findJsonObjectEnd } from './fake-tool-json-utils';
import type {
  ModelToolProtocolAdapter,
  ModelToolProtocolDialect,
} from './model-tool-protocol-adapter';

interface BareJsonToolAttempt {
  index: number;
  end: number;
  name: string;
  input: Record<string, unknown> | null;
}

const BARE_JSON_TOOL_START_RE = /([a-z_][a-z0-9_:-]*)[ \t]+\{/g;
const INLINE_PROTOCOL_BOUNDARY = new Set([':', '\uff1a', ';', '\uff1b', '.', '\u3002', '!', '\uff01', '?', '\uff1f']);

export function createBareJsonToolCallDialect<TTool>(
  adapter: ModelToolProtocolAdapter<TTool>,
): ModelToolProtocolDialect<TTool> {
  return {
    name: 'bare-json-tool-call',
    parse: text => findBareJsonToolAttempts(text, adapter)
      .filter((attempt): attempt is BareJsonToolAttempt & { input: Record<string, unknown> } => (
        attempt.input !== null
      ))
      .map(attempt => adapter.createTool(
        attempt.name,
        adapter.normalizeInput(attempt.name, attempt.input),
      )),
    findStart: text => findBareJsonToolAttempts(text, adapter)[0]?.index ?? -1,
    strip: text => stripBareJsonToolAttempts(text, adapter),
  };
}

export function createFencedAnonymousJsonToolDialect<TTool>(input: {
  parseImplicit(value: Record<string, unknown>): TTool | null;
  normalize(tool: TTool): TTool;
}): ModelToolProtocolDialect<TTool> {
  const findSpans = (text: string): Array<{ index: number; end: number; tool: TTool }> => {
    const spans: Array<{ index: number; end: number; tool: TTool }> = [];
    const fenceRegex = /```json\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(text)) !== null) {
      const candidate = String(match[1] || '').trim();
      if (!candidate.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const tool = input.parseImplicit(parsed as Record<string, unknown>);
        if (tool) spans.push({ index: match.index, end: fenceRegex.lastIndex, tool: input.normalize(tool) });
      } catch { /* A nameless protocol must be strict JSON. */ }
    }
    return spans;
  };
  return {
    name: 'fenced-anonymous-json-tool',
    parse: text => findSpans(text).map(span => span.tool),
    findStart: text => findSpans(text)[0]?.index ?? -1,
    strip(text) {
      const spans = findSpans(text);
      if (spans.length === 0) return text;
      let output = '';
      let cursor = 0;
      for (const span of spans) {
        output += text.slice(cursor, span.index).replace(/[ \t]+$/, '');
        cursor = span.end;
      }
      return output + text.slice(cursor);
    },
  };
}

function findBareJsonToolAttempts<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): BareJsonToolAttempt[] {
  const attempts: BareJsonToolAttempt[] = [];
  const startRe = new RegExp(BARE_JSON_TOOL_START_RE.source, BARE_JSON_TOOL_START_RE.flags);
  let previousAttemptEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = startRe.exec(text)) !== null) {
    const index = match.index;
    if (isInsideMarkdownCode(text, index)
        || !hasProtocolBoundary(text, index, previousAttemptEnd)) {
      continue;
    }

    const name = adapter.normalizeName(match[1]);
    if (!adapter.isRegisteredName(name)) continue;

    const objectStart = startRe.lastIndex - 1;
    const objectEnd = findJsonObjectEnd(text, objectStart);
    if (objectEnd < 0) {
      attempts.push({ index, end: text.length, name, input: null });
      break;
    }

    const input = parseJsonObject(text.slice(objectStart, objectEnd + 1));
    const end = objectEnd + 1;
    attempts.push({ index, end, name, input });
    previousAttemptEnd = end;
    startRe.lastIndex = end;
  }

  return attempts;
}

function hasProtocolBoundary(text: string, index: number, previousAttemptEnd: number): boolean {
  if (index === 0) return true;
  if (previousAttemptEnd >= 0 && /^\s*$/.test(text.slice(previousAttemptEnd, index))) return true;

  const lineStart = Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1;
  const linePrefix = text.slice(lineStart, index);
  if (/^\s*(?:[-*]\s+)?$/.test(linePrefix)) return true;

  return INLINE_PROTOCOL_BOUNDARY.has(text[index - 1]);
}

function isInsideMarkdownCode(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  const fenceCount = (prefix.match(/^[ \t]*```/gm) || []).length;
  if (fenceCount % 2 === 1) return true;

  const lineStart = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1;
  const linePrefix = prefix.slice(lineStart);
  let inlineTicks = 0;
  for (let cursor = 0; cursor < linePrefix.length; cursor += 1) {
    if (linePrefix[cursor] !== '`') continue;
    if (cursor > 0 && linePrefix[cursor - 1] === '\\') continue;
    inlineTicks += 1;
  }
  return inlineTicks % 2 === 1;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stripBareJsonToolAttempts<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): string {
  const attempts = findBareJsonToolAttempts(text, adapter);
  if (attempts.length === 0) return text;

  let output = '';
  let cursor = 0;
  for (const attempt of attempts) {
    output += text.slice(cursor, attempt.index).replace(/[ \t]+$/, '');
    cursor = attempt.end;
  }
  return output + text.slice(cursor);
}
