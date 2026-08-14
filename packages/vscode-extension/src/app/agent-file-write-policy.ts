import * as nodePath from 'path';
import type { CodingToolSurfaceConstraint } from '@devseek-netai/shared';
import { authorizeAgentFileWriteContract } from '../agent/task-contract';
import {
  detectIsolatedArtifactWriteScope,
  isTargetExactIsolatedArtifactWriteScope,
  isTargetInsideIsolatedArtifactWriteScope,
} from '../agent/isolated-artifact-write-scope';
import { isCanonicalPathInsideRoot } from '../workspace/path-containment';
import type { ToolPolicy } from './permission-service';
import { decideToolPermission } from './permission-service';
import type { ToolRisk } from '../intent/intent-types';

export { detectIsolatedArtifactWriteScope };
export type { IsolatedArtifactWriteScope } from '../agent/isolated-artifact-write-scope';

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
  toolRisk?: ToolRisk;
  displayName?: string;
  requestPrompt?: string;
  semanticIntent?: {
    mutationRequested?: boolean;
    mutationProhibited?: boolean;
    sourceChange?: boolean;
    fileArtifact?: boolean;
    targets?: readonly string[];
    signals?: readonly string[];
  };
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
    markdownArtifactWriteAllowed?: boolean;
    markdownArtifactWriteReason?: string;
    markdownArtifactRequestedTargets?: string[];
    semanticWriteAllowed?: boolean;
    semanticWriteReason?: string;
    isolatedArtifactScopeRequired?: boolean;
    isolatedArtifactAllowedRoots?: string[];
  };
}

/**
 * Projects product policy into the only authority contribution a VS Code
 * Surface is allowed to make. A real confirmation reference can only be added
 * by the interaction owner after the user accepts the prompt.
 */
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

/** Surface-only preflight for legacy deterministic paths that do not invoke a tool host. */
export function isAgentFileWriteConstraintSatisfied(
  constraint: CodingToolSurfaceConstraint,
): boolean {
  return constraint.decision === 'allow'
    || (constraint.decision === 'require-confirmation' && Boolean(constraint.confirmationRef?.trim()));
}

const SENSITIVE_FILE_RE = /^(\.env(\.|$))|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|secret|credentials|token|passwd|password)$/i;

export function decideAgentFileWrite(input: AgentFileWriteDecisionInput): AgentFileWriteDecision {
  const absPath = nodePath.normalize(String(input.absPath || '').trim());
  const workspaceRoot = input.workspaceRoot ? nodePath.normalize(input.workspaceRoot) : '';
  const relPath = displayWritePath(absPath, workspaceRoot, input.context?.displayName);
  const explicitMarkdownDeliverable = isExplicitMarkdownDeliverable(input.context, absPath);
  const isolatedScope = detectIsolatedArtifactWriteScope(input.context?.requestPrompt, workspaceRoot);
  const targetInsideIsolatedScope = isTargetInsideIsolatedArtifactWriteScope(
    input.context?.requestPrompt,
    absPath,
    workspaceRoot || undefined,
  );
  const targetExactIsolatedScope = isTargetExactIsolatedArtifactWriteScope(
    input.context?.requestPrompt,
    absPath,
    workspaceRoot || undefined,
  );
  const semanticAuthorization = resolveSemanticFileWriteAuthorization({
    absPath,
    workspaceRoot,
    context: input.context,
  });
  const modelLedActionProposal = input.toolPolicy?.mode === 'model-led';
  const markdownAuthorization = authorizeAgentFileWriteContract({
    promptText: input.context?.requestPrompt || '',
    targetPath: absPath,
    workspaceRoot: workspaceRoot || undefined,
    allowImplicitPrimaryArtifact: input.context?.purpose === 'markdown-deliverable'
      && input.context?.userRequested === true,
    allowScopedSourceArtifact: targetInsideIsolatedScope,
    allowExactScopedArtifact: targetExactIsolatedScope,
    targetKind: isDirectoryWriteAction(input.context?.taskAction) ? 'directory' : 'file',
    writeAction: input.context?.taskAction,
  });
  const audit = {
    absPath,
    workspaceRoot: workspaceRoot || undefined,
    toolPolicyMode: input.toolPolicy?.mode,
    purpose: input.context?.purpose,
    userRequested: input.context?.userRequested,
    protectedPath: !!input.protectedPath,
    autopilotMode: !!input.autopilotMode,
    explicitMarkdownDeliverable,
    markdownArtifactWriteAllowed: modelLedActionProposal || markdownAuthorization.allowed || semanticAuthorization.allowed,
    markdownArtifactWriteReason: markdownAuthorization.reason,
    markdownArtifactRequestedTargets: markdownAuthorization.requestedTargets.length > 0
      ? markdownAuthorization.requestedTargets
      : undefined,
    semanticWriteAllowed: modelLedActionProposal || semanticAuthorization.allowed || undefined,
    semanticWriteReason: modelLedActionProposal ? 'model-led-action-proposal' : semanticAuthorization.reason,
  };
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
  if (isolatedScope.required && isolatedScope.allowedRoots.length === 0) {
    return deny(
      'invalid-isolated-artifact-scope',
      '本次请求要求隔离新增产物，但未能解析出可验证的输出目录；为避免写入正式源码或未授权位置，已停止写入。',
      scopedAudit,
    );
  }
  if (isolatedScope.required && isolatedScope.allowedRoots.length > 0 && !targetInsideIsolatedScope) {
    return deny(
      'isolated-artifact-scope',
      `写入被测试/交付产物隔离规则阻止：${relPath}。本次请求要求新增产物只能写入 ${isolatedScope.allowedRoots.map(root => displayWritePath(root, workspaceRoot)).join('、')}；正式源码修改请写入“原有代码修改清单”，不要直接改正式源码。`,
      scopedAudit,
    );
  }
  if (!modelLedActionProposal && !markdownAuthorization.allowed && !semanticAuthorization.allowed) {
    const targetList = markdownAuthorization.requestedTargets.length > 0
      ? `；用户明确允许的 Markdown 目标为 ${markdownAuthorization.requestedTargets.join('、')}`
      : '';
    return deny(
      markdownAuthorization.reason || 'markdown-artifact-write-prohibited',
      `文件写入不符合当前用户请求：${relPath}${targetList}。`,
      scopedAudit,
    );
  }
  if (input.protectedPath) {
    return deny('protected-files-match', `已跳过受保护文件：${relPath}（匹配 devseek.protectedFiles 规则）`, scopedAudit);
  }
  if (input.toolPolicy) {
    const writePermission = decideToolPermission(input.toolPolicy, {
      kind: 'edit',
      risk: input.context?.toolRisk,
      mutatesWorkspace: true,
      protectedPath: input.protectedPath,
    });
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
    && ['.md', '.markdown'].includes(nodePath.extname(absPath).toLowerCase());
}

function resolveSemanticFileWriteAuthorization(input: {
  absPath: string;
  workspaceRoot: string;
  context?: AgentFileWriteContext;
}): { allowed: boolean; reason?: string } {
  const semantic = input.context?.semanticIntent;
  if (!semantic?.mutationRequested || semantic.mutationProhibited) return { allowed: false };
  if (!semantic.sourceChange && !semantic.fileArtifact) return { allowed: false };
  if (!semantic.signals?.includes('prior-task-continuation-request')) return { allowed: false };

  const absPath = nodePath.normalize(input.absPath);
  const targets = Array.isArray(semantic.targets) ? semantic.targets : [];
  const matched = targets.some(target => {
    const raw = String(target || '').trim();
    if (!raw) return false;
    const candidate = nodePath.normalize(nodePath.isAbsolute(raw)
      ? raw
      : nodePath.resolve(input.workspaceRoot || process.cwd(), raw));
    return candidate === absPath;
  });
  return matched
    ? { allowed: true, reason: 'semantic-prior-task-continuation-target' }
    : { allowed: false, reason: 'semantic-prior-task-continuation-target-mismatch' };
}

function isDirectoryWriteAction(taskAction: string | undefined): boolean {
  return /^(?:create[_-]?directory|mkdir|make[_-]?(?:directory|folder))$/i.test(String(taskAction || '').trim());
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

function isFormalSourceDirectoryTarget(absPath: string, workspaceRoot: string): boolean {
  const relative = workspaceRoot
    ? nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/')
    : nodePath.normalize(absPath).replace(/\\/g, '/').replace(/^\/+/, '');
  return /(?:^|\/)(?:src|source|sources|lib|app)(?:\/|$)/i.test(relative)
    || /(?:^|\/)packages\/[^/]+\/src(?:\/|$)/i.test(relative);
}
