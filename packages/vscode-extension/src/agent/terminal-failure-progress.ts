import type { CodingToolCall, CodingToolPurpose } from '@devseek-netai/shared';
import { projectActionableDiagnosticExcerpt } from '../app/diagnostic-output-projection';
import type { TerminalEvidence } from './completion-evidence';
import type { ToolSuppressionEvidence } from './tool-loop-result';

const DEFAULT_INVESTIGATE_AFTER_UNCHANGED_REPAIRS = 2;
const FAILURE_SIGNAL_RE = /(?:\berror\b|\bfail(?:ed|ure)?\b|\bfatal\b|cannot|can't|unable|exception|assert|undefined reference|not found|no such|denied|timed?\s*out)/i;

interface FailureState {
  readonly identity: string;
  readonly fingerprint: string;
  readonly progressRevision: number;
  readonly unchangedRepairCohorts: number;
}

export interface TerminalFailureProgressOptions {
  readonly investigateAfterUnchangedRepairs?: number;
}

export interface TerminalFailureProgressObservation {
  readonly unchangedRepairCohorts: number;
  readonly investigationRequired: boolean;
  readonly newlyRequiresInvestigation: boolean;
  readonly feedback?: string;
}

export interface TerminalFailureInvestigationScreen {
  readonly blockedToolIndexes: ReadonlySet<number>;
  readonly suppressedTools: readonly ToolSuppressionEvidence[];
  readonly warnings: readonly string[];
}

/**
 * Distinguishes accepted file writes from repairs that actually change the
 * public failure. The model owns the next hypothesis; the host owns whether
 * unchanged validation evidence permits another effectful attempt.
 */
export class TerminalFailureProgressLedger {
  private readonly investigateAfterUnchangedRepairs: number;
  private state: FailureState | undefined;
  private investigationPending = false;

  constructor(options: TerminalFailureProgressOptions = {}) {
    this.investigateAfterUnchangedRepairs = Math.max(
      1,
      options.investigateAfterUnchangedRepairs ?? DEFAULT_INVESTIGATE_AFTER_UNCHANGED_REPAIRS,
    );
  }

  observe(
    failure: TerminalEvidence | undefined,
    progressRevision: number,
    freshFailureObserved: boolean,
  ): TerminalFailureProgressObservation {
    if (!failure) {
      this.reset();
      return this.observation(0, false);
    }
    if (!freshFailureObserved) {
      return this.observation(this.state?.unchangedRepairCohorts ?? 0, false);
    }

    const identity = makeTerminalFailureIdentity(failure);
    const fingerprint = makeTerminalFailureFingerprint(failure);
    if (!this.state || this.state.identity !== identity || this.state.fingerprint !== fingerprint) {
      this.state = {
        identity,
        fingerprint,
        progressRevision,
        unchangedRepairCohorts: 0,
      };
      this.investigationPending = false;
      return this.observation(0, false);
    }

    if (progressRevision <= this.state.progressRevision) {
      return this.observation(this.state.unchangedRepairCohorts, false);
    }

    const unchangedRepairCohorts = this.state.unchangedRepairCohorts + 1;
    this.state = {
      ...this.state,
      progressRevision,
      unchangedRepairCohorts,
    };
    const newlyRequiresInvestigation = unchangedRepairCohorts >= this.investigateAfterUnchangedRepairs
      && !this.investigationPending;
    if (newlyRequiresInvestigation) this.investigationPending = true;
    return this.observation(
      unchangedRepairCohorts,
      newlyRequiresInvestigation,
      newlyRequiresInvestigation ? buildUnchangedFailureInvestigationFeedback(failure, unchangedRepairCohorts) : undefined,
    );
  }

  requiresInvestigation(): boolean {
    return this.investigationPending;
  }

  screen(tools: readonly CodingToolCall[]): TerminalFailureInvestigationScreen {
    const blockedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    if (!this.investigationPending) {
      return { blockedToolIndexes, suppressedTools, warnings: [] };
    }

    tools.forEach((tool, toolIndex) => {
      if (!isEffectfulPurpose(tool.purpose)) return;
      blockedToolIndexes.add(toolIndex);
      suppressedTools.push({
        tool: tool.name,
        reason: 'terminal-failure-investigation-required',
      });
    });
    const blockedNames = [...new Set(suppressedTools.map(item => item.tool))];
    return {
      blockedToolIndexes,
      suppressedTools,
      warnings: blockedNames.length > 0
        ? [[
          `【系统反馈】活动失败尚未取得新的根因证据，已暂缓动作：${blockedNames.join('、')}。`,
          '本轮只允许新的只读取证。请精确检查相关源码、接口契约、系统头文件/文档、运行时元数据或诊断；收到真实观察结果后再提出一个不同的修复假设。',
          '该暂缓不改变工具权限，也不把取证结果视为验证通过。',
        ].join('\n')]
        : [],
    };
  }

  recordInvestigationEvidence(novelObservationEvidence: boolean): string | undefined {
    if (!this.investigationPending || !novelObservationEvidence) return undefined;
    this.investigationPending = false;
    return [
      '【系统反馈】已取得新的根因取证结果。',
      '下一轮必须明确说明新证据如何否定或修正先前假设，然后只提交一个因果上不同的修复动作，并原样重跑公开失败命令。',
    ].join('\n');
  }

  reset(): void {
    this.state = undefined;
    this.investigationPending = false;
  }

  private observation(
    unchangedRepairCohorts: number,
    newlyRequiresInvestigation: boolean,
    feedback?: string,
  ): TerminalFailureProgressObservation {
    return {
      unchangedRepairCohorts,
      investigationRequired: this.investigationPending,
      newlyRequiresInvestigation,
      ...(feedback ? { feedback } : {}),
    };
  }
}

export function makeTerminalFailureFingerprint(failure: TerminalEvidence): string {
  return [
    makeTerminalFailureIdentity(failure),
    normalizeFailureDiagnostic(failure.detail),
  ].join('::');
}

function makeTerminalFailureIdentity(failure: TerminalEvidence): string {
  return [
    normalizeCommand(failure.command),
    String(failure.workdir || '').trim().replace(/\\/g, '/'),
    failure.kind,
    failure.exitCode ?? 'unknown',
  ].join('::');
}

function normalizeFailureDiagnostic(detail: string | undefined): string {
  const projected = projectActionableDiagnosticExcerpt(String(detail || ''), 2400)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = projected
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\[[^\]]*(?:\d{2}:\d{2}:\d{2}|pid[=: ]\d+)[^\]]*\]\s*/i, ''))
    .filter(Boolean);
  const signals = lines.filter(line => FAILURE_SIGNAL_RE.test(line));
  return (signals.length > 0 ? signals : lines)
    .slice(-12)
    .join('\n')
    .replace(/\s+/g, ' ')
    .slice(0, 1800);
}

function normalizeCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function isEffectfulPurpose(purpose: CodingToolPurpose): boolean {
  return purpose === 'verify' || purpose === 'workspace-mutation' || purpose === 'external-effect';
}

function buildUnchangedFailureInvestigationFeedback(
  failure: TerminalEvidence,
  unchangedRepairCohorts: number,
): string {
  return [
    '【系统反馈】修复策略已被公开验证证伪，必须先取证再继续修改。',
    `连续 ${unchangedRepairCohorts} 个已写盘修复批次后，失败命令、exitCode 与核心诊断仍未变化。`,
    `公开失败命令: ${failure.command}`,
    '先前修改没有改变活动失败状态；不得继续猜测参数、重复近似写入或换一种说法重试。',
    '下一轮只做一组精确的只读根因取证：检查相关实现、接口契约、系统头文件/文档、运行时元数据或新的诊断。宿主会暂缓新的写入和验证，直到真实观察结果已交付。',
  ].join('\n');
}
