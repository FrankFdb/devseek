import { projectActionableDiagnosticExcerpt } from '../app/diagnostic-output-projection';
import type { TerminalEvidence } from './completion-evidence';

export type TerminalFailureRepairPhase = 'repair' | 'rerun';

/**
 * Projects one active validation failure into a bounded model instruction.
 * The model still chooses the concrete edit; the host only preserves evidence,
 * scope, and the public command that must settle the failure.
 */
export function buildTerminalFailureRepairFeedback(
  failure: TerminalEvidence,
  missing: readonly string[],
  phase: TerminalFailureRepairPhase = 'repair',
): string {
  const diagnostic = failure.detail
    ? projectActionableDiagnosticExcerpt(failure.detail, 1800)
    : '';
  const nextAction = phase === 'rerun'
    ? [
      '当前轮已经产生文件修改。下一步先原样重跑上面的失败命令，确认修改是否清除了活动失败。',
      '不得用 grep/head/tail/sed/awk 等输出过滤管道替代公开验证入口；过滤结果只能补充诊断，不能作为通过证据。',
    ]
    : [
      '该活动失败是下一轮最高优先级。根据最新诊断做一个最小修复动作，不得重新规划任务或横向探索无关文件/API。',
      '若缺少当前源码，只精确读取一个相关文件或行范围；已有最新快照时直接提交一个最小写入。修改后原样重跑失败命令。',
    ];
  return [
    '【系统反馈】当前终端验证仍未通过，不能结束任务或转移到其他工作。',
    missing.length > 0 ? `尚缺证据: ${missing.join('、')}` : '',
    `公开失败命令: ${failure.command}`,
    `exitCode: ${failure.exitCode ?? 'unknown'}`,
    diagnostic ? `最新诊断:\n${diagnostic}` : '',
    '',
    ...nextAction,
  ].filter(Boolean).join('\n');
}
