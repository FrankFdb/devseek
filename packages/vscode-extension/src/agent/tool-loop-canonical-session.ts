import type {
  CodingToolAuthorityReceipt,
  CodingToolExecutionOutcome,
  CodingToolExecutionReceipt,
  CodingToolHostResult,
} from '@devseek-netai/shared';
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
  readonly authorityEvidenceRefs: readonly string[];
}

let fallbackCanonicalToolSequence = 0;

/** Owns canonical receipt settlement for one ToolLoop invocation. */
export class ToolLoopCanonicalSession {
  constructor(
    private readonly receipts: CodingToolExecutionReceipt<unknown>[],
    private readonly evidenceRefs: EvidenceRef[],
    private readonly executor = new AgentToolExecutor(),
  ) {}

  nextContext(runId: string | undefined, plan: AgentToolExecutionPlan): CanonicalToolContext {
    fallbackCanonicalToolSequence += 1;
    const sequence = fallbackCanonicalToolSequence;
    const normalizedTool = plan.tool.name.trim().replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'unknown';
    const actionId = `vscode-tool-${sequence}-${normalizedTool}`;
    return {
      runId: runId?.trim() || 'vscode-tool-loop',
      sequence,
      actionId,
      authorityEvidenceRefs: [`vscode-tool-policy:${actionId}:${plan.permission?.action ?? 'missing'}`],
    };
  }

  async settle<TResult>(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
    host: { execute(plan: AgentToolExecutionPlan): Promise<CodingToolHostResult<TResult>> },
    authority?: CodingToolAuthorityReceipt,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const outcome = await this.executor.executeCanonical(plan, {
      ...context,
      ...(authority ? { authority } : {}),
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
        status: 'denied',
        reason,
        evidenceRefs: [`vscode-tool-authority:${context.actionId}:denied`],
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

  fileWriteAuthority(
    plan: AgentToolExecutionPlan,
    context: CanonicalToolContext,
  ): CodingToolAuthorityReceipt {
    const requiresConfirmation = plan.permission?.action === 'requireConfirm';
    return {
      decision: requiresConfirmation ? 'require-confirmation' : 'allow',
      status: 'authorized',
      reason: plan.permission?.reason ?? 'vscode-file-write-authorized',
      ...(requiresConfirmation ? {
        confirmationRef: `vscode-file-write-confirmation:${context.actionId}`,
      } : {}),
      evidenceRefs: [`vscode-file-write-authority:${context.actionId}:authorized`],
    };
  }
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
