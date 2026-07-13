import * as nodePath from 'path';
import { isCanonicalPathInsideRoot } from '../workspace/path-containment';

export interface IsolatedArtifactWriteScope {
  required: boolean;
  allowedRoots: string[];
}

const ISOLATED_ARTIFACT_SCOPE_RE = /(?:本次测试|测试产物|所有(?:(?:新增|生成|产出)(?:的)?)?(?:产物|输出|交付物|文档|文件|代码|脚本)|所有(?:新增|生成|产出)(?:的)?|新增设计文档|新增代码|验证脚本|新增产物).{0,72}(?:必须|统一|只能).{0,18}(?:放在|放入|写入|保存到|输出到|隔离(?:目录|路径))|(?:只|仅)[^，,。；;\n]{0,32}隔离(?:目录|路径)[^，,。；;\n]{0,40}(?:创建|新建|生成|编写|写入|保存|输出)|\b(?:(?:all\s+)?(?:(?:new|generated|produced|created)\s+)?|test\s+)(?:artifacts?|outputs?|deliverables?|documents?|files?|code|scripts?)[^\n,.;]{0,72}\b(?:must|shall)\s+be\s+(?:placed|written|saved|created|output)\s+(?:in|to)\b/i;
const OUTPUT_ROOT_RE = /(?:必须(?:统一)?放在|只能放在|放入|放到|放置到|写入到|保存到|输出到|输出目录(?:要求)?|隔离(?:目录|路径)[^：:\n]{0,80}|目标(?:目录|路径|文件)[^：:\n]{0,80}|必须创建[^：:\n]{0,60}(?:文档|文件)?|\bmust\s+be\s+(?:placed|written|saved|created|output)\s+(?:in|to)|\b(?:output|artifact)\s+(?:root|director(?:y|ies))\s*(?:is|are)?)\s*[:：]?\s*(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|“([^”\n]+)”|((?:~\/|\.{0,2}\/|\/)[^\s"'`<>，。；;]+|[A-Za-z0-9_.@+~-]+(?:[\\/][A-Za-z0-9_.@+~-]+)+))(?=$|[\n，。；;,.]|\s+(?:文件内容要求|内容要求|文件要求|文件内容|content\s+requirements?|file\s+contents?|requirements?)(?:\s|[:：]|$))/gi;

export function detectIsolatedArtifactWriteScope(
  requestPrompt: string | undefined,
  workspaceRoot?: string,
): IsolatedArtifactWriteScope {
  const text = String(requestPrompt || '');
  const required = ISOLATED_ARTIFACT_SCOPE_RE.test(text);
  if (!required) return { required: false, allowedRoots: [] };

  const roots = new Set<string>();
  let match: RegExpExecArray | null;
  OUTPUT_ROOT_RE.lastIndex = 0;
  while ((match = OUTPUT_ROOT_RE.exec(text)) !== null) {
    const root = coerceAllowedOutputRoot(match.slice(1).find(Boolean), workspaceRoot);
    if (root) roots.add(root);
  }

  return {
    required: true,
    allowedRoots: pruneStructuredArtifactContainerRoots([...roots].sort((a, b) => a.length - b.length)),
  };
}

export function isTargetInsideIsolatedArtifactWriteScope(
  requestPrompt: string | undefined,
  absPath: string,
  workspaceRoot?: string,
): boolean {
  const isolatedScope = detectIsolatedArtifactWriteScope(requestPrompt, workspaceRoot);
  return isolatedScope.required
    && isolatedScope.allowedRoots.length > 0
    && isInsideAnyCanonicalPath(absPath, isolatedScope.allowedRoots);
}

export function isTargetExactIsolatedArtifactWriteScope(
  requestPrompt: string | undefined,
  absPath: string,
  workspaceRoot?: string,
): boolean {
  const isolatedScope = detectIsolatedArtifactWriteScope(requestPrompt, workspaceRoot);
  return isolatedScope.required
    && isolatedScope.allowedRoots.length > 0
    && isolatedScope.allowedRoots.some(root => isSamePath(absPath, root) && isCanonicalPathInsideRoot(absPath, root));
}

function coerceAllowedOutputRoot(value: string | undefined, workspaceRoot?: string): string | undefined {
  let raw = String(value || '')
    .replace(/[)\]}>，。；;：:,.]+$/g, '')
    .replace(/\/+$/g, '')
    .trim();
  if (!raw) return undefined;
  if (raw.startsWith('~/')) {
    const home = process.env.HOME || '';
    if (!home) return undefined;
    raw = nodePath.join(home, raw.slice(2));
  }
  const absPath = nodePath.isAbsolute(raw)
    ? nodePath.normalize(raw)
    : workspaceRoot
      ? nodePath.resolve(workspaceRoot, raw)
      : '';
  if (!absPath) return undefined;
  const ext = nodePath.extname(absPath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return nodePath.dirname(absPath);
  return absPath;
}

function pruneStructuredArtifactContainerRoots(roots: string[]): string[] {
  const normalized = roots.map(root => nodePath.normalize(root).replace(/[\\/]+$/g, ''));
  const set = new Set(normalized);
  return normalized.filter(root => !isStructuredArtifactContainerRoot(root, set));
}

function isStructuredArtifactContainerRoot(root: string, allRoots: ReadonlySet<string>): boolean {
  if (!root) return false;
  const hasDocs = allRoots.has(nodePath.join(root, 'docs')) || allRoots.has(nodePath.join(root, 'doc'));
  const hasSrc = allRoots.has(nodePath.join(root, 'src')) || allRoots.has(nodePath.join(root, 'source'));
  return hasDocs && hasSrc;
}

function isInsideAnyCanonicalPath(absPath: string, roots: readonly string[]): boolean {
  return roots.some(root => isInsidePath(absPath, root) && isCanonicalPathInsideRoot(absPath, root));
}

function isInsidePath(absPath: string, root: string): boolean {
  const rel = nodePath.relative(root, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function isSamePath(left: string, right: string): boolean {
  return nodePath.relative(left, right) === '';
}
