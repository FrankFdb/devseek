import {
  buildCodingVerificationPlan,
  type CodingToolExecutionReceipt,
  type CodingVerificationCriterion,
  type CodingVerificationReceipt,
  type CodingVerificationSessionPort,
} from '@devseek-netai/shared';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { workspaceRelativeVerificationPaths } from './verification-scope';
import { isDiagnosticProjectionCommand } from '../tools/shell-command-analysis';

export interface TerminalVerificationObservation {
  readonly toolReceipt: CodingToolExecutionReceipt<unknown>;
  readonly evidence: TerminalEvidence;
  readonly workspaceRoot: string;
  readonly workdir: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly verification: CodingVerificationSessionPort;
  /** Dispatch purpose may predate a same-batch, evidence-settled contract revision. */
  readonly contractBinding?: 'dispatch-time' | 'settled-semantic-revision';
}

export interface SettledTerminalVerificationBatch {
  readonly toolReceipts: readonly CodingToolExecutionReceipt<unknown>[];
  readonly evidence: readonly TerminalEvidence[];
  readonly existingReceipts: readonly CodingVerificationReceipt[];
  readonly workspaceRoot: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly verification: CodingVerificationSessionPort;
}

/** Projects one deterministic terminal result into Verification without rerunning it. */
export async function recordTerminalVerification(
  input: TerminalVerificationObservation,
): Promise<CodingVerificationReceipt | undefined> {
  const terminalStatus = canonicalTerminalVerificationStatus(input);
  if (!terminalStatus) return undefined;
  const { toolReceipt, evidence } = input;
  const scopePaths = workspaceRelativeVerificationPaths(input.writtenFiles, input.workspaceRoot);
  const canonicalScope = scopePaths.length > 0 ? scopePaths : ['workspace'];
  const evidenceRefs = [
    ...toolReceipt.evidenceRefs,
    ...(evidence.canonicalAction?.evidenceRefs ?? []),
    `vscode-terminal-verification:${toolReceipt.actionId}:exit-${terminalStatus.exitCode}`,
  ];
  const outcome = await input.verification.verify(buildCodingVerificationPlan({
    runId: toolReceipt.runId,
    sequence: toolReceipt.sequence,
    actionId: toolReceipt.actionId,
    idempotencyKey: `${toolReceipt.runId}:${toolReceipt.actionId}`,
    scopePaths: canonicalScope,
    acceptance: input.acceptance,
    payload: {
      source: 'settled-terminal-tool' as const,
      command: evidence.command,
      kind: evidence.kind,
      workdir: input.workdir,
    },
    evidenceRefs,
  }), {
    async verify() {
      return {
        verifier: 'vscode-terminal-execution',
        checks: [{
          checkId: `terminal-${toolReceipt.actionId}`,
          status: terminalStatus.status,
          acceptanceIds: input.acceptance.map(criterion => criterion.id),
          summary: terminalStatus.status === 'passed'
            ? `Executed ${evidence.kind} validation passed.`
            : `Executed ${evidence.kind} validation failed with exit code ${terminalStatus.exitCode}.`,
          command: evidence.command,
          exitCode: terminalStatus.exitCode,
          evidenceRefs,
        }],
        evidenceRefs,
      };
    },
  });
  return outcome.receipt;
}

/** Binds already-settled terminal evidence after an evidence-backed contract refinement. */
export async function recordNewlyAcceptedTerminalVerifications(
  input: SettledTerminalVerificationBatch,
): Promise<CodingVerificationReceipt[]> {
  if (input.acceptance.length === 0) return [];
  const recordedActionIds = new Set(input.existingReceipts.map(receipt => receipt.actionId));
  const toolReceipts = new Map(input.toolReceipts.map(receipt => [receipt.actionId, receipt]));
  const receipts: CodingVerificationReceipt[] = [];
  for (const evidence of input.evidence) {
    const actionId = evidence.canonicalAction?.actionId;
    if (!actionId || recordedActionIds.has(actionId)) continue;
    const toolReceipt = toolReceipts.get(actionId);
    if (!toolReceipt) continue;
    const receipt = await recordTerminalVerification({
      toolReceipt,
      evidence,
      workspaceRoot: input.workspaceRoot,
      workdir: evidence.workdir ?? input.workspaceRoot,
      writtenFiles: input.writtenFiles,
      acceptance: input.acceptance,
      verification: input.verification,
      contractBinding: 'settled-semantic-revision',
    });
    if (!receipt) continue;
    recordedActionIds.add(actionId);
    receipts.push(receipt);
  }
  return receipts;
}

function canonicalTerminalVerificationStatus(
  input: TerminalVerificationObservation,
): { readonly status: 'passed' | 'failed'; readonly exitCode: number } | undefined {
  const { toolReceipt, evidence, verification } = input;
  const action = evidence.canonicalAction;
  const purposeIsVerification = toolReceipt.purpose === 'verify'
    || input.contractBinding === 'settled-semantic-revision';
  const hasCanonicalOwnership = toolReceipt.runId === verification.runId
    && toolReceipt.tool === 'run_terminal'
    && purposeIsVerification
    && toolReceipt.effects.length === 1
    && toolReceipt.effects[0] === 'process'
    && input.acceptance.length > 0
    && evidence.kind !== 'other'
    && action?.actionId === toolReceipt.actionId
    && action.sequence === toolReceipt.sequence
    && !isDiagnosticProjectionCommand(evidence.command);
  if (!hasCanonicalOwnership) return undefined;
  if (toolReceipt.status === 'completed' && evidence.ok && evidence.exitCode === 0) {
    return { status: 'passed', exitCode: 0 };
  }
  if (toolReceipt.status === 'failed'
    && !evidence.ok
    && Number.isSafeInteger(evidence.exitCode)
    && evidence.exitCode !== 0) {
    return { status: 'failed', exitCode: evidence.exitCode as number };
  }
  return undefined;
}
