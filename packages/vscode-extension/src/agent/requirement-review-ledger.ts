import type { AgenticHistoryQualityGate } from './agentic-history';
import { isCodeArtifactPath, type WrittenFileEvidence } from './completion-evidence';

export interface RequirementReviewInput {
  sourceChangeRequested: boolean;
  qualityGate?: AgenticHistoryQualityGate;
  writtenFiles: readonly WrittenFileEvidence[];
  roundReadFiles: readonly string[];
}

interface PendingRequirementReview {
  sourcePaths: string[];
  freshSourceEvidenceReady: boolean;
}

/** Owns the post-validation source evidence required for semantic review. */
export class RequirementReviewLedger {
  private reviewedSourceWriteCount = 0;
  private pending?: PendingRequirementReview;

  request(input: RequirementReviewInput): string | undefined {
    if (!input.sourceChangeRequested || input.qualityGate?.status !== 'pass') return undefined;
    const sourceWrites = input.writtenFiles.filter(file => isCodeArtifactPath(file.path));
    if (sourceWrites.length > this.reviewedSourceWriteCount) {
      const sourcePaths = Array.from(new Set(sourceWrites
        .slice(this.reviewedSourceWriteCount)
        .map(file => file.path)));
      this.reviewedSourceWriteCount = sourceWrites.length;
      this.pending = {
        sourcePaths,
        freshSourceEvidenceReady: false,
      };
      return [
        '【系统反馈：完成前需求覆盖复核】',
        `项目现有验证已通过，最新源码变更为：${sourcePaths.join('、')}。通过可见测试只证明已覆盖行为，不能替代用户需求。`,
        `下一轮必须先用 read_file 重新读取这些最终源码：${sourcePaths.join('、')}。写入工具的自动读回不算独立复核。`,
        '读取后逐条把用户的行为要求映射到最新实现的不变量，并标明现有测试已覆盖或仅靠代码推演覆盖。',
        '对时间回拨、状态迁移、重入、顺序、容量、边界值和异常路径等适用场景，至少用一组具体值推演完整序列；检查每个新增状态量和中间计算是否真正参与后续决策。',
        '若实现与任一条款矛盾，继续使用工具修复并重新验证；若一致，再给出复核结论。不要重复运行相同命令，也不要在重新读取源码的同一轮直接结束。',
      ].join('\n');
    }

    if (!this.pending || this.pending.freshSourceEvidenceReady) return undefined;
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
      '现在根据本轮真实源码逐条核对用户行为要求；特别检查未被公开测试覆盖的输入拒绝、边界、状态迁移、重入、顺序与异常路径。',
      '发现不一致就继续修复并重新验证；确认一致后，在下一轮给出复核结论并结束。',
    ].join('\n');
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
    this.pending = undefined;
    return undefined;
  }
}

function sameWorkspacePath(left: string, right: string): boolean {
  const a = normalizeWorkspacePath(left);
  const b = normalizeWorkspacePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizeWorkspacePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
