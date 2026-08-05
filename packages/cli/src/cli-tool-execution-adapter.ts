import {
  CanonicalToolExecutor,
  CanonicalWorkspaceMutationTransaction,
  buildCodingToolAction,
  buildCodingWorkspaceMutationPlan,
  classifyCodingTerminalEffects,
  type CodingToolAuthorityReceipt,
  type CodingToolExecutionOutcome,
  type CodingVerificationOutcome,
  type CodingVerificationReceipt,
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
  readonly authority: CodingToolAuthorityReceipt;
}

export interface CliWorkspaceToolExecutionResult {
  readonly outcome: CodingToolExecutionOutcome<CodingWorkspaceMutationReceipt<readonly string[]>>;
}

export interface CliVerificationToolExecutionInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly files: readonly string[];
  readonly authority: CodingToolAuthorityReceipt;
  readonly verify: () => Promise<CodingVerificationOutcome>;
}

export interface CliVerificationToolExecutionResult {
  readonly outcome: CodingToolExecutionOutcome<CodingVerificationReceipt>;
}

export interface CliDeniedTerminalToolInput {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly command: string;
  readonly workdir?: string;
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
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'cli-workspace-artifact-apply',
      effects: ['workspace-mutation'],
      input: {
        workspaceRoot: input.workspaceRoot,
        proposal: input.proposal,
      },
      authority: input.authority,
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
    });
    return { outcome };
  }

  async executeVerification(
    input: CliVerificationToolExecutionInput,
  ): Promise<CliVerificationToolExecutionResult> {
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'run_terminal',
      effects: ['process'],
      input: { files: input.files },
      authority: input.authority,
    });
    const outcome = await this.executor.execute(action, {
      execute: async () => {
        const verification = await input.verify();
        const receipt = verification.receipt;
        return {
          status: receipt.status === 'passed'
            ? 'completed'
            : receipt.status === 'indeterminate'
              ? 'indeterminate'
              : 'failed',
          result: receipt,
          ...(receipt.status === 'passed' ? {} : {
            errorCode: receipt.errorCode ?? `verification-${receipt.status}`,
          }),
          evidenceRefs: receipt.evidenceRefs,
        };
      },
    });
    return { outcome };
  }

  executeDeniedTerminal(
    input: CliDeniedTerminalToolInput,
  ): Promise<CodingToolExecutionOutcome<never>> {
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.actionId,
      tool: 'run_terminal',
      effects: classifyCodingTerminalEffects(input.command),
      input: {
        command: input.command,
        ...(input.workdir ? { workdir: input.workdir } : {}),
      },
      authority: {
        decision: 'deny',
        status: 'denied',
        reason: 'cli-model-terminal-requires-explicit-authorization',
        evidenceRefs: [`cli-authority:${input.actionId}:denied`],
      },
    });
    return this.executor.execute(action, {
      execute: async () => {
        throw new Error('denied CLI terminal host must not execute');
      },
    });
  }
}

function cliMutationPlanErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && error.message === 'coding-workspace-mutation:unsafe-path') {
    return 'workspace-path-outside-root';
  }
  return undefined;
}
