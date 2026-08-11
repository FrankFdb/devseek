import type { ModelToolProtocolDialect } from './model-tool-protocol-adapter';
import { decodeXmlishText, stripJsonFence } from './tool-protocol-text';

const OPEN_PATTERN = '(?:<|&lt;)\\s*TOOL_USE\\s*(?:>|&gt;)';
const CLOSE_PATTERN = '(?:<\\/|&lt;\\/)\\s*TOOL_USE\\s*(?:>|&gt;)';
const PREFIX_TAIL_RE = /(?:<|&lt;)\s*(?:T|TO|TOO|TOOL|TOOL_|TOOL_U|TOOL_US|TOOL_USE)?$/i;

export interface ToolUseEnvelopeAdapter<TTool> {
  isRegisteredName(name: string): boolean;
  normalizeName(name: string): string;
  parseInput(name: string, value: unknown): Record<string, unknown> | null;
  createTool(name: string, input: Record<string, unknown>): TTool;
}

export interface ToolUseEnvelopeDialect<TTool> extends ModelToolProtocolDialect<TTool> {
  hasIncomplete(text: string): boolean;
  parseBody(rawBody: string): TTool | null;
}

/**
 * Owns DeepSeek's named TOOL_USE compatibility envelope. The malformed path is
 * deliberately narrow: only a final arguments object may use loose tool-input
 * recovery, so arbitrary prose never becomes an executable call.
 */
export function createToolUseEnvelopeDialect<TTool>(
  adapter: ToolUseEnvelopeAdapter<TTool>,
): ToolUseEnvelopeDialect<TTool> {
  function parseBody(rawBody: string): TTool | null {
    const body = stripJsonFence(decodeXmlishText(rawBody)).trim();
    const strict = parseJsonRecord(body);
    if (strict) return toolFromRecord(strict);
    return toolFromQuoteDamagedEnvelope(body);
  }

  function toolFromRecord(record: Record<string, unknown>): TTool | null {
    const rawName = typeof record.name === 'string' ? record.name.trim() : '';
    if (!rawName || !adapter.isRegisteredName(rawName)) return null;
    const name = adapter.normalizeName(rawName);
    const input = adapter.parseInput(
      name,
      record.arguments ?? record.parameters ?? record.params ?? record.args,
    );
    return input ? adapter.createTool(name, input) : null;
  }

  function toolFromQuoteDamagedEnvelope(body: string): TTool | null {
    if (!body.startsWith('{') || !body.endsWith('}')) return null;
    const nameMatch = /"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/.exec(body);
    if (!nameMatch || !adapter.isRegisteredName(nameMatch[1])) return null;

    const argumentsRe = /"arguments"\s*:\s*/g;
    argumentsRe.lastIndex = nameMatch.index + nameMatch[0].length;
    const argumentsMatch = argumentsRe.exec(body);
    if (!argumentsMatch) return null;

    const rawInput = body.slice(argumentsRe.lastIndex, -1).trim();
    if (!rawInput.startsWith('{') || !rawInput.endsWith('}')) return null;
    const name = adapter.normalizeName(nameMatch[1]);
    const input = adapter.parseInput(name, rawInput);
    return input ? adapter.createTool(name, input) : null;
  }

  function parse(text: string): TTool[] {
    const tools: TTool[] = [];
    const blockRe = makeBlockRegex();
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(text)) !== null) {
      const tool = parseBody(match[1] || '');
      if (tool) tools.push(tool);
    }
    return tools;
  }

  function removeCompleteBlocks(text: string): string {
    return text.replace(makeBlockRegex(), '');
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

  return {
    name: 'tool-use-envelope',
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

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
