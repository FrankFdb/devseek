import type { AutoValidationResult } from '../workspace/validation-service';

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

export function normalizeVerificationResult(
  result: AutoValidationResult | null | undefined,
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

  if (looksFlaky(signalText, result.exitCode)) {
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
