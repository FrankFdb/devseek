import * as vscode from 'vscode';
import { emitLearningEvent, fingerprintError } from '../agent-learner';
import {
  applyGeneratedArtifactsWithPrompt,
  type AppliedChangeRecord,
  type ApplyWorkflowResult,
  type ApplyWorkflowStatus,
} from '../workspace-applier';
import { AgenticRepairService } from './agentic-repair-service';
import { askRepairExhaustedAction, requestManualFixGuidance } from './repair-exhaustion-interaction';
import type { ValidationCommandRunner } from '../workspace/validation-service';

export interface ClosedLoopRepairRouteChatOptions {
  prompt: string;
  newSession?: boolean;
  mode?: 'fast' | 'r1';
  stream?: boolean;
  onDelta?: (delta: string) => void;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  traceEvidenceParticipantToken?: string;
  onTraceEvidenceError?: (error: unknown) => void;
}

export interface RunClosedLoopRepairInput {
  reporter: (status: ApplyWorkflowStatus) => Promise<void>;
  originalPrompt: string;
  mode: 'fast' | 'r1' | undefined;
  initialApply: ApplyWorkflowResult;
  preferredAbsolutePaths: string[];
  routeChat: (opts: ClosedLoopRepairRouteChatOptions) => Promise<string>;
  registerAppliedChange: (change: AppliedChangeRecord) => Promise<void>;
  getSessionId: () => string;
  postVisibleDelta: (text: string) => void;
  validationCommandRunner: ValidationCommandRunner;
}

export async function runClosedLoopRepair(input: RunClosedLoopRepairInput): Promise<void> {
  const config = vscode.workspace.getConfiguration('devseek');
  let maxRounds = Math.max(0, Math.min(6, config.get<number>('autoFixRounds', 6)));
  let current = input.initialApply;
  let priorRepairRejection = '';
  const repairService = new AgenticRepairService(input.initialApply);

  for (let round = 1; round <= maxRounds; round += 1) {
    const validation = current.validation;
    if (!validation || validation.ok) {
      if (validation?.ok) {
        await input.reporter({
          phase: 'repair',
          state: 'completed',
          title: '闭环修正完成（OK）',
          detail: `第 ${round - 1} 轮修正后通过自动验证。`,
        });
        emitLearningEvent({
          type: 'error_fixed',
          errorFingerprint: fingerprintError(validation.output ?? ''),
          fixSummary: `round=${round - 1} cmd=${validation.command}`,
          sessionId: input.getSessionId(),
        });
      }
      return;
    }

    await input.reporter({
      phase: 'repair',
      state: 'started',
      title: `第 ${round} 轮自动修正`,
      detail: `基于验证失败结果回传 DeepSeek：\n命令: ${validation.command}\nexitCode: ${validation.exitCode ?? 'null'}`,
    });

    const repairPrompt = repairService.buildRepairPrompt({
      originalPrompt: input.originalPrompt,
      changedPaths: current.changedPaths,
      validation,
      round,
      priorRepairRejection,
      failureFiles: current.review?.validation.failureFiles ?? [],
    });
    priorRepairRejection = '';

    let repairResponse = '';
    let resetNoticeSent = false;
    try {
      repairResponse = await input.routeChat({
        prompt: repairPrompt,
        newSession: false,
        mode: input.mode,
        onDelta: (delta) => {
          if (delta.startsWith('\x00RESET\x00') && !resetNoticeSent) {
            resetNoticeSent = true;
            input.postVisibleDelta('\n\n[自动修正] 已收到修正草案，正在安全解析并应用。\n');
          }
        },
      });
    } catch (error) {
      await input.reporter({
        phase: 'repair',
        state: 'failed',
        title: '自动修正请求失败',
        detail: (error as Error).message,
      });
      return;
    }

    const repairApply = await applyGeneratedArtifactsWithPrompt(
      repairResponse,
      repairPrompt,
      input.reporter,
      true,
      input.registerAppliedChange,
      input.preferredAbsolutePaths,
      {
        rollbackOnValidationFailure: false,
        validationCommandRunner: input.validationCommandRunner,
      },
    );
    if (!repairApply.applied) {
      if (repairApply.failureReason === 'truncating-overwrite') {
        priorRepairRejection = repairService.buildTruncatingOverwriteRepairRejection(repairApply, validation);
        if (round < maxRounds) {
          await input.reporter({
            phase: 'repair',
            state: 'started',
            title: '已拒绝截断覆盖修复，重新要求最小补丁',
            detail: priorRepairRejection,
          });
          continue;
        }
        await input.reporter({
          phase: 'repair',
          state: 'failed',
          title: '自动修正被安全拦截',
          detail: priorRepairRejection,
        });
        return;
      }
      await input.reporter({
        phase: 'repair',
        state: 'failed',
        title: '自动修正未产生可应用改动',
        detail: 'DeepSeek 回复未包含可解析的文件变更，请手动调整提示词。',
      });
      return;
    }
    current = repairApply;

    const progressDecision = repairService.evaluateAppliedRepair(current, round < maxRounds);
    if (progressDecision.kind === 'stop-no-progress') {
      await input.reporter({
        phase: 'repair',
        state: 'failed',
        title: progressDecision.title,
        detail: progressDecision.detail,
      });
      return;
    }
    if (progressDecision.kind === 'retry-with-root-cause') {
      priorRepairRejection = progressDecision.rejection;
      await input.reporter({
        phase: 'repair',
        state: 'started',
        title: progressDecision.title,
        detail: priorRepairRejection,
      });
      continue;
    }

    if (round >= maxRounds) {
      const validationNow = current.validation;
      if (validationNow && !validationNow.ok) {
        const action = await askRepairExhaustedAction('自动修复达到上限', `已执行 ${maxRounds} 轮自动修复，仍未通过验证。`);
        if (action === 'continue') {
          maxRounds += 3;
          await input.reporter({
            phase: 'repair',
            state: 'started',
            title: '用户选择继续修复',
            detail: `修复上限已扩展到 ${maxRounds} 轮。`,
          });
          continue;
        }

        if (action === 'guide') {
          const guidance = await requestManualFixGuidance(input.routeChat, input.originalPrompt, validationNow.command, validationNow.output);
          input.postVisibleDelta(`\n\n[手动修复建议]\n${guidance}\n`);
        }
      }
    }
  }

  const finalValidation = current.validation;
  if (finalValidation && !finalValidation.ok) {
    await input.reporter({
      phase: 'repair',
      state: 'failed',
      title: '闭环修正结束（NG）',
      detail: `达到最大修正轮次后仍未通过。\n命令: ${finalValidation.command}\nexitCode: ${finalValidation.exitCode ?? 'null'}\n${finalValidation.output.slice(0, 1000)}`,
    });
  }
}
