import * as nodePath from 'path';
import type {
  CodingVerificationCriterion,
  CodingVerificationReceipt,
  CodingVerificationSessionPort,
} from '@devseek-netai/shared';
import { VsCodeVerificationAdapter } from '../app/coding-verification-adapter';
import type { TerminalEvidence, WrittenFileEvidence } from './completion-evidence';
import { shouldRequestManualReviewForRun } from './manual-review-validation';

const canonicalTerminalVerification = new VsCodeVerificationAdapter();

export interface TerminalVerificationProjectionInput {
  readonly runId: string | undefined;
  readonly workspaceRoot: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly adapter?: Pick<VsCodeVerificationAdapter, 'verify'>;
  readonly verification?: CodingVerificationSessionPort;
}

export function classifyAgenticManualReviewEvidence(input: {
  readonly evidence: readonly TerminalEvidence[] | undefined;
  readonly feedbackForAI: string;
  readonly userPrompt: string;
  readonly writtenFiles: readonly WrittenFileEvidence[];
}): TerminalEvidence[] {
  if (!input.evidence?.length) return [];
  const changedPaths = input.writtenFiles.map(file => file.path).filter(Boolean);
  return input.evidence.map((evidence) => {
    if (evidence.reviewRequired || evidence.ok) return evidence;
    const review = shouldRequestManualReviewForRun({
      userPrompt: input.userPrompt,
      command: evidence.command,
      output: input.feedbackForAI || evidence.detail || '',
      changedPaths,
      terminalEvidence: evidence,
    });
    return review
      ? {
          ...evidence,
          ok: true,
          reviewRequired: true,
          detail: review.detail,
        }
      : evidence;
  });
}

/** Projects settled compile/run/test actions into acceptance-aware verification receipts. */
export async function projectTerminalVerificationReceipts(
  input: TerminalVerificationProjectionInput,
): Promise<CodingVerificationReceipt[]> {
  const runId = input.runId?.trim();
  if (!runId) return [];
  const scopePaths = workspaceRelativeWrittenPaths(input.writtenFiles, input.workspaceRoot);
  const adapter = input.adapter
    ?? (input.verification
      ? new VsCodeVerificationAdapter(input.verification)
      : canonicalTerminalVerification);
  const receipts: CodingVerificationReceipt[] = [];

  for (const evidence of input.terminalEvidence) {
    const action = evidence.canonicalAction;
    if (!action || evidence.kind === 'other') continue;
    const evidenceRefs = uniqueNonEmpty([
      ...action.evidenceRefs,
      `terminal-verification:${action.actionId}`,
    ]);
    const outcome = await adapter.verify({
      runId,
      sequence: action.sequence,
      actionId: action.actionId,
      scopePaths,
      acceptance: input.acceptance,
      evidenceRefs,
      verifier: `vscode-terminal-${evidence.kind}`,
      observe: async () => ({
        status: evidence.ok ? 'passed' : 'failed',
        summary: evidence.ok
          ? `Terminal ${evidence.kind} verification passed.`
          : `Terminal ${evidence.kind} verification failed.`,
        command: evidence.command,
        exitCode: evidence.exitCode,
        evidenceRefs,
      }),
    });
    receipts.push(outcome.receipt);
  }
  return receipts;
}

function workspaceRelativeWrittenPaths(
  writtenFiles: readonly WrittenFileEvidence[],
  workspaceRoot: string,
): string[] {
  const root = nodePath.resolve(workspaceRoot);
  return uniqueNonEmpty(writtenFiles.flatMap(file => {
    const absolutePath = nodePath.resolve(nodePath.isAbsolute(file.path)
      ? file.path
      : nodePath.join(root, file.path));
    const relativePath = nodePath.relative(root, absolutePath).replace(/\\/g, '/');
    return !relativePath || relativePath === '..' || relativePath.startsWith('../')
      ? []
      : [relativePath];
  }));
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}
