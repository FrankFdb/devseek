import { listCodingToolNames as listAgentToolNames } from '@devseek-netai/shared';
import { normalizeStructuredToolEnvelope } from './structured-tool-envelope-normalizer';

export interface ModelToolProtocolDialect<TTool> {
  name: string;
  parse(text: string): TTool[];
  findStart(text: string): number;
  strip(text: string): string;
}

export interface ModelToolProtocolAdapter<TTool> {
  isRegisteredName(name: string): boolean;
  normalizeName(name: string): string;
  normalizeInput(name: string, input: Record<string, unknown>): Record<string, unknown>;
  createTool(name: string, input: Record<string, unknown>): TTool;
}

export interface ProtocolStripResult {
  text: string;
  removed: boolean;
}

export interface ModelToolRequestIsolation {
  text: string;
  resultStart: number;
  truncated: boolean;
}

const EMPTY_TOOL_PROTOCOL_FENCE_RE = /(?:^|\n)[ \t]*```[A-Za-z0-9_-]*[ \t]*\n[ \t\r\n]*```(?=\n|$)/g;

const MODEL_AUTHORED_TOOL_RESULT_MARKERS: readonly RegExp[] = [
  /\[(?:工具返回|工具执行结果)\]/i,
  /【(?:工具返回|工具执行结果)】/i,
  new RegExp(`\\[(?:${toolNamePattern()})\\s*[:：]`, 'i'),
  /^工具执行结果\s*[:：]/mi,
];

function toolNamePattern(): string {
  return listAgentToolNames(true)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findFirstModelAuthoredToolResultStart(text: string): number {
  const indexes: number[] = [];
  for (const marker of MODEL_AUTHORED_TOOL_RESULT_MARKERS) {
    const match = marker.exec(text);
    if (match) indexes.push(match.index);
  }
  return indexes.length ? Math.min(...indexes) : -1;
}

export function isolateModelToolRequestText(text: string): ModelToolRequestIsolation {
  const normalizedText = normalizeStructuredToolEnvelope(text);
  const resultStart = findFirstModelAuthoredToolResultStart(normalizedText);
  if (resultStart < 0) {
    return { text: normalizedText, resultStart: -1, truncated: false };
  }
  return {
    text: normalizedText.slice(0, resultStart),
    resultStart,
    truncated: true,
  };
}

export function parseModelToolProtocol<TTool>(
  text: string,
  dialects: readonly ModelToolProtocolDialect<TTool>[],
): TTool[] {
  for (const dialect of dialects) {
    const tools = dialect.parse(text);
    if (tools.length > 0) return tools;
  }
  return [];
}

export function findFirstModelToolProtocolStart<TTool>(
  text: string,
  dialects: readonly ModelToolProtocolDialect<TTool>[],
): number {
  const indexes: number[] = [];
  for (const dialect of dialects) {
    const index = dialect.findStart(text);
    if (index >= 0) indexes.push(index);
  }
  return indexes.length ? Math.min(...indexes) : -1;
}

export function stripModelToolProtocolBlocks<TTool>(
  text: string,
  dialects: readonly ModelToolProtocolDialect<TTool>[],
): ProtocolStripResult {
  let result = text;
  let removed = false;
  for (const dialect of dialects) {
    const before = result;
    result = dialect.strip(result);
    removed = removed || result !== before;
  }
  if (removed) result = result.replace(EMPTY_TOOL_PROTOCOL_FENCE_RE, '\n');
  return { text: result, removed };
}
