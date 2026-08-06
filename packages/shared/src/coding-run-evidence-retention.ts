import {
  assertCodingRunLifecycleSnapshot,
  CODING_RUN_LIFECYCLE_VERSION,
  type CodingRunLifecycleSnapshot,
} from './coding-run-lifecycle';
import {
  PRODUCT_RUNTIME_OBSERVATION_TRUST,
  productRunEvidenceIdempotencyKey,
  type ProductRunEvidenceSession,
} from './run-evidence-integration';
import type { RunEvidenceAppendResult } from './run-evidence-protocol';

export const CODING_RUN_LIFECYCLE_EVIDENCE_SCHEMA = 'devseek.coding-run-lifecycle-evidence/v1' as const;

type RunEvidenceAppendPort = Pick<ProductRunEvidenceSession, 'record'>;

export interface RunEvidenceRetentionPort {
  retainLifecycle(snapshot: CodingRunLifecycleSnapshot): readonly RunEvidenceAppendResult[];
}

/**
 * Projects canonical lifecycle receipts into the append-only product ledger.
 * It owns retention shape only; opening and terminal sealing stay with the run owner.
 */
export class CanonicalRunEvidenceRetentionService implements RunEvidenceRetentionPort {
  constructor(
    private readonly runId: string,
    private readonly session: RunEvidenceAppendPort,
  ) {
    if (!runId.trim()) throw new Error('coding-run-evidence-retention:missing-run-id');
  }

  retainLifecycle(snapshot: CodingRunLifecycleSnapshot): readonly RunEvidenceAppendResult[] {
    assertCodingRunLifecycleSnapshot(snapshot);
    if (snapshot.runId !== this.runId) {
      throw new Error('coding-run-evidence-retention:run-id-mismatch');
    }
    return Object.freeze(snapshot.events.map(event => this.session.record({
      type: 'agent.status',
      idempotencyKey: productRunEvidenceIdempotencyKey('coding-run-lifecycle', {
        runId: this.runId,
        sequence: event.sequence,
        event,
      }),
      payload: {
        schema: CODING_RUN_LIFECYCLE_EVIDENCE_SCHEMA,
        lifecycle_version: CODING_RUN_LIFECYCLE_VERSION,
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        status: event.to,
        previous_status: event.from,
        cause: event.cause,
        lifecycle_sequence: event.sequence,
        terminal: event.sequence === snapshot.events.length && snapshot.terminal,
      },
    })));
  }
}
