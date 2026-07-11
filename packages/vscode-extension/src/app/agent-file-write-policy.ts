import * as nodePath from 'path';
import { isCanonicalPathInsideRoot } from '../workspace/path-containment';
import type { ToolPolicy } from './permission-service';
import { decideToolPermission } from './permission-service';

export type AgentFileWritePurpose =
  | 'workspace-edit'
  | 'markdown-deliverable'
  | 'deterministic-task'
  | 'tool-write'
  | 'local-repair';

export interface AgentFileWriteContext {
  purpose?: AgentFileWritePurpose;
  userRequested?: boolean;
  taskAction?: string;
  displayName?: string;
  requestPrompt?: string;
}

export interface AgentFileWriteDecisionInput {
  absPath: string;
  workspaceRoot?: string;
  toolPolicy?: ToolPolicy;
  autopilotMode?: boolean;
  protectedPath?: boolean;
  context?: AgentFileWriteContext;
}

export interface AgentFileWriteDecision {
  action: 'allow' | 'deny' | 'requireConfirm';
  reason: string;
  notice?: string;
  confirmationTitle?: string;
  audit?: {
    absPath: string;
    workspaceRoot?: string;
    toolPolicyMode?: string;
    purpose?: string;
    userRequested?: boolean;
    protectedPath?: boolean;
    autopilotMode?: boolean;
    explicitMarkdownDeliverable?: boolean;
    isolatedArtifactScopeRequired?: boolean;
    isolatedArtifactAllowedRoots?: string[];
  };
}

const SENSITIVE_FILE_RE = /^(\.env(\.|$))|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|secret|credentials|token|passwd|password)$/i;

export function decideAgentFileWrite(input: AgentFileWriteDecisionInput): AgentFileWriteDecision {
  const absPath = nodePath.normalize(String(input.absPath || '').trim());
  const workspaceRoot = input.workspaceRoot ? nodePath.normalize(input.workspaceRoot) : '';
  const relPath = displayWritePath(absPath, workspaceRoot, input.context?.displayName);
  const explicitMarkdownDeliverable = isExplicitMarkdownDeliverable(input.context, absPath);
  const audit = {
    absPath,
    workspaceRoot: workspaceRoot || undefined,
    toolPolicyMode: input.toolPolicy?.mode,
    purpose: input.context?.purpose,
    userRequested: input.context?.userRequested,
    protectedPath: !!input.protectedPath,
    autopilotMode: !!input.autopilotMode,
    explicitMarkdownDeliverable,
  };
  const isolatedScope = detectIsolatedArtifactWriteScope(input.context?.requestPrompt, workspaceRoot);
  const scopedAudit = {
    ...audit,
    isolatedArtifactScopeRequired: isolatedScope.required,
    isolatedArtifactAllowedRoots: isolatedScope.allowedRoots.length > 0 ? isolatedScope.allowedRoots : undefined,
  };

  if (!absPath) {
    return deny('missing-target-path', '缺少可写入的目标路径。', scopedAudit);
  }
  if (workspaceRoot && (!isInsidePath(absPath, workspaceRoot) || !isCanonicalPathInsideRoot(absPath, workspaceRoot))) {
    return deny('target-outside-workspace', `写入目标不在当前 workspace 内：${relPath}`, scopedAudit);
  }
  if (input.protectedPath) {
    return deny('protected-files-match', `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）`, scopedAudit);
  }
  if (isolatedScope.required && isolatedScope.allowedRoots.length > 0 && !isInsideAnyCanonicalPath(absPath, isolatedScope.allowedRoots)) {
    return deny(
      'isolated-artifact-scope',
      `写入被测试/交付产物隔离规则阻止：${relPath}。本次请求要求新增产物只能写入 ${isolatedScope.allowedRoots.map(root => displayWritePath(root, workspaceRoot)).join('、')}；正式源码修改请写入“原有代码修改清单”，不要直接改正式源码。`,
      scopedAudit,
    );
  }

  if (input.toolPolicy) {
    const writePermission = decideToolPermission(input.toolPolicy, 'edit');
    if (writePermission.action === 'deny') {
      return deny(writePermission.reason, `当前 ${input.toolPolicy.mode} 模式不允许写入文件（${writePermission.reason}）。`, scopedAudit);
    }
    if (writePermission.action === 'requireConfirm' && !explicitMarkdownDeliverable) {
      return {
        action: 'requireConfirm',
        reason: writePermission.reason,
        confirmationTitle: `确认写入文件：${relPath}`,
        audit: scopedAudit,
      };
    }
  }

  if (!input.autopilotMode && SENSITIVE_FILE_RE.test(nodePath.basename(absPath))) {
    return {
      action: 'requireConfirm',
      reason: 'sensitive-file-requires-confirmation',
      confirmationTitle: `⚠️ 写入敏感文件：${relPath}`,
      audit: scopedAudit,
    };
  }

  return {
    action: 'allow',
    reason: explicitMarkdownDeliverable ? 'explicit-markdown-deliverable' : 'workspace-write-allowed',
    audit: scopedAudit,
  };
}

export function isExplicitMarkdownDeliverable(context: AgentFileWriteContext | undefined, absPath: string): boolean {
  return context?.purpose === 'markdown-deliverable'
    && context.userRequested === true
    && nodePath.extname(absPath).toLowerCase() === '.md';
}

function deny(reason: string, notice: string, audit?: AgentFileWriteDecision['audit']): AgentFileWriteDecision {
  return { action: 'deny', reason, notice, audit };
}

function displayWritePath(absPath: string, workspaceRoot: string, fallback?: string): string {
  if (!absPath) return fallback || '目标文件';
  if (!workspaceRoot) return fallback || nodePath.basename(absPath);
  const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel) ? rel : (fallback || absPath);
}

function isInsidePath(absPath: string, root: string): boolean {
  const rel = nodePath.relative(root, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function isInsideAnyCanonicalPath(absPath: string, roots: readonly string[]): boolean {
  return roots.some(root => isInsidePath(absPath, root) && isCanonicalPathInsideRoot(absPath, root));
}

export interface IsolatedArtifactWriteScope {
  required: boolean;
  allowedRoots: string[];
}

const ISOLATED_ARTIFACT_SCOPE_RE = /(?:不要|不得|禁止).{0,18}(?:修改|改动|写入).{0,18}(?:正式源码|正式代码|原项目|既有文件|正式源码目录)|(?:本次测试|测试产物|所有新增|新增设计文档|新增代码|验证脚本).{0,60}(?:必须|统一).{0,12}(?:放在|放入|写入|保存到|输出到)/i;
const OUTPUT_ROOT_RE = /(?:必须放在|放入|放到|放置到|写入到|保存到|输出到|输出目录(?:要求)?|必须创建[^：:\n]{0,60}(?:文档|文件)?)\s*[:：]?\s*([~/][^\s"'`<>，。；;]+)/gi;

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
    const root = coerceAllowedOutputRoot(match[1], workspaceRoot);
    if (root) roots.add(root);
  }

  return {
    required: true,
    allowedRoots: pruneStructuredArtifactContainerRoots([...roots].sort((a, b) => a.length - b.length)),
  };
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
