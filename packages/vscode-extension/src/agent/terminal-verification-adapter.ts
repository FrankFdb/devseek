import {
  buildCodingVerificationPlan,
  type CodingToolExecutionReceipt,
  type CodingVerificationCriterion,
  type CodingVerificationReceipt,
  type CodingVerificationSessionPort,
} from '@devseek-netai/shared';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { workspaceRelativeVerificationPaths } from './verification-scope';

export interface TerminalVerificationObservation {
  readonly toolReceipt: CodingToolExecutionReceipt<unknown>;
  readonly evidence: TerminalEvidence;
  readonly workspaceRoot: string;
  readonly workdir: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly verification: CodingVerificationSessionPort;
}

/**
 * Projects one already-settled validation command into Verification without
 * rerunning it. Failed or ambiguous commands remain tool evidence only.
 */
export async function recordPassedTerminalVerification(
  input: TerminalVerificationObservation,
): Promise<CodingVerificationReceipt | undefined> {
  if (!isCanonicalPassedValidation(input)) return undefined;
  const { toolReceipt, evidence } = input;
  const scopePaths = workspaceRelativeVerificationPaths(input.writtenFiles, input.workspaceRoot);
  const canonicalScope = scopePaths.length > 0 ? scopePaths : ['workspace'];
  const evidenceRefs = [
    ...toolReceipt.evidenceRefs,
    ...(evidence.canonicalAction?.evidenceRefs ?? []),
    `vscode-terminal-verification:${toolReceipt.actionId}:exit-0`,
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
          status: 'passed',
          acceptanceIds: input.acceptance.map(criterion => criterion.id),
          summary: `Executed ${evidence.kind} validation passed.`,
          command: evidence.command,
          exitCode: 0,
          evidenceRefs,
        }],
        evidenceRefs,
      };
    },
  });
  return outcome.receipt;
}

function isCanonicalPassedValidation(input: TerminalVerificationObservation): boolean {
  const { toolReceipt, evidence, verification } = input;
  const action = evidence.canonicalAction;
  return toolReceipt.runId === verification.runId
    && toolReceipt.tool === 'run_terminal'
    && toolReceipt.purpose === 'verify'
    && toolReceipt.effects.length === 1
    && toolReceipt.effects[0] === 'process'
    && toolReceipt.status === 'completed'
    && input.acceptance.length > 0
    && evidence.kind !== 'other'
    && evidence.ok
    && evidence.exitCode === 0
    && action?.actionId === toolReceipt.actionId
    && action.sequence === toolReceipt.sequence;
}
