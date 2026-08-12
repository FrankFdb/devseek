import type { ModelToolProtocolDialect } from './model-tool-protocol-adapter';
import { decodeXmlishText, stripJsonFence } from './tool-protocol-text';

export interface LegacyToolCallXmlDialectAdapter<TTool> {
  isRegisteredName(name: string): boolean;
  normalizeName(name: string): string;
  normalizeInput(name: string, input: Record<string, unknown>): Record<string, unknown>;
  createTool(name: string, input: Record<string, unknown>): TTool;
}

export function createLegacyToolCallXmlDialect<TTool>(
  adapter: LegacyToolCallXmlDialectAdapter<TTool>,
): ModelToolProtocolDialect<TTool> {
  return {
    name: 'legacy-tool-call-xml',
    parse: text => parseLegacyToolCallXmlCalls(text, adapter),
    findStart: findLegacyToolCallXmlStart,
    strip: stripLegacyToolCallXmlBlocks,
  };
}

function parseLegacyToolCallXmlCalls<TTool>(
  text: string,
  adapter: LegacyToolCallXmlDialectAdapter<TTool>,
): TTool[] {
  const tools: Array<{ index: number; tool: TTool }> = [];
  const xmlRe = /<tool_call\b([^<>]*?)>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = xmlRe.exec(text)) !== null) {
    const inner = stripJsonFence(decodeXmlishText(match[2] || '')).trim();
    const attrName = legacyToolCallNameAttribute(match[1] || '');
    const tool = attrName
      ? parseNamedAttributeTool(attrName, inner, adapter)
      : parseLegacyBodyTool(inner, adapter);
    if (tool) tools.push({ index: match.index, tool });
  }
  return tools.sort((a, b) => a.index - b.index).map(item => item.tool);
}

function parseNamedAttributeTool<TTool>(
  rawName: string,
  inner: string,
  adapter: LegacyToolCallXmlDialectAdapter<TTool>,
): TTool | null {
  const name = adapter.normalizeName(rawName);
  if (!adapter.isRegisteredName(name) || !inner.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(inner) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? adapter.createTool(name, adapter.normalizeInput(name, parsed as Record<string, unknown>))
      : null;
  } catch {
    return null;
  }
}

function parseLegacyBodyTool<TTool>(
  inner: string,
  adapter: LegacyToolCallXmlDialectAdapter<TTool>,
): TTool | null {
  if (inner.startsWith('{')) {
    try {
      const parsed = JSON.parse(inner) as Record<string, unknown>;
      const rawName = typeof parsed.name === 'string' ? parsed.name : '';
      if (!rawName) return null;
      const name = adapter.normalizeName(rawName);
      if (!adapter.isRegisteredName(name)) return null;
      const input = (parsed.arguments ?? parsed.parameters ?? parsed.args ?? {}) as Record<string, unknown>;
      return adapter.createTool(name, adapter.normalizeInput(name, input));
    } catch {
      return null;
    }
  }

  const newline = inner.indexOf('\n');
  if (newline < 0) return null;
  const name = adapter.normalizeName(inner.slice(0, newline).trim());
  const jsonPart = inner.slice(newline + 1).trim();
  if (!adapter.isRegisteredName(name) || !jsonPart.startsWith('{')) return null;
  try {
    return adapter.createTool(name, adapter.normalizeInput(name, JSON.parse(jsonPart) as Record<string, unknown>));
  } catch {
    return null;
  }
}

function legacyToolCallNameAttribute(rawAttrs: string): string {
  const attrs = decodeXmlishText(rawAttrs);
  const match = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'/>]+))/i.exec(attrs);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function findLegacyToolCallXmlStart(text: string): number {
  const starts = [text.search(/<tool_call\b[^<>]*>/i), text.search(/<tool_calls\b[^<>]*>/i)].filter(index => index >= 0);
  return starts.length ? Math.min(...starts) : -1;
}

function stripLegacyToolCallXmlBlocks(text: string): string {
  return text
    .replace(/<tool_call\b[^<>]*>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls\b[^<>]*>[\s\S]*?<\/tool_calls>/gi, '');
}
