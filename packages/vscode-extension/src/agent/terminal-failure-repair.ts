import { projectActionableDiagnosticExcerpt } from '../app/diagnostic-output-projection';
import type { TerminalEvidence } from './completion-evidence';

export type TerminalFailureRepairPhase = 'investigate' | 'repair' | 'rerun';

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
  const nextAction = phase === 'investigate'
    ? [
      '当前连续修复没有改变核心失败，先前假设已被公开验证证伪。下一轮只做精确的只读根因取证，不得继续写入或重复验证。',
      '优先检查相关源码、接口契约、系统头文件/文档、运行时元数据或新的诊断；取得真实观察结果后，再提出一个因果上不同的修复动作。',
    ]
    : phase === 'rerun'
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
    '验证诊断是当前实现的观测证据，不是新的产品需求。修复必须同时保持原始用户约束、行为契约和现有架构边界。',
    '不得为了单一阈值、快照统计或测试计数制造无语义分支、数据、绘制、延迟或重复逻辑，也不得降低断言或修改受保护测试来过关。',
    '若公开验证与原始需求冲突，先用针对性语义 probe 证明冲突，再修复验证契约或报告阻塞；不能用污染生产实现换取绿色结果。',
    ...nextAction,
  ].filter(Boolean).join('\n');
}
