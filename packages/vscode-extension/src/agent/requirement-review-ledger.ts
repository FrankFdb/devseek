import type { AgenticHistoryQualityGate } from './agentic-history';
import { isCodeArtifactPath, type WrittenFileEvidence } from './completion-evidence';

export interface RequirementReviewInput {
  sourceChangeRequested: boolean;
  qualityGate?: AgenticHistoryQualityGate;
  writtenFiles: readonly WrittenFileEvidence[];
  roundReadFiles: readonly string[];
}

export interface RequirementReviewFinding {
  title: string;
  body: string;
  priority: 0 | 1 | 2 | 3;
  confidence: number;
  path: string;
  line: number;
}

export interface RequirementReviewDecision {
  status: 'passed' | 'failed' | 'indeterminate';
  explanation: string;
  findings: readonly RequirementReviewFinding[];
}

export interface RequirementReviewCandidate {
  sourcePaths: readonly string[];
}

interface PendingRequirementReview {
  sourcePaths: string[];
  freshSourceEvidenceReady: boolean;
  reviewerRequested: boolean;
  decision?: RequirementReviewDecision;
}

/** Owns requirement-review state; provider invocation belongs to its adapter. */
export class RequirementReviewLedger {
  private scheduledSourceWriteCount = 0;
  private pending?: PendingRequirementReview;

  request(input: RequirementReviewInput): string | undefined {
    if (!input.sourceChangeRequested) return undefined;
    const sourceWrites = input.writtenFiles.filter(file => isCodeArtifactPath(file.path));
    if (sourceWrites.length > this.scheduledSourceWriteCount) {
      if (input.qualityGate?.status !== 'pass') return undefined;
      const sourcePaths = Array.from(new Set(sourceWrites
        .slice(this.scheduledSourceWriteCount)
        .map(file => file.path)));
      this.scheduledSourceWriteCount = sourceWrites.length;
      this.pending = {
        sourcePaths,
        freshSourceEvidenceReady: false,
        reviewerRequested: false,
      };
      return [
        '【系统反馈：完成前需求覆盖复核】',
        `项目现有验证已通过，最新源码变更为：${sourcePaths.join('、')}。通过可见测试只证明已覆盖行为，不能替代用户需求。`,
        `下一轮必须先用 read_file 重新读取这些最终源码：${sourcePaths.join('、')}。写入工具的自动读回不算独立复核。`,
        '读取后将由全新隔离上下文中的只读审查者逐条映射用户需求；实现会话不能用自己的文字自检替代该结论。',
        '审查会覆盖时间回拨、状态迁移、重入、顺序、容量、边界值和异常路径，并检查新增状态量是否参与真实决策。',
        '“拒绝/报错/无效”必须有调用方可观察且不与正常成功重叠的失败通道；“重复/已使用”身份约束会推演完成或取消后的再次使用。',
        '用户指定的数据结构和复杂度同样属于验收条款；审查会识别无效状态量、错误所有权和违背约束的线性扫描。',
        '本轮只重新读取最终源码，不要自行创建临时 probe、修改受保护测试或直接结束任务。',
      ].join('\n');
    }

    if (!this.pending) return undefined;
    if (this.pending.decision && this.pending.decision.status !== 'passed') {
      return renderBlockingDecision(this.pending.decision);
    }
    if (this.pending.freshSourceEvidenceReady) return undefined;
    const missingPaths = this.pending.sourcePaths.filter(sourcePath => (
      !input.roundReadFiles.some(readPath => sameWorkspacePath(readPath, sourcePath))
    ));
    if (missingPaths.length > 0) {
      return [
        '【系统反馈：需求覆盖复核仍缺少最终源码证据】',
        `请用 read_file 重新读取：${missingPaths.join('、')}。`,
        '必须基于写入后的实际内容复核，不能用先前上下文、写入参数或公开测试通过代替。',
      ].join('\n');
    }

    this.pending.freshSourceEvidenceReady = true;
    return [
      '【系统反馈：最终源码已重新读取】',
      '最终源码证据已齐全，正在交给全新隔离上下文中的只读审查者。实现会话不得自行宣告通过。',
    ].join('\n');
  }

  takeIndependentReviewCandidate(): RequirementReviewCandidate | undefined {
    if (!this.pending?.freshSourceEvidenceReady || this.pending.reviewerRequested) return undefined;
    this.pending.reviewerRequested = true;
    return { sourcePaths: [...this.pending.sourcePaths] };
  }

  settleIndependentReview(decision: RequirementReviewDecision): string {
    if (!this.pending?.reviewerRequested) {
      throw new Error('requirement-review-ledger:review-without-candidate');
    }
    this.pending.decision = decision;
    return decision.status === 'passed'
      ? [
          '【独立需求审查：通过】',
          decision.explanation,
          '审查者使用了与实现会话隔离的只读上下文。下一轮请基于既有验证事实简洁完成交付，不要再次修改源码。',
        ].join('\n')
      : renderBlockingDecision(decision);
  }

  beforeNoToolCompletion(): string | undefined {
    if (!this.pending) return undefined;
    if (!this.pending.freshSourceEvidenceReady) {
      return [
        '【系统反馈：不能跳过需求覆盖复核】',
        `请先用 read_file 重新读取最终源码：${this.pending.sourcePaths.join('、')}。`,
        '公开测试通过和文字自检都不能替代对最终实现的独立读取。',
      ].join('\n');
    }
    if (!this.pending.decision) {
      return '【系统反馈：不能跳过独立需求审查】\n最终源码已读取，但隔离审查者尚未形成结论。';
    }
    if (this.pending.decision.status !== 'passed') {
      return renderBlockingDecision(this.pending.decision);
    }
    this.pending = undefined;
    return undefined;
  }
}

function renderBlockingDecision(decision: RequirementReviewDecision): string {
  const heading = decision.status === 'failed'
    ? '【独立需求审查：未通过】'
    : '【独立需求审查：证据不足】';
  const findings = decision.findings.map((finding, index) => (
    `${index + 1}. [P${finding.priority}] ${finding.title} (${finding.path}:${finding.line})\n${finding.body}`
  ));
  return [
    heading,
    decision.explanation,
    ...findings,
    '必须根据上述独立结论修复生产源码并重新运行项目验证；不要修改受保护测试，也不要仅用解释否定审查结果。',
  ].filter(Boolean).join('\n');
}

function sameWorkspacePath(left: string, right: string): boolean {
  const a = normalizeWorkspacePath(left);
  const b = normalizeWorkspacePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizeWorkspacePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
