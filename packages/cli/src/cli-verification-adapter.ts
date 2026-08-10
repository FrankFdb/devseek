import {
  buildCodingVerificationPlan,
  type CodingVerificationCriterion,
  type CodingVerificationHostResult,
  type CodingVerificationOutcome,
  type VerificationPort,
} from '@devseek-netai/shared';
import {
  type CliValidationResult,
  type CliVerificationHostAdapter,
} from './cli-verification-service';

export interface CliVerificationInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly files: readonly string[];
  readonly prompt: string;
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly evidenceRefs: readonly string[];
}

/** Maps the CLI verifier host onto shared acceptance and receipt semantics. */
export class CliVerificationAdapter {
  constructor(private readonly host: Pick<CliVerificationHostAdapter, 'verify'>) {}

  verify(
    input: CliVerificationInput,
    verification: VerificationPort,
  ): Promise<CodingVerificationOutcome> {
    const plan = buildCodingVerificationPlan({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      idempotencyKey: `${input.runId}:${input.actionId}`,
      scopePaths: input.files,
      acceptance: input.acceptance,
      payload: {
        workspaceRoot: input.workspaceRoot,
        files: input.files,
        prompt: input.prompt,
      },
      evidenceRefs: input.evidenceRefs,
    });
    return verification.verify(plan, {
      verify: async () => projectCliHostResult(
        await this.host.verify(input.workspaceRoot, input.files, input.prompt),
        input.acceptance,
        input.actionId,
      ),
    });
  }
}

function projectCliHostResult(
  result: CliValidationResult,
  acceptance: readonly CodingVerificationCriterion[],
  actionId: string,
): CodingVerificationHostResult {
  const status = result.status ?? (result.passed ? 'passed' : 'failed');
  if (status === 'indeterminate') throw new Error('CLI verifier returned an indeterminate host result');
  return {
    verifier: status === 'unverified' ? 'none' : 'cli-project-verifier',
    checks: status === 'unverified' ? [] : [{
      checkId: `cli-verification-check-${actionId}`,
      status,
      acceptanceIds: acceptance.map(criterion => criterion.id),
      summary: result.summary,
      evidenceRefs: result.evidenceRefs,
    }],
    evidenceRefs: result.evidenceRefs,
  };
}
