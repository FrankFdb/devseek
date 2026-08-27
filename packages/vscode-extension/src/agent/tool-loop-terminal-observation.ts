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
import { projectActionableDiagnosticExcerpt } from '../app/diagnostic-output-projection';
import { isDiagnosticProjectionCommand } from '../tools/shell-command-analysis';

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
  const failureDetail = analyzed.evidence.ok
    ? analyzed.evidence.detail
    : analyzed.evidence.detail ?? projectActionableDiagnosticExcerpt(input.output, 1800);
  const canonicalEvidence: TerminalEvidence = {
    ...analyzed.evidence,
    ...(failureDetail ? { detail: failureDetail } : {}),
    workdir: input.workdir,
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
  if (isDiagnosticProjectionCommand(input.command)) {
    feedbackParts.push(
      `[terminal_evidence]\n`
      + '当前命令包含输出截断或非断言诊断过滤，只能用于观察，不能建立或清除编译、运行、测试通过证据。\n'
      + '即使显示 exitCode=0，也可能只是末级过滤器成功。请去掉 head/tail/sed 或诊断 grep/rg 管道后原样重跑待验证命令；终端宿主会限制反馈长度。',
    );
  }
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
