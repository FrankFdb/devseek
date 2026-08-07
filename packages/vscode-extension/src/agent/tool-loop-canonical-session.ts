import {
  CanonicalExternalEffectService,
  CanonicalToolAuthorityService,
  resolveCodingKernelTaskContract,
  type CodingTaskMode,
  type CodingExternalEffectReconciliation,
  type CodingExternalEffectSessionPort,
  type CodingToolAuthorityReceipt,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionOutcome,
  type CodingToolExecutionReceipt,
  type CodingToolHostResult,
  type CodingToolSurfaceConstraint,
} from '@devseek-netai/shared';
import type { AgentLoopCallbacks } from './loop-types';
import type { AgentFileWriteInput } from './tool-registry';
import {
  AgentToolExecutor,
  type AgentToolExecutionPlan,
  type EvidenceRef,
} from './tool-executor';

export interface CanonicalToolContext {
  readonly runId: string;
  readonly sequence: number;
  readonly actionId: string;
}

interface CanonicalToolHost<TResult> {
  execute(
    plan: AgentToolExecutionPlan,
    authority: CodingToolAuthorityReceipt,
  ): Promise<CodingToolHostResult<TResult>>;
  reconcile?(
    plan: AgentToolExecutionPlan,
    authority: CodingToolAuthorityReceipt,
  ): Promise<CodingExternalEffectReconciliation<TResult>>;
}

let directToolLoopRunSequence = 0;

export function createToolLoopCanonicalSession(input: {
  readonly callbacks: AgentLoopCallbacks;
  readonly workspaceRoot: string;
  readonly userPrompt?: string;
  readonly receipts: CodingToolExecutionReceipt<unknown>[];
  readonly evidenceRefs: EvidenceRef[];
}): ToolLoopCanonicalSession {
  const { callbacks, workspaceRoot } = input;
  if (callbacks.canonicalToolAuthority && callbacks.canonicalExternalEffects) {
    return new ToolLoopCanonicalSession(
      callbacks.traceRunId?.trim() || 'vscode-kernel-tool-loop',
      input.receipts,
      input.evidenceRefs,
      callbacks.canonicalToolAuthority,
      callbacks.canonicalExternalEffects,
    );
  }
  if (callbacks.canonicalToolAuthority || callbacks.canonicalExternalEffects) {
    throw new Error('vscode-tool-loop:incomplete-canonical-tool-sessions');
  }

  // Direct loop tests still exercise the same authority owners as product execution.
  directToolLoopRunSequence += 1;
  const runId = `${callbacks.traceRunId?.trim() || 'vscode-direct-tool-loop'}-${directToolLoopRunSequence}`;
  const taskContract = resolveCodingKernelTaskContract({
    prompt: input.userPrompt?.trim() || 'Execute the requested VS Code tool loop safely.',
    surface: 'vscode',
    modeHint: projectCodingTaskMode(callbacks.executionMode),
  });
  const authority = new CanonicalToolAuthorityService().bind({
    runId,
    surface: 'vscode',
    workspaceRoot,
    taskContract,
  });
  return new ToolLoopCanonicalSession(
    runId,
    input.receipts,
    input.evidenceRefs,
    authority,
    new CanonicalExternalEffectService().bind({ runId, authority }),
  );
}

/** Owns canonical authority and receipt settlement for one ToolLoop invocation. */
export class ToolLoopCanonicalSession {
  private sequence = 0;

  constructor(
    private readonly runId: string,
    private readonly receipts: CodingToolExecutionReceipt<unknown>[],
    private readonly evidenceRefs: EvidenceRef[],
    private readonly authority: CodingToolAuthoritySessionPort,
    private readonly externalEffects: CodingExternalEffectSessionPort,
    private readonly executor = new AgentToolExecutor(),
  ) {}

  nextContext(plan: AgentToolExecutionPlan): CanonicalToolContext {
    this.sequence += 1;
    const normalizedTool = plan.tool.name.trim().replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'unknown';
    const actionId = `vscode-tool-${this.sequence}-${normalizedTool}`;
    return {
      runId: this.runId,
      sequence: this.sequence,
      actionId,
    };
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
      targetPaths: projectTargetPaths(plan),
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

function projectCodingTaskMode(mode: AgentLoopCallbacks['executionMode']): CodingTaskMode {
  if (mode === 'inspect') return 'review';
  if (mode === 'edit' || mode === 'run' || mode === 'destructive') return 'change';
  return 'explain';
}

export function projectFileWriteActionPlan(
  plan: AgentToolExecutionPlan,
  fileWrite: AgentFileWriteInput,
): AgentToolExecutionPlan {
  const input = { path: fileWrite.rawPath, content: fileWrite.content };
  return {
    ...plan,
    tool: { ...plan.tool, input },
    call: { ...plan.call, input },
  };
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

function projectTargetPaths(plan: AgentToolExecutionPlan): string[] {
  const input = plan.call.input;
  return [...new Set(['path', 'filePath', 'targetPath']
    .map(key => input[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim()))];
}
