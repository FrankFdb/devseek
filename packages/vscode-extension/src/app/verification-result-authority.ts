export type VerificationResultStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'missing'
  | 'not-run'
  | 'manual-required'
  | 'flaky';

export interface VerificationAuthorityResult {
  version: 'devseek.verification-result/v1';
  status: VerificationResultStatus;
  ran: boolean;
  ok: boolean;
  command: string;
  exitCode: number | null;
  reason?: string;
  mode?: string;
  output: string;
  risks: string[];
  alternativeChecks: string[];
  sourceCanWrite: false;
}

export interface VerificationRawResult {
  ran: boolean;
  ok: boolean;
  status?: 'passed' | 'failed' | 'blocked';
  command?: string;
  exitCode?: number | null;
  reason?: string;
  mode?: string;
  output?: string;
  cwd?: string;
  risks?: string[];
  alternativeChecks?: string[];
}

export interface VerificationHistoryEntry extends VerificationRawResult {
  evidenceRef?: string;
  resolvedByEvidenceRef?: string;
}

export interface VerificationHistoryVeto {
  version: 'devseek.verification-history-veto/v1';
  status: Exclude<VerificationResultStatus, 'passed'>;
  reason: string;
  command: string;
  exitCode: number | null;
  mode?: string;
  evidenceRefs: string[];
  risks: string[];
  alternativeChecks: string[];
  completionCandidate: false;
  terminalEvidenceEligible: false;
}

export function normalizeVerificationResult(
  result: VerificationRawResult | null | undefined,
): VerificationAuthorityResult {
  if (!result) {
    return {
      version: 'devseek.verification-result/v1',
      status: 'missing',
      ran: false,
      ok: false,
      command: '',
      exitCode: null,
      reason: 'missing-verification-result',
      mode: undefined,
      output: '',
      risks: ['缺少自动验证结果，不能证明变更后的行为正确。'],
      alternativeChecks: [],
      sourceCanWrite: false,
    };
  }

  const reason = normalizeText(result.reason);
  const command = normalizeText(result.command) ?? '';
  const output = normalizeText(result.output) ?? '';
  const authorityBase = {
    version: 'devseek.verification-result/v1' as const,
    ran: result.ran === true,
    ok: result.ok === true,
    command,
    exitCode: result.exitCode ?? null,
    ...(reason ? { reason } : {}),
    ...(result.mode ? { mode: result.mode } : {}),
    output,
    risks: [...(result.risks ?? [])],
    alternativeChecks: [...(result.alternativeChecks ?? [])],
    sourceCanWrite: false as const,
  };
  const signalText = `${reason ?? ''}\n${command}\n${output}`.toLowerCase();

  if (looksManualRequired(signalText)) {
    return {
      ...authorityBase,
      status: 'manual-required',
      ran: false,
      ok: false,
    };
  }

  if (result.ran !== true) {
    const risks = authorityBase.risks.length
      ? authorityBase.risks
      : ['验证命令未执行，不能证明变更后的行为正确。'];
    if (result.status === 'blocked') {
      return {
        ...authorityBase,
        status: 'blocked',
        ran: false,
        ok: false,
        risks,
      };
    }
    return {
      ...authorityBase,
      status: 'not-run',
      ran: false,
      ok: false,
      risks,
    };
  }

  if (looksFlaky(signalText, result.exitCode ?? null)) {
    return {
      ...authorityBase,
      status: 'flaky',
      ok: false,
      risks: authorityBase.risks.length
        ? authorityBase.risks
        : ['验证结果疑似不稳定，需要重试或人工确认。'],
    };
  }

  if (result.status === 'blocked') {
    return {
      ...authorityBase,
      status: 'blocked',
      ok: false,
    };
  }

  return {
    ...authorityBase,
    status: result.ok === true ? 'passed' : 'failed',
    ok: result.ok === true,
  };
}

export function shouldEmitTerminalEvidenceForVerification(result: VerificationAuthorityResult): boolean {
  return result.status === 'passed' || result.status === 'failed';
}

export function verificationResultIsCompletionCandidate(result: VerificationAuthorityResult): boolean {
  return result.status === 'passed';
}

export function findUnresolvedVerificationHistoryVeto(
  history: readonly VerificationHistoryEntry[] | null | undefined,
): VerificationHistoryVeto | undefined {
  const entries = (history ?? []).filter(Boolean);
  for (const entry of entries) {
    const verification = normalizeVerificationResult(entry);
    if (verificationResultIsCompletionCandidate(verification)) continue;
    if (verificationHistoryEntryIsResolved(entry, entries)) continue;

    const reasonTail = verification.reason || verification.command || verification.status;
    return {
      version: 'devseek.verification-history-veto/v1',
      status: verification.status as Exclude<VerificationResultStatus, 'passed'>,
      reason: `unresolved-verification-history:${verification.status}:${reasonTail}`,
      command: verification.command,
      exitCode: verification.exitCode,
      ...(verification.mode ? { mode: verification.mode } : {}),
      evidenceRefs: [verificationHistoryEvidenceRef(entry, verification)],
      risks: verificationHistoryRisks(verification),
      alternativeChecks: verification.alternativeChecks.length > 0
        ? verification.alternativeChecks
        : ['找到并记录解除该历史验证事实的确定性验证证据。'],
      completionCandidate: false,
      terminalEvidenceEligible: false,
    };
  }
  return undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function looksManualRequired(text: string): boolean {
  return /(manual|human|visual|interactive|人工|手动|目视|观察|确认)/.test(text)
    && /(required|review|confirm|人工|手动|目视|观察|确认)/.test(text);
}

function looksFlaky(text: string, exitCode: number | null): boolean {
  return exitCode === 124
    || /(flaky|intermittent|timed?\s*out|timeout|超时|偶发|不稳定)/.test(text);
}

function verificationHistoryEntryIsResolved(
  entry: VerificationHistoryEntry,
  history: readonly VerificationHistoryEntry[],
): boolean {
  const resolvedByEvidenceRef = normalizeText(entry.resolvedByEvidenceRef);
  if (!resolvedByEvidenceRef) return false;
  return history.some(candidate => {
    if (normalizeText(candidate.evidenceRef) !== resolvedByEvidenceRef) return false;
    return verificationResultIsCompletionCandidate(normalizeVerificationResult(candidate));
  });
}

function verificationHistoryEvidenceRef(
  entry: VerificationHistoryEntry,
  verification: VerificationAuthorityResult,
): string {
  const explicitRef = normalizeText(entry.evidenceRef);
  if (explicitRef) return explicitRef;
  const kind = shouldEmitTerminalEvidenceForVerification(verification)
    ? verification.status
    : 'blocked';
  return `validation:${kind}:${verification.command || verification.reason || verification.status}`;
}

function verificationHistoryRisks(verification: VerificationAuthorityResult): string[] {
  if (verification.risks.length > 0) return verification.risks;
  if (verification.status === 'failed') {
    return ['历史验证存在未解除失败，不能被后续绿色结果覆盖。'];
  }
  if (verification.status === 'flaky') {
    return ['历史验证疑似不稳定，不能用单次绿色重跑覆盖。'];
  }
  if (verification.status === 'manual-required') {
    return ['历史验证仍需要人工确认，不能用自动重跑覆盖。'];
  }
  return ['历史验证存在未解除阻塞，不能把任务标记为完成。'];
}
