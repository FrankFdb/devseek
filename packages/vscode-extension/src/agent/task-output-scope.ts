import * as nodePath from 'path';
import {
  detectIsolatedArtifactWriteScope,
} from '../app/agent-file-write-policy';

export interface TaskOutputScopeDrift {
  blocked: boolean;
  reason?: string;
  allowedRoots: string[];
  stalePaths: string[];
}

interface TimestampArtifactAnchor {
  parent: string;
  runId: string;
  root: string;
}

const TIMESTAMP_RUN_ID_RE = /^20\d{10}$/;
const ABS_PATH_RE = /(?:~|\/)[^\s"'`<>，。；;)\]}]+/g;

export function detectTaskOutputScopeDrift(input: {
  requestPrompt?: string;
  text?: string;
  workspaceRoot?: string;
}): TaskOutputScopeDrift {
  const scope = detectIsolatedArtifactWriteScope(input.requestPrompt, input.workspaceRoot);
  const allowedRoots = scope.allowedRoots;
  if (!scope.required || allowedRoots.length === 0) {
    return { blocked: false, allowedRoots, stalePaths: [] };
  }

  const anchors = collectTimestampArtifactAnchors(allowedRoots);
  if (anchors.length === 0) {
    return { blocked: false, allowedRoots, stalePaths: [] };
  }

  const stalePaths = extractAbsolutePaths(input.text || '')
    .filter(candidate => isStaleTimestampSibling(candidate, anchors));
  const uniqueStalePaths = [...new Set(stalePaths)].sort();
  if (uniqueStalePaths.length === 0) {
    return { blocked: false, allowedRoots, stalePaths: [] };
  }

  const allowed = allowedRoots.map(root => displayPath(root, input.workspaceRoot)).join('、');
  const stale = uniqueStalePaths.map(pathValue => displayPath(pathValue, input.workspaceRoot)).join('、');
  return {
    blocked: true,
    allowedRoots,
    stalePaths: uniqueStalePaths,
    reason: `检测到模型输出引用了本轮输出目录的同级旧运行目录：${stale}。当前任务只允许使用：${allowed}。这通常表示旧 DeepSeek 会话、缓存或增量上下文污染，必须丢弃该输出并按当前目录重新生成。`,
  };
}

export function buildTaskOutputScopeRecoveryPrompt(drift: TaskOutputScopeDrift): string {
  const allowed = drift.allowedRoots.map(root => `- ${root}`).join('\n') || '- 当前用户指定目录';
  const stale = drift.stalePaths.map(pathValue => `- ${pathValue}`).join('\n') || '- 未知旧目录';
  return [
    '【系统反馈】本轮 Provider 输出被拒绝：检测到旧运行目录或过期产物路径。',
    '这不是可执行结果，不能继续沿用上一轮路径、上一轮文档或上一轮编译命令。',
    '',
    '当前允许的输出根目录：',
    allowed,
    '',
    '已拒绝的旧路径：',
    stale,
    '',
    '请立即重新读取/确认当前任务要求，并且所有 create_file/write_file/replace_in_file/run_terminal 都必须使用当前允许目录。',
    '不要复用旧时间戳目录；不要把旧会话里的文件路径当成事实。',
  ].join('\n');
}

function collectTimestampArtifactAnchors(allowedRoots: readonly string[]): TimestampArtifactAnchor[] {
  const anchors = new Map<string, TimestampArtifactAnchor>();
  for (const root of allowedRoots) {
    const normalized = nodePath.resolve(root);
    const parts = normalized.split(nodePath.sep);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!TIMESTAMP_RUN_ID_RE.test(part)) continue;
      const parentParts = parts.slice(0, i);
      const parent = parentParts.length === 0 ? nodePath.sep : parentParts.join(nodePath.sep) || nodePath.sep;
      const key = `${parent}::${part}`;
      if (!anchors.has(key)) {
        anchors.set(key, { parent, runId: part, root: normalized });
      }
      break;
    }
  }
  return [...anchors.values()];
}

function extractAbsolutePaths(text: string): string[] {
  const result: string[] = [];
  const home = process.env.HOME || '';
  for (const match of String(text || '').matchAll(ABS_PATH_RE)) {
    let raw = match[0]
      .replace(/\\n.*$/g, '')
      .replace(/[)\]}>，。；;：:,.]+$/g, '')
      .replace(/\\+/g, '/')
      .trim();
    if (!raw) continue;
    if (raw.startsWith('~/')) {
      if (!home) continue;
      raw = nodePath.join(home, raw.slice(2));
    }
    if (!nodePath.isAbsolute(raw)) continue;
    result.push(nodePath.normalize(raw));
  }
  return result;
}

function isStaleTimestampSibling(candidate: string, anchors: readonly TimestampArtifactAnchor[]): boolean {
  const normalized = nodePath.resolve(candidate);
  return anchors.some(anchor => {
    const rel = nodePath.relative(anchor.parent, normalized);
    if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return false;
    const first = rel.split(/[\\/]/)[0];
    return TIMESTAMP_RUN_ID_RE.test(first) && first !== anchor.runId;
  });
}

function displayPath(absPath: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return absPath;
  const rel = nodePath.relative(nodePath.resolve(workspaceRoot), nodePath.resolve(absPath)).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel) ? rel : absPath;
}
