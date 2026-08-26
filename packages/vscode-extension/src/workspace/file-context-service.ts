import * as fs from 'fs';
import * as nodePath from 'path';

export interface FileContextReadRange {
  startLine?: number;
  endLine?: number;
}

export interface FileContextServiceOptions {
  workspaceRoot?: string;
  recentFiles?: ReadonlyMap<string, string>;
  fallbackRead?: (path: string, preferredAbsolutePaths?: string[]) => Promise<string | null>;
  maxFullBytes?: number;
  maxFullLines?: number;
  previewLines?: number;
  maxRangeLines?: number;
}

export interface FileContextReadRequest extends FileContextReadRange {
  workDir?: string;
}

interface ResolvedFileContent {
  content: string;
  resolvedPath: string;
  source: 'fs' | 'fallback';
}

export type FileContextReadDenialReason =
  | 'target-outside-workspace'
  | 'protected-devseek-credential';

export interface FileContextReadBoundaryDecision {
  allowed: boolean;
  reason?: FileContextReadDenialReason;
}

export const FILE_CONTEXT_PROTOCOL_VERSION = 'devseek.file-context/v1';

const DEFAULT_MAX_FULL_BYTES = 64 * 1024;
const DEFAULT_MAX_FULL_LINES = 2000;
const DEFAULT_PREVIEW_LINES = 240;
const DEFAULT_MAX_RANGE_LINES = 600;
const SYMBOL_OUTLINE_LIMIT = 80;
const MAX_MISSING_PATH_SUGGESTIONS = 5;
const MAX_MISSING_PATH_SEARCH_DEPTH = 8;
const MAX_MISSING_PATH_SEARCH_ENTRIES = 2000;
const MISSING_PATH_SEARCH_IGNORED_DIRECTORIES = new Set([
  '.devseek',
  '.git',
  'backups',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const MISSING_PATH_EQUIVALENT_EXTENSION_FAMILIES = [
  new Set(['.h', '.hh', '.hpp', '.hxx']),
  new Set(['.c', '.cc', '.cpp', '.cxx']),
  new Set(['.js', '.cjs', '.mjs']),
  new Set(['.ts', '.cts', '.mts']),
];

type SourceIntegrity = 'full' | 'range' | 'preview' | 'generated-full' | 'generated-range' | 'generated-preview';

interface SelectedLineRange {
  start: number;
  end: number;
}

interface GeneratedFileInfo {
  generatedFile: boolean;
  reasons: string[];
}

interface SymbolOutlineEntry {
  kind: 'class' | 'function';
  name: string;
  line: number;
  duplicateIndex: number;
  inReturnedRange: boolean;
}

interface SymbolOutline {
  entries: SymbolOutlineEntry[];
  total: number;
  truncated: boolean;
  sameNameSymbolGroups: string[];
}

export class FileContextService {
  constructor(private readonly options: FileContextServiceOptions) {}

  async readFileForAi(rawPath: string, request: FileContextReadRequest = {}): Promise<string> {
    const filePath = rawPath.trim();
    if (!filePath) throw new Error('read_file: path is empty');

    const candidates = this.buildCandidatePaths(filePath, request.workDir);
    const resolved = await this.resolveContent(filePath, candidates);
    if (!resolved) {
      const suggestions = this.findMissingPathSuggestions(filePath);
      const hint = suggestions.length > 0
        ? `。工作区可能匹配：${suggestions.join('、')}`
        : '';
      throw new Error(`找不到文件：${filePath}${hint}`);
    }

    return formatFileContext({
      requestedPath: filePath,
      resolvedPath: resolved.resolvedPath,
      content: resolved.content,
      source: resolved.source,
      range: request,
      limits: {
        maxFullBytes: this.options.maxFullBytes ?? DEFAULT_MAX_FULL_BYTES,
        maxFullLines: this.options.maxFullLines ?? DEFAULT_MAX_FULL_LINES,
        previewLines: this.options.previewLines ?? DEFAULT_PREVIEW_LINES,
        maxRangeLines: this.options.maxRangeLines ?? DEFAULT_MAX_RANGE_LINES,
      },
    });
  }

  private buildCandidatePaths(filePath: string, workDir?: string): string[] {
    const candidates: string[] = [];
    const push = (candidate?: string, strict = false) => {
      if (!candidate) return;
      const decision = decideFileContextReadBoundary(candidate, this.options.workspaceRoot);
      if (!decision.allowed) {
        if (strict) throw fileContextReadDenied(candidate, decision.reason!);
        return;
      }
      if (!candidates.includes(candidate)) candidates.push(candidate);
    };

    if (nodePath.isAbsolute(filePath)) push(nodePath.resolve(filePath), true);
    if (workDir && !nodePath.isAbsolute(filePath)) {
      const candidate = nodePath.resolve(workDir, filePath);
      if (this.isAllowedWorkspaceCandidate(candidate)) push(candidate, true);
    }

    const recentByBase = this.options.recentFiles?.get(nodePath.basename(filePath).toLowerCase());
    push(recentByBase);
    const recentByRel = this.options.recentFiles?.get(filePath);
    push(recentByRel);

    if (this.options.workspaceRoot && !nodePath.isAbsolute(filePath)) {
      push(nodePath.resolve(this.options.workspaceRoot, filePath), true);
    }
    return candidates;
  }

  private isAllowedWorkspaceCandidate(candidate: string): boolean {
    const root = this.options.workspaceRoot;
    if (!root) return true;
    const rel = nodePath.relative(nodePath.resolve(root), nodePath.resolve(candidate));
    return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel));
  }

  private async resolveContent(filePath: string, candidates: string[]): Promise<ResolvedFileContent | null> {
    for (const candidate of candidates) {
      const content = readLocalFile(candidate);
      if (content !== null) return { content, resolvedPath: candidate, source: 'fs' };
    }

    const fallback = this.options.fallbackRead;
    if (!fallback) return null;
    const content = await fallback(filePath, candidates);
    return content === null ? null : { content, resolvedPath: filePath, source: 'fallback' };
  }

  private findMissingPathSuggestions(filePath: string): string[] {
    const workspaceRoot = this.options.workspaceRoot;
    if (!workspaceRoot) return [];

    const root = nodePath.resolve(workspaceRoot);
    const requestedBasename = nodePath.basename(filePath).toLowerCase();
    if (!requestedBasename) return [];

    const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
    const suggestions: string[] = [];
    let visitedEntries = 0;

    while (
      pending.length > 0
      && visitedEntries < MAX_MISSING_PATH_SEARCH_ENTRIES
      && suggestions.length < MAX_MISSING_PATH_SUGGESTIONS
    ) {
      const current = pending.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current.directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name, 'en'));
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (visitedEntries >= MAX_MISSING_PATH_SEARCH_ENTRIES) break;
        visitedEntries += 1;

        const absolutePath = nodePath.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (
            current.depth < MAX_MISSING_PATH_SEARCH_DEPTH
            && !MISSING_PATH_SEARCH_IGNORED_DIRECTORIES.has(entry.name.toLowerCase())
          ) {
            pending.push({ directory: absolutePath, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile() || !missingPathNamesMatch(requestedBasename, entry.name)) continue;
        if (!decideFileContextReadBoundary(absolutePath, root).allowed) continue;

        suggestions.push(toWorkspaceDisplayPath(root, absolutePath));
        if (suggestions.length >= MAX_MISSING_PATH_SUGGESTIONS) break;
      }
    }

    return suggestions;
  }
}

function toWorkspaceDisplayPath(workspaceRoot: string, candidate: string): string {
  return nodePath.relative(workspaceRoot, candidate).split(nodePath.sep).join('/');
}

function missingPathNamesMatch(requestedBasename: string, candidateName: string): boolean {
  const candidateBasename = candidateName.toLowerCase();
  if (candidateBasename === requestedBasename) return true;
  if (nodePath.basename(candidateBasename, nodePath.extname(candidateBasename))
    !== nodePath.basename(requestedBasename, nodePath.extname(requestedBasename))) {
    return false;
  }

  const requestedExtension = nodePath.extname(requestedBasename);
  const candidateExtension = nodePath.extname(candidateBasename);
  return MISSING_PATH_EQUIVALENT_EXTENSION_FAMILIES.some(family => (
    family.has(requestedExtension) && family.has(candidateExtension)
  ));
}

/** The only local-file boundary used before content can enter an AI prompt. */
export function decideFileContextReadBoundary(
  candidate: string,
  workspaceRoot?: string,
): FileContextReadBoundaryDecision {
  const requested = nodePath.resolve(candidate);
  const target = canonicalFileContextPath(candidate);
  if (isProtectedDevSeekCredential(requested) || isProtectedDevSeekCredential(target)) {
    return { allowed: false, reason: 'protected-devseek-credential' };
  }
  if (!workspaceRoot) return { allowed: true };
  const root = canonicalFileContextPath(workspaceRoot);
  const relative = nodePath.relative(root, target);
  if (relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative))) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'target-outside-workspace' };
}

function canonicalFileContextPath(candidate: string): string {
  const resolved = nodePath.resolve(candidate);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isProtectedDevSeekCredential(candidate: string): boolean {
  return /(?:^|[\\/])\.devseek[\\/]bridge-token$/i.test(candidate);
}

function fileContextReadDenied(candidate: string, reason: FileContextReadDenialReason): Error {
  return new Error(`read_file:${reason}:${candidate}`);
}

function readLocalFile(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function formatFileContext(args: {
  requestedPath: string;
  resolvedPath: string;
  content: string;
  source: 'fs' | 'fallback';
  range: FileContextReadRange;
  limits: { maxFullBytes: number; maxFullLines: number; previewLines: number; maxRangeLines: number };
}): string {
  const lines = splitPhysicalLines(args.content);
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(args.content, 'utf8');
  const requestedRange = normalizeRange(args.range, totalLines, args.limits.maxRangeLines);
  const canReturnFull = totalBytes <= args.limits.maxFullBytes && totalLines <= args.limits.maxFullLines;
  const selected = requestedRange ?? (canReturnFull ? { start: 1, end: totalLines } : { start: 1, end: Math.min(totalLines, args.limits.previewLines) });
  const generated = detectGeneratedFile(args.resolvedPath, args.requestedPath, lines);
  const complete = selected.start === 1 && selected.end === totalLines;
  const truncated = !complete;
  const returnedLineCount = countSelectedLines(selected);
  const omittedLines = Math.max(0, totalLines - returnedLineCount);
  const body = lines.slice(selected.start - 1, selected.end).join('\n');
  const reason = requestedRange
    ? requestedRange.capped ? 'range-capped' : 'requested-range'
    : canReturnFull ? 'full-file' : 'file-too-large-preview';
  const sourceIntegrity = determineSourceIntegrity({
    complete,
    generatedFile: generated.generatedFile,
    requestedRange: Boolean(requestedRange),
  });
  const symbolOutline = buildSymbolOutline(lines, selected);

  return [
    '[file_context]',
    `version=${FILE_CONTEXT_PROTOCOL_VERSION}`,
    `path=${args.requestedPath}`,
    `resolvedPath=${args.resolvedPath}`,
    `source=${args.source}`,
    `bytes=${totalBytes}`,
    `lines=${totalLines}`,
    `returnedLines=${selected.start}-${selected.end}/${totalLines}`,
    `complete=${complete}`,
    `truncated=${truncated}`,
    `omittedLines=${omittedLines}`,
    `sourceIntegrity=${sourceIntegrity}`,
    `generatedFile=${generated.generatedFile}`,
    `generatedReason=${generated.reasons.length ? generated.reasons.join(',') : 'none'}`,
    `reason=${reason}`,
    `symbolOutlineCount=${symbolOutline.total}`,
    `symbolOutlineTruncated=${symbolOutline.truncated}`,
    `sameNameSymbolGroups=${symbolOutline.sameNameSymbolGroups.length ? symbolOutline.sameNameSymbolGroups.join(',') : 'none'}`,
    ...symbolOutline.entries.map(entry => (
      `symbolOutline=${entry.kind} ${entry.name} line=${entry.line} duplicateIndex=${entry.duplicateIndex} inReturnedRange=${entry.inReturnedRange}`
    )),
    truncated ? 'next=use read_file with startLine/endLine for the missing range before editing unseen code.' : '',
    '[/file_context]',
    body,
  ].filter(Boolean).join('\n');
}

function determineSourceIntegrity(args: {
  complete: boolean;
  generatedFile: boolean;
  requestedRange: boolean;
}): SourceIntegrity {
  if (args.generatedFile) {
    if (args.complete) return 'generated-full';
    return args.requestedRange ? 'generated-range' : 'generated-preview';
  }
  if (args.complete) return 'full';
  return args.requestedRange ? 'range' : 'preview';
}

function countSelectedLines(selected: SelectedLineRange): number {
  if (selected.end < selected.start) return 0;
  return selected.end - selected.start + 1;
}

function detectGeneratedFile(resolvedPath: string, requestedPath: string, lines: readonly string[]): GeneratedFileInfo {
  const reasons: string[] = [];
  const pathProbe = `${requestedPath}\n${resolvedPath}`.replace(/\\/g, '/').toLowerCase();
  const generatedDir = pathProbe.match(/(?:^|\/)(dist|build|out|coverage|generated|gen)(?:\/|$)/)?.[1];
  if (generatedDir) reasons.push(`path-boundary:${generatedDir}`);
  if (/\.(?:min|bundle)\.[cm]?[jt]sx?$/.test(pathProbe)) reasons.push('path-boundary:bundled-file');

  const markerProbe = lines.slice(0, 40).join('\n').toLowerCase();
  if (/@generated|auto-generated|automatically generated|generated by|do not edit|codegen/.test(markerProbe)) {
    reasons.push('content-marker:generated-or-do-not-edit');
  }

  return { generatedFile: reasons.length > 0, reasons: uniqueStrings(reasons) };
}

function buildSymbolOutline(lines: readonly string[], selected: SelectedLineRange): SymbolOutline {
  const discovered = lines
    .map((line, index) => parseSymbolLine(line, index + 1))
    .filter((entry): entry is Omit<SymbolOutlineEntry, 'duplicateIndex' | 'inReturnedRange'> => Boolean(entry));
  const totalsByName = new Map<string, number>();
  for (const entry of discovered) totalsByName.set(entry.name, (totalsByName.get(entry.name) ?? 0) + 1);

  const seenByName = new Map<string, number>();
  const entries = discovered.slice(0, SYMBOL_OUTLINE_LIMIT).map(entry => {
    const duplicateIndex = (seenByName.get(entry.name) ?? 0) + 1;
    seenByName.set(entry.name, duplicateIndex);
    return {
      ...entry,
      duplicateIndex,
      inReturnedRange: entry.line >= selected.start && entry.line <= selected.end,
    };
  });

  return {
    entries,
    total: discovered.length,
    truncated: discovered.length > entries.length,
    sameNameSymbolGroups: [...totalsByName.entries()]
      .filter(([, count]) => count > 1)
      .map(([name, count]) => `${name}:${count}`),
  };
}

function parseSymbolLine(line: string, lineNumber: number): Omit<SymbolOutlineEntry, 'duplicateIndex' | 'inReturnedRange'> | null {
  const trimmed = line.trim();
  const classMatch = trimmed.match(/^(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)\b/)
    ?? trimmed.match(/^class\s+([A-Za-z_]\w*)\b/);
  if (classMatch) return { kind: 'class', name: classMatch[1], line: lineNumber };

  const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    ?? trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/)
    ?? trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (functionMatch) return { kind: 'function', name: functionMatch[1], line: lineNumber };

  return null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function splitPhysicalLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  if (content.endsWith('\n') || content.endsWith('\r\n')) lines.pop();
  return lines;
}

function normalizeRange(
  range: FileContextReadRange,
  totalLines: number,
  maxRangeLines: number,
): { start: number; end: number; capped: boolean } | null {
  const start = toPositiveInteger(range.startLine);
  const end = toPositiveInteger(range.endLine);
  if (!start && !end) return null;
  const normalizedStart = clampLine(start ?? 1, totalLines);
  const normalizedEnd = clampLine(end ?? totalLines, totalLines);
  const orderedEnd = Math.max(normalizedStart, normalizedEnd);
  const cappedEnd = Math.min(orderedEnd, normalizedStart + Math.max(1, maxRangeLines) - 1);
  return { start: normalizedStart, end: cappedEnd, capped: cappedEnd !== orderedEnd };
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value));
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Math.max(1, Number.parseInt(value.trim(), 10));
  return null;
}

function clampLine(value: number, totalLines: number): number {
  if (totalLines <= 0) return 1;
  return Math.min(Math.max(1, value), totalLines);
}
