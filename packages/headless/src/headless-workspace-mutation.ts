import {
  buildCodingWorkspaceMutationPlan,
  type BuildCodingWorkspaceMutationPlanInput,
  type CodingToolAuthoritySessionPort,
  type CodingWorkspaceMutationOutcome,
  type WorkspaceMutationPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';

export interface HeadlessWorkspaceMutationInput<TPayload, TBaseline, TApplied, TResult> {
  readonly plan: BuildCodingWorkspaceMutationPlanInput<TPayload>;
  readonly tool: string;
  readonly authority: CodingToolAuthoritySessionPort;
  readonly host: WorkspaceMutationPort<TPayload, TBaseline, TApplied, TResult>;
}

/** Programmatic Surface adapter for caller-supplied workspace mutation capabilities. */
export class HeadlessWorkspaceMutationAdapter {
  constructor(
    private readonly transaction: WorkspaceMutationTransactionPort,
  ) {}

  execute<TPayload, TBaseline, TApplied, TResult>(
    input: HeadlessWorkspaceMutationInput<TPayload, TBaseline, TApplied, TResult>,
  ): Promise<CodingWorkspaceMutationOutcome<TResult>> {
    const authorization = input.authority.authorize({
      actionId: input.plan.actionId,
      tool: input.tool,
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      input: input.plan.payload,
      risk: 'medium',
      targetPaths: input.plan.paths,
    });
    if (authorization.receipt.status !== 'authorized') {
      throw new Error(`headless-workspace-mutation:authority-denied:${authorization.receipt.reason}`);
    }
    return this.transaction.execute(buildCodingWorkspaceMutationPlan({
      ...input.plan,
      evidenceRefs: [
        ...(input.plan.evidenceRefs ?? []),
        ...authorization.receipt.evidenceRefs,
      ],
    }), input.host);
  }
}
