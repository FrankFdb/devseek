import type {
  ModelToolProtocolAdapter,
  ModelToolProtocolDialect,
} from './model-tool-protocol-adapter';

const EXECUTABLE_BARE_TOOL_NAMES = new Set(['read_file', 'list_dir']);
const PROTOCOL_ONLY_BARE_TOOL_NAMES = new Set([
  'apply_workspace_artifacts',
  'create_directory',
  'create_file',
  'delete_file',
  'replace_file',
  'replace_in_file',
  'run_terminal',
  'run_vscode_command',
  'write_file',
]);

export function createBareToolCommandDialect<TTool>(
  adapter: ModelToolProtocolAdapter<TTool>,
): ModelToolProtocolDialect<TTool> {
  return {
    name: 'bare-tool-command',
    parse: text => parseBareToolCommandCalls(text, adapter),
    findStart: text => findBareToolCommandStart(text, adapter),
    strip: text => stripBareToolCommandLines(text, adapter),
  };
}

function parseBareToolCommandCalls<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): TTool[] {
  const tools: Array<{ index: number; tool: TTool }> = [];
  for (const line of findBareToolCommandLines(text, adapter)) {
    if (!EXECUTABLE_BARE_TOOL_NAMES.has(line.name)) continue;
    const input = parseBareToolArguments(line.rawArguments);
    if (!input || typeof input.path !== 'string' || !input.path.trim()) continue;
    tools.push({
      index: line.index,
      tool: adapter.createTool(line.name, adapter.normalizeInput(line.name, input)),
    });
  }
  return tools.sort((a, b) => a.index - b.index).map(item => item.tool);
}

function findBareToolCommandStart<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): number {
  return findBareToolCommandLines(text, adapter)[0]?.index ?? -1;
}

function stripBareToolCommandLines<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): string {
  const lines = findBareToolCommandLines(text, adapter);
  if (lines.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const line of lines) {
    out += text.slice(cursor, line.index).replace(/[ \t]+$/, '');
    cursor = line.end;
  }
  return out + text.slice(cursor);
}

interface BareToolCommandLine {
  index: number;
  end: number;
  name: string;
  rawArguments: string;
}

function findBareToolCommandLines<TTool>(
  text: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): BareToolCommandLine[] {
  const commands: BareToolCommandLine[] = [];
  let offset = 0;
  let insideFence = false;
  for (const rawLine of text.split(/(\r?\n)/)) {
    if (/^\r?\n$/.test(rawLine)) {
      offset += rawLine.length;
      continue;
    }
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      insideFence = !insideFence;
      offset += rawLine.length;
      continue;
    }
    if (!insideFence) {
      const command = parseBareToolCommandLine(rawLine, adapter);
      if (command) {
        commands.push({
          ...command,
          index: offset + command.leadingWhitespace,
          end: offset + rawLine.length,
        });
      }
    }
    offset += rawLine.length;
  }
  return commands;
}

function parseBareToolCommandLine<TTool>(
  rawLine: string,
  adapter: ModelToolProtocolAdapter<TTool>,
): { leadingWhitespace: number; name: string; rawArguments: string } | null {
  const match = /^(\s*)([A-Za-z_][\w:-]*)(?:\s+(.+?))?\s*$/.exec(rawLine);
  if (!match) return null;
  const rawName = match[2] || '';
  const name = adapter.normalizeName(rawName);
  if (!adapter.isRegisteredName(name)) return null;
  if (!EXECUTABLE_BARE_TOOL_NAMES.has(name) && !PROTOCOL_ONLY_BARE_TOOL_NAMES.has(name)) return null;
  const rawArguments = (match[3] || '').trim();
  if (!rawArguments || !/[A-Za-z_][\w-]*\s*=/.test(rawArguments)) return null;
  if (!parseBareToolArguments(rawArguments)) return null;
  return { leadingWhitespace: (match[1] || '').length, name, rawArguments };
}

function parseBareToolArguments(rawArguments: string): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  let cursor = 0;
  while (cursor < rawArguments.length) {
    while (cursor < rawArguments.length && /\s/.test(rawArguments[cursor])) cursor += 1;
    if (cursor >= rawArguments.length) break;
    const parsed = parseBareToolArgument(rawArguments, cursor);
    if (!parsed) return null;
    input[parsed.key] = parsed.value;
    cursor = parsed.end;
  }
  return Object.keys(input).length > 0 ? input : null;
}

function parseBareToolArgument(
  text: string,
  start: number,
): { key: string; value: unknown; end: number } | null {
  const keyMatch = /^([A-Za-z_][\w-]*)\s*=\s*/.exec(text.slice(start));
  if (!keyMatch) return null;
  const key = keyMatch[1];
  let cursor = start + keyMatch[0].length;
  if (cursor >= text.length) return null;
  const quote = text[cursor];
  if (quote === '"' || quote === "'") {
    return parseQuotedBareToolArgument(text, cursor, key, quote);
  }
  const valueStart = cursor;
  while (cursor < text.length && !/\s/.test(text[cursor])) cursor += 1;
  return {
    key,
    value: parseBareToolScalar(text.slice(valueStart, cursor)),
    end: cursor,
  };
}

function parseQuotedBareToolArgument(
  text: string,
  valueStart: number,
  key: string,
  quote: string,
): { key: string; value: unknown; end: number } | null {
  let cursor = valueStart + 1;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === quote) {
      const raw = text.slice(valueStart, cursor + 1);
      return {
        key,
        value: decodeBareToolQuotedScalar(raw, quote),
        end: cursor + 1,
      };
    }
    cursor += 1;
  }
  return null;
}

function decodeBareToolQuotedScalar(raw: string, quote: string): string {
  if (quote === '"') {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function parseBareToolScalar(raw: string): unknown {
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/i.test(raw)) {
    try {
      return JSON.parse(raw.toLowerCase());
    } catch {
      return raw;
    }
  }
  return raw;
}
