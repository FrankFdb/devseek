import {
  buildValidationFailureDiagnosis,
  type FailureDiagnosis,
} from './failure-diagnosis';
import {
  normalizeVerificationResult,
  shouldEmitTerminalEvidenceForVerification,
  verificationResultIsCompletionCandidate,
  type VerificationResultStatus,
} from './verification-result-authority';

export type QualityGateStatus = 'pass' | 'fail' | 'blocked';
export type QualityGateContractAcceptanceStatus =
  | 'accepted'
  | 'missing'
  | 'pending'
  | 'weak-oracle'
  | 'adverse';

export interface QualityGateRiskAcceptance {
  source: 'user' | 'policy';
  note?: string;
  acceptedAt: number;
}

export interface QualityGateValidationEvidence {
  ran: boolean;
  ok: boolean;
  status?: 'passed' | 'failed' | 'blocked';
  command?: string;
  exitCode?: number | null;
  output?: string;
  cwd?: string;
  mode?: string;
  reason?: string;
  risks?: string[];
  alternativeChecks?: string[];
}

export interface QualityGateContractAcceptance {
  status: QualityGateContractAcceptanceStatus;
  reason?: string;
  evidenceRefs?: string[];
  risks?: string[];
  alternativeChecks?: string[];
  requiredActions?: string[];
}

export interface QualityGateInput {
  changedPaths: string[];
  validation?: QualityGateValidationEvidence | null;
  contractAcceptance?: QualityGateContractAcceptance;
  acceptedRisk?: QualityGateRiskAcceptance;
  adverseEvidenceCount?: number;
}

export interface QualityGateDecision {
  version: 'devseek.quality-gate-decision/v1';
  authority: 'QualityGateService';
  status: QualityGateStatus;
  summary: string;
  evidenceRefs: string[];
  verificationStatus?: VerificationResultStatus;
  contractAcceptanceStatus?: QualityGateContractAcceptanceStatus;
  failureDiagnosis?: FailureDiagnosis;
  risks: string[];
  alternativeChecks: string[];
  requiredActions: string[];
  acceptedRisk?: QualityGateRiskAcceptance;
}

export class QualityGateService {
  evaluate(input: QualityGateInput): QualityGateDecision {
    const contractVeto = evaluateContractAcceptance(input.contractAcceptance);
    if (contractVeto) return contractVeto;

    if ((input.adverseEvidenceCount ?? 0) > 0) {
      return {
        version: 'devseek.quality-gate-decision/v1',
        authority: 'QualityGateService',
        status: 'fail',
        summary: `QualityGate 未通过：存在 ${input.adverseEvidenceCount} 个未解除的不利证据。`,
        evidenceRefs: ['run-context:adverse-evidence'],
        contractAcceptanceStatus: input.contractAcceptance?.status ?? 'accepted',
        risks: ['存在未解除的不利证据，不能把任务标记为完成。'],
        alternativeChecks: [],
        requiredActions: ['先通过恢复/重新验证解除不利证据后再结算。'],
      };
    }

    const validation = input.validation;
    if (!validation) {
      return this.blockedDecision({
        changedPaths: input.changedPaths,
        status: 'missing',
        reason: 'no-validation-evidence',
        risks: ['没有自动验证证据，不能证明变更后的行为正确。'],
        alternativeChecks: [],
        acceptedRisk: input.acceptedRisk,
        verificationStatus: 'missing',
        contractAcceptanceStatus: input.contractAcceptance?.status ?? 'accepted',
      });
    }

    const verification = normalizeVerificationResult(validation);
    if (!shouldEmitTerminalEvidenceForVerification(verification)) {
      return this.blockedDecision({
        changedPaths: input.changedPaths,
        status: verification.status === 'missing' ? 'missing' : 'blocked',
        reason: verification.reason || verification.status,
        risks: verification.risks,
        alternativeChecks: verification.alternativeChecks,
        acceptedRisk: input.acceptedRisk,
        verificationStatus: verification.status,
        contractAcceptanceStatus: input.contractAcceptance?.status ?? 'accepted',
      });
    }

    if (verificationResultIsCompletionCandidate(verification)) {
      const ref = validationEvidenceRef('passed', validation);
      return {
        version: 'devseek.quality-gate-decision/v1',
        authority: 'QualityGateService',
        status: 'pass',
        summary: `QualityGate 通过：${validation.command || '自动验证'} 已通过。`,
        evidenceRefs: [ref],
        verificationStatus: verification.status,
        contractAcceptanceStatus: input.contractAcceptance?.status ?? 'accepted',
        risks: validation.risks || [],
        alternativeChecks: validation.alternativeChecks || [],
        requiredActions: [],
        ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
      };
    }

    const evidenceRef = validationEvidenceRef('failed', validation);
  return {
    version: 'devseek.quality-gate-decision/v1',
    authority: 'QualityGateService',
    status: 'fail',
    summary: `QualityGate 未通过：自动验证失败（exitCode=${validation.exitCode ?? 'null'}）。`,
    evidenceRefs: [evidenceRef],
    verificationStatus: verification.status,
    contractAcceptanceStatus: input.contractAcceptance?.status ?? 'accepted',
    failureDiagnosis: buildValidationFailureDiagnosis({
        status: 'failed',
        changedPaths: input.changedPaths,
        command: validation.command,
        exitCode: validation.exitCode,
        output: validation.output,
        reason: validation.reason,
        mode: validation.mode,
        evidenceRef,
      }),
      risks: [
        ...(validation.risks || []),
        '自动验证命令失败，不能把任务标记为完成。',
      ],
      alternativeChecks: validation.alternativeChecks || [],
      requiredActions: [
        '修复自动验证失败后重新运行 QualityGate。',
      ],
      ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
    };
  }

  private blockedDecision(input: {
    changedPaths: string[];
    status: 'blocked' | 'missing';
    reason: string;
    risks: string[];
    alternativeChecks: string[];
    acceptedRisk?: QualityGateRiskAcceptance;
    verificationStatus?: VerificationResultStatus;
    contractAcceptanceStatus?: QualityGateContractAcceptanceStatus;
  }): QualityGateDecision {
    const evidenceRef = `validation:${input.status}:${input.reason}`;
    return {
      version: 'devseek.quality-gate-decision/v1',
      authority: 'QualityGateService',
      status: 'blocked',
      summary: `QualityGate 阻塞：${input.reason}。`,
      evidenceRefs: [evidenceRef],
      verificationStatus: input.verificationStatus,
      contractAcceptanceStatus: input.contractAcceptanceStatus,
      failureDiagnosis: buildValidationFailureDiagnosis({
        status: input.status,
        changedPaths: input.changedPaths,
        reason: input.reason,
        output: input.risks.join('\n'),
        evidenceRef,
      }),
      risks: input.risks.length > 0
        ? input.risks
        : ['没有自动验证证据，不能证明变更后的行为正确。'],
      alternativeChecks: input.alternativeChecks.length > 0
        ? input.alternativeChecks
        : ['人工检查变更文件内容是否符合用户请求。'],
      requiredActions: [
        '补充可运行验证，或由用户明确接受剩余风险。',
      ],
      ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
    };
  }
}

function evaluateContractAcceptance(
  acceptance: QualityGateContractAcceptance | undefined,
): QualityGateDecision | undefined {
  if (!acceptance || acceptance.status === 'accepted') return undefined;
  const reason = acceptance.reason || acceptance.status;
  const fail = acceptance.status === 'adverse';
  return {
    version: 'devseek.quality-gate-decision/v1',
    authority: 'QualityGateService',
    status: fail ? 'fail' : 'blocked',
    summary: fail
      ? `QualityGate 未通过：${reason}。`
      : `QualityGate 阻塞：${reason}。`,
    evidenceRefs: acceptance.evidenceRefs?.length
      ? acceptance.evidenceRefs
      : [`contract:${acceptance.status}:${reason}`],
    contractAcceptanceStatus: acceptance.status,
    risks: acceptance.risks?.length
      ? acceptance.risks
      : [contractAcceptanceRisk(acceptance.status)],
    alternativeChecks: acceptance.alternativeChecks ?? [],
    requiredActions: acceptance.requiredActions?.length
      ? acceptance.requiredActions
      : ['补齐可执行 acceptance 证据后重新评估 QualityGate。'],
  };
}

function contractAcceptanceRisk(status: QualityGateContractAcceptanceStatus): string {
  if (status === 'weak-oracle') return '验收 oracle 过弱，不能证明交付满足用户契约。';
  if (status === 'pending') return '用户契约验收仍处于 pending 状态，不能完成结算。';
  if (status === 'adverse') return '用户契约验收存在不利证据，不能完成结算。';
  return '缺少用户契约验收输入，不能完成结算。';
}

function validationEvidenceRef(status: 'passed' | 'failed', validation: QualityGateValidationEvidence): string {
  return `validation:${status}:${validation.command || validation.reason || 'unknown'}`;
}
