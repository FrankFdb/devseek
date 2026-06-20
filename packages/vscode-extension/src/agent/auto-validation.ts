import * as nodePath from 'path';
import type { AgentStatusEvent } from './events';
import {
  classifyTerminalEvidenceCommand,
  type TerminalEvidence,
  type TerminalEvidenceKind,
  type WrittenFileEvidence,
} from './completion-evidence';
import { isInsideWorkspacePath } from './write-guard';
import { ValidationService, type AutoValidationResult } from '../workspace/validation-service';
import type { CppValidationPolicy } from '../validation-planner';

export interface AgentAutoValidationCallbacks {
  onAgentStatus: (status: AgentStatusEvent) => void | Promise<void>;
  onToolActivity?: (kind: 'terminal', label: string) => void;
  signal?: AbortSignal;
}

export interface AgentAutoValidationResult {
  evidence?: TerminalEvidence;
  feedbackForAI?: string;
  repairBlockedReason?: string;
  qualityGate?: {
    status: 'pass' | 'fail' | 'blocked';
    summary: string;
    risks?: string[];
    evidenceRefs?: string[];
    alternativeChecks?: string[];
    requiredActions?: string[];
  };
}

export interface AgentAutoValidationOptions {
  validationService?: Pick<ValidationService, 'validateWorkspaceChanges'>;
}

function workspaceRelativeValidationPaths(writtenFiles: WrittenFileEvidence[], workspaceRootFsPath: string): string[] {
  if (!workspaceRootFsPath) return [];
  const root = nodePath.resolve(workspaceRootFsPath);
  const seen = new Set<string>();
  const relPaths: string[] = [];
  for (const file of writtenFiles) {
    const absPath = nodePath.resolve(nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path));
    if (!isInsideWorkspacePath(absPath, root)) continue;
    const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);
    relPaths.push(relPath);
  }
  return relPaths;
}

export function validationResultToTerminalEvidence(result: AutoValidationResult): TerminalEvidence {
  const classified = classifyTerminalEvidenceCommand(result.command);
  const kind: TerminalEvidenceKind = result.mode === 'compile-run'
    ? 'compile-run'
    : result.mode === 'file-check'
      ? 'other'
    : classified !== 'other'
      ? classified
      : result.mode
        ? 'compile'
        : 'other';
  const detail = [result.reason, result.output].filter(Boolean).join('\n').slice(0, 1200);
  return {
    command: result.command,
    kind,
    ok: result.ok,
    exitCode: result.exitCode,
    ...(detail ? { detail } : {}),
  };
}

function formatAutoValidationFeedback(result: AutoValidationResult): string {
  return [
    `[auto_validation: ${result.command}]`,
    `cwd=${result.cwd}`,
    `exitCode=${result.exitCode ?? 'unknown'}`,
    result.reason ? `reason=${result.reason}` : '',
    result.output ? result.output.slice(0, 4000) : '',
    result.ok ? '' : '自动验证命令未通过，不能把编译/运行/测试标记为完成。',
  ].filter(Boolean).join('\n');
}

function formatBlockedAutoValidationFeedback(result: AutoValidationResult): string {
  return [
    '[auto_validation: blocked]',
    `reason=${result.reason ?? 'no-auto-validation-target'}`,
    result.output ? result.output.slice(0, 1600) : '',
    result.risks?.length ? `risks:\n${result.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    result.alternativeChecks?.length ? `alternativeChecks:\n${result.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    'QualityGate 阻塞：没有可自动运行的验证目标，不能把结果标记为已验证通过；不要发明 build/test 脚本或用失败命令反复修复。',
  ].filter(Boolean).join('\n');
}

function isExplicitContentWriteRequest(prompt: string): boolean {
  return /(?:内容为|内容是|写入内容|文件内容|content\s*(?:is|:|=)|with\s+content)/i.test(prompt || '');
}

function buildExactContentRepairBlockedReason(result: AutoValidationResult): string {
  return [
    '用户指定了精确文件内容，自动验证未通过；DevSeek 已保留用户指定内容，不能擅自改写为通过验证的其他内容。',
    `验证原因: ${result.reason ?? 'validation-failed'}`,
    result.command ? `验证命令: ${result.command}` : '',
    result.exitCode !== undefined ? `exitCode: ${result.exitCode ?? 'null'}` : '',
  ].filter(Boolean).join('\n');
}

function validationEvidenceRef(status: 'passed' | 'failed' | 'blocked', result: AutoValidationResult): string {
  return `validation:${status}:${result.command || result.reason || 'unknown'}`;
}

function buildAutoValidationQualityGate(result: AutoValidationResult): NonNullable<AgentAutoValidationResult['qualityGate']> {
  if (result.status === 'blocked' || result.ran === false) {
    return {
      status: 'blocked',
      summary: `QualityGate 阻塞：${result.reason || 'validation-blocked'}。`,
      evidenceRefs: [validationEvidenceRef('blocked', result)],
      risks: result.risks?.length
        ? result.risks
        : ['没有自动验证证据，不能证明变更后的行为正确。'],
      alternativeChecks: result.alternativeChecks?.length
        ? result.alternativeChecks
        : ['人工检查变更文件内容是否符合用户请求。'],
      requiredActions: ['补充可运行验证，或由用户明确接受剩余风险。'],
    };
  }

  if (result.ok) {
    return {
      status: 'pass',
      summary: `QualityGate 通过：${result.command || '自动验证'} 已通过。`,
      evidenceRefs: [validationEvidenceRef('passed', result)],
    };
  }

  return {
    status: 'fail',
    summary: `QualityGate 未通过：自动验证失败（exitCode=${result.exitCode ?? 'null'}）。`,
    evidenceRefs: [validationEvidenceRef('failed', result)],
    risks: [
      ...(result.risks || []),
      '自动验证命令失败，不能把任务标记为完成。',
    ],
    alternativeChecks: result.alternativeChecks || [],
    requiredActions: ['修复自动验证失败后重新运行 QualityGate。'],
  };
}

export async function runAgentAutoValidationForWrites(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
  callbacks: AgentAutoValidationCallbacks,
  cppValidationPolicy: CppValidationPolicy,
  options: AgentAutoValidationOptions = {},
): Promise<AgentAutoValidationResult> {
  const changedPaths = workspaceRelativeValidationPaths(writtenFiles, workspaceRootFsPath);
  if (changedPaths.length === 0 || callbacks.signal?.aborted) return {};

  const validationService = options.validationService ?? new ValidationService();
  try {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'started',
      title: '自动验证写入结果',
      detail: changedPaths.join('\n'),
    });
    const result = await validationService.validateWorkspaceChanges({
      rootFsPath: workspaceRootFsPath,
      changedPaths,
      requestPrompt: userPrompt,
      cppValidationPolicy,
    });
    if (!result) {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'skipped',
        title: '未识别到自动验证目标',
        detail: changedPaths.join('\n'),
      });
      return {};
    }
    if (result.status === 'blocked' || result.ran === false) {
      const feedbackForAI = formatBlockedAutoValidationFeedback(result);
      const qualityGate = buildAutoValidationQualityGate(result);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'skipped',
        title: '自动验证阻塞',
        detail: feedbackForAI.slice(0, 1200),
      });
      return { feedbackForAI, qualityGate };
    }
    callbacks.onToolActivity?.('terminal', `自动验证: ${result.command}`);
    const feedbackForAI = formatAutoValidationFeedback(result);
    const repairBlockedReason = !result.ok && isExplicitContentWriteRequest(userPrompt)
      ? buildExactContentRepairBlockedReason(result)
      : undefined;
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: result.ok ? 'completed' : 'failed',
      title: result.ok ? '自动验证通过' : '自动验证失败',
      detail: [feedbackForAI, repairBlockedReason].filter(Boolean).join('\n\n').slice(0, 1200),
    });
    return {
      evidence: validationResultToTerminalEvidence(result),
      feedbackForAI: [feedbackForAI, repairBlockedReason].filter(Boolean).join('\n\n'),
      repairBlockedReason,
      qualityGate: buildAutoValidationQualityGate(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'failed',
      title: '自动验证异常',
      detail: message,
    });
    return {
      evidence: {
        command: 'automatic workspace validation',
        kind: 'other',
        ok: false,
        exitCode: null,
        detail: `自动验证异常：${message}`,
      },
      feedbackForAI: `自动验证异常：${message}\n自动验证命令未通过，不能把编译/运行/测试标记为完成。`,
    };
  }
}
