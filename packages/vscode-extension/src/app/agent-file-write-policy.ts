import * as nodePath from 'path';
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

  if (!absPath) {
    return deny('missing-target-path', '缺少可写入的目标路径。', audit);
  }
  if (workspaceRoot && !isInsidePath(absPath, workspaceRoot)) {
    return deny('target-outside-workspace', `写入目标不在当前 workspace 内：${relPath}`, audit);
  }
  if (input.protectedPath) {
    return deny('protected-files-match', `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）`, audit);
  }

  if (!explicitMarkdownDeliverable && input.toolPolicy) {
    const writePermission = decideToolPermission(input.toolPolicy, 'edit');
    if (writePermission.action === 'deny') {
      return deny(writePermission.reason, `当前 ${input.toolPolicy.mode} 模式不允许写入文件（${writePermission.reason}）。`, audit);
    }
    if (writePermission.action === 'requireConfirm') {
      return {
        action: 'requireConfirm',
        reason: writePermission.reason,
        confirmationTitle: `确认写入文件：${relPath}`,
        audit,
      };
    }
  }

  if (!input.autopilotMode && SENSITIVE_FILE_RE.test(nodePath.basename(absPath))) {
    return {
      action: 'requireConfirm',
      reason: 'sensitive-file-requires-confirmation',
      confirmationTitle: `⚠️ 写入敏感文件：${relPath}`,
      audit,
    };
  }

  return {
    action: 'allow',
    reason: explicitMarkdownDeliverable ? 'explicit-markdown-deliverable' : 'workspace-write-allowed',
    audit,
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
