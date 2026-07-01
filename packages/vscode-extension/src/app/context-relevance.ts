import * as nodePath from 'path';

const GENERIC_PATH_SEGMENTS = new Set([
  '.', '..', 'code', 'src', 'source', 'sources', 'include', 'lib', 'libs', 'app', 'apps',
  'packages', 'pkg', 'module', 'modules', 'cmd', 'core', 'build', 'dist', 'out', 'bin',
  'obj', 'debug', 'release', 'test', 'tests', 'docs', 'doc', 'examples', 'example',
]);

const GENERIC_FILE_NAMES = new Set([
  'main.cpp', 'main.c', 'main.cc', 'main.cxx', 'main.h', 'main.hpp',
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'package.json',
  'readme.md', 'README.md', 'CMakeLists.txt', 'Makefile',
]);

const GENERIC_TOKENS = new Set([
  'main', 'index', 'readme', 'cmakelists', 'makefile',
  'cpp', 'cxx', 'hpp', 'tsx', 'jsx', 'mjs', 'json', 'yaml', 'yml', 'toml',
  'html', 'css', 'scss', 'less', 'xml', 'md', 'txt', 'log',
]);

const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_-]{2,}/g;
const PATH_TOKEN_RE = /(?:[A-Za-z]:)?\/[^\s"'`<>，。；;、)]+|(?:[A-Za-z0-9_.-]+[\\/]){1,}[A-Za-z0-9_.-]+/g;

export interface ContextAnchorSet {
  pathAnchors: string[];
  tokenAnchors: string[];
}

export interface BuildContextAnchorsInput {
  workspaceRoot?: string;
  prompt?: string;
  relatedPaths?: Iterable<string>;
  extraText?: Iterable<string>;
}

export function buildContextAnchors(input: BuildContextAnchorsInput): ContextAnchorSet {
  const workspaceRoot = normalizePath(input.workspaceRoot ?? '');
  const workspaceName = workspaceRoot ? nodePath.basename(workspaceRoot).toLowerCase() : '';
  const pathAnchors = new Set<string>();
  const tokenAnchors = new Set<string>();

  const addPath = (rawPath: string) => {
    const normalized = normalizePath(rawPath);
    if (!normalized) return;
    const rel = workspaceRoot && normalized.startsWith(`${workspaceRoot}/`)
      ? normalized.slice(workspaceRoot.length + 1)
      : normalized;
    addPathAnchors(rel, pathAnchors, tokenAnchors, workspaceName);
  };

  for (const pathValue of input.relatedPaths ?? []) addPath(pathValue);
  for (const pathValue of extractPathTokens(input.prompt ?? '')) addPath(pathValue);

  const textForTokens = [
    input.prompt ?? '',
    ...[...(input.extraText ?? [])],
  ].join('\n');
  for (const token of extractProjectTokens(textForTokens, workspaceName)) {
    tokenAnchors.add(token);
  }

  return {
    pathAnchors: [...pathAnchors].sort((a, b) => b.length - a.length),
    tokenAnchors: [...tokenAnchors].sort((a, b) => b.length - a.length),
  };
}

export function hasContextAnchors(anchors: ContextAnchorSet): boolean {
  return anchors.pathAnchors.length > 0 || anchors.tokenAnchors.length > 0;
}

export function textMatchesContextAnchors(text: string, anchors: ContextAnchorSet): boolean {
  if (!hasContextAnchors(anchors)) return true;
  const normalizedText = normalizePath(text).toLowerCase();
  for (const anchor of anchors.pathAnchors) {
    if (normalizedText.includes(anchor.toLowerCase())) return true;
  }
  const tokenText = text.toLowerCase();
  for (const token of anchors.tokenAnchors) {
    if (matchesToken(tokenText, token)) return true;
  }
  return false;
}

export function filterByContextAnchors<T>(
  items: readonly T[],
  anchors: ContextAnchorSet,
  textOf: (item: T) => string,
): T[] {
  if (!hasContextAnchors(anchors)) return [...items];
  return items.filter(item => textMatchesContextAnchors(textOf(item), anchors));
}

export function filterLegacyMemoryMarkdownByContext(markdown: string, anchors: ContextAnchorSet): string {
  const content = String(markdown || '').trim();
  if (!content || !hasContextAnchors(anchors)) return content;
  return content
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .filter(block => textMatchesContextAnchors(block, anchors))
    .join('\n\n')
    .trim();
}

function addPathAnchors(
  relOrAbsPath: string,
  pathAnchors: Set<string>,
  tokenAnchors: Set<string>,
  workspaceName: string,
): void {
  const clean = normalizePath(relOrAbsPath)
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
  if (!clean) return;

  if (clean.includes('/')) {
    pathAnchors.add(clean);
    const dir = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    if (dir && !isGenericPathSegment(dir)) pathAnchors.add(dir);
    const parts = clean.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) addProjectToken(parts[i], tokenAnchors, workspaceName);
  }

  const basename = clean.split('/').pop() ?? clean;
  if (basename && !GENERIC_FILE_NAMES.has(basename)) addProjectToken(stripKnownExtension(basename), tokenAnchors, workspaceName);
}

function extractPathTokens(text: string): string[] {
  return [...String(text || '').matchAll(PATH_TOKEN_RE)].map(match => match[0]);
}

function extractProjectTokens(text: string, workspaceName: string): string[] {
  const tokens = new Set<string>();
  for (const match of String(text || '').matchAll(TOKEN_RE)) {
    addProjectToken(match[0], tokens, workspaceName);
  }
  return [...tokens];
}

function addProjectToken(rawToken: string, tokens: Set<string>, workspaceName: string): void {
  const token = stripKnownExtension(rawToken).toLowerCase();
  if (!token || token.length < 3) return;
  if (token === workspaceName) return;
  if (/^\d+$/.test(token)) return;
  if (GENERIC_PATH_SEGMENTS.has(token)) return;
  if (GENERIC_TOKENS.has(token)) return;
  tokens.add(token);
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(?:cpp|c|cc|cxx|h|hpp|ts|tsx|js|jsx|mjs|py|rs|go|java|cs|md|json|txt)$/i, '');
}

function isGenericPathSegment(value: string): boolean {
  return value.split('/').every(part => GENERIC_PATH_SEGMENTS.has(part.toLowerCase()));
}

function matchesToken(text: string, token: string): boolean {
  const escaped = escapeRegExp(token);
  return new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?:$|[^a-z0-9_-])`, 'i').test(text);
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
