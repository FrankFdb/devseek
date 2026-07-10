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

export function extractRequiredDeliverables(prompt: string): RequiredDeliverable[] {
  const text = String(prompt || '');
  const byPath = new Map<string, RequiredDeliverable>();
  let match: RegExpExecArray | null;
  FILE_TOKEN_RE.lastIndex = 0;
  while ((match = FILE_TOKEN_RE.exec(text)) !== null) {
    const rawPath = normalizeDeliverablePath(match[0]);
    if (!rawPath) continue;
    const source = clauseAround(text, match.index, match.index + match[0].length);
    if (!WRITE_ACTION_RE.test(source) || NEGATED_WRITE_RE.test(source)) continue;
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
    const relative = !nodePath.isAbsolute(deliverable.path);
    const matchedWrite = written.find(file => file.resolved === resolved
      || (!workspaceRoot && relative && file.raw.endsWith(`/${deliverable.path}`)));
    if (!resolved || !matchedWrite) return true;
    try { return !fs.existsSync(matchedWrite.resolved); } catch { return true; }
  });
}

function clauseAround(text: string, start: number, end: number): string {
  const boundaries = ['\n', '。', '；', ';'];
  const left = Math.max(-1, ...boundaries.map(ch => text.lastIndexOf(ch, start))) + 1;
  const rightCandidates = boundaries
    .map(ch => text.indexOf(ch, end))
    .filter(index => index >= 0);
  const right = rightCandidates.length > 0 ? Math.min(...rightCandidates) : text.length;
  return text.slice(left, right);
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
