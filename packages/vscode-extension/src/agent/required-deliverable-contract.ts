import * as fs from 'fs';
import * as nodePath from 'path';

export interface RequiredDeliverable {
  path: string;
  source: string;
}

export interface DeliverableWriteEvidence {
  path: string;
}

const FILE_TOKEN_RE = /(?:\/[^\s，。；;：:"'`<>|]+|(?:\.{0,2}\/)?[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*)\.(?:cpp|cxx|cc|c|hpp|hxx|hh|h|tsx|jsx|mjs|cjs|ts|js|py|java|go|rs|cs|php|rb|swift|kts|kt|scala|html|scss|sass|css|svelte|vue|bash|zsh|sh|json|ya?ml|md|markdown|txt|cmake)\b/gi;
const WRITE_ACTION_RE = /(?:必须|务必|请|需要|应当|要求|must|required|shall)?\s*(?:创建|新建|生成|编写|写入|输出|保存|交付|修改|更新|重构|create|generate|write|save|deliver|modify|update|refactor)/i;
const NEGATED_WRITE_RE = /(?:不要|不用|无需|不需要|禁止|不得|不能|别|do\s+not|must\s+not).{0,18}(?:创建|新建|生成|编写|写入|输出|保存|交付|修改|更新|create|generate|write|save|deliver|modify|update)/i;
const INPUT_ROLE_RE = /(?:基于|根据|依据|参考|读取|读入|检查|审计|分析|查看|来自|\b(?:from|based\s+on|according\s+to|read|inspect|audit|analy[sz]e|check|review)\b)/gi;
const TARGET_AFTER_INPUT_RE = /(?:目标|输出|报告|文档|文件|创建|新建|生成|编写|写入|写到|保存|保存到|输出到|交付|修改|更新|重构|target|output|report|document|file|create|generate|write|save|deliver|modify|update|refactor)/i;
const TARGET_PREFIX_RE = /(?:目标(?:文件|文档|报告|路径)?\s*(?:是|为|:|：|=)?|输出(?:文件|文档|报告|路径)?\s*(?:是|为|:|：|=)?|(?:保存|写入|写到|输出|输出到|放入|放到|交付)(?:到|至|为)?|(?:创建|新建|生成|编写)(?:输出)?(?:文件|文档|报告)?\s*(?:是|为|:|：|=)?|\b(?:target|output)(?:\s+(?:file|document|report|path))?\s*(?::|=)?|\b(?:save|write|output|deliver)\s+(?:it\s+)?(?:to|as)?|\b(?:create|generate|write)\s+(?:the\s+)?(?:output\s+)?(?:file|document|report)?\s*)$/i;

export function extractRequiredDeliverables(prompt: string): RequiredDeliverable[] {
  const text = String(prompt || '');
  const byPath = new Map<string, RequiredDeliverable>();
  let match: RegExpExecArray | null;
  FILE_TOKEN_RE.lastIndex = 0;
  while ((match = FILE_TOKEN_RE.exec(text)) !== null) {
    const rawPath = normalizeDeliverablePath(match[0]);
    if (!rawPath) continue;
    const bounds = clauseBoundsAround(text, match.index, match.index + match[0].length);
    const source = text.slice(bounds.start, bounds.end);
    if (!WRITE_ACTION_RE.test(source) || NEGATED_WRITE_RE.test(source)) continue;
    if (isInputPathMention(text, match.index, match.index + match[0].length, bounds)) continue;
    byPath.set(rawPath, { path: rawPath, source: source.trim() });
  }
  return [...byPath.values()];
}

export function getMissingRequiredDeliverables(
  prompt: string,
  writtenFiles: DeliverableWriteEvidence[],
  workspaceRoot?: string,
): RequiredDeliverable[] {
  const required = extractRequiredDeliverables(prompt);
  if (required.length === 0) return [];
  const written = writtenFiles.map(file => ({
    raw: normalizeDeliverablePath(file.path),
    resolved: resolveEvidencePath(file.path, workspaceRoot),
  }));
  return required.filter(deliverable => {
    const resolved = resolveEvidencePath(deliverable.path, workspaceRoot);
    const matchedWrite = written.find(file => deliverableWriteMatches(
      deliverable.path,
      resolved,
      file,
      workspaceRoot,
    ));
    if (!resolved || !matchedWrite) return true;
    try { return !fs.existsSync(matchedWrite.resolved); } catch { return true; }
  });
}

function deliverableWriteMatches(
  deliverablePath: string,
  resolvedDeliverable: string,
  file: { raw: string; resolved: string },
  workspaceRoot?: string,
): boolean {
  if (!resolvedDeliverable || !file.resolved) return false;
  if (file.resolved === resolvedDeliverable) return true;
  const relative = !nodePath.isAbsolute(deliverablePath);
  if (!workspaceRoot && relative && file.raw.endsWith(`/${deliverablePath}`)) return true;
  return isNumberedCollisionSibling(resolvedDeliverable, file.resolved);
}

function isNumberedCollisionSibling(requiredResolved: string, writtenResolved: string): boolean {
  const required = nodePath.parse(requiredResolved);
  const written = nodePath.parse(writtenResolved);
  if (required.dir !== written.dir) return false;
  if (!required.ext || required.ext !== written.ext) return false;
  return new RegExp(`^${escapeRegExp(required.name)}-\\d+$`).test(written.name);
}

function clauseBoundsAround(text: string, start: number, end: number): { start: number; end: number } {
  const boundaries = ['\n', '。', '；', ';'];
  const left = Math.max(-1, ...boundaries.map(ch => text.lastIndexOf(ch, start))) + 1;
  const rightCandidates = boundaries
    .map(ch => text.indexOf(ch, end))
    .filter(index => index >= 0);
  const right = rightCandidates.length > 0 ? Math.min(...rightCandidates) : text.length;
  return { start: left, end: right };
}

function isInputPathMention(
  text: string,
  start: number,
  end: number,
  bounds: { start: number; end: number },
): boolean {
  const prefix = text.slice(bounds.start, start);
  if (TARGET_PREFIX_RE.test(prefix)) return false;
  const inputIndex = lastInputRoleIndex(prefix);
  if (inputIndex < 0) return false;
  const sinceInputRole = prefix.slice(inputIndex);
  if (TARGET_AFTER_INPUT_RE.test(sinceInputRole)) return false;
  const suffix = text.slice(end, Math.min(bounds.end, end + 80));
  if (/^\s*(?:作为|as)\s+(?:目标|输出|报告|文档|文件|target|output|report|document|file)\b/i.test(suffix)) {
    return false;
  }
  return true;
}

function lastInputRoleIndex(text: string): number {
  let latest = -1;
  INPUT_ROLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INPUT_ROLE_RE.exec(text)) !== null) {
    latest = match.index ?? latest;
  }
  return latest;
}

function normalizeDeliverablePath(value: string): string {
  return String(value || '')
    .replace(/^[《「“"'`\s]+|[》」”"'`\s]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
}

function resolveEvidencePath(value: string, workspaceRoot?: string): string {
  const normalized = normalizeDeliverablePath(value);
  if (!normalized) return '';
  const resolved = nodePath.isAbsolute(normalized)
    ? nodePath.resolve(normalized)
    : workspaceRoot
      ? nodePath.resolve(workspaceRoot, normalized)
      : nodePath.resolve(normalized);
  return resolved.replace(/\\/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
