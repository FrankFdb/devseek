import * as fs from 'fs';
import * as nodePath from 'path';

export interface TerminalCommandCapabilityResolutionInput {
  command: string;
  envPath?: string;
}

export interface TerminalCommandCapabilityResolution {
  command: string;
  changed: boolean;
  blocked: boolean;
  reason?: string;
  notes: string[];
}

export function resolveTerminalCommandCapabilities(
  input: TerminalCommandCapabilityResolutionInput,
): TerminalCommandCapabilityResolution {
  const envPath = input.envPath ?? process.env.PATH ?? '';
  const hasPython = hasExecutableInPath('python', envPath);
  const hasPython3 = hasExecutableInPath('python3', envPath);
  const rewritten = rewritePythonRuntime(input.command, { hasPython, hasPython3 });
  if (rewritten.blocked) {
    return {
      command: input.command,
      changed: false,
      blocked: true,
      reason: rewritten.reason,
      notes: rewritten.notes,
    };
  }
  return {
    command: rewritten.command,
    changed: rewritten.command !== input.command,
    blocked: false,
    notes: rewritten.notes,
  };
}

function rewritePythonRuntime(
  command: string,
  availability: { hasPython: boolean; hasPython3: boolean },
): TerminalCommandCapabilityResolution {
  const pieces = splitCommandPieces(command);
  let changed = false;
  let sawPython = false;
  const rewritten = pieces.map(piece => {
    if (piece.kind === 'separator') return piece.text;
    const replaced = rewritePythonSegment(piece.text, availability);
    changed = changed || replaced.changed;
    sawPython = sawPython || replaced.sawPython;
    return replaced.text;
  }).join('');

  if (sawPython && !availability.hasPython && !availability.hasPython3) {
    return {
      command,
      changed: false,
      blocked: true,
      reason: 'missing-python-runtime',
      notes: ['当前系统没有可用的 python/python3，不能执行该 Python 验证命令。'],
    };
  }
  return {
    command: rewritten,
    changed,
    blocked: false,
    notes: changed
      ? ['当前系统未提供 python，但检测到 python3，已将验证命令中的 python 解析为 python3。']
      : [],
  };
}

function rewritePythonSegment(
  segment: string,
  availability: { hasPython: boolean; hasPython3: boolean },
): { text: string; changed: boolean; sawPython: boolean } {
  const match = segment.match(/^(\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+))\s+)*)(python)(?=\s|$)([\s\S]*)$/);
  if (!match) return { text: segment, changed: false, sawPython: false };
  if (availability.hasPython || !availability.hasPython3) {
    return { text: segment, changed: false, sawPython: true };
  }
  return {
    text: `${match[1]}python3${match[3]}`,
    changed: true,
    sawPython: true,
  };
}

function splitCommandPieces(command: string): Array<{ kind: 'segment' | 'separator'; text: string }> {
  const pieces: Array<{ kind: 'segment' | 'separator'; text: string }> = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    const next = command[index + 1] ?? '';
    if (ch === '\\') {
      current += ch;
      if (next) current += command[++index];
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
      pieces.push({ kind: 'segment', text: current });
      pieces.push({ kind: 'separator', text: ch + next });
      current = '';
      index += 1;
      continue;
    }
    if (ch === '|' || ch === ';') {
      pieces.push({ kind: 'segment', text: current });
      pieces.push({ kind: 'separator', text: ch });
      current = '';
      continue;
    }
    current += ch;
  }
  pieces.push({ kind: 'segment', text: current });
  return pieces;
}

function hasExecutableInPath(command: string, envPath: string): boolean {
  return envPath.split(nodePath.delimiter).filter(Boolean).some(dir => {
    const candidate = nodePath.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
