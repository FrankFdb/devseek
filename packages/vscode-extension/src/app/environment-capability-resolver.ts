import * as fs from 'fs';
import * as nodePath from 'path';

export interface TerminalCommandCapabilityResolutionInput {
  command: string;
  envPath?: string;
  workspaceRoot?: string;
  workdir?: string;
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
  const pathResolved = rewriteWorkspaceRelativePythonScriptPaths(rewritten.command, {
    workspaceRoot: input.workspaceRoot,
    workdir: input.workdir,
  });
  return {
    command: pathResolved.command,
    changed: pathResolved.command !== input.command,
    blocked: false,
    notes: [...rewritten.notes, ...pathResolved.notes],
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

function rewriteWorkspaceRelativePythonScriptPaths(
  command: string,
  paths: { workspaceRoot?: string; workdir?: string },
): { command: string; changed: boolean; notes: string[] } {
  const workspaceRoot = paths.workspaceRoot ? nodePath.resolve(paths.workspaceRoot) : undefined;
  const workdir = paths.workdir ? nodePath.resolve(paths.workdir) : workspaceRoot;
  if (!workspaceRoot || !workdir) {
    return { command, changed: false, notes: [] };
  }

  const pieces = splitCommandPieces(command);
  let changed = false;
  const resolved = pieces.map(piece => {
    if (piece.kind === 'separator') return piece.text;
    const segment = rewritePythonScriptPathSegment(piece.text, workspaceRoot, workdir);
    changed = changed || segment.changed;
    return segment.text;
  }).join('');

  return {
    command: resolved,
    changed,
    notes: changed
      ? ['检测到终端工作目录不同于工作区根目录，已将工作区相对 Python 脚本路径解析为绝对路径。']
      : [],
  };
}

function rewritePythonScriptPathSegment(
  segment: string,
  workspaceRoot: string,
  workdir: string,
): { text: string; changed: boolean } {
  const match = segment.match(/^(\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+))\s+)*)(python3?|python)(?=\s|$)([\s\S]*)$/);
  if (!match) return { text: segment, changed: false };

  const remainder = match[3] || '';
  const tokens = shellTokensWithSpans(remainder);
  const script = tokens.find(token => {
    const value = token.value;
    return /\.py$/i.test(value)
      && !nodePath.isAbsolute(value)
      && !/[`$*?\[\]{}]/.test(value)
      && shouldAnchorWorkspaceRelativePath(value, workspaceRoot, workdir);
  });
  if (!script) return { text: segment, changed: false };

  const absoluteScriptPath = nodePath.resolve(workspaceRoot, script.value);
  const nextRemainder = `${remainder.slice(0, script.start)}${shellQuote(absoluteScriptPath)}${remainder.slice(script.end)}`;
  return {
    text: `${match[1]}${match[2]}${nextRemainder}`,
    changed: true,
  };
}

function shouldAnchorWorkspaceRelativePath(value: string, workspaceRoot: string, workdir: string): boolean {
  const rootCandidate = nodePath.resolve(workspaceRoot, value);
  const workdirCandidate = nodePath.resolve(workdir, value);
  return isInsidePath(rootCandidate, workspaceRoot)
    && !safeExistsSync(workdirCandidate)
    && safeExistsSync(rootCandidate);
}

function safeExistsSync(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isInsidePath(filePath: string, root: string): boolean {
  const relative = nodePath.relative(nodePath.resolve(root), nodePath.resolve(filePath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function shellTokensWithSpans(text: string): Array<{ value: string; start: number; end: number }> {
  const tokens: Array<{ value: string; start: number; end: number }> = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    const start = index;
    let value = '';
    let quote = '';
    while (index < text.length) {
      const ch = text[index];
      const next = text[index + 1] ?? '';
      if (!quote && /\s/.test(ch)) break;
      if (ch === '\\') {
        if (next) {
          value += next;
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (quote) {
        if (ch === quote) {
          quote = '';
        } else {
          value += ch;
        }
        index += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        index += 1;
        continue;
      }
      value += ch;
      index += 1;
    }
    tokens.push({ value, start, end: index });
  }
  return tokens;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
