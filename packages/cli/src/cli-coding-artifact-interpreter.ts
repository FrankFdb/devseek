export interface CliFileToolCall {
  name: 'create_file' | 'replace_file';
  filePath: string;
  content: string;
}

export interface CliTerminalToolCall {
  name: 'run_terminal';
  command: string;
  workdir?: string;
}

export interface CliUnifiedDiffArtifact {
  filePath: string;
  hunks: CliDiffHunk[];
}

export interface CliDiffHunk {
  oldStart: number;
  lines: string[];
}

export interface CliCodingArtifactProposal {
  fileToolCalls: CliFileToolCall[];
  terminalToolCalls: CliTerminalToolCall[];
  unifiedDiffs: CliUnifiedDiffArtifact[];
  candidateCount: number;
}

export class CliCodingArtifactInterpreter {
  interpret(response: string): CliCodingArtifactProposal {
    const fileToolCalls = parseFileToolCalls(response);
    const terminalToolCalls = parseTerminalToolCalls(response);
    const unifiedDiffs = parseUnifiedDiffs(response);
    return {
      fileToolCalls,
      terminalToolCalls,
      unifiedDiffs,
      candidateCount: fileToolCalls.length + terminalToolCalls.length + unifiedDiffs.length,
    };
  }
}

function parseTerminalToolCalls(response: string): CliTerminalToolCall[] {
  const calls: CliTerminalToolCall[] = [];
  let cursor = 0;
  while (cursor < response.length) {
    const match = response.slice(cursor).match(/\[TOOL:run_terminal\s+/);
    if (!match || match.index === undefined) break;
    const objectStart = cursor + match.index + match[0].length;
    const parsed = readJsonObject(response, objectStart);
    if (!parsed) {
      cursor = objectStart;
      continue;
    }
    try {
      const input = JSON.parse(parsed.text) as { command?: unknown; workdir?: unknown };
      if (typeof input.command === 'string' && input.command.trim()) {
        calls.push({
          name: 'run_terminal',
          command: input.command.trim(),
          ...(typeof input.workdir === 'string' && input.workdir.trim()
            ? { workdir: input.workdir.trim() }
            : {}),
        });
      }
    } catch {
      // Invalid structured terminal calls remain absent and cannot reach a host.
    }
    cursor = parsed.end;
  }

  for (const match of response.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    try {
      const parsed = JSON.parse(match[1] ?? '') as {
        name?: unknown;
        arguments?: { command?: unknown; workdir?: unknown };
      };
      if (parsed.name === 'run_terminal'
        && typeof parsed.arguments?.command === 'string'
        && parsed.arguments.command.trim()) {
        calls.push({
          name: 'run_terminal',
          command: parsed.arguments.command.trim(),
          ...(typeof parsed.arguments.workdir === 'string' && parsed.arguments.workdir.trim()
            ? { workdir: parsed.arguments.workdir.trim() }
            : {}),
        });
      }
    } catch {
      // Invalid XML-wrapped JSON is not a terminal capability request.
    }
  }
  return calls;
}

function parseFileToolCalls(response: string): CliFileToolCall[] {
  const calls: CliFileToolCall[] = [];
  let cursor = 0;
  while (cursor < response.length) {
    const match = response.slice(cursor).match(/\[TOOL:(create_file|replace_file)\s+/);
    if (!match || match.index === undefined) break;
    const name = match[1] as CliFileToolCall['name'];
    const objectStart = cursor + match.index + match[0].length;
    const parsed = readJsonObject(response, objectStart);
    if (!parsed) {
      cursor = objectStart;
      continue;
    }
    let input: { filePath?: unknown; path?: unknown; content?: unknown } | undefined;
    try {
      input = JSON.parse(parsed.text) as { filePath?: unknown; path?: unknown; content?: unknown };
    } catch {
      const recovered = recoverLooseFileToolCall(name, parsed.text);
      if (recovered) calls.push(recovered);
      cursor = parsed.end;
      continue;
    }
    const filePath = typeof input.filePath === 'string'
      ? input.filePath
      : typeof input.path === 'string'
        ? input.path
        : undefined;
    if (filePath && typeof input.content === 'string') {
      calls.push({ name, filePath, content: normalizeToolContent(filePath, input.content) });
    }
    cursor = parsed.end;
  }
  calls.push(...parseXmlToolCalls(response));
  return calls;
}

function parseXmlToolCalls(response: string): CliFileToolCall[] {
  const calls: CliFileToolCall[] = [];
  for (const match of response.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    const rawToolCall = match[1];
    if (!rawToolCall) continue;
    const parsed = parseXmlToolCall(rawToolCall);
    if (parsed) calls.push(parsed);
  }
  return calls;
}

function parseXmlToolCall(rawToolCall: string): CliFileToolCall | undefined {
  try {
    const parsed = JSON.parse(rawToolCall) as {
      name?: unknown;
      arguments?: { filePath?: unknown; path?: unknown; content?: unknown };
    };
    const name = parsed.name === 'create_file' || parsed.name === 'replace_file'
      ? parsed.name
      : undefined;
    const filePath = typeof parsed.arguments?.filePath === 'string'
      ? parsed.arguments.filePath
      : typeof parsed.arguments?.path === 'string'
        ? parsed.arguments.path
        : undefined;
    if (name && filePath && typeof parsed.arguments?.content === 'string') {
      return { name, filePath, content: normalizeToolContent(filePath, parsed.arguments.content) };
    }
  } catch {
    const name = rawToolCall.match(/"name"\s*:\s*"(create_file|replace_file)"/)?.[1] as CliFileToolCall['name'] | undefined;
    if (name) return recoverLooseFileToolCall(name, rawToolCall);
  }
  return undefined;
}

function recoverLooseFileToolCall(
  name: CliFileToolCall['name'],
  rawJsonish: string,
): CliFileToolCall | undefined {
  const rawPath = matchJsonishStringField(rawJsonish, 'filePath') ?? matchJsonishStringField(rawJsonish, 'path');
  const contentStart = rawJsonish.match(/"content"\s*:\s*"/);
  if (!rawPath || !contentStart || contentStart.index === undefined) return undefined;

  const start = contentStart.index + contentStart[0].length;
  const objectEnd = rawJsonish.lastIndexOf('}');
  const end = rawJsonish.lastIndexOf('"', objectEnd > start ? objectEnd - 1 : rawJsonish.length - 1);
  if (end <= start) return undefined;

  const filePath = decodeJsonishString(rawPath);
  return {
    name,
    filePath,
    content: normalizeToolContent(filePath, decodeLooseSourceContent(rawJsonish.slice(start, end))),
  };
}

function normalizeToolContent(filePath: string, content: string): string {
  if (!/\.py$/i.test(filePath)) return content;
  return content.replace(/\*\*(file|main|name)\*\*/g, '__$1__');
}

function matchJsonishStringField(text: string, fieldName: string): string | undefined {
  return text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`))?.[1];
}

function decodeLooseSourceContent(text: string): string {
  const protectedNewlineEscape = '\0DEVSEEK_CLI_NEWLINE_ESCAPE\0';
  return decodeJsonishString(text.replace(/\\n(?=['"])/g, protectedNewlineEscape))
    .split(protectedNewlineEscape)
    .join('\\n');
}

function decodeJsonishString(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function readJsonObject(text: string, start: number): { text: string; end: number } | undefined {
  let index = start;
  while (index < text.length && /\s/.test(text[index] ?? '')) index++;
  if (text[index] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return { text: text.slice(start, index + 1).trim(), end: index + 1 };
    }
  }
  return undefined;
}

function parseUnifiedDiffs(response: string): CliUnifiedDiffArtifact[] {
  return extractDiffTexts(response)
    .map(parseUnifiedDiff)
    .filter((diff): diff is CliUnifiedDiffArtifact => diff !== undefined);
}

function extractDiffTexts(response: string): string[] {
  const fenced = [...response.matchAll(/```(?:diff|patch)?\s*\n([\s\S]*?)```/gi)]
    .map(match => match[1] ?? '')
    .filter(text => /^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text));
  if (fenced.length > 0) return fenced;
  if (/^---\s+/m.test(response) && /^\+\+\+\s+/m.test(response)) return [response];
  return [];
}

function parseUnifiedDiff(diffText: string): CliUnifiedDiffArtifact | undefined {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const plusLine = lines.find(line => line.startsWith('+++ '));
  if (!plusLine) return undefined;
  const filePath = normalizeDiffPath(plusLine.slice(4).trim().split(/\s+/)[0] ?? '');
  if (!filePath) return undefined;

  const hunks: CliDiffHunk[] = [];
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index]?.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/);
    if (!header) continue;
    const hunkLines: string[] = [];
    index++;
    while (index < lines.length && !lines[index]?.startsWith('@@ ')) {
      const line = lines[index] ?? '';
      if (line.startsWith('--- ') || line.startsWith('+++ ')) break;
      if (line === '\\ No newline at end of file') {
        index++;
        continue;
      }
      if (/^[ +\-]/.test(line)) hunkLines.push(line);
      index++;
    }
    index--;
    hunks.push({ oldStart: Number(header[1]), lines: hunkLines });
  }
  return hunks.length > 0 ? { filePath, hunks } : undefined;
}

function normalizeDiffPath(diffPath: string): string {
  if (!diffPath || diffPath === '/dev/null') return '';
  return diffPath.replace(/^[ab]\//, '');
}
