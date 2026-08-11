import type { AgenticHistoryQualityGate } from './agentic-history';
import { isCodeArtifactPath, type WrittenFileEvidence } from './completion-evidence';

export interface RequirementReviewInput {
  sourceChangeRequested: boolean;
  qualityGate?: AgenticHistoryQualityGate;
  writtenFiles: readonly WrittenFileEvidence[];
  roundHasWorkTools: boolean;
}

/** Schedules one semantic review for each newly validated source mutation cohort. */
export class RequirementReviewLedger {
  private reviewedWriteCount = 0;
  private reviewPending = false;

  request(input: RequirementReviewInput): string | undefined {
    if (this.reviewPending
      && input.writtenFiles.length <= this.reviewedWriteCount
      && input.roundHasWorkTools) {
      return '【系统反馈：需求覆盖复核仍在进行】请先根据本轮真实工具结果完成语义判断；发现偏差就修复，否则给出复核结论。';
    }
    if (!input.sourceChangeRequested || input.qualityGate?.status !== 'pass') return undefined;
    if (input.writtenFiles.length <= this.reviewedWriteCount) return undefined;
    const sourcePaths = Array.from(new Set(input.writtenFiles
      .map(file => file.path)
      .filter(isCodeArtifactPath)));
    if (sourcePaths.length === 0) return undefined;

    this.reviewedWriteCount = input.writtenFiles.length;
    this.reviewPending = true;
    return [
      '【系统反馈：完成前需求覆盖复核】',
      `项目现有验证已通过，最新源码变更为：${sourcePaths.join('、')}。通过可见测试只证明已覆盖行为，不能替代用户需求。`,
      '结束前请逐条把用户的行为要求映射到最新实现的不变量，并标明现有测试已覆盖或仅靠代码推演覆盖。',
      '对时间回拨、状态迁移、重入、顺序、容量、边界值和异常路径等适用场景，至少用一组具体值推演完整序列；检查每个新增状态量和中间计算是否真正参与后续决策。',
      '若实现与任一条款矛盾，继续使用工具修复并重新验证；若一致，简洁报告复核结论和仍未实测的风险，不要重复运行相同命令。',
    ].join('\n');
  }
}
