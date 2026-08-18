import type { AgenticHistoryQualityGate } from './agentic-history';

interface SourceValidationSnapshot {
  writeCount: number;
  qualityGate?: AgenticHistoryQualityGate;
}

/** Keeps validation evidence bound to the exact accumulated write cohort it verified. */
export class SourceValidationLedger {
  private currentWriteCount = 0;
  private snapshot?: SourceValidationSnapshot;

  beginWriteCohort(writeCount: number): void {
    if (writeCount <= this.currentWriteCount) return;
    this.currentWriteCount = writeCount;
    this.snapshot = undefined;
  }

  settleWriteCohort(writeCount: number, qualityGate?: AgenticHistoryQualityGate): void {
    if (writeCount !== this.currentWriteCount) return;
    this.snapshot = { writeCount, qualityGate };
  }

  qualityGateForCurrentSource(): AgenticHistoryQualityGate | undefined {
    if (this.snapshot?.writeCount !== this.currentWriteCount) return undefined;
    return this.snapshot.qualityGate;
  }

  currentSourceIsValidated(): boolean {
    return this.qualityGateForCurrentSource()?.status === 'pass';
  }
}
