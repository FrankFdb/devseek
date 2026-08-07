import {
  type CodingExternalEffectReconciliation,
  type CodingExternalEffectSessionPort,
  type CodingToolAuthorityReceipt,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionOutcome,
  type CodingToolExecutionReceipt,
  type CodingToolExecutionSessionPort,
  type CodingToolHostResult,
  type CodingToolSurfaceConstraint,
  type CodingToolCall,
  type ToolDispatchPort,
  type WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';
import type { AgentLoopCallbacks } from './loop-types';
import type { ToolPolicy } from '../app/permission-service';
import type { FakeTool } from './fake-tool-parser';
import {
  AgentToolExecutor,
  type AgentToolExecutionPlan,
  type EvidenceRef,
} from './tool-executor';

export interface CanonicalToolContext {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
  readonly operationSha256: string;
}

interface CanonicalToolHost<TResult> {
  readonly reconciliationScope?: 'process-local' | 'durable';
  execute(
    plan: AgentToolExecutionPlan,
    authority: CodingToolAuthorityReceipt,
  ): Promise<CodingToolHostResult<TResult>>;
  reconcile?(
    plan: AgentToolExecutionPlan,
    authority: CodingToolAuthorityReceipt,
  ): Promise<CodingExternalEffectReconciliation<TResult>>;
}

export function createToolLoopCanonicalSession(input: {
  readonly callbacks: AgentLoopCallbacks;
  readonly receipts: CodingToolExecutionReceipt<unknown>[];
  readonly evidenceRefs: EvidenceRef[];
}): ToolLoopCanonicalSession {
  const { callbacks } = input;
  if (!callbacks.canonicalToolAuthority
    || !callbacks.canonicalToolExecution
    || !callbacks.canonicalWorkspaceMutations
    || !callbacks.canonicalExternalEffects
    || !callbacks.canonicalToolDispatch) {
    throw new Error('vscode-tool-loop:incomplete-canonical-tool-sessions');
  }
  return new ToolLoopCanonicalSession(
    input.receipts,
    input.evidenceRefs,
    callbacks.canonicalToolAuthority,
    callbacks.canonicalToolExecution,
    callbacks.canonicalWorkspaceMutations,
    callbacks.canonicalExternalEffects,
    callbacks.canonicalToolDispatch,
  );
}

/** Owns canonical authority and receipt settlement for one ToolLoop invocation. */
export class ToolLoopCanonicalSession {
  private readonly executor: AgentToolExecutor;

  constructor(
    private readonly receipts: CodingToolExecutionReceipt<unknown>[],
    private readonly evidenceRefs: EvidenceRef[],
    private readonly authority: CodingToolAuthoritySessionPort,
    private readonly toolExecution: CodingToolExecutionSessionPort,
    readonly workspaceMutations: WorkspaceMutationTransactionPort,
    private readonly externalEffects: CodingExternalEffectSessionPort,
    dispatch: ToolDispatchPort,
    executor?: AgentToolExecutor,
  ) {
    this.executor = executor ?? new AgentToolExecutor(toolExecution, dispatch);
  }

  plan(tool: FakeTool | CodingToolCall, policy?: ToolPolicy, workspaceRoot?: string): AgentToolExecutionPlan {
    return this.executor.plan(tool, policy, workspaceRoot);
  }

  validateInput(plan: AgentToolExecutionPlan): { readonly ok: boolean; readonly error?: string } {
    return this.executor.validateInput(plan);
  }

  nextContext(plan: AgentToolExecutionPlan): CanonicalToolContext {
    return this.toolExecution.nextAction({
      tool: plan.tool.name,
      purpose: plan.purpose,
      effects: plan.effects,
      input: plan.call.input,
    });
  }

  async settle<TResult>(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
    host: CanonicalToolHost<TResult>,
    suppliedConstraint?: CodingToolSurfaceConstraint,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const surfaceConstraint = mergeSurfaceConstraints(plan, context, suppliedConstraint);
    if (plan.purpose !== 'workspace-mutation'
      && !plan.effects.includes('workspace-mutation')
      && plan.effects.some(effect => effect !== 'read')) {
      const outcome = await this.externalEffects.execute(
        {
          sequence: context.sequence,
          actionId: context.actionId,
          tool: plan.tool.name,
          purpose: plan.purpose,
          nature: plan.purpose === 'external-effect' ? 'mutating' : 'observational',
          effects: plan.effects,
          input: plan.call.input,
          risk: plan.risk,
          protectedPath: plan.protectedPath,
          surfaceConstraint,
        },
        {
          ...(host.reconciliationScope ? { reconciliationScope: host.reconciliationScope } : {}),
          ...(host.reconcile ? {
            reconcile: action => host.reconcile!(plan, action.authority),
          } : {}),
          execute: async action => {
            const result = await host.execute(plan, action.authority);
            return {
              status: result.status === 'completed'
                ? 'committed' as const
                : result.status === 'failed'
                  ? 'failed-no-effect' as const
                  : 'indeterminate' as const,
              ...(result.result === undefined ? {} : { result: result.result }),
              ...(result.errorCode ? { errorCode: result.errorCode } : {}),
              evidenceRefs: result.evidenceRefs,
            };
          },
        },
      );
      if (outcome.receipt.settlement === 'resume-replay') {
        throw new Error('vscode-tool-loop:resume-replay-must-be-settled-by-task-scheduler');
      }
      const receipt = outcome.receipt.toolReceipt;
      this.receipts.push(receipt as CodingToolExecutionReceipt<unknown>);
      return { receipt, replayed: outcome.replayed };
    }

    const authorization = this.authority.authorize({
      actionId: context.actionId,
      tool: plan.tool.name,
      purpose: plan.purpose,
      effects: plan.effects,
      input: plan.call.input,
      risk: plan.risk,
      protectedPath: plan.protectedPath,
      targetPaths: plan.call.targetPaths,
      surfaceConstraint,
    });
    const outcome = await this.executor.executeCanonical(plan, {
      ...context,
      authority: authorization.receipt,
      authoritySession: this.authority,
      host,
    });
    this.receipts.push(outcome.receipt as CodingToolExecutionReceipt<unknown>);
    return outcome;
  }

  deny(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
    reason: string,
  ): Promise<CodingToolExecutionOutcome<never>> {
    return this.settle(
      plan,
      context,
      { execute: async () => { throw new Error('denied tool host must not execute'); } },
      {
        decision: 'deny',
        reason,
        evidenceRefs: [`vscode-tool-constraint:${context.actionId}:denied`],
      },
    );
  }

  fail(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
    errorCode: string,
  ): Promise<CodingToolExecutionOutcome<never>> {
    return this.settle(plan, context, {
      execute: async () => ({
        status: 'failed',
        errorCode,
        evidenceRefs: [`vscode-tool-host:${context.actionId}:failed`],
      }),
    });
  }

  async observe<TResult>(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
    observe: () => Promise<TResult>,
    record: (result: TResult) => EvidenceRef,
  ): Promise<{receipt: CodingToolExecutionReceipt<TResult>; error?: string}> {
    let error: string | undefined;
    const uncertainOnFailure = plan.kind === 'network' || plan.kind === 'memory';
    const outcome = await this.settle(plan, context, {
      execute: async () => {
        try {
          const result = await observe();
          const evidence = record(result);
          this.evidenceRefs.push(evidence);
          return {
            status: 'completed' as const,
            result,
            evidenceRefs: [evidence.evidenceId ?? evidence.ref ?? `vscode-tool-observation:${context.actionId}`],
          };
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
          return {
            status: uncertainOnFailure ? 'indeterminate' as const : 'failed' as const,
            errorCode: uncertainOnFailure ? 'tool-host-effect-indeterminate' : 'tool-host-observation-failed',
            evidenceRefs: [`vscode-tool-host:${context.actionId}:${uncertainOnFailure ? 'indeterminate' : 'failed'}`],
          };
        }
      },
    });
    return { receipt: outcome.receipt, ...(error ? { error } : {}) };
  }

}

function mergeSurfaceConstraints(
  plan: AgentToolExecutionPlan,
  context: CanonicalToolContext,
  supplied: CodingToolSurfaceConstraint | undefined,
): CodingToolSurfaceConstraint {
  const policyAction = plan.permission?.action ?? 'deny';
  const evidenceRefs = [...new Set([
    `vscode-tool-policy:${context.actionId}:${policyAction}`,
    ...(supplied?.evidenceRefs ?? []),
  ])];
  if (policyAction === 'deny' || supplied?.decision === 'deny') {
    return {
      decision: 'deny',
      reason: supplied?.reason ?? plan.permission?.reason ?? 'missing-vscode-tool-policy',
      evidenceRefs,
    };
  }

  const requiresConfirmation = policyAction === 'requireConfirm'
    || supplied?.decision === 'require-confirmation';
  const confirmationRef = supplied?.confirmationRef?.trim();
  if (requiresConfirmation && !confirmationRef) {
    return {
      decision: 'require-confirmation',
      reason: supplied?.reason ?? plan.permission?.reason ?? 'vscode-tool-confirmation-missing',
      evidenceRefs,
    };
  }
  const reason = supplied?.reason ?? plan.permission?.reason ?? 'vscode-tool-policy-allowed';
  if (requiresConfirmation) {
    return { decision: 'require-confirmation', reason, confirmationRef, evidenceRefs };
  }
  return { decision: 'allow', reason, evidenceRefs };
}
