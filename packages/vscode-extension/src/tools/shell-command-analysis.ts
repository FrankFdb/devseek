import * as nodePath from 'path';

export type ShellCommandEvidenceKind = 'compile' | 'run' | 'test' | 'compile-run' | 'other';

const NON_RUNTIME_COMMANDS = new Set([
  'cmake',
  'make',
  'ninja',
  'ctest',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'tsc',
  'test',
  '[',
]);

const CONTROL_COMMAND_TOKENS = new Set(['then', 'else', 'do']);

export function classifyShellCommandEvidence(command: string): ShellCommandEvidenceKind {
  const c = String(command || '').trim();
  const lower = c.toLowerCase();
  const compileLike = /(?:^|[\s;&|])(?:g\+\+|gcc|clang\+\+|clang|cmake|make|ninja)(?=\s|$)/.test(lower)
    || /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|compile)\b/.test(lower)
    || /\bcargo\s+build\b|\bgo\s+build\b|\bdotnet\s+build\b/.test(lower);
  const testLike = /\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test)\b/.test(lower)
    || /\b(?:pytest|go\s+test|cargo\s+test|dotnet\s+test|ctest)\b/.test(lower);
  const runLike = containsRuntimeExecutableSegment(c)
    || /\b(?:python3?|node|java|cargo\s+run|go\s+run|dotnet\s+run)\b/.test(lower);
  if (compileLike && runLike) return 'compile-run';
  if (testLike) return 'test';
  if (runLike) return 'run';
  if (compileLike) return 'compile';
  return 'other';
}

export function containsRuntimeExecutableSegment(command: string): boolean {
  return runtimeExecutableTokens(command).length > 0;
}

export function runtimeExecutableTokens(command: string): string[] {
  const out: string[] = [];
  for (const segment of splitShellSegments(String(command || ''))) {
    const words = shellWords(segment);
    for (const token of commandPositionTokens(words)) {
      if (isRuntimeExecutableToken(token)) out.push(token);
    }
  }
  return out;
}

function commandPositionTokens(words: string[]): string[] {
  const starts = new Set<number>();
  if (words.length > 0) starts.add(0);
  for (let i = 0; i < words.length - 1; i++) {
    if (CONTROL_COMMAND_TOKENS.has(words[i].toLowerCase())) starts.add(i + 1);
  }
  return [...starts]
    .map(start => firstCommandTokenFrom(words, start))
    .filter((token): token is string => !!token);
}

function firstCommandTokenFrom(words: string[], start: number): string | undefined {
  let i = start;
  while (i < words.length) {
    const lower = words[i].toLowerCase();
    if (CONTROL_COMMAND_TOKENS.has(lower) || lower === 'if' || lower === 'fi' || lower === 'while' || lower === 'for') {
      i++;
      continue;
    }
    if (isAssignment(words[i])) {
      i++;
      continue;
    }
    if (lower === 'env') {
      i++;
      while (i < words.length && (words[i].startsWith('-') || isAssignment(words[i]))) i++;
      continue;
    }
    if (lower === 'command' || lower === 'exec' || lower === 'time') {
      i++;
      continue;
    }
    if (lower === 'timeout' || lower === 'gtimeout') {
      i++;
      while (i < words.length && words[i].startsWith('-')) i++;
      if (i < words.length && /^\d+(?:\.\d+)?[smhd]?$/.test(words[i])) i++;
      continue;
    }
    return cleanToken(words[i]);
  }
  return undefined;
}

function isRuntimeExecutableToken(token: string): boolean {
  const cleaned = cleanToken(token);
  if (!cleaned) return false;
  const basename = nodePath.basename(cleaned).toLowerCase();
  if (NON_RUNTIME_COMMANDS.has(basename)) return false;
  return cleaned.startsWith('/') || cleaned.startsWith('./') || cleaned.startsWith('../');
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1] ?? '';
    if (ch === '\\') {
      current += ch;
      if (next) current += command[++i];
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '\n') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    const next = segment[i + 1] ?? '';
    if (ch === '\\') {
      if (next) current += segment[++i];
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words.map(cleanToken).filter(Boolean);
}

function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function cleanToken(token: string): string {
  return token.trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),]+$/g, '');
}
