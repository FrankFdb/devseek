import type { ToolFailureEvidence } from './tool-loop';

export interface ToolFailureRoundResult {
  warnings: string[];
  stopReason?: string;
}

export interface ToolFailureRecoveryOptions {
  warnAfterRounds?: number;
  stopAfterRounds?: number;
}

interface FailureRoundState {
  rounds: number;
  failure: ToolFailureEvidence;
}

const DEFAULT_WARN_AFTER_ROUNDS = 2;
const DEFAULT_STOP_AFTER_ROUNDS = 4;

/**
 * Tracks failed mutation strategies by agent round. Multiple malformed calls in
 * one provider response are one failed strategy, not four independent rounds.
 */
export class ToolFailureRecoveryLedger {
  private readonly failures = new Map<string, FailureRoundState>();
  private readonly warnAfterRounds: number;
  private readonly stopAfterRounds: number;

  constructor(options: ToolFailureRecoveryOptions = {}) {
    this.warnAfterRounds = options.warnAfterRounds ?? DEFAULT_WARN_AFTER_ROUNDS;
    this.stopAfterRounds = options.stopAfterRounds ?? DEFAULT_STOP_AFTER_ROUNDS;
  }

  recordRound(failures: readonly ToolFailureEvidence[]): ToolFailureRoundResult {
    const grouped = new Map<string, { failure: ToolFailureEvidence; occurrences: number }>();
    for (const failure of failures) {
      const signature = makeToolFailureSignature(failure);
      const existing = grouped.get(signature);
      if (existing) existing.occurrences += 1;
      else grouped.set(signature, { failure, occurrences: 1 });
    }

    const warnings: string[] = [];
    let stopReason: string | undefined;
    for (const [signature, current] of grouped) {
      const previous = this.failures.get(signature);
      const rounds = (previous?.rounds ?? 0) + 1;
      this.failures.set(signature, { rounds, failure: current.failure });

      if (current.occurrences > 1 || rounds >= this.warnAfterRounds) {
        warnings.push(buildRepeatedToolFailureFeedback(
          current.failure,
          rounds,
          current.occurrences,
        ));
      }
      if (!stopReason && rounds >= this.stopAfterRounds) {
        stopReason = describeRepeatedToolFailureStop(current.failure, rounds);
      }
    }
    return { warnings, stopReason };
  }

  clearForWrittenPaths(paths: readonly string[]): void {
    const normalizedPaths = paths.map(normalizeToolFailurePath).filter(Boolean);
    if (normalizedPaths.length === 0) return;
    for (const [signature, state] of this.failures) {
      const failurePath = normalizeToolFailurePath(state.failure.path);
      if (failurePath && normalizedPaths.includes(failurePath)) {
        this.failures.delete(signature);
      }
    }
  }
}

function normalizeToolFailurePath(pathValue: string | undefined): string {
  return (pathValue || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function makeToolFailureSignature(failure: ToolFailureEvidence): string {
  return [
    failure.tool,
    failure.kind,
    normalizeToolFailurePath(failure.path),
    failure.reason.slice(0, 220),
  ].join('::');
}

function describeToolFailureTarget(failure: ToolFailureEvidence): string {
  return failure.path ? `${failure.tool}(${failure.path})` : failure.tool;
}

function buildRepeatedToolFailureFeedback(
  failure: ToolFailureEvidence,
  rounds: number,
  occurrences: number,
): string {
  const target = describeToolFailureTarget(failure);
  const strategy = failure.kind === 'replace'
    ? '当前文件快照已随工具结果返回。请基于最新内容给出精确 old_str/new_str；若结构变化较大，改用 write_file 完整重写，不能复用过期片段。'
    : failure.kind === 'terminal-guard'
      ? 'run_terminal 只用于查询、编译、运行和测试。创建、修改或删除文件必须使用 create_file/write_file/replace_in_file/delete_file。'
      : '不要重复提交同一份损坏内容。请缩小写入范围，保持源码真实换行，并先修复写入完整性问题再验证。';
  return [
    `【系统反馈】同一工具策略已连续失败 ${rounds} 轮：${target}`,
    occurrences > 1 ? `本轮同类失败调用 ${occurrences} 次，已按一次失败策略结算。` : '',
    `失败原因：${failure.reason}`,
    strategy,
    '下一轮必须改变参数或工具策略；如果无法继续推进，请明确报告阻塞，不能 task_complete。',
  ].filter(Boolean).join('\n');
}

function describeRepeatedToolFailureStop(failure: ToolFailureEvidence, rounds: number): string {
  return `同一工具策略连续 ${rounds} 轮失败且无有效恢复：${describeToolFailureTarget(failure)}；${failure.reason}`;
}
