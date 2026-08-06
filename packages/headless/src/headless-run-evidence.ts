import {
  CanonicalRunEvidenceRetentionService,
  createProductRunEvidenceAuthorityToken,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  type CodingRunLifecycleSnapshot,
  type RunEvidenceSettlementStatus,
} from '@devseek-netai/shared';

export const HEADLESS_RUN_EVIDENCE_RECEIPT_SCHEMA = 'devseek.headless-run-evidence-receipt/v1' as const;

export interface HeadlessRunEvidenceReceipt {
  readonly schema: typeof HEADLESS_RUN_EVIDENCE_RECEIPT_SCHEMA;
  readonly runId: string;
  readonly status: RunEvidenceSettlementStatus;
  readonly eventCount: number;
  readonly finalEventSha256: string;
  readonly finalRecordSha256: string;
  readonly sealSha256: string;
  readonly qualificationEligible: false;
}

export class HeadlessRunEvidence {
  static open(input: { workspaceRoot: string; runId: string }): HeadlessRunEvidence {
    const ownerToken = createProductRunEvidenceAuthorityToken();
    const participantToken = createProductRunEvidenceAuthorityToken();
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: input.workspaceRoot,
      runId: input.runId,
      surface: 'headless',
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
      openPayload: {
        owner_surface: 'headless',
        retention_policy: HEADLESS_RUN_EVIDENCE_RECEIPT_SCHEMA,
      },
    });
    session.record({
      type: 'command.accepted',
      idempotencyKey: productRunEvidenceIdempotencyKey('headless-command-accepted', {
        runId: input.runId,
      }),
      payload: {
        schema: HEADLESS_RUN_EVIDENCE_RECEIPT_SCHEMA,
        trust: 'product-runtime-observation',
        command_kind: 'coding-run',
      },
    });
    return new HeadlessRunEvidence(input.runId, session);
  }

  private readonly retention: CanonicalRunEvidenceRetentionService;

  private constructor(
    private readonly runId: string,
    private readonly session: ProductRunEvidenceSession,
  ) {
    this.retention = new CanonicalRunEvidenceRetentionService(runId, session);
  }

  finalize(
    lifecycle: CodingRunLifecycleSnapshot | undefined,
    status: RunEvidenceSettlementStatus,
    reason: string,
  ): HeadlessRunEvidenceReceipt {
    if (lifecycle) this.retention.retainLifecycle(lifecycle);
    const result = this.session.settleAndSeal({
      status,
      idempotencyKey: productRunEvidenceIdempotencyKey('headless-run-settled', {
        runId: this.runId,
        status,
      }),
      payload: {
        surface: 'headless',
        reason,
        lifecycle_status: lifecycle?.status ?? null,
      },
    });
    return Object.freeze({
      schema: HEADLESS_RUN_EVIDENCE_RECEIPT_SCHEMA,
      runId: this.runId,
      status,
      eventCount: result.seal.event_count,
      finalEventSha256: result.seal.final_event_sha256,
      finalRecordSha256: result.seal.final_record_sha256,
      sealSha256: result.seal.seal_sha256,
      qualificationEligible: false,
    });
  }
}
