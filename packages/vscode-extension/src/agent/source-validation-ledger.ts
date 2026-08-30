import type { AgenticHistoryQualityGate } from './agentic-history';
import {
  projectCurrentTerminalEvidence,
  type TerminalEvidence,
} from './completion-evidence';

interface SourceValidationSnapshot {
  writeCount: number;
  terminalEvidenceStartIndex: number;
  qualityGate?: AgenticHistoryQualityGate;
}

/** Keeps validation evidence bound to the exact accumulated write cohort it verified. */
export class SourceValidationLedger {
  private currentWriteCount = 0;
  private currentTerminalEvidenceStartIndex = 0;
  private snapshot?: SourceValidationSnapshot;

  beginWriteCohort(writeCount: number, terminalEvidenceStartIndex = 0): void {
    if (writeCount <= this.currentWriteCount) return;
    this.currentWriteCount = writeCount;
    this.currentTerminalEvidenceStartIndex = Math.max(0, terminalEvidenceStartIndex);
    this.snapshot = undefined;
  }

  settleWriteCohort(writeCount: number, qualityGate?: AgenticHistoryQualityGate): void {
    if (writeCount !== this.currentWriteCount) return;
    this.snapshot = {
      writeCount,
      terminalEvidenceStartIndex: this.currentTerminalEvidenceStartIndex,
      qualityGate,
    };
  }

  qualityGateForCurrentSource(): AgenticHistoryQualityGate | undefined {
    if (this.snapshot?.writeCount !== this.currentWriteCount) return undefined;
    return this.snapshot.qualityGate;
  }

  currentSourceIsValidated(): boolean {
    return this.qualityGateForCurrentSource()?.status === 'pass';
  }

  terminalEvidenceForCurrentSource(evidence: readonly TerminalEvidence[]): TerminalEvidence[] {
    if (this.snapshot?.writeCount !== this.currentWriteCount) return [];
    return projectCurrentTerminalEvidence(
      evidence.slice(this.snapshot.terminalEvidenceStartIndex),
      8,
    );
  }
}
