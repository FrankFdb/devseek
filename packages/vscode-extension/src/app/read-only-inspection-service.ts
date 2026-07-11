import * as fs from 'fs';
import * as nodePath from 'path';
import { fenceLangForFile } from '../utils';
import { isExplicitDeliverablePathWriteRequest } from '../intent/advisory-patterns';

export interface ReadOnlyInspectionRequest {
  prompt: string;
  workspaceRoot: string;
  maxBytes?: number;
}

export interface ReadOnlyInspectionResult {
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  wantsContent: boolean;
  text: string;
}

const DEFAULT_MAX_BYTES = 24 * 1024;

const EXPLICIT_READ_ONLY_RE = /(不要|无需|不需要|别|禁止).{0,10}(修改|改动|更改|写入|创建|删除|保存|编辑)|只读|read[-\s]?only|no\s+changes?/i;
const SIMPLE_INSPECTION_RE = /(检查|确认|查看|读取|显示|展示|是否存在|存在|内容|inspect|check|read|show|display|exist|cat)/i;
const CONTENT_REQUEST_RE = /(显示|展示|读取|查看).{0,12}(文件)?内容|文件内容|content|show|display|cat|read\s+file/i;
const COMPLEX_ANALYSIS_RE = /(分析|评估|审计|诊断|定位|找出|提取|汇总|比较|对比|验证|交付|根本原因|问题|建议|计划|方案|重构|修复|优化|review|audit|analy[sz]e|diagnose|extract|compare|verify|root\s+cause|refactor|fix)/i;

const PATH_RE = /(?:^|[\s`'":：，。；；（(【\[])(\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9][A-Za-z0-9_.-]{0,15})(?=$|[\s`'"),，。；；）)】\]])/g;

function normalizeCandidatePath(candidate: string): string {
  return candidate
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/#L\d+$/i, '')
    .replace(/:\d+(?::\d+)?$/i, '')
    .replace(/[，。；;：:）)\]】]+$/g, '');
}

function isInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  const rel = nodePath.relative(workspaceRoot, absolutePath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function extractFirstWorkspacePath(prompt: string): string | null {
  let match: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((match = PATH_RE.exec(prompt)) !== null) {
    const normalized = normalizeCandidatePath(match[1]);
    if (normalized && !normalized.includes('..')) return normalized;
  }
  return null;
}

function readFileExcerpt(absolutePath: string, stat: fs.Stats, maxBytes: number): { content: string; truncated: boolean; binary: boolean } {
  const bytesToRead = Math.min(Math.max(0, maxBytes), stat.size);
  const fd = fs.openSync(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    const chunk = buffer.subarray(0, bytesRead);
    const binary = chunk.includes(0);
    return {
      content: binary ? '' : chunk.toString('utf8'),
      truncated: stat.size > bytesRead,
      binary,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function buildFoundText(relativePath: string, contentResult: { content: string; truncated: boolean; binary: boolean } | null): string {
  if (!contentResult) {
    return [
      `检查结果：\`${relativePath}\` 存在。`,
      '',
      '未修改任何文件。',
    ].join('\n');
  }

  if (contentResult.binary) {
    return [
      `检查结果：\`${relativePath}\` 存在。`,
      '',
      '文件看起来是二进制内容，已跳过正文展示。',
      '',
      '未修改任何文件。',
    ].join('\n');
  }

  const lang = fenceLangForFile(relativePath);
  const fence = lang ? `\`\`\`${lang}` : '```';
  const truncationNote = contentResult.truncated ? '\n\n（内容较长，仅显示前 24KB。）' : '';
  return [
    `检查结果：\`${relativePath}\` 存在。`,
    '',
    '文件内容：',
    '',
    fence,
    contentResult.content.replace(/\s+$/g, ''),
    '```',
    `${truncationNote}`,
    '',
    '未修改任何文件。',
  ].join('\n');
}

export function tryBuildReadOnlyInspectionResult(request: ReadOnlyInspectionRequest): ReadOnlyInspectionResult | null {
  const prompt = request.prompt || '';
  const rawWorkspaceRoot = (request.workspaceRoot || '').trim();
  if (!prompt.trim() || !rawWorkspaceRoot) return null;
  if (isExplicitDeliverablePathWriteRequest(prompt)) return null;
  const workspaceRoot = nodePath.resolve(rawWorkspaceRoot);
  if (!fs.existsSync(workspaceRoot)) return null;
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    return null;
  }
  if (!EXPLICIT_READ_ONLY_RE.test(prompt)) return null;
  if (!SIMPLE_INSPECTION_RE.test(prompt)) return null;
  if (COMPLEX_ANALYSIS_RE.test(prompt)) return null;

  const extractedPath = extractFirstWorkspacePath(prompt);
  if (!extractedPath) return null;

  const absolutePath = nodePath.isAbsolute(extractedPath)
    ? nodePath.resolve(extractedPath)
    : nodePath.resolve(workspaceRoot, extractedPath);
  if (!isInsideWorkspace(workspaceRoot, absolutePath)) return null;

  const relativePath = nodePath.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
  const wantsContent = CONTENT_REQUEST_RE.test(prompt);

  if (!fs.existsSync(absolutePath)) {
    return {
      relativePath,
      absolutePath,
      exists: false,
      wantsContent,
      text: [
        `检查结果：\`${relativePath}\` 不存在。`,
        '',
        '未修改任何文件。',
      ].join('\n'),
    };
  }

  let realAbsolutePath: string;
  try {
    realAbsolutePath = fs.realpathSync.native(absolutePath);
  } catch {
    return null;
  }
  if (!isInsideWorkspace(realWorkspaceRoot, realAbsolutePath)) return null;

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    return {
      relativePath,
      absolutePath,
      exists: true,
      wantsContent,
      text: [
        `检查结果：\`${relativePath}\` 存在，但不是文件。`,
        '',
        '未修改任何文件。',
      ].join('\n'),
    };
  }

  const contentResult = wantsContent
    ? readFileExcerpt(absolutePath, stat, request.maxBytes ?? DEFAULT_MAX_BYTES)
    : null;

  return {
    relativePath,
    absolutePath,
    exists: true,
    wantsContent,
    text: buildFoundText(relativePath, contentResult),
  };
}
