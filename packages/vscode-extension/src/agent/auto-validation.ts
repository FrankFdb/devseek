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
    callbacks.onToolActivity?.('terminal', `自动验证: ${result.command}`);
    const feedbackForAI = formatAutoValidationFeedback(result);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: result.ok ? 'completed' : 'failed',
      title: result.ok ? '自动验证通过' : '自动验证失败',
      detail: feedbackForAI.slice(0, 1200),
    });
    return {
      evidence: validationResultToTerminalEvidence(result),
      feedbackForAI,
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
