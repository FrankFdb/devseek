import * as nodePath from 'path';
import {
  isCanonicalPathInsideRoot,
  type CodingToolSurfaceConstraint,
} from '@devseek-netai/shared';
import type { ToolRisk } from '../intent/intent-types';
import { isProjectInstructionFilePath } from '../workspace/instruction-file-safety';
import { decideToolPermission, type ToolPolicy } from './permission-service';

export interface AgentFileWriteContext {
  purpose?: 'tool-write';
  taskAction?: string;
  toolRisk?: ToolRisk;
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
    taskAction?: string;
    protectedPath: boolean;
    autopilotMode: boolean;
  };
}

/** Projects the VS Code surface decision into canonical tool authority evidence. */
export function projectAgentFileWriteConstraint(
  decision: AgentFileWriteDecision,
  confirmationRef?: string,
): CodingToolSurfaceConstraint {
  const evidenceRefs = [`vscode-file-write-policy:${decision.reason}`];
  if (decision.action === 'deny') {
    return { decision: 'deny', reason: decision.reason, evidenceRefs };
  }
  if (decision.action === 'requireConfirm') {
    const settledRef = confirmationRef?.trim();
    return {
      decision: 'require-confirmation',
      reason: decision.reason,
      ...(settledRef ? { confirmationRef: settledRef } : {}),
      evidenceRefs,
    };
  }
  return { decision: 'allow', reason: decision.reason, evidenceRefs };
}

const SENSITIVE_FILE_RE = /^(\.env(?:\.|$))|.*\.(?:pem|key|p12|pfx|crt|cer|jks|keystore|secret|credentials|token|passwd|password)$/i;

export function decideAgentFileWrite(input: AgentFileWriteDecisionInput): AgentFileWriteDecision {
  const rawPath = String(input.absPath || '').trim();
  const rawWorkspaceRoot = String(input.workspaceRoot || '').trim();
  const absPath = rawPath ? nodePath.normalize(rawPath) : '';
  const workspaceRoot = rawWorkspaceRoot ? nodePath.normalize(rawWorkspaceRoot) : '';
  const relPath = displayWritePath(absPath, workspaceRoot, input.context?.displayName);
  const audit: NonNullable<AgentFileWriteDecision['audit']> = {
    absPath,
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(input.toolPolicy?.mode ? { toolPolicyMode: input.toolPolicy.mode } : {}),
    ...(input.context?.taskAction ? { taskAction: input.context.taskAction } : {}),
    protectedPath: input.protectedPath === true,
    autopilotMode: input.autopilotMode === true,
  };

  if (!absPath || !nodePath.isAbsolute(absPath)) {
    return deny('invalid-target-path', '缺少可验证的绝对写入路径。', audit);
  }
  if (!workspaceRoot || !nodePath.isAbsolute(workspaceRoot)) {
    return deny('missing-workspace-root', '缺少可验证的 workspace 根目录，已停止写入。', audit);
  }
  if (!isInsidePath(absPath, workspaceRoot) || !isCanonicalPathInsideRoot(absPath, workspaceRoot)) {
    return deny('target-outside-workspace', `写入目标不在当前 workspace 内：${relPath}`, audit);
  }
  if (input.protectedPath) {
    return deny('protected-files-match', `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）`, audit);
  }
  if (!input.toolPolicy) {
    return deny('missing-tool-policy', '缺少工具权限策略，已停止写入。', audit);
  }

  const permission = decideToolPermission(input.toolPolicy, {
    kind: 'edit',
    risk: input.context?.toolRisk,
    mutatesWorkspace: true,
    protectedPath: input.protectedPath,
  });
  if (permission.action === 'deny') {
    return deny(
      permission.reason,
      `当前 ${input.toolPolicy.mode} 模式不允许写入文件（${permission.reason}）。`,
      audit,
    );
  }
  if (permission.action === 'requireConfirm') {
    return {
      action: 'requireConfirm',
      reason: permission.reason,
      confirmationTitle: `确认写入文件：${relPath}`,
      audit,
    };
  }
  if (!input.autopilotMode && isProjectInstructionFilePath(relPath)) {
    return {
      action: 'requireConfirm',
      reason: 'project-instruction-file-requires-confirmation',
      confirmationTitle: `确认写入项目指令文件：${relPath}`,
      audit,
    };
  }
  if (!input.autopilotMode && SENSITIVE_FILE_RE.test(nodePath.basename(absPath))) {
    return {
      action: 'requireConfirm',
      reason: 'sensitive-file-requires-confirmation',
      confirmationTitle: `确认写入敏感文件：${relPath}`,
      audit,
    };
  }
  return { action: 'allow', reason: 'workspace-write-allowed', audit };
}

function deny(
  reason: string,
  notice: string,
  audit: NonNullable<AgentFileWriteDecision['audit']>,
): AgentFileWriteDecision {
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
