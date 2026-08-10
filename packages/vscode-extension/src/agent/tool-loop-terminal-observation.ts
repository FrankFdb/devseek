import type {
  CodingToolExecutionReceipt,
  CodingVerificationCriterion,
  CodingVerificationReceipt,
  CodingVerificationSessionPort,
} from '@devseek-netai/shared';
import {
  isReadOnlyTerminalEvidenceCommand,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { EvidenceRef } from './evidence-grounding';
import { recordTerminalVerification } from './terminal-verification-adapter';
import { ToolReadEvidenceRecorder } from './tool-read-evidence';
import { analyzeTerminalEvidence } from './tool-loop-terminal-evidence';

export interface SettledTerminalObservationInput {
  readonly command: string;
  readonly output: string;
  readonly workdir: string;
  readonly workspaceRoot: string;
  readonly toolReceipt: CodingToolExecutionReceipt<unknown>;
  readonly readEvidenceRecorder: ToolReadEvidenceRecorder;
  readonly writtenFiles: readonly WrittenFileEvidence[];
  readonly acceptance?: readonly CodingVerificationCriterion[];
  readonly verification?: CodingVerificationSessionPort;
}

export interface SettledTerminalObservation {
  readonly output: { readonly command: string; readonly workdir: string; readonly output: string };
  readonly evidenceRef: EvidenceRef;
  readonly terminalCommands: readonly string[];
  readonly terminalEvidence: readonly TerminalEvidence[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly feedbackParts: readonly string[];
}

/** Owns the evidence and feedback projection of one already-settled terminal action. */
export async function observeSettledTerminalExecution(
  input: SettledTerminalObservationInput,
): Promise<SettledTerminalObservation> {
  const analyzed = analyzeTerminalEvidence(input.command, input.output, input.workdir);
  const canonicalEvidence: TerminalEvidence = {
    ...analyzed.evidence,
    canonicalAction: {
      actionId: input.toolReceipt.actionId,
      sequence: input.toolReceipt.sequence,
      evidenceRefs: input.toolReceipt.evidenceRefs,
    },
  };
  const verificationReceipt = input.verification && input.acceptance?.length
    ? await recordTerminalVerification({
      toolReceipt: input.toolReceipt,
      evidence: canonicalEvidence,
      workspaceRoot: input.workspaceRoot,
      workdir: input.workdir,
      writtenFiles: input.writtenFiles,
      acceptance: input.acceptance,
      verification: input.verification,
    })
    : undefined;
  const feedbackParts = [`[run_terminal: ${input.command}]\n${input.output}`];
  if (canonicalEvidence.kind !== 'other' && !canonicalEvidence.ok) {
    feedbackParts.push(
      `[terminal_evidence]\n`
      + `验证命令未通过，不能把编译/运行/测试标记为完成。\n`
      + `kind=${canonicalEvidence.kind} exitCode=${canonicalEvidence.exitCode ?? 'unknown'}\n`
      + `${canonicalEvidence.detail ?? '请根据终端输出修复后重新验证。'}`,
    );
  }
  return {
    output: { command: input.command, workdir: input.workdir, output: input.output },
    evidenceRef: input.readEvidenceRecorder.recordTerminalOutput(
      input.command,
      input.output,
      input.workdir,
      canonicalEvidence.exitCode,
    ),
    terminalCommands: analyzed.ran ? [input.command] : [],
    terminalEvidence: canonicalEvidence.kind !== 'other'
      || isReadOnlyTerminalEvidenceCommand(input.command)
      ? [canonicalEvidence]
      : [],
    verificationReceipts: verificationReceipt ? [verificationReceipt] : [],
    feedbackParts,
  };
}
