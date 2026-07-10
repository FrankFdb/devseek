export type QualityGateStatus = 'pass' | 'fail' | 'blocked';

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

export interface QualityGateInput {
  changedPaths: string[];
  validation?: QualityGateValidationEvidence | null;
  acceptedRisk?: QualityGateRiskAcceptance;
}

export interface QualityGateDecision {
  status: QualityGateStatus;
  summary: string;
  evidenceRefs: string[];
  risks: string[];
  alternativeChecks: string[];
  requiredActions: string[];
  acceptedRisk?: QualityGateRiskAcceptance;
}

export class QualityGateService {
  evaluate(input: QualityGateInput): QualityGateDecision {
    const validation = input.validation;
    if (!validation) {
      return this.blockedDecision({
        reason: 'no-validation-evidence',
        risks: ['没有自动验证证据，不能证明变更后的行为正确。'],
        alternativeChecks: [],
        acceptedRisk: input.acceptedRisk,
      });
    }

    if (validation.status === 'blocked' || !validation.ran) {
      return this.blockedDecision({
        reason: validation.reason || 'validation-blocked',
        risks: validation.risks || [],
        alternativeChecks: validation.alternativeChecks || [],
        acceptedRisk: input.acceptedRisk,
      });
    }

    if (validation.ok) {
      const ref = validationEvidenceRef('passed', validation);
      return {
        status: 'pass',
        summary: `QualityGate 通过：${validation.command || '自动验证'} 已通过。`,
        evidenceRefs: [ref],
        risks: validation.risks || [],
        alternativeChecks: validation.alternativeChecks || [],
        requiredActions: [],
        ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
      };
    }

    return {
      status: 'fail',
      summary: `QualityGate 未通过：自动验证失败（exitCode=${validation.exitCode ?? 'null'}）。`,
      evidenceRefs: [validationEvidenceRef('failed', validation)],
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
    reason: string;
    risks: string[];
    alternativeChecks: string[];
    acceptedRisk?: QualityGateRiskAcceptance;
  }): QualityGateDecision {
    return {
      status: 'blocked',
      summary: `QualityGate 阻塞：${input.reason}。`,
      evidenceRefs: [`validation:blocked:${input.reason}`],
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

function validationEvidenceRef(status: 'passed' | 'failed', validation: QualityGateValidationEvidence): string {
  return `validation:${status}:${validation.command || validation.reason || 'unknown'}`;
}
