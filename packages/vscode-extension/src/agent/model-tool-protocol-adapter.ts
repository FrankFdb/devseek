import { listCodingToolNames as listAgentToolNames } from '@devseek-netai/shared';
import { normalizeStructuredToolEnvelope } from './structured-tool-envelope-normalizer';

export interface ModelToolProtocolDialect<TTool> {
  name: string;
  conflictParticipation?: 'protocol' | 'payload';
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

export interface ModelToolProtocolMatch<TTool> {
  dialect: string;
  conflictParticipation: 'protocol' | 'payload';
  start: number;
  tools: TTool[];
}

export interface ModelToolProtocolAnalysis<TTool> {
  tools: TTool[];
  matches: ModelToolProtocolMatch<TTool>[];
  mixed: boolean;
}

export interface ModelToolProtocolAnalysisOptions<TTool> {
  toolIdentity(tool: TTool): string;
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
  return analyzeModelToolProtocol(text, dialects).tools;
}

/**
 * Model output may contain overlapping parsers for one serialization, but it
 * must not combine distinct serializations in one executable response. The
 * latter is ambiguous at the execution boundary and therefore fails closed.
 */
export function analyzeModelToolProtocol<TTool>(
  text: string,
  dialects: readonly ModelToolProtocolDialect<TTool>[],
  options?: ModelToolProtocolAnalysisOptions<TTool>,
): ModelToolProtocolAnalysis<TTool> {
  const matches: ModelToolProtocolMatch<TTool>[] = [];
  for (const dialect of dialects) {
    const tools = dialect.parse(text);
    if (tools.length === 0) continue;
    const start = dialect.findStart(text);
    if (start < 0) continue;
    matches.push({
      dialect: dialect.name,
      conflictParticipation: dialect.conflictParticipation ?? 'protocol',
      start,
      tools,
    });
  }

  const protocolMatches = matches.filter(match => match.conflictParticipation === 'protocol');
  const mixed = options ? hasNovelToolsInDistinctProtocol(protocolMatches, options.toolIdentity) : false;
  return {
    tools: mixed ? [] : protocolMatches[0]?.tools ?? matches[0]?.tools ?? [],
    matches,
    mixed,
  };
}

function hasNovelToolsInDistinctProtocol<TTool>(
  matches: readonly ModelToolProtocolMatch<TTool>[],
  toolIdentity: (tool: TTool) => string,
): boolean {
  const first = matches[0];
  if (!first) return false;
  const knownTools = new Set(first.tools.map(toolIdentity));
  const knownStarts = new Set([first.start]);

  for (const match of matches.slice(1)) {
    const identities = match.tools.map(toolIdentity);
    const contributesNovelTool = identities.some(identity => !knownTools.has(identity));
    if (contributesNovelTool && !knownStarts.has(match.start)) return true;
    identities.forEach(identity => knownTools.add(identity));
    knownStarts.add(match.start);
  }
  return false;
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
  const stripOrder = [
    ...dialects.filter(dialect => (dialect.conflictParticipation ?? 'protocol') === 'protocol'),
    ...dialects.filter(dialect => dialect.conflictParticipation === 'payload'),
  ];
  for (const dialect of stripOrder) {
    const before = result;
    result = dialect.strip(result);
    removed = removed || result !== before;
  }
  if (removed) result = result.replace(EMPTY_TOOL_PROTOCOL_FENCE_RE, '\n');
  return { text: result, removed };
}
