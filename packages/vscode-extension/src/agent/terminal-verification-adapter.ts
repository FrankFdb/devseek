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

function canonicalTerminalVerificationStatus(
  input: TerminalVerificationObservation,
): { readonly status: 'passed' | 'failed'; readonly exitCode: number } | undefined {
  const { toolReceipt, evidence, verification } = input;
  const action = evidence.canonicalAction;
  const hasCanonicalOwnership = toolReceipt.runId === verification.runId
    && toolReceipt.tool === 'run_terminal'
    && toolReceipt.purpose === 'verify'
    && toolReceipt.effects.length === 1
    && toolReceipt.effects[0] === 'process'
    && input.acceptance.length > 0
    && evidence.kind !== 'other'
    && action?.actionId === toolReceipt.actionId
    && action.sequence === toolReceipt.sequence;
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
