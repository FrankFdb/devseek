import type { ApplyWorkflowResult } from '../workspace-applier';
import {
  decideBoundedRepairProgress,
  decideClosedLoopRepairability,
} from './bounded-repair-policy';

export type RepairValidationEvidence = NonNullable<ApplyWorkflowResult['validation']>;

export interface BuildRepairPromptInput {
  originalPrompt: string;
  changedPaths: string[];
  validation: RepairValidationEvidence;
  round: number;
  priorRepairRejection?: string;
  failureFiles?: string[];
}

export type RepairProgressDecision =
  | { kind: 'progressing' }
  | {
      kind: 'retry-with-root-cause';
      title: string;
      rejection: string;
      repeatedRepairAttempt: boolean;
      stagnantFailureRounds: number;
    }
  | {
      kind: 'stop-no-progress';
      title: string;
      detail: string;
      repeatedRepairAttempt: boolean;
      stagnantFailureRounds: number;
    };

export class AgenticRepairService {
  private lastFailureSignature: string;
  private stagnantFailureRounds = 0;
  private readonly seenRepairAttemptSignatures = new Set<string>();

  constructor(initialApply: ApplyWorkflowResult) {
    this.lastFailureSignature = buildValidationFailureSignature(
      initialApply.validation,
      initialApply.review?.validation.failureFiles ?? [],
    );
  }

  buildRepairPrompt(input: BuildRepairPromptInput): string {
    return buildRepairPrompt(input);
  }

  buildTruncatingOverwriteRepairRejection(
    failedApply: ApplyWorkflowResult,
    validation: Pick<RepairValidationEvidence, 'command' | 'exitCode'>,
  ): string {
    return buildTruncatingOverwriteRepairRejection(failedApply, validation);
  }

  buildStatusOkRejection(validation: Pick<RepairValidationEvidence, 'command' | 'exitCode'>): string {
    return [
      '上一轮 DeepSeek 只返回 STATUS: OK 或“无需修改”，但 DevSeek 本地验证仍是失败状态。',
      `失败命令: ${validation.command}`,
      `exitCode: ${validation.exitCode ?? 'null'}`,
      '请不要再自判 OK；必须输出至少一个可应用的文件变更，或输出 STATUS: NG。',
    ].join('\n');
  }

  evaluateAppliedRepair(result: ApplyWorkflowResult, canContinue: boolean): RepairProgressDecision {
    const repairAttemptSignature = buildRepairAttemptSignature(result);
    const repeatedRepairAttempt = repairAttemptSignature !== '' && this.seenRepairAttemptSignatures.has(repairAttemptSignature);
    if (repairAttemptSignature) {
      this.seenRepairAttemptSignatures.add(repairAttemptSignature);
    }

    const validation = result.validation;
    if (!validation || validation.ok) {
      return { kind: 'progressing' };
    }

    const nextFailureSignature = buildValidationFailureSignature(
      validation,
      result.review?.validation.failureFiles ?? [],
    );
    if (nextFailureSignature && nextFailureSignature === this.lastFailureSignature) {
      this.stagnantFailureRounds += 1;
    } else {
      this.stagnantFailureRounds = 0;
    }
    if (nextFailureSignature) {
      this.lastFailureSignature = nextFailureSignature;
    }

    const progressDecision = decideBoundedRepairProgress({
      validationFailed: true,
      canContinue,
      repeatedRepairAttempt,
      stagnantFailureRounds: this.stagnantFailureRounds,
    });

    if (progressDecision.kind === 'stop-no-progress') {
      return {
        kind: 'stop-no-progress',
        title: '自动修正无进展，已停止重复修复',
        detail: buildNoProgressRepairDetail(result, validation, repeatedRepairAttempt),
        repeatedRepairAttempt: progressDecision.repeatedRepairAttempt,
        stagnantFailureRounds: progressDecision.stagnantFailureRounds,
      };
    }

    if (progressDecision.kind === 'retry-with-root-cause') {
      return {
        kind: 'retry-with-root-cause',
        title: '检测到修复无进展，要求重新定位根因',
        rejection: buildNoProgressRepairRejection(result, validation, repeatedRepairAttempt),
        repeatedRepairAttempt: progressDecision.repeatedRepairAttempt,
        stagnantFailureRounds: progressDecision.stagnantFailureRounds,
      };
    }

    return { kind: 'progressing' };
  }
}

export function buildRepairPrompt(input: BuildRepairPromptInput): string {
  const paths = input.changedPaths.length > 0 ? input.changedPaths.join('\n') : '（未知）';
  const uniqueFailureFiles = [...new Set(input.failureFiles ?? [])];
  const failurePathText = uniqueFailureFiles.length > 0 ? uniqueFailureFiles.join('\n') : '（未从验证输出提取到明确文件）';
  const output = (input.validation.output || '').trim().slice(0, 6000);
  return [
    '你是一个严格执行修复闭环的高级编程助手。',
    `这是第 ${input.round} 轮自动修复。上一次自动验证失败，请直接修复。`,
    '注意：本地验证状态为 FAILED。即使 stdout 中出现成功文本，或旧日志里出现 exitCode=0，也不能把本轮判定为 OK；验证是否通过只由 DevSeek 下一轮本地命令决定。',
    input.priorRepairRejection ? `\n上一轮无效修复反馈：\n${input.priorRepairRejection}` : '',
    '',
    '原始需求：',
    input.originalPrompt,
    '',
    '已落地文件：',
    paths,
    '',
    '验证失败涉及文件：',
    failurePathText,
    '',
    `自动验证命令（cwd=${input.validation.cwd}）：`,
    input.validation.command,
    '',
    `验证状态：FAILED${input.validation.mode ? ` mode=${input.validation.mode}` : ''}${input.validation.reason ? ` reason=${input.validation.reason}` : ''}`,
    `验证结果：exitCode=${input.validation.exitCode ?? 'null'}`,
    '```text',
    output || '（无输出）',
    '```',
    '',
    '请只输出可直接应用的文件变更，不要解释。',
    '输出格式要求：',
    '1. 多文件时，按“文件 1：path/to/file.ext”+ 对应代码块 输出。',
    '2. 不要输出目录树、流程图、编译命令说明。',
    '3. 当前本地验证已失败，禁止只输出 STATUS: OK 或“无需修改”。',
    '4. 对已存在文件，尤其 CMakeLists.txt/构建文件，优先输出 unified diff；禁止用缩略内容覆盖整文件。',
    '5. 若上一轮反馈包含“疑似截断覆盖”，本轮只能输出 unified diff。',
    '6. 若上一轮反馈包含“无进展”，必须改变定位策略：优先修复“验证失败涉及文件”，不要重复输出同一文件的同一类改动。',
    '7. 若能修复，已有文件必须输出可应用补丁；新增文件才可以输出完整源码。',
    '8. 若无法修复，在末尾单独输出一行：STATUS: NG',
  ].join('\n');
}

export function buildValidationFailureSignature(
  validation: ApplyWorkflowResult['validation'] | undefined,
  failureFiles: string[],
): string {
  if (!validation || validation.ok) return '';
  const primary = fingerprintValidationOutput(validation.output || '');
  const fallback = (validation.output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join('|')
    .slice(0, 220)
    .toLowerCase();
  return [
    validation.command || '',
    validation.exitCode ?? 'null',
    [...new Set(failureFiles)].sort().join(','),
    primary || fallback,
  ].join('\0');
}

export function buildRepairAttemptSignature(result: ApplyWorkflowResult): string {
  const files = result.review?.files;
  return [
    result.changedPaths.slice().sort().join(','),
    files?.total ?? result.changeCount,
    files?.creates ?? '',
    files?.overwrites ?? '',
    files?.patches ?? '',
  ].join('\0');
}

export function buildTruncatingOverwriteRepairRejection(
  failedApply: ApplyWorkflowResult,
  validation: Pick<RepairValidationEvidence, 'command' | 'exitCode'>,
): string {
  return [
    '上一轮修复被 DevSeek 安全拦截：疑似截断覆盖已有文件。',
    failedApply.failureDetail ? `拦截详情：${failedApply.failureDetail}` : '',
    failedApply.blockedChangePaths?.length ? `被拦截文件：${failedApply.blockedChangePaths.join(', ')}` : '',
    `失败命令仍需修复：${validation.command}`,
    `exitCode: ${validation.exitCode ?? 'null'}`,
    '下一轮必须输出 unified diff，保留现有未相关内容；不要输出缩略版整文件或完整 CMakeLists.txt。',
  ].filter(Boolean).join('\n');
}

export function responseClaimsStatusOk(text: string): boolean {
  return /(?:^|\n)\s*STATUS\s*:\s*OK\s*(?:\n|$)/i.test(text || '');
}

export function shouldRunClosedLoopRepair(result: ApplyWorkflowResult): boolean {
  return decideClosedLoopRepairability(result).repairable;
}

function buildNoProgressRepairRejection(
  result: ApplyWorkflowResult,
  validation: RepairValidationEvidence,
  repeatedRepairAttempt: boolean,
): string {
  return [
    '上一轮修复后，本地验证错误没有变化，DevSeek 判定为无进展。',
    repeatedRepairAttempt ? '本轮修复还疑似重复修改了同一批文件。' : '',
    result.review?.validation.failureFiles.length
      ? `失败涉及文件：${result.review.validation.failureFiles.join(', ')}`
      : '',
    `失败命令：${validation.command}`,
    `exitCode: ${validation.exitCode ?? 'null'}`,
    '下一轮必须重新定位根因，优先修复验证失败涉及文件；不要重复输出同一文件的同一类改动。',
  ].filter(Boolean).join('\n');
}

function buildNoProgressRepairDetail(
  result: ApplyWorkflowResult,
  validation: RepairValidationEvidence,
  repeatedRepairAttempt: boolean,
): string {
  return [
    buildNoProgressRepairRejection(result, validation, repeatedRepairAttempt),
    '',
    '已停止继续自动修复，避免反复应用无效补丁。',
    '建议切换到 Agent 模式读取相关源码/构建文件后重新定位，或提供更具体的首个编译错误。',
  ].join('\n');
}

function fingerprintValidationOutput(errorText: string): string {
  const lines = errorText
    .split('\n')
    .map(line => line.trim())
    .filter(line => /error:|fatal:|undefined reference|cannot find|no such file|linker|ld returned/i.test(line))
    .slice(0, 3);
  return lines.join('|').slice(0, 120).toLowerCase();
}
