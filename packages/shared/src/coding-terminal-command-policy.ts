import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { inspectCodingWorkspacePathBoundary } from './coding-workspace-path-boundary';

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
  'file', 'find', 'grep', 'head', 'la', 'll', 'ls', 'printf', 'pwd', 'realpath',
  'rg', 'sed', 'sort', 'stat', 'tail', 'test', 'tr', 'true', 'uniq', 'wc', '[',
]);

const GIT_READ_ONLY_COMMANDS = new Set([
  'branch', 'diff', 'grep', 'log', 'ls-files', 'rev-parse', 'show', 'status',
]);

const DESTRUCTIVE_RE = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm\s+-[^\s]*r[^\s]*f|dd\s+|mkfs\b)|\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f)/i;
const MUTATING_RE = /(?:^|[;&|]\s*)(?:touch|mkdir|cp|mv|rm|chmod|chown|ln|truncate)\b|\bgit\s+(?:add|apply|checkout|commit|merge|pull|push|rebase|reset|restore|stash|switch)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b|\b(?:python3?|node)\s+-e\s+[\s\S]*(?:writeFile|appendFile|mkdirSync|rmSync|open\()/i;
const NODE_INLINE_SIDE_EFFECT_RE = /\b(?:require|import)\s*\(\s*['"](?:node:)?(?:child_process|cluster|dgram|fs(?:\/promises)?|http|https|net|tls|worker_threads)['"]\s*\)|\b(?:appendFile|chmod|chown|copyFile|createWriteStream|link|mkdir|rename|rm|rmdir|symlink|truncate|unlink|writeFile)(?:Sync)?\s*\(|\bprocess\.(?:abort|chdir|kill|setegid|seteuid|setgid|setgroups|setuid)\s*\(|\b(?:eval|Function)\s*\(/i;
const NODE_INLINE_ASSERTION_RE = /\b(?:assert(?:\.\w+)?\s*\(|process\.exit\s*\(\s*[1-9]\d*\s*\)|throw\s+new\s+(?:Error|TypeError|RangeError)\s*\()/;
const PYTHON_FILE_WRITE_RE = /\bpython3?\s+-c\s+["'][\s\S]*(?:\bopen\(\s*["'][^"']+["']\s*,\s*["'][^"']*[wax+]|Path\(\s*["'][^"']+["']\s*\)\.write_(?:text|bytes)\s*\()/i;
const IN_PLACE_EDIT_RE = /\bsed\b(?=[^;&|]*\s-i(?:\b|[^\s;&|]*))|\bperl\b(?=[^;&|]*\s-[^\s;&|]*p)(?=[^;&|]*\s-[^\s;&|]*i)/i;
const COMMAND_SUBSTITUTION_RE = /[`$]\(/;
const PROCESS_SUBSTITUTION_RE = /(?:<|>)\(/;
const DYNAMIC_VALUE_EXPANSION_RE = /(?:^|[\s"'=:(,])(?:\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)|%[A-Za-z_][A-Za-z0-9_]*%)/;
const DYNAMIC_PATH_SUFFIX_RE = /(?:\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)|%[A-Za-z_][A-Za-z0-9_]*%)[\\/]/;
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
  if (hasTerminalCommandWorkspaceMutation(command)) {
    return decision('mutating', 'mutating-command');
  }
  if (COMMAND_SUBSTITUTION_RE.test(command)) return decision('unknown', 'command-substitution');
  if (PROCESS_SUBSTITUTION_RE.test(command)) return decision('unknown', 'process-substitution');
  if (DYNAMIC_VALUE_EXPANSION_RE.test(command) && !isScalarEnvironmentDisplay(command)) {
    return decision('unknown', 'dynamic-path-expansion');
  }
  const workspaceBoundaryFailure = terminalWorkspaceBoundaryFailure(
    command,
    input.workspaceRoot,
    input.workdir,
  );
  if (workspaceBoundaryFailure) return decision('unknown', workspaceBoundaryFailure);

  const segments = splitShellSegments(command).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return decision('unknown', 'empty-command');

  let sawValidation = false;
  for (const segment of segments) {
    if (isReadOnlySegment(segment)) continue;
    if (isValidationSegment(segment, input.workspaceRoot, input.workdir)) {
      sawValidation = true;
      continue;
    }
    return decision('unknown', 'unclassified-command');
  }

  return sawValidation
    ? decision('validation', 'validation-command')
    : decision('read-only', 'read-only-workspace-inspection');
}

/** Intrinsic source/workspace writes, shared by permission and effect projection. */
export function hasTerminalCommandWorkspaceMutation(command: string): boolean {
  const normalized = String(command || '').trim();
  if (!normalized) return false;
  return DESTRUCTIVE_RE.test(normalized)
    || (isNodeInlineCommand(normalized) && NODE_INLINE_SIDE_EFFECT_RE.test(normalized))
    || hasShellWriteRedirection(normalized)
    || hasAllowlistedCommandSideEffect(normalized)
    || hasValidationWrapperSideEffect(normalized)
    || PYTHON_FILE_WRITE_RE.test(normalized)
    || IN_PLACE_EDIT_RE.test(normalized)
    || MUTATING_RE.test(normalized);
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

function isScalarEnvironmentDisplay(command: string): boolean {
  if (DYNAMIC_PATH_SUFFIX_RE.test(command) || /[;&|<>]/.test(command)) return false;
  return /^\s*(?:echo|printf)\b/i.test(command);
}

function terminalWorkspaceBoundaryFailure(
  command: string,
  workspaceRoot?: string,
  workdir?: string,
): string | undefined {
  const root = workspaceRoot ? nodePath.resolve(workspaceRoot) : '';
  if (workdir && root) {
    const workdirBoundary = inspectCodingWorkspacePathBoundary({
      workspaceRoot: root,
      candidatePath: workdir,
    });
    if (workdirBoundary.decision === 'denied') {
      return workdirBoundary.reason === 'path-resolves-outside-root'
        ? 'command-workdir-resolves-outside-workspace'
        : 'command-workdir-outside-workspace';
    }
  }
  if (/(?:^|[\s'"])\.\.(?:\/|$)/.test(command)) return 'command-references-outside-workspace';
  if (/(?:^|[\s'"])~(?:\/|$)/.test(command)) return 'command-references-outside-workspace';

  const absPathRe = /(?:^|[\s=:(,])(['"]?)(\/[^'"`\s;&|)]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = absPathRe.exec(command)) !== null) {
    const rawPath = cleanToken(match[2] || '');
    if (!rawPath || rawPath === '/dev/null') continue;
    if (!root) return 'command-references-outside-workspace';
    const boundary = inspectCodingWorkspacePathBoundary({
      workspaceRoot: root,
      candidatePath: rawPath,
      ...(workdir ? { baseDir: workdir } : {}),
    });
    if (boundary.decision === 'denied') {
      return boundary.reason === 'path-resolves-outside-root'
        ? 'command-path-resolves-outside-workspace'
        : 'command-references-outside-workspace';
    }
  }

  if (!root) return undefined;
  const baseDir = workdir || root;
  for (const candidate of existingRelativePathCandidates(command, root, baseDir)) {
    const boundary = inspectCodingWorkspacePathBoundary({
      workspaceRoot: root,
      candidatePath: candidate,
      baseDir,
    });
    if (boundary.decision === 'denied') {
      return boundary.reason === 'path-resolves-outside-root'
        ? 'command-path-resolves-outside-workspace'
        : 'command-references-outside-workspace';
    }
  }
  return undefined;
}

function existingRelativePathCandidates(command: string, workspaceRoot: string, workdir: string): string[] {
  const baseDir = nodePath.isAbsolute(workdir)
    ? nodePath.resolve(workdir)
    : nodePath.resolve(workspaceRoot, workdir);
  const candidates: string[] = [];
  for (const segment of splitShellSegments(command)) {
    for (const word of splitShellWords(segment)) {
      const candidate = cleanPathOperand(word);
      if (!candidate || nodePath.isAbsolute(candidate) || candidate.startsWith('-')
        || /^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate)) {
        continue;
      }
      const existingPrefix = existingPathPrefix(candidate, baseDir);
      if (existingPrefix) candidates.push(existingPrefix);
    }
  }
  return [...new Set(candidates)];
}

function cleanPathOperand(value: string): string {
  return cleanToken(value)
    .replace(/^\d*(?:<|>)+/u, '')
    .replace(/[,:]+$/u, '');
}

function existingPathPrefix(candidate: string, baseDir: string): string | undefined {
  if (!candidate || candidate === '.' || candidate === '/dev/null'
    || /^[&|]+$/u.test(candidate) || /^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)) {
    return undefined;
  }
  const wildcardIndex = candidate.search(/[*?[]/u);
  let concrete = wildcardIndex >= 0 ? candidate.slice(0, wildcardIndex) : candidate;
  if (wildcardIndex >= 0 && concrete && !/[\\/]$/u.test(concrete)) {
    concrete = nodePath.dirname(concrete);
  }
  concrete = concrete.replace(/[\\/]+$/u, '') || '.';
  const absolute = nodePath.resolve(baseDir, concrete);
  try {
    fs.lstatSync(absolute);
    return concrete;
  } catch {
    return undefined;
  }
}

function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  const boundary = inspectCodingWorkspacePathBoundary({
    workspaceRoot,
    candidatePath: filePath,
  });
  return boundary.decision === 'accepted';
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

function isValidationSegment(rawSegment: string, workspaceRoot?: string, workdir?: string): boolean {
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
  if (command === 'node') {
    return /\bnode\s+(?:--test\b|(?:\.\/)?test\/|[\w./-]+\.test\.(?:mjs|cjs|js))\b/i.test(segment)
      || isNodeInlineValidationSegment(segment);
  }
  if (command === 'bash' || command === 'sh') {
    return isWorkspaceShellValidationSegment(segment, workspaceRoot, workdir);
  }
  if (command === 'cmake') return isCmakeValidationSegment(segment);
  if (/^python3?$/.test(command)) return isPythonValidationSegment(segment, workspaceRoot, workdir);
  if (['pytest', 'ctest'].includes(command)) return true;
  if (command === 'go') return /\bgo\s+test\b/i.test(segment);
  if (command === 'cargo') return /\bcargo\s+test\b/i.test(segment);
  if (command === 'dotnet') return /\bdotnet\s+test\b/i.test(segment);
  if (command === 'make') return isMakeValidationSegment(segment);
  if (isCppCompilerCommand(command)) return isCppCompilerValidationSegment(segment);
  if (isWorkspaceExecutableValidationSegment(token, workspaceRoot, workdir)) return true;
  return false;
}

function isWorkspaceShellValidationSegment(
  segment: string,
  workspaceRoot?: string,
  workdir?: string,
): boolean {
  const words = splitShellWords(stripLeadingAssignments(segment))
    .filter(word => !isNonPersistingOutputRedirection(word));
  if (words.length !== 2) return false;
  const script = cleanToken(words[1]);
  if (!/^(?:test|tests|check|verify)(?:[-_.][A-Za-z0-9_.-]+)?\.sh$/i.test(nodePath.basename(script))) {
    return false;
  }
  return isWorkspacePath(script, workspaceRoot, workdir);
}

function isNonPersistingOutputRedirection(word: string): boolean {
  return /^\d*>\s*&\s*\d+$/u.test(word)
    || /^\d*>{1,2}\s*\/dev\/null$/u.test(word);
}

function isCmakeValidationSegment(segment: string): boolean {
  const args = splitShellWords(stripLeadingAssignments(segment)).slice(1).map(cleanToken);
  if (args.length === 0 || args.some(arg => ['-E', '-P', '--install'].includes(arg))) return false;
  const buildIndex = args.indexOf('--build');
  if (buildIndex >= 0) {
    const targetIndex = args.indexOf('--target');
    const target = targetIndex >= 0 ? (args[targetIndex + 1] || '').toLowerCase() : '';
    return Boolean(args[buildIndex + 1]) && !['install', 'package'].includes(target);
  }
  const hasSource = args.some((arg, index) => arg === '-S' ? Boolean(args[index + 1]) : arg.startsWith('-S') && arg.length > 2);
  const hasBuild = args.some((arg, index) => arg === '-B' ? Boolean(args[index + 1]) : arg.startsWith('-B') && arg.length > 2);
  return hasSource && hasBuild;
}

function isMakeValidationSegment(segment: string): boolean {
  const words = splitShellWords(stripLeadingAssignments(segment))
    .slice(1)
    .map(cleanToken)
    .filter(word => word && !isNonPersistingOutputRedirection(word));
  const targets: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (/^(?:-j|--jobs|-l|--load-average)$/u.test(word)) {
      if (/^\d+(?:\.\d+)?$/u.test(words[index + 1] ?? '')) index += 1;
      continue;
    }
    if (/^(?:-j\d+|--jobs=\d+|-l\d+(?:\.\d+)?|--load-average=\d+(?:\.\d+)?)$/u.test(word)) {
      continue;
    }
    if (word.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) return false;
    targets.push(word.toLowerCase());
  }
  return targets.every(target => /^(?:all|build|test|tests|check|verify)$/u.test(target));
}

function isPythonValidationSegment(segment: string, workspaceRoot?: string, workdir?: string): boolean {
  const words = splitShellWords(stripLeadingAssignments(segment));
  if (words.length < 2) return false;
  const args = words.slice(1);
  const moduleIndex = args.indexOf('-m');
  if (moduleIndex >= 0) {
    const moduleName = args[moduleIndex + 1] || '';
    if (/^(?:pytest|unittest)$/.test(moduleName)) return true;
    if (moduleName === 'py_compile') {
      return args.slice(moduleIndex + 2).some(arg => isWorkspacePythonPath(arg, workspaceRoot, workdir));
    }
    return false;
  }
  const commandText = stripLeadingAssignments(segment);
  const codeIndex = args.indexOf('-c');
  if (codeIndex >= 0) {
    const code = args[codeIndex + 1] || '';
    const target = args.slice(codeIndex + 2).find(arg => /\.py$/i.test(cleanToken(arg)));
    return /\bcompile\s*\(/.test(code)
      && /\bread_text\s*\(/.test(code)
      && !!target
      && isWorkspacePythonPath(target, workspaceRoot, workdir);
  }
  if (/^\s*python3?\s+-/.test(commandText)) return false;
  const script = args.find(arg => /\.py$/i.test(cleanToken(arg)));
  return !!script && isWorkspacePythonPath(script, workspaceRoot, workdir);
}

function isNodeInlineCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)node\s+(?:--input-type=\S+\s+)?(?:-e|--eval)(?:\s|=)/i.test(command);
}

function isNodeInlineValidationSegment(segment: string): boolean {
  const words = splitShellWords(stripLeadingAssignments(segment));
  const evalIndex = words.findIndex(word => word === '-e' || word === '--eval');
  const code = evalIndex >= 0 ? words[evalIndex + 1] ?? '' : '';
  if (!code || NODE_INLINE_SIDE_EFFECT_RE.test(code)) return false;

  // Inline JavaScript is only a validation route when it carries an explicit
  // failing assertion. Plain snippets remain outside the unattended boundary.
  return NODE_INLINE_ASSERTION_RE.test(code);
}

function isWorkspacePythonPath(rawPath: string, workspaceRoot?: string, workdir?: string): boolean {
  const cleaned = cleanToken(rawPath);
  if (!cleaned || !/\.py$/i.test(cleaned)) return false;
  return isWorkspacePath(cleaned, workspaceRoot, workdir);
}

function isWorkspacePath(rawPath: string, workspaceRoot?: string, workdir?: string): boolean {
  const cleaned = cleanToken(rawPath);
  if (!cleaned) return false;
  if (!workspaceRoot) return !nodePath.isAbsolute(cleaned);
  const baseDir = workdir && nodePath.isAbsolute(workdir) ? workdir : workspaceRoot;
  const resolved = nodePath.isAbsolute(cleaned) ? cleaned : nodePath.resolve(baseDir, cleaned);
  return isInsideWorkspace(resolved, workspaceRoot);
}

function splitShellWords(segment: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < segment.length; index++) {
    const ch = segment[index];
    const next = segment[index + 1] ?? '';
    if (ch === '\\') {
      if (next) {
        current += next;
        index += 1;
      }
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
  return words;
}

function isCppCompilerCommand(command: string): boolean {
  return /^(?:g\+\+|gcc|clang\+\+|clang|cc|c\+\+)$/.test(command);
}

function isCppCompilerValidationSegment(segment: string): boolean {
  // Compilers may write build artifacts via -o/-c; those artifacts are validation
  // evidence, while source/content writes still stay blocked by redirection guards.
  return /(?:^|\s)(?:-[cS]|-fsyntax-only)(?=\s|$)/.test(segment)
    || /(?:^|\s)-o(?:\s+|[^\s]+\s*)/.test(segment)
    || /\.(?:c|cc|cpp|cxx)(?:['"])?(?:\s|$)/i.test(segment);
}

function isWorkspaceExecutableValidationSegment(token: string, workspaceRoot?: string, workdir?: string): boolean {
  const cleaned = cleanToken(token);
  if (!cleaned) return false;
  const executableLike = cleaned.startsWith('./') || cleaned.startsWith('/');
  if (!executableLike) return false;
  if (!workspaceRoot) return !cleaned.startsWith('/');
  const baseDir = workdir && nodePath.isAbsolute(workdir) ? workdir : workspaceRoot;
  const resolved = nodePath.resolve(baseDir, cleaned);
  return isInsideWorkspace(resolved, workspaceRoot);
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
