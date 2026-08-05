import {
  CanonicalVerificationService,
  buildCodingVerificationPlan,
  type CodingVerificationCriterion,
  type CodingVerificationOutcome,
  type VerificationPort,
} from '@devseek-netai/shared';

export type VsCodeVerificationObservationStatus =
  | 'passed'
  | 'failed'
  | 'unverified'
  | 'indeterminate';

export interface VsCodeVerificationObservation {
  readonly status: VsCodeVerificationObservationStatus;
  readonly summary: string;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly evidenceRefs: readonly string[];
}

export interface VsCodeVerificationInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly scopePaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly evidenceRefs: readonly string[];
  readonly verifier: string;
  readonly observe: () => Promise<VsCodeVerificationObservation>;
}

/** Adapts settled VS Code validation observations to shared acceptance semantics. */
export class VsCodeVerificationAdapter {
  constructor(private readonly verification: VerificationPort = new CanonicalVerificationService()) {}

  verify(input: VsCodeVerificationInput): Promise<CodingVerificationOutcome> {
    const plan = buildCodingVerificationPlan({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      idempotencyKey: `${input.runId}:${input.actionId}`,
      scopePaths: input.scopePaths,
      acceptance: input.acceptance,
      payload: {
        surface: 'vscode' as const,
        verifier: input.verifier,
      },
      evidenceRefs: input.evidenceRefs,
    });
    return this.verification.verify(plan, {
      verify: async () => {
        const observation = await input.observe();
        if (observation.status === 'indeterminate') {
          throw new Error('vscode-verification:indeterminate-observation');
        }
        return {
          verifier: input.verifier,
          checks: [{
            checkId: `vscode-check-${input.actionId}`,
            status: observation.status === 'unverified' ? 'unavailable' : observation.status,
            acceptanceIds: input.acceptance.map(criterion => criterion.id),
            summary: observation.summary,
            ...(observation.command ? { command: observation.command } : {}),
            ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
            evidenceRefs: observation.evidenceRefs,
          }],
          evidenceRefs: observation.evidenceRefs,
        };
      },
    });
  }
}
