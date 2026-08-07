import {
  CanonicalToolExecutor,
  CanonicalWorkspaceMutationTransaction,
  buildCodingToolAction,
  buildCodingWorkspaceMutationPlan,
  classifyCodingTerminalEffects,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionOutcome,
  type CodingWorkspaceMutationReceipt,
  type ToolExecutorPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import type { CliCodingArtifactProposal } from './cli-coding-artifact-interpreter';
import {
  collectCliWorkspaceMutationPaths,
  type CliWorkspaceMutationHostAdapter,
} from './cli-workspace-mutation-service';

export interface CliWorkspaceToolExecutionInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly workspaceRoot: string;
  readonly proposal: CliCodingArtifactProposal;
  readonly authority: CodingToolAuthoritySessionPort;
}

export interface CliWorkspaceToolExecutionResult {
  readonly outcome: CodingToolExecutionOutcome<CodingWorkspaceMutationReceipt<readonly string[]>>;
}

export interface CliDeniedTerminalToolInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly command: string;
  readonly workdir?: string;
  readonly authority: CodingToolAuthoritySessionPort;
}

/** Maps the CLI filesystem capability onto the shared tool execution owner. */
export class CliToolExecutionAdapter {
  constructor(
    private readonly mutation: CliWorkspaceMutationHostAdapter,
    private readonly executor: ToolExecutorPort = new CanonicalToolExecutor(),
    private readonly transaction: WorkspaceMutationTransactionPort = new CanonicalWorkspaceMutationTransaction(),
  ) {}

  async executeWorkspaceMutation(
    input: CliWorkspaceToolExecutionInput,
  ): Promise<CliWorkspaceToolExecutionResult> {
    const actionInput = {
      workspaceRoot: input.workspaceRoot,
      proposal: input.proposal,
    };
    const authority = input.authority.authorize({
      actionId: input.actionId,
      tool: 'cli-workspace-artifact-apply',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      input: actionInput,
      risk: 'medium',
      targetPaths: collectCliWorkspaceMutationPaths(input.proposal),
    });
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'cli-workspace-artifact-apply',
      purpose: 'workspace-mutation',
      effects: ['workspace-mutation'],
      input: actionInput,
      authority: authority.receipt,
    });
    const outcome = await this.executor.execute(action, {
      execute: async settledAction => {
        let mutationPlan;
        try {
          mutationPlan = buildCodingWorkspaceMutationPlan({
            runId: settledAction.runId,
            sequence: settledAction.sequence,
            actionId: settledAction.actionId,
            idempotencyKey: `${settledAction.runId}:${settledAction.actionId}`,
            paths: collectCliWorkspaceMutationPaths(settledAction.input.proposal),
            payload: settledAction.input,
            evidenceRefs: [
              ...settledAction.authority.evidenceRefs,
              `cli-tool-action:${settledAction.actionId}`,
            ],
          });
        } catch (error) {
          const errorCode = cliMutationPlanErrorCode(error);
          if (!errorCode) throw error;
          return {
            status: 'failed' as const,
            errorCode,
            evidenceRefs: [`cli-mutation-plan:${settledAction.actionId}:rejected`],
          };
        }
        const mutation = await this.transaction.execute(mutationPlan, this.mutation);
        const receipt = mutation.receipt;
        return {
          status: receipt.status === 'committed'
            ? 'completed'
            : receipt.status === 'indeterminate'
              ? 'indeterminate'
              : 'failed',
          result: receipt,
          ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
          evidenceRefs: receipt.evidenceRefs,
        };
      },
    }, input.authority);
    return { outcome };
  }

  executeDeniedTerminal(
    input: CliDeniedTerminalToolInput,
  ): Promise<CodingToolExecutionOutcome<never>> {
    const effects = classifyCodingTerminalEffects(input.command);
    const actionInput = {
      command: input.command,
      ...(input.workdir ? { workdir: input.workdir } : {}),
    };
    const authority = input.authority.authorize({
      actionId: input.actionId,
      tool: 'run_terminal',
      purpose: 'external-effect',
      effects,
      input: actionInput,
      risk: 'high',
      surfaceConstraint: {
        decision: 'deny',
        reason: 'cli-model-terminal-requires-explicit-authorization',
        evidenceRefs: [`cli-terminal-policy:${input.actionId}:denied`],
      },
    });
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'run_terminal',
      purpose: 'external-effect',
      effects,
      input: actionInput,
      authority: authority.receipt,
    });
    return this.executor.execute(action, {
      execute: async () => {
        throw new Error('denied CLI terminal host must not execute');
      },
    }, input.authority);
  }
}

function cliMutationPlanErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && error.message === 'coding-workspace-mutation:unsafe-path') {
    return 'workspace-path-outside-root';
  }
  return undefined;
}
