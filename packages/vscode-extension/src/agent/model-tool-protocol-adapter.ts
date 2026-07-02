export interface ModelToolProtocolDialect<TTool> {
  name: string;
  parse(text: string): TTool[];
  findStart(text: string): number;
  strip(text: string): string;
}

export interface ProtocolStripResult {
  text: string;
  removed: boolean;
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
  return { text: result, removed };
}
