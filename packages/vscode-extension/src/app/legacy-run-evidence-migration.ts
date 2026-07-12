import {
  createProductRunEvidenceAuthorityToken,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  projectLegacyDiagnosticJsonl,
  projectLegacyReviewLedger,
  projectLegacyTaskHistory,
  type RunEvidenceAppendResult,
  type RunEvidenceSealResult,
} from '@devseek-netai/shared';

import type { ReviewLedgerSnapshot } from '../workspace/review-ledger';
import type { TaskRunRecord } from './task-history-store';

export interface LegacyRunEvidenceMigrationOptions {
  workspaceRoot: string;
  migrationRunId: string;
}

/**
 * Explicit migration entry point for mutable pre-G0-D projections. Nothing is
 * auto-imported, and every imported item remains a legacy.imported event with
 * trust=legacy-unverified and qualification_eligible=false.
 */
export class LegacyRunEvidenceMigrationService {
  private readonly evidence: ProductRunEvidenceSession;

  constructor(options: LegacyRunEvidenceMigrationOptions) {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    this.evidence = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: options.workspaceRoot,
      runId: options.migrationRunId,
      surface: 'vscode-migration',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
      openPayload: { purpose: 'legacy-unverified-import' },
    });
  }

  importTaskHistory(records: readonly TaskRunRecord[]): RunEvidenceAppendResult {
    return this.evidence.importLegacy(projectLegacyTaskHistory(records));
  }

  importReviewLedger(snapshot: ReviewLedgerSnapshot, sourceRef: string): RunEvidenceAppendResult {
    return this.evidence.importLegacy(projectLegacyReviewLedger(snapshot, sourceRef));
  }

  importDiagnosticJsonl(content: string, sourceRef: string): RunEvidenceAppendResult {
    return this.evidence.importLegacy(projectLegacyDiagnosticJsonl(content, sourceRef));
  }

  complete(): RunEvidenceSealResult {
    return this.evidence.settleAndSeal({
      status: 'completed',
      idempotencyKey: productRunEvidenceIdempotencyKey('legacy-migration-settled', {
        runId: this.evidence.runId,
      }),
      payload: { trust: 'legacy-unverified', qualification_eligible: false },
      sealReason: 'legacy-migration-completed',
    });
  }
}
