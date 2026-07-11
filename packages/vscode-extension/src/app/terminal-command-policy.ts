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
const IN_PLACE_EDIT_RE = /\bsed\b(?=[^;&|]*\s-i(?:\b|[^\s;&|]*))|\bperl\b(?=[^;&|]*\s-[^\s;&|]*p)(?=[^;&|]*\s-[^\s;&|]*i)/i;
const COMMAND_SUBSTITUTION_RE = /[`$]\(/;
const FIND_WRITE_ACTION_RE = /(?:^|\s)-(?:delete|exec(?:dir)?|ok(?:dir)?|fprint(?:0)?|fprintf|fls)(?=\s|$)/i;
const GIT_OUTPUT_RE = /(?:^|\s)--output(?==|\s|$)/i;
const SORT_OUTPUT_RE = /(?:^|\s)(?:-o\S*|--out(?:put)?(?:=\S*)?)(?=\s|$)/i;
const SED_SIDE_EFFECT_RE = /(?:^|[\s"';{}])(?:\d+(?:,\d+)?|\$|\/[^/\n]*\/)?[ \t]*(?:w|W|e)[ \t]+[^\s"';&|]+|\bs([^\w\s]).*?\1.*?\1[0-9gIpMm]*[we](?=\s|["']|$)/i;
const AWK_SIDE_EFFECT_RE = /\bsystem\s*\(|\bprint(?:f)?\b[^;{}\n]*(?:>{1,2}|\|&?)|\|&?\s*getline\b/i;
const GIT_BRANCH_MUTATION_FLAG_RE = /(?:^|\s)(?:-[dDmMcCf](?=\s|$)|--(?:delete|move|copy|force|edit-description|set-upstream-to|unset-upstream|create-reflog)(?==|\s|$))/i;
const VALIDATION_WRITE_FLAG_RE = /(?:^|\s)(?:--fix(?==|\s|$)|--write(?==|\s|$)|-u(?==|\s|$)|--update-?snapshots?(?==|\s|$)|--coverage(?:-?directory|-?reporters?)?(?==|\s|$)|--output-?file(?==|\s|$)|--cache(?:-?(?:directory|location|file))?(?==|\s|$)|--clear-?cache(?==|\s|$))/i;
const TSC_AUXILIARY_WRITE_RE = /(?:^|\s)--(?:incremental|composite|generateTrace|generateCpuProfile|tsBuildInfoFile)(?==|\s|$)/i;

export function decideTerminalCommandPermission(input: TerminalCommandPermissionInput): TerminalCommandPermissionDecision {
  const command = input.command.trim();
  if (!command) return decision('unknown', 'empty-command');

  if (DESTRUCTIVE_RE.test(command)) return decision('destructive', 'destructive-command');
  if (hasShellWriteRedirection(command) || hasAllowlistedCommandSideEffect(command) || hasValidationWrapperSideEffect(command) || PYTHON_FILE_WRITE_RE.test(command) || IN_PLACE_EDIT_RE.test(command) || MUTATING_RE.test(command)) {
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
  let quote = '';
  for (let index = 0; index < command.length; index++) {
    const ch = command[index];
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== '>') continue;
    let cursor = index + 1;
    if (command[cursor] === '>') cursor += 1;
    if (command[cursor] === '|') cursor += 1;
    while (/\s/.test(command[cursor] ?? '')) cursor += 1;
    const target = readShellRedirectionTarget(command, cursor);
    if (!target || /^&\d+$/.test(target) || target === '/dev/null') continue;
    return true;
  }
  return false;
}

function readShellRedirectionTarget(command: string, start: number): string {
  const quote = command[start];
  if (quote === '"' || quote === "'") {
    const end = command.indexOf(quote, start + 1);
    return cleanToken(command.slice(start + 1, end < 0 ? command.length : end));
  }
  let end = start;
  while (end < command.length && !/[\s;&|]/.test(command[end])) end += 1;
  return cleanToken(command.slice(start, end));
}

function hasAllowlistedCommandSideEffect(command: string): boolean {
  return splitShellSegments(command).some((rawSegment) => {
    const segment = stripLeadingAssignments(rawSegment).trim();
    const commandNameValue = commandName(firstCommandToken(segment));
    if (commandNameValue === 'git') {
      const subcommand = segment.split(/\s+/)[1]?.toLowerCase();
      return GIT_OUTPUT_RE.test(segment) || (subcommand === 'branch' && !isGitBranchReadOnly(segment));
    }
    if (commandNameValue === 'find') return FIND_WRITE_ACTION_RE.test(segment);
    if (commandNameValue === 'sort') return SORT_OUTPUT_RE.test(segment);
    if (commandNameValue === 'sed') return SED_SIDE_EFFECT_RE.test(segment);
    if (commandNameValue === 'awk') return AWK_SIDE_EFFECT_RE.test(segment);
    return false;
  });
}

function isGitBranchReadOnly(segment: string): boolean {
  const match = segment.trim().match(/^git\s+branch(?:\s+([\s\S]*))?$/i);
  const args = match?.[1]?.trim() ?? '';
  if (!match || GIT_BRANCH_MUTATION_FLAG_RE.test(args)) return false;
  if (!args || args === '--show-current') return true;
  if (/^(?:--list|-l)(?:\s|$)/.test(args)) return true;
  return /^(?:(?:-a|-r|-v|-vv|--all|--remotes|--verbose)(?:\s+|$))+$/.test(args);
}

function hasValidationWrapperSideEffect(command: string): boolean {
  return splitShellSegments(command).some((rawSegment) => {
    const segment = stripLeadingAssignments(rawSegment).trim();
    const executable = commandName(firstCommandToken(segment));
    const npxTool = executable === 'npx'
      ? segment.match(/^npx\s+(?:--yes\s+)?([^\s]+)/i)?.[1]?.toLowerCase()
      : undefined;
    const isTsc = executable === 'tsc' || npxTool === 'tsc';
    if (isTsc) return !isNoEmitTypeScriptValidation(segment);
    if (VALIDATION_WRITE_FLAG_RE.test(segment)) return true;
    if (npxTool === 'eslint' && /(?:^|\s)(?:-o\S*|--output-file(?==|\s|$))(?=\s|$)/.test(segment)) return true;
    return false;
  });
}

function isNoEmitTypeScriptValidation(segment: string): boolean {
  if (/(?:^|\s)--noEmit(?:=|\s+)(?:false|0)(?=\s|$)/i.test(segment)) return false;
  return /(?:^|\s)--noEmit(?:=true)?(?=\s|$)/i.test(segment) && !TSC_AUXILIARY_WRITE_RE.test(segment);
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
    if (subcommand === 'branch') return isGitBranchReadOnly(segment);
    return GIT_READ_ONLY_COMMANDS.has(subcommand) && !GIT_OUTPUT_RE.test(segment);
  }
  if (!READ_ONLY_COMMANDS.has(command)) return false;
  if (hasAllowlistedCommandSideEffect(segment)) return false;
  if (command === 'sed' && /(?:^|\s)-i(?:\b|[^\s]*)/.test(segment)) return false;
  return true;
}

function isValidationSegment(rawSegment: string): boolean {
  const segment = stripLeadingAssignments(rawSegment).trim();
  const token = firstCommandToken(segment);
  if (!token) return false;
  const command = commandName(token);

  if (command === 'npx') {
    if (/\bnpx\s+(?:--yes\s+)?tsc\b/i.test(segment)) return isNoEmitTypeScriptValidation(segment);
    return /\bnpx\s+(?:--yes\s+)?(?:eslint|jest)\b/i.test(segment) && !hasValidationWrapperSideEffect(segment);
  }
  if (command === 'tsc') return isNoEmitTypeScriptValidation(segment);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) {
    return /\b(?:test|run\s+(?:test|build|compile|lint|typecheck))\b/i.test(segment) && !hasValidationWrapperSideEffect(segment);
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
