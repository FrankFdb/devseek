import * as nodePath from 'path';

export type TerminalCommandRiskClass =
  | 'read-only'
  | 'validation'
  | 'mutating'
  | 'destructive'
  | 'unknown';

export interface TerminalCommandPermissionInput {
  command: string;
  workspaceRoot?: string;
  workdir?: string;
}

export interface TerminalCommandPermissionDecision {
  risk: TerminalCommandRiskClass;
  requiresConfirmation: boolean;
  canRememberDecision: boolean;
  reason: string;
}

const READ_ONLY_COMMANDS = new Set([
  'awk', 'basename', 'cat', 'cd', 'cut', 'dirname', 'df', 'du', 'echo',
  'file', 'find', 'grep', 'head', 'la', 'll', 'ls', 'pwd', 'realpath',
  'rg', 'sed', 'sort', 'stat', 'tail', 'test', 'tr', 'true', 'uniq', 'wc', '[',
]);

const GIT_READ_ONLY_COMMANDS = new Set([
  'branch', 'diff', 'grep', 'log', 'ls-files', 'rev-parse', 'show', 'status',
]);

const DESTRUCTIVE_RE = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm\s+-[^\s]*r[^\s]*f|dd\s+|mkfs\b)|\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f)/i;
const MUTATING_RE = /(?:^|[;&|]\s*)(?:touch|mkdir|cp|mv|rm|chmod|chown|ln|truncate)\b|\bgit\s+(?:add|apply|checkout|commit|merge|pull|push|rebase|reset|restore|stash|switch)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b|\b(?:python3?|node)\s+-e\s+[\s\S]*(?:writeFile|appendFile|mkdirSync|rmSync|open\()/i;
const PYTHON_FILE_WRITE_RE = /\bpython3?\s+-c\s+["'][\s\S]*(?:\bopen\(\s*["'][^"']+["']\s*,\s*["'][^"']*[wax+]|Path\(\s*["'][^"']+["']\s*\)\.write_(?:text|bytes)\s*\()/i;
const COMMAND_SUBSTITUTION_RE = /[`$]\(/;

export function decideTerminalCommandPermission(input: TerminalCommandPermissionInput): TerminalCommandPermissionDecision {
  const command = input.command.trim();
  if (!command) return decision('unknown', 'empty-command');

  if (DESTRUCTIVE_RE.test(command)) return decision('destructive', 'destructive-command');
  if (hasShellWriteRedirection(command) || PYTHON_FILE_WRITE_RE.test(command) || MUTATING_RE.test(command)) {
    return decision('mutating', 'mutating-command');
  }
  if (COMMAND_SUBSTITUTION_RE.test(command)) return decision('unknown', 'command-substitution');
  if (referencesOutsideWorkspace(command, input.workspaceRoot, input.workdir)) {
    return decision('unknown', 'command-references-outside-workspace');
  }

  const segments = splitShellSegments(command).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return decision('unknown', 'empty-command');

  let sawValidation = false;
  for (const segment of segments) {
    if (isReadOnlySegment(segment)) continue;
    if (isValidationSegment(segment)) {
      sawValidation = true;
      continue;
    }
    return decision('unknown', 'unclassified-command');
  }

  return sawValidation
    ? decision('validation', 'validation-command')
    : decision('read-only', 'read-only-workspace-inspection');
}

function decision(risk: TerminalCommandRiskClass, reason: string): TerminalCommandPermissionDecision {
  return {
    risk,
    requiresConfirmation: risk !== 'read-only',
    canRememberDecision: risk === 'read-only' || risk === 'validation',
    reason,
  };
}

function hasShellWriteRedirection(command: string): boolean {
  const re = /(?:^|[\s;&|])(?:[0-9]?>{1,2})\s*([^\s;&|]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const target = cleanToken(match[1] || '');
    if (!target || /^&\d+$/.test(target) || target === '/dev/null') continue;
    return true;
  }
  return false;
}

function referencesOutsideWorkspace(command: string, workspaceRoot?: string, workdir?: string): boolean {
  const root = workspaceRoot ? nodePath.resolve(workspaceRoot) : '';
  if (workdir && nodePath.isAbsolute(workdir) && root && !isInsideWorkspace(workdir, root)) return true;
  if (/(?:^|[\s'"])\.\.(?:\/|$)/.test(command)) return true;
  if (/(?:^|[\s'"])~(?:\/|$)/.test(command)) return true;

  const absPathRe = /(?:^|[\s=:(,])(['"]?)(\/[^'"`\s;&|)]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = absPathRe.exec(command)) !== null) {
    const rawPath = cleanToken(match[2] || '');
    if (!rawPath || rawPath === '/dev/null') continue;
    if (!root || !isInsideWorkspace(rawPath, root)) return true;
  }
  return false;
}

function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(workspaceRoot), nodePath.resolve(filePath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
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
    if (ch === '|' || ch === ';') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function isReadOnlySegment(rawSegment: string): boolean {
  const segment = stripLeadingAssignments(rawSegment);
  const token = firstCommandToken(segment);
  if (!token) return false;
  const command = commandName(token);

  if (command === 'git') {
    const subcommand = segment.trim().split(/\s+/)[1] ?? '';
    return GIT_READ_ONLY_COMMANDS.has(subcommand);
  }
  if (!READ_ONLY_COMMANDS.has(command)) return false;
  if (command === 'find' && /\s-(?:delete|exec|ok)\b/.test(segment)) return false;
  if (command === 'sed' && /(?:^|\s)-i(?:\s|$)/.test(segment)) return false;
  if (command === 'awk' && /\bsystem\s*\(/.test(segment)) return false;
  return true;
}

function isValidationSegment(rawSegment: string): boolean {
  const segment = stripLeadingAssignments(rawSegment).trim();
  const token = firstCommandToken(segment);
  if (!token) return false;
  const command = commandName(token);

  if (command === 'npx') return /\bnpx\s+(?:--yes\s+)?(?:tsc|eslint|jest)\b/i.test(segment);
  if (command === 'tsc') return /\b--noEmit\b/i.test(segment);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) {
    return /\b(?:test|run\s+(?:test|build|compile|lint|typecheck))\b/i.test(segment);
  }
  if (command === 'node') return /\bnode\s+(?:--test\b|(?:\.\/)?test\/|[\w./-]+\.test\.(?:mjs|cjs|js))\b/i.test(segment);
  if (['pytest', 'ctest'].includes(command)) return true;
  if (command === 'go') return /\bgo\s+test\b/i.test(segment);
  if (command === 'cargo') return /\bcargo\s+test\b/i.test(segment);
  if (command === 'dotnet') return /\bdotnet\s+test\b/i.test(segment);
  if (command === 'make') return /\bmake\s+(?:test|check)\b/i.test(segment);
  return false;
}

function stripLeadingAssignments(segment: string): string {
  let s = segment.trim();
  while (/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|[^\s]+)\s+/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|[^\s]+)\s+/, '').trimStart();
  }
  return s;
}

function firstCommandToken(segment: string): string {
  const match = segment.trim().match(/^("[^"]+"|'[^']+'|[^\s]+)/);
  return cleanToken(match?.[1] ?? '');
}

function commandName(token: string): string {
  return nodePath.basename(token).toLowerCase();
}

function cleanToken(token: string): string {
  return token.trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),]+$/g, '');
}
