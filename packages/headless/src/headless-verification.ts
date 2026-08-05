import {
  CanonicalVerificationService,
  buildCodingVerificationPlan,
  type BuildCodingVerificationPlanInput,
  type CodingVerificationHostPort,
  type CodingVerificationOutcome,
  type VerificationPort,
} from '@devseek-netai/shared';

export interface HeadlessVerificationInput<TPayload> {
  readonly plan: BuildCodingVerificationPlanInput<TPayload>;
  readonly host: CodingVerificationHostPort<TPayload>;
}

/** Programmatic Surface adapter for caller-supplied read-only verifier capabilities. */
export class HeadlessVerificationAdapter {
  constructor(private readonly verification: VerificationPort = new CanonicalVerificationService()) {}

  verify<TPayload>(input: HeadlessVerificationInput<TPayload>): Promise<CodingVerificationOutcome> {
    return this.verification.verify(buildCodingVerificationPlan(input.plan), input.host);
  }
}
