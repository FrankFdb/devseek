const WORKSPACE_PATH_TOKEN_RE = /(?:^|[\s("'`:：、])((?:\.{0,2}\/)?[A-Za-z0-9_.?*/-]+)(?=$|[\s,;:!?，。；：！？、)"'`])/gu;
const ROOT_WORKSPACE_FILE_RE = /(?:\.(?:bash|c|cc|cjs|cpp|css|cxx|env|go|h|hh|hpp|html|java|js|json|jsonc|jsx|local|lock|md|mdx|mjs|py|rs|scss|sh|sql|svelte|toml|ts|tsx|txt|vue|xml|ya?ml)|^(?:containerfile|dockerfile|license|makefile))$/iu;
const ACTION_DIRECTIVE_RE = /\b(?:according\s+to|add|added|based\s+on|compare\s+with|create|created|delete|deleted|edit|edited|fix|generate|generated|implement|implemented|inspect|modify|modified|read|refactor|reference|remove|removed|repair|repaired|review|save|update|updated|using|write|written)\b|创建|新增|添加|删除|编辑|修复|生成|实现|修改|重构|移除|保存|更新|写入|参考|基于|依据|按照|对标|读取|查看|分析/giu;
const MUTATION_ACTION_RE = /^(?:add|added|create|created|delete|deleted|edit|edited|fix|generate|generated|implement|implemented|modify|modified|refactor|remove|removed|repair|repaired|save|update|updated|write|written|创建|新增|添加|删除|编辑|修复|生成|实现|修改|重构|移除|保存|更新|写入)$/iu;
const NEGATED_ACTION_PREFIX_RE = /(?:\b(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never)\s+(?:be\s+)?|(?:不要|不得|禁止|严禁|不可|不允许|勿|别)(?:再)?(?:被)?)\s*$/iu;
const PASSIVE_NEGATED_ACTION_PREFIX_RE = /(?:\b(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never)\s+be\s+|(?:不要|不得|禁止|严禁|不可|不允许|勿|别)(?:再)?被)\s*$/iu;
const LEADING_ACTION_CONTEXT_RE = /^\s*[`'"’”({\[、,，:：-]*\s*(?:(?:and|then)\s+|并(?:且)?|然后)?\s*(?:(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never)\s+(?:be\s+)?|(?:不要|不得|禁止|严禁|不可|不允许|勿|别)(?:再)?(?:被)?)?\s*$/iu;
const FOLLOWING_PATH_RE = /^\s*[`'"“‘({\[]*((?:\.{0,2}\/)?[A-Za-z0-9_.?*/-]+)(?=$|[\s,;:!?，。；：！？、)\]}'"`])/u;
const DATA_PREFIX_RE = /(?:\b(?:example|input|stdin|url|value)\s+|输入|示例|网址|值)\s*$/iu;
const DIRECTORY_SUFFIX_RE = /^\s*(?:directory|folder|目录)(?:\b|下|内)/iu;
const TECHNOLOGY_LABEL_RE = /^(?:bun|deno|electron|next|node|nuxt|react|vue)\.(?:js|ts)$/iu;
const TECHNOLOGY_CONTEXT_RE = /^\s*(?:(?:project|application|app|runtime|ecosystem)\b|(?:项目|工程|应用|运行时|生态)(?=$|[\s,，;；]))/iu;

export interface CodingTaskPathIntent {
  readonly mentionedPaths: readonly string[];
  readonly mutationFileTargets: readonly string[];
  readonly mutationDirectoryTargets: readonly string[];
  readonly excludedFileTargets: readonly string[];
  readonly excludedDirectoryTargets: readonly string[];
}

export interface TaskPathIntentPort {
  resolve(input: {
    readonly prompt: string;
    readonly targetPaths?: readonly string[];
  }): CodingTaskPathIntent;
}

interface PathMention {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly directory: boolean;
}

/** Separates prompt context paths from paths that carry explicit mutation intent. */
export class CanonicalTaskPathIntentService implements TaskPathIntentPort {
  resolve(input: Parameters<TaskPathIntentPort['resolve']>[0]): CodingTaskPathIntent {
    const mentions = parsePathMentions(input.prompt);
    const mentionedPaths = mentions.map(mention => mention.path);
    const mutationFileTargets: string[] = [];
    const mutationDirectoryTargets: string[] = [];
    const excludedFileTargets: string[] = [];
    const excludedDirectoryTargets: string[] = [];

    for (const mention of mentions) {
      const intent = classifyMutationIntent(mention);
      if (intent === 'mutation') {
        (mention.directory ? mutationDirectoryTargets : mutationFileTargets).push(mention.path);
      } else if (intent === 'excluded') {
        (mention.directory ? excludedDirectoryTargets : excludedFileTargets).push(mention.path);
      }
    }
    for (const rawTarget of input.targetPaths ?? []) {
      const target = normalizeWorkspacePath(rawTarget);
      if (!target) continue;
      mentionedPaths.push(target);
      if (isDeclaredDirectoryTarget(rawTarget)) mutationDirectoryTargets.push(stripDirectoryPattern(target));
      else mutationFileTargets.push(target);
    }

    return Object.freeze({
      mentionedPaths: Object.freeze(uniquePaths(mentionedPaths)),
      mutationFileTargets: Object.freeze(uniquePaths(mutationFileTargets)),
      mutationDirectoryTargets: Object.freeze(uniquePaths(mutationDirectoryTargets)),
      excludedFileTargets: Object.freeze(uniquePaths(excludedFileTargets)),
      excludedDirectoryTargets: Object.freeze(uniquePaths(excludedDirectoryTargets)),
    });
  }
}

const TASK_PATH_INTENT = new CanonicalTaskPathIntentService();

export function resolveCodingTaskPathIntent(
  input: Parameters<TaskPathIntentPort['resolve']>[0],
): CodingTaskPathIntent {
  return TASK_PATH_INTENT.resolve(input);
}

export function extractCodingWorkspacePaths(prompt: string): string[] {
  return uniquePaths(parsePathMentions(prompt).map(mention => mention.path));
}

function parsePathMentions(prompt: string): PathMention[] {
  const source = String(prompt || '');
  const mentions: PathMention[] = [];
  for (const match of source.matchAll(WORKSPACE_PATH_TOKEN_RE)) {
    const rawPath = match[1] ?? '';
    const path = normalizeWorkspacePath(rawPath.replace(/\.+$/u, ''));
    if (!path || !isWorkspacePathToken(path)) continue;
    const matchStart = (match.index ?? 0) + match[0].lastIndexOf(rawPath);
    const bounds = clauseBounds(source, matchStart, matchStart + rawPath.length);
    const before = source.slice(bounds.start, matchStart);
    const after = source.slice(matchStart + rawPath.length, bounds.end);
    if (DATA_PREFIX_RE.test(before)) continue;
    if (TECHNOLOGY_LABEL_RE.test(path) && TECHNOLOGY_CONTEXT_RE.test(after)) continue;
    mentions.push({
      path,
      before,
      after,
      directory: isDirectoryMention(rawPath, path, before, after),
    });
  }
  return mentions;
}

function classifyMutationIntent(mention: PathMention): 'mutation' | 'excluded' | 'none' {
  const postfix = resolvePostfixAction(mention.after);
  if (postfix) return postfix;
  return resolvePrecedingAction(mention.before);
}

function resolvePrecedingAction(before: string): 'mutation' | 'excluded' | 'none' {
  let nearest: RegExpMatchArray | undefined;
  for (const match of before.matchAll(ACTION_DIRECTIVE_RE)) nearest = match;
  if (!nearest) return 'none';
  const action = nearest[0] ?? '';
  if (!MUTATION_ACTION_RE.test(action)) return 'none';
  const prefix = before.slice(0, nearest.index ?? 0);
  return NEGATED_ACTION_PREFIX_RE.test(prefix) ? 'excluded' : 'mutation';
}

function resolvePostfixAction(after: string): 'mutation' | 'excluded' | undefined {
  let first: RegExpMatchArray | undefined;
  for (const match of after.matchAll(ACTION_DIRECTIVE_RE)) {
    first = match;
    break;
  }
  if (!first || !LEADING_ACTION_CONTEXT_RE.test(after.slice(0, first.index ?? 0))) return undefined;
  const action = first[0] ?? '';
  if (!MUTATION_ACTION_RE.test(action)) return undefined;
  const remainder = after.slice((first.index ?? 0) + action.length);
  if (startsWithWorkspacePath(remainder)) return undefined;
  const prefix = after.slice(0, first.index ?? 0);
  const negated = NEGATED_ACTION_PREFIX_RE.test(prefix);
  if (negated && hasPostfixObject(remainder) && !PASSIVE_NEGATED_ACTION_PREFIX_RE.test(prefix)) {
    return undefined;
  }
  return negated ? 'excluded' : 'mutation';
}

function startsWithWorkspacePath(value: string): boolean {
  const match = FOLLOWING_PATH_RE.exec(value);
  if (!match) return false;
  return isWorkspacePathToken(normalizeWorkspacePath(match[1] ?? ''));
}

function hasPostfixObject(value: string): boolean {
  return Boolean(value.replace(/^[\s:：-]+/u, '').replace(/[\s,;:!?，。；：！？、'"`’”)}\]]+$/u, ''));
}

function isDirectoryMention(rawPath: string, path: string, before: string, after: string): boolean {
  if (isDeclaredDirectoryTarget(rawPath) || DIRECTORY_SUFFIX_RE.test(after)) return true;
  if (ROOT_WORKSPACE_FILE_RE.test(path)) return false;
  return /(?:\b(?:inside|under|within)\s+|(?:目录下|目录内|于|在)\s*[：:]?)$/iu.test(before);
}

function clauseBounds(source: string, start: number, end: number): { start: number; end: number } {
  let clauseStart = start;
  while (clauseStart > 0 && !isClauseBoundary(source, clauseStart - 1)) clauseStart -= 1;
  let clauseEnd = end;
  while (clauseEnd < source.length && !isClauseBoundary(source, clauseEnd)) clauseEnd += 1;
  return { start: clauseStart, end: clauseEnd };
}

function isClauseBoundary(source: string, index: number): boolean {
  const token = source[index] ?? '';
  if (/[!?;\n。！？；]/u.test(token)) return true;
  if (token !== '.') return false;
  const next = source[index + 1] ?? '';
  return !next || /[\s'"`’”)}\]]/u.test(next);
}

function isWorkspacePathToken(path: string): boolean {
  return path.includes('/') || ROOT_WORKSPACE_FILE_RE.test(path);
}

function isDeclaredDirectoryTarget(value: string): boolean {
  return /(?:[/\\]|\/\*\*)\s*$/u.test(String(value || ''));
}

function stripDirectoryPattern(value: string): string {
  return value.replace(/\/\*\*$/u, '').replace(/\/+$/u, '');
}

function normalizeWorkspacePath(value: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/')) return '';
  return normalized;
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeWorkspacePath).filter(Boolean))];
}
