import {
  CanonicalToolExecutor,
  CanonicalWorkspaceMutationTransaction,
  buildCodingToolAction,
  buildCodingWorkspaceMutationPlan,
  type CodingToolAuthoritySessionPort,
  type CodingToolCall,
  type CodingToolExecutionOutcome,
  type CodingWorkspaceMutationReceipt,
  type ToolExecutorPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import type { CliCodingArtifactProposal } from './cli-coding-artifact-interpreter';
import {
  type CliWorkspaceMutationHostAdapter,
} from './cli-workspace-mutation-service';

export interface CliWorkspaceToolExecutionInput {
  readonly runId: string;
  readonly sequence: number;
  readonly call: CodingToolCall;
  readonly authority: CodingToolAuthoritySessionPort;
}

export interface CliWorkspaceToolExecutionResult {
  readonly outcome: CodingToolExecutionOutcome<CodingWorkspaceMutationReceipt<readonly string[]>>;
}

export interface CliDeniedTerminalToolInput {
  readonly runId: string;
  readonly sequence: number;
  readonly call: CodingToolCall;
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
    assertDispatchedOperation(input.call, 'apply_workspace_artifacts');
    const actionInput = input.call.input as Readonly<{
      workspaceRoot: string;
      proposal: CliCodingArtifactProposal;
    }>;
    const authority = input.authority.authorize({
      actionId: input.call.id,
      tool: input.call.name,
      purpose: input.call.purpose,
      effects: input.call.effects,
      input: actionInput,
      risk: input.call.risk,
      protectedPath: input.call.protectedPath,
      targetPaths: input.call.targetPaths,
    });
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.call.id,
      tool: input.call.name,
      purpose: input.call.purpose,
      effects: input.call.effects,
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
            paths: input.call.targetPaths,
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
    assertDispatchedOperation(input.call, 'run_terminal');
    const actionInput = input.call.input;
    const authority = input.authority.authorize({
      actionId: input.call.id,
      tool: input.call.name,
      purpose: input.call.purpose,
      effects: input.call.effects,
      input: actionInput,
      risk: input.call.risk,
      protectedPath: input.call.protectedPath,
      targetPaths: input.call.targetPaths,
      surfaceConstraint: {
        decision: 'deny',
        reason: 'cli-model-terminal-requires-explicit-authorization',
        evidenceRefs: [`cli-terminal-policy:${input.call.id}:denied`],
      },
    });
    const action = buildCodingToolAction({
      runId: input.runId,
      sequence: input.sequence,
      actionId: input.call.id,
      tool: input.call.name,
      purpose: input.call.purpose,
      effects: input.call.effects,
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

function assertDispatchedOperation(call: CodingToolCall, expectedTool: string): void {
  if (!call.executable || !call.descriptor || call.name !== expectedTool) {
    throw new Error(`cli-tool-execution:invalid-dispatch:${call.rejectionReason ?? call.name ?? 'unknown'}`);
  }
}

function cliMutationPlanErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && error.message === 'coding-workspace-mutation:unsafe-path') {
    return 'workspace-path-outside-root';
  }
  return undefined;
}
