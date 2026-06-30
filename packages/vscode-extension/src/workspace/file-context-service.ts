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

const DEFAULT_MAX_FULL_BYTES = 64 * 1024;
const DEFAULT_MAX_FULL_LINES = 2000;
const DEFAULT_PREVIEW_LINES = 240;
const DEFAULT_MAX_RANGE_LINES = 600;

export class FileContextService {
  constructor(private readonly options: FileContextServiceOptions) {}

  async readFileForAi(rawPath: string, request: FileContextReadRequest = {}): Promise<string> {
    const filePath = rawPath.trim();
    if (!filePath) throw new Error('read_file: path is empty');

    const candidates = this.buildCandidatePaths(filePath, request.workDir);
    const resolved = await this.resolveContent(filePath, candidates);
    if (!resolved) throw new Error(`找不到文件：${filePath}`);

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
    const push = (candidate?: string) => {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    };

    if (nodePath.isAbsolute(filePath)) push(nodePath.resolve(filePath));
    if (workDir && !nodePath.isAbsolute(filePath)) {
      const candidate = nodePath.resolve(workDir, filePath);
      if (this.isAllowedWorkspaceCandidate(candidate)) push(candidate);
    }

    const recentByBase = this.options.recentFiles?.get(nodePath.basename(filePath).toLowerCase());
    push(recentByBase);
    const recentByRel = this.options.recentFiles?.get(filePath);
    push(recentByRel);

    if (this.options.workspaceRoot && !nodePath.isAbsolute(filePath)) {
      push(nodePath.resolve(this.options.workspaceRoot, filePath));
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
  const truncated = selected.start !== 1 || selected.end !== totalLines;
  const body = lines.slice(selected.start - 1, selected.end).join('\n');
  const reason = requestedRange
    ? requestedRange.capped ? 'range-capped' : 'requested-range'
    : canReturnFull ? 'full-file' : 'file-too-large-preview';

  return [
    '[file_context]',
    `path=${args.requestedPath}`,
    `resolvedPath=${args.resolvedPath}`,
    `source=${args.source}`,
    `bytes=${totalBytes}`,
    `lines=${totalLines}`,
    `returnedLines=${selected.start}-${selected.end}/${totalLines}`,
    `truncated=${truncated}`,
    `reason=${reason}`,
    truncated ? 'next=use read_file with startLine/endLine for the missing range before editing unseen code.' : '',
    '[/file_context]',
    body,
  ].filter(Boolean).join('\n');
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
