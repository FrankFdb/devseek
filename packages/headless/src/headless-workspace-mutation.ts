import {
  CanonicalWorkspaceMutationTransaction,
  buildCodingWorkspaceMutationPlan,
  type BuildCodingWorkspaceMutationPlanInput,
  type CodingWorkspaceMutationOutcome,
  type WorkspaceMutationPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';

export interface HeadlessWorkspaceMutationInput<TPayload, TBaseline, TApplied, TResult> {
  readonly plan: BuildCodingWorkspaceMutationPlanInput<TPayload>;
  readonly host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>;
}

/** Programmatic Surface adapter for caller-supplied workspace mutation capabilities. */
export class HeadlessWorkspaceMutationAdapter {
  constructor(
    private readonly transaction: WorkspaceMutationTransactionPort = new CanonicalWorkspaceMutationTransaction(),
  ) {}

  execute<TPayload, TBaseline, TApplied, TResult>(
    input: HeadlessWorkspaceMutationInput<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    return this.transaction.execute(buildCodingWorkspaceMutationPlan(input.plan), input.host);
  }
}
