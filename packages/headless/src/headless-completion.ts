import {
  CanonicalCompletionDecisionService,
  type CodingCompletionDecision,
  type CodingCompletionDecisionInput,
  type CompletionDecisionPort,
} from '@devseek-netai/shared';

/** Programmatic Surface adapter; all terminal semantics remain in the shared owner. */
export class HeadlessCompletionAdapter {
  constructor(
    private readonly completion: CompletionDecisionPort = new CanonicalCompletionDecisionService(),
  ) {}

  decide(input: CodingCompletionDecisionInput): CodingCompletionDecision {
    return this.completion.decide(input);
  }
}
