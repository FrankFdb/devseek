const WORKSPACE_PATH_TOKEN_RE = /(?:^|[\s("'`:：])((?:\.{0,2}\/)?[A-Za-z0-9_.?*/-]+)(?=$|[\s,;:!?，。；：！？)"'`])/gu;
const ROOT_WORKSPACE_FILE_RE = /(?:\.(?:bash|c|cc|cjs|cpp|css|cxx|env|go|h|hh|hpp|html|java|js|json|jsonc|jsx|local|lock|md|mdx|mjs|py|rs|scss|sh|sql|svelte|toml|ts|tsx|txt|vue|xml|ya?ml)|^(?:containerfile|dockerfile|license|makefile))$/iu;
const CLAUSE_MUTATION_RE = /(?:\b(?:add|create|delete|edit|fix|generate|implement|modify|refactor|remove|save|update|write)\b|创建|新增|添加|删除|编辑|修复|生成|实现|修改|重构|移除|保存|更新|写入)/iu;
const MUTATION_SUFFIX_RE = /^\s*(?:(?:,|，)?\s*(?:and|then|并|然后)\s*)?(?:(?:fix|modify|refactor|remove|update)\b|修复|修改|重构|移除|更新)/iu;
const REFERENCE_PREFIX_RE = /(?:\b(?:according\s+to|based\s+on|compare\s+with|inspect|read|reference|review|using)\s+|参考|基于|依据|按照|对标|读取|查看|分析)\s*$/iu;
const DATA_PREFIX_RE = /(?:\b(?:example|input|stdin|url|value)\s+|输入|示例|网址|值)\s*$/iu;
const DIRECTORY_SUFFIX_RE = /^\s*(?:directory|folder|目录)(?:\b|下|内)/iu;

export interface CodingTaskPathIntent {
  readonly mentionedPaths: readonly string[];
  readonly mutationFileTargets: readonly string[];
  readonly mutationDirectoryTargets: readonly string[];
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

    for (const mention of mentions) {
      if (!hasMutationIntent(mention)) continue;
      (mention.directory ? mutationDirectoryTargets : mutationFileTargets).push(mention.path);
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
    mentions.push({
      path,
      before,
      after,
      directory: isDirectoryMention(rawPath, path, before, after),
    });
  }
  return mentions;
}

function hasMutationIntent(mention: PathMention): boolean {
  if (MUTATION_SUFFIX_RE.test(mention.after)) return true;
  if (REFERENCE_PREFIX_RE.test(mention.before)) return false;
  return CLAUSE_MUTATION_RE.test(mention.before);
}

function isDirectoryMention(rawPath: string, path: string, before: string, after: string): boolean {
  if (isDeclaredDirectoryTarget(rawPath) || DIRECTORY_SUFFIX_RE.test(after)) return true;
  if (ROOT_WORKSPACE_FILE_RE.test(path)) return false;
  return /(?:\b(?:inside|under|within)\s+|(?:目录下|目录内|于|在)\s*[：:]?)$/iu.test(before);
}

function clauseBounds(source: string, start: number, end: number): { start: number; end: number } {
  const boundary = /[.!?;\n。！？；]/u;
  let clauseStart = start;
  while (clauseStart > 0 && !boundary.test(source[clauseStart - 1] ?? '')) clauseStart -= 1;
  let clauseEnd = end;
  while (clauseEnd < source.length && !boundary.test(source[clauseEnd] ?? '')) clauseEnd += 1;
  return { start: clauseStart, end: clauseEnd };
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
