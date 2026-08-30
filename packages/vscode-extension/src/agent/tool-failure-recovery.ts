import * as nodePath from 'path';
import type { ToolFailureEvidence } from './tool-loop-result';

export interface ToolFailureRoundResult {
  warnings: string[];
  stopReason?: string;
}

export interface ToolFailureRecoveryOptions {
  warnAfterRounds?: number;
  stopAfterRounds?: number;
  workspaceRoot?: string;
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
  private readonly pendingContextRefreshPaths = new Set<string>();
  private pendingMutationRepair = false;
  private readonly warnAfterRounds: number;
  private readonly stopAfterRounds: number;
  private readonly workspaceRoot?: string;

  constructor(options: ToolFailureRecoveryOptions = {}) {
    this.warnAfterRounds = options.warnAfterRounds ?? DEFAULT_WARN_AFTER_ROUNDS;
    this.stopAfterRounds = options.stopAfterRounds ?? DEFAULT_STOP_AFTER_ROUNDS;
    this.workspaceRoot = options.workspaceRoot;
  }

  recordRound(failures: readonly ToolFailureEvidence[]): ToolFailureRoundResult {
    const grouped = new Map<string, { failure: ToolFailureEvidence; occurrences: number }>();
    for (const failure of failures) {
      if (failure.kind === 'write' || failure.kind === 'replace') {
        this.pendingMutationRepair = true;
        const refreshPath = this.normalizePath(failure.path);
        if (refreshPath) this.pendingContextRefreshPaths.add(refreshPath);
      }
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
    const normalizedPaths = paths.map(pathValue => this.normalizePath(pathValue)).filter(Boolean);
    if (normalizedPaths.length === 0) return;
    this.pendingMutationRepair = false;
    for (const normalizedPath of normalizedPaths) {
      this.pendingContextRefreshPaths.delete(normalizedPath);
    }
    for (const [signature, state] of this.failures) {
      const failurePath = this.normalizePath(state.failure.path);
      if (failurePath && normalizedPaths.includes(failurePath)) {
        this.failures.delete(signature);
      }
    }
  }

  consumeContextRefresh(pathValue: string | undefined): boolean {
    const normalizedPath = this.normalizePath(pathValue);
    if (!normalizedPath || !this.pendingContextRefreshPaths.has(normalizedPath)) return false;
    this.pendingContextRefreshPaths.delete(normalizedPath);
    return true;
  }

  /** A failed write remains delivery debt until a later write establishes progress. */
  hasPendingMutationRepair(): boolean {
    return this.pendingMutationRepair;
  }

  completionBlocker(): string | undefined {
    if (!this.pendingMutationRepair) return undefined;
    return '最近的写入动作失败后尚未产生新的有效写盘；任务不能使用失败前的验证证据结算为完成。';
  }

  private normalizePath(pathValue: string | undefined): string {
    const trimmed = pathValue?.trim();
    if (!trimmed) return '';
    const resolved = this.workspaceRoot && !nodePath.isAbsolute(trimmed)
      ? nodePath.resolve(this.workspaceRoot, trimmed)
      : trimmed;
    return normalizeToolFailurePath(resolved);
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
    failure.strategyFingerprint ?? 'unspecified-strategy',
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
    ? '当前文件快照已随工具结果返回。请缩小到唯一的最小 old_str/new_str；若需要插入/删除代码或完整 old_str 很长，改用带唯一上下文的单文件 apply_patch。两者都必须使用 fenced CDATA 保留真实换行；不能升级为 write_file 整文件覆写。'
    : failure.kind === 'terminal-guard'
      ? 'run_terminal 只用于查询、编译、运行和测试。创建、修改或删除文件必须使用 create_file/write_file/replace_in_file/apply_patch/delete_file。'
      : failure.kind === 'terminal-capability'
        ? '当前系统缺少该命令所需的运行时或工具。请先探测已安装的等价能力并改用可用命令；如果必须安装依赖，明确报告阻塞并请求用户授权，不得重复执行同一缺失命令。'
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
