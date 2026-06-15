import * as fs from 'fs';
import * as nodePath from 'path';

export interface LocalAttachmentContextOptions {
  workspaceRoot?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export interface LocalAttachmentContextResult {
  prompt: string;
  inlinedFiles: string[];
  skippedFiles: string[];
}

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_BYTES_PER_FILE = 12_000;
const DEFAULT_MAX_TOTAL_BYTES = 40_000;

export function buildLocalAttachmentContextPrompt(
  prompt: string,
  filePaths: string[],
  options: LocalAttachmentContextOptions = {},
): LocalAttachmentContextResult {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const workspaceRoot = options.workspaceRoot ? nodePath.resolve(options.workspaceRoot) : '';

  const blocks: string[] = [];
  const inlinedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let totalBytes = 0;

  for (const filePath of dedupe(filePaths).slice(0, maxFiles)) {
    const normalized = nodePath.isAbsolute(filePath)
      ? nodePath.resolve(filePath)
      : nodePath.resolve(workspaceRoot || process.cwd(), filePath);
    let raw: Buffer;
    try {
      const stat = fs.statSync(normalized);
      if (!stat.isFile()) {
        skippedFiles.push(filePath);
        continue;
      }
      raw = fs.readFileSync(normalized);
    } catch {
      skippedFiles.push(filePath);
      continue;
    }

    if (raw.includes(0)) {
      skippedFiles.push(filePath);
      continue;
    }

    const remaining = maxTotalBytes - totalBytes;
    if (remaining <= 0) {
      skippedFiles.push(filePath);
      continue;
    }

    const limit = Math.min(maxBytesPerFile, remaining);
    const truncated = raw.length > limit;
    const text = raw.subarray(0, limit).toString('utf8');
    totalBytes += Math.min(raw.length, limit);
    inlinedFiles.push(normalized);
    blocks.push([
      `文件: ${displayPath(normalized, workspaceRoot)}`,
      '```text',
      text,
      truncated ? '\n...（内容已截断）' : '',
      '```',
    ].join('\n'));
  }

  if (filePaths.length > maxFiles) {
    skippedFiles.push(...dedupe(filePaths).slice(maxFiles));
  }

  if (blocks.length === 0) {
    return { prompt, inlinedFiles, skippedFiles };
  }

  return {
    prompt: [
      '【本地附件上下文】',
      '用户本轮附加了以下本地文件，内容已由 VS Code 扩展读取。请基于这些内容回答，不要要求用户重新上传，也不要输出工具调用。',
      '',
      blocks.join('\n\n'),
      '[/本地附件上下文]',
      '',
      '【用户请求】',
      prompt,
    ].join('\n'),
    inlinedFiles,
    skippedFiles,
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function displayPath(filePath: string, workspaceRoot: string): string {
  if (!workspaceRoot) return nodePath.basename(filePath);
  const rel = nodePath.relative(workspaceRoot, filePath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)
    ? rel
    : nodePath.basename(filePath);
}
