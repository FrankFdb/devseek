import type { AgenticHistoryQualityGate } from './agentic-history';
import { stableStringify } from './stable-stringify';

export interface QualityGateStagnationOptions {
  warnAfterObservations?: number;
  stopAfterObservations?: number;
}

export interface QualityGateStagnationResult {
  repeatedWithoutProgress: number;
  warning?: string;
  stopReason?: string;
}

const DEFAULT_WARN_AFTER_OBSERVATIONS = 2;
const DEFAULT_STOP_AFTER_OBSERVATIONS = 3;

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map(value => String(value || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean))]
    .sort();
}

export function makeQualityGateFailureFingerprint(qualityGate: AgenticHistoryQualityGate): string {
  return stableStringify({
    status: qualityGate.status,
    summary: String(qualityGate.summary || '').trim().replace(/\s+/g, ' '),
    risks: normalizeList(qualityGate.risks),
    evidenceRefs: normalizeList(qualityGate.evidenceRefs),
    alternativeChecks: normalizeList(qualityGate.alternativeChecks),
    requiredActions: normalizeList(qualityGate.requiredActions),
  });
}

/**
 * Detects a QualityGate loop only when the same complete failure recurs without
 * a successful workspace mutation between observations. A persistent high-level
 * summary is not stagnation while the agent is still changing artifacts.
 */
export class QualityGateStagnationLedger {
  private readonly failureCounts = new Map<string, number>();
  private readonly warnAfterObservations: number;
  private readonly stopAfterObservations: number;
  private progressRevision: number | undefined;

  constructor(options: QualityGateStagnationOptions = {}) {
    this.warnAfterObservations = options.warnAfterObservations ?? DEFAULT_WARN_AFTER_OBSERVATIONS;
    this.stopAfterObservations = options.stopAfterObservations ?? DEFAULT_STOP_AFTER_OBSERVATIONS;
  }

  record(
    qualityGate: AgenticHistoryQualityGate | undefined,
    progressRevision: number,
  ): QualityGateStagnationResult {
    if (!qualityGate) return { repeatedWithoutProgress: 0 };
    if (qualityGate.status === 'pass') {
      this.reset();
      return { repeatedWithoutProgress: 0 };
    }

    if (this.progressRevision !== progressRevision) {
      this.failureCounts.clear();
      this.progressRevision = progressRevision;
    }

    const fingerprint = makeQualityGateFailureFingerprint(qualityGate);
    const repeatedWithoutProgress = (this.failureCounts.get(fingerprint) ?? 0) + 1;
    this.failureCounts.set(fingerprint, repeatedWithoutProgress);

    const result: QualityGateStagnationResult = { repeatedWithoutProgress };
    if (repeatedWithoutProgress >= this.warnAfterObservations) {
      result.warning = [
        `【系统反馈】QualityGate 在没有新增修改证据的情况下连续 ${repeatedWithoutProgress} 次以同一原因未通过：${qualityGate.summary}`,
        '不要重复原策略；请回到源项目证据、接口事实、代码集成点或验证入口，换一种可验证的修复方式。',
        ...(qualityGate.requiredActions?.length
          ? [`requiredActions:\n${qualityGate.requiredActions.map(action => `- ${action}`).join('\n')}`]
          : []),
      ].join('\n');
    }
    if (repeatedWithoutProgress >= this.stopAfterObservations) {
      result.stopReason = `QualityGate 连续 ${repeatedWithoutProgress} 次未通过且没有新增修改证据：${qualityGate.summary}`;
    }
    return result;
  }

  reset(): void {
    this.failureCounts.clear();
    this.progressRevision = undefined;
  }
}
