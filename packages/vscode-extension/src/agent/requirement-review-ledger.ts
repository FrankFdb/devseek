import type { AgenticHistoryQualityGate } from './agentic-history';
import {
  coalesceWrittenFileEvidence,
  isCodeArtifactPath,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { RequirementReviewPolicyDecision } from './requirement-review-policy';

export interface RequirementReviewInput {
  qualityGate?: AgenticHistoryQualityGate;
  writtenFiles: readonly WrittenFileEvidence[];
  roundReadFiles: readonly string[];
  readEvidencePaths?: readonly string[];
  hostFinalSourceEvidenceReady?: boolean;
}

export interface RequirementReviewFinding {
  requirementId: string;
  requirement: string;
  title: string;
  observedBehavior: string;
  expectedBehavior: string;
  counterexample: string;
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
  contextPaths?: readonly string[];
}

export type RequirementReviewNoToolRecovery =
  | { kind: 'retry'; feedback: string }
  | { kind: 'stop'; reason: string };

export interface RequirementReviewCompletionObligation {
  readonly kind: 'final-source-read' | 'review-settlement' | 'source-repair' | 'review-evidence';
  readonly blocker: string;
}

interface PendingRequirementReview {
  changedSourcePaths: string[];
  reviewSourcePaths: string[];
  contextPaths: string[];
  freshSourceEvidenceReady: boolean;
  hostFinalSourceEvidenceReady: boolean;
  reviewerRequested: boolean;
  indeterminateDecisionCount: number;
  decision?: RequirementReviewDecision;
}

/** Owns requirement-review state; provider invocation belongs to its adapter. */
export class RequirementReviewLedger {
  private scheduledSourceMutationCount = 0;
  private pending?: PendingRequirementReview;

  request(
    input: RequirementReviewInput,
    policyDecision?: RequirementReviewPolicyDecision,
  ): string | undefined {
    const sourceMutations = input.writtenFiles.filter(file => isCodeArtifactPath(file.path));
    if (sourceMutations.length > this.scheduledSourceMutationCount) {
      const currentSourcePaths = policyDecision?.sourcePaths
        ?? coalesceWrittenFileEvidence(sourceMutations)
          .filter(file => file.action !== 'delete')
          .map(file => file.path);
      const reviewSourcePaths = Array.from(new Set(currentSourcePaths));
      const changedSourcePaths = Array.from(new Set(sourceMutations
        .slice(this.scheduledSourceMutationCount)
        .map(file => file.path)))
        .filter(path => reviewSourcePaths.some(current => sameWorkspacePath(path, current)));
      if (reviewSourcePaths.length === 0) {
        this.scheduledSourceMutationCount = sourceMutations.length;
        this.pending = undefined;
        return undefined;
      }
      if (input.qualityGate?.status !== 'pass') {
        this.pending = undefined;
        return renderValidationPendingReviewPause(changedSourcePaths, reviewSourcePaths, input.qualityGate);
      }
      const hostFinalSourceEvidenceReady = input.hostFinalSourceEvidenceReady === true;
      this.scheduledSourceMutationCount = sourceMutations.length;
      if (policyDecision?.strategy === 'host-evidence') {
        this.pending = undefined;
        return undefined;
      }
      this.pending = {
        changedSourcePaths,
        reviewSourcePaths,
        contextPaths: uniqueContextPaths(input.readEvidencePaths ?? [], reviewSourcePaths),
        freshSourceEvidenceReady: hostFinalSourceEvidenceReady,
        hostFinalSourceEvidenceReady,
        reviewerRequested: false,
        indeterminateDecisionCount: 0,
      };
      if (hostFinalSourceEvidenceReady) {
        return [
          '【系统反馈：完成前需求覆盖复核】',
          `项目现有验证已通过，最新源码变更为：${changedSourcePaths.join('、')}。通过可见测试只证明已覆盖行为，不能替代用户需求。`,
          `DevSeek 已通过宿主侧写入读回和验证流程绑定最终源码证据：${reviewSourcePaths.join('、')}。`,
          '系统将直接捕获最终源码快照并交给全新隔离上下文中的只读审查者；实现会话不要再请求工具或自行宣告通过。',
        ].join('\n');
      }
      return [
        '【系统反馈：完成前需求覆盖复核】',
        `项目现有验证已通过，最新源码变更为：${changedSourcePaths.join('、')}。通过可见测试只证明已覆盖行为，不能替代用户需求。`,
        `下一轮必须先用 read_file 重新读取这些最终源码：${changedSourcePaths.join('、')}。写入工具的自动读回不算独立复核。`,
        `独立审查将共同读取本任务全部已修改源码：${reviewSourcePaths.join('、')}，避免脱离声明、类型或依赖文件判断实现。`,
        '读取后将由全新隔离上下文中的只读审查者逐条映射用户需求；实现会话不能用自己的文字自检替代该结论。',
        '审查者会根据原始需求和实际源码推演相关边界、状态迁移、失败路径、数据所有权及复杂度约束，不依赖本地任务关键词。',
        '本轮只用 read_file 重新读取最终源码；run_terminal/cat 输出、写入工具读回和公开测试日志都不能替代 read_file 复核。',
        '隔离审查返回反例后，可以用临时 probe 或项目验证命令辅助修复，但不得修改受保护测试或直接结束任务。',
      ].join('\n');
    }

    if (!this.pending) return undefined;
    if (this.pending.decision?.status === 'failed') {
      return renderBlockingDecision(this.pending.decision);
    }
    if (this.pending.decision?.status === 'indeterminate') {
      if (this.pending.hostFinalSourceEvidenceReady) {
        return undefined;
      }
      if (this.pending.indeterminateDecisionCount >= 2) {
        return renderIndeterminateDecision(this.pending.decision, this.pending, false);
      }
      const missingRetryPaths = this.pending.reviewSourcePaths.filter(sourcePath => (
        !input.roundReadFiles.some(readPath => sameWorkspacePath(readPath, sourcePath))
      ));
      if (missingRetryPaths.length > 0) {
        return renderIndeterminateDecision(this.pending.decision, this.pending, true);
      }
      this.pending.decision = undefined;
      this.pending.reviewerRequested = false;
      this.pending.freshSourceEvidenceReady = true;
      return [
        '【系统反馈：重新触发独立需求审查】',
        '上一轮隔离审查未形成可用结构化结论，最终源码已重新读取。',
        '系统将重试隔离审查；实现会话不要修改源码、不要编造审查结论。',
      ].join('\n');
    }
    if (this.pending.freshSourceEvidenceReady) return undefined;
    const missingPaths = this.pending.changedSourcePaths.filter(sourcePath => (
      !input.roundReadFiles.some(readPath => sameWorkspacePath(readPath, sourcePath))
    ));
    if (missingPaths.length > 0) {
      return [
        '【系统反馈：需求覆盖复核仍缺少最终源码证据】',
        `请用 read_file 重新读取：${missingPaths.join('、')}。`,
        'run_terminal/cat 输出不计入完成前源码复核证据。',
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
    return {
      sourcePaths: [...this.pending.reviewSourcePaths],
      ...(this.pending.contextPaths.length > 0
        ? { contextPaths: [...this.pending.contextPaths] }
        : {}),
    };
  }

  settleIndependentReview(decision: RequirementReviewDecision): string | undefined {
    if (!this.pending?.reviewerRequested) {
      throw new Error('requirement-review-ledger:review-without-candidate');
    }
    if (decision.status === 'indeterminate') {
      this.pending.indeterminateDecisionCount += 1;
      this.pending.decision = decision;
      if (this.pending.hostFinalSourceEvidenceReady) {
        return undefined;
      }
      return renderIndeterminateDecision(
        decision,
        this.pending,
        this.pending.indeterminateDecisionCount < 2,
      );
    }
    if (decision.status === 'passed') {
      this.pending = undefined;
      return undefined;
    }
    this.pending.decision = decision;
    return renderBlockingDecision(decision);
  }

  beforeNoToolCompletion(): string | undefined {
    if (!this.pending) return undefined;
    if (!this.pending.freshSourceEvidenceReady) {
      return [
        '【系统反馈：不能跳过需求覆盖复核】',
        `请先用 read_file 重新读取最终源码：${this.pending.changedSourcePaths.join('、')}。`,
        '公开测试通过和文字自检都不能替代对最终实现的独立读取。',
      ].join('\n');
    }
    if (!this.pending.decision) {
      return '【系统反馈：不能跳过独立需求审查】\n最终源码已读取，但隔离审查者尚未形成结论。';
    }
    if (this.pending.decision.status === 'indeterminate') {
      if (this.pending.hostFinalSourceEvidenceReady) return undefined;
      return renderIndeterminateDecision(
        this.pending.decision,
        this.pending,
        this.pending.indeterminateDecisionCount < 2,
      );
    }
    if (this.pending.decision.status !== 'passed') {
      return renderBlockingDecision(this.pending.decision);
    }
    this.pending = undefined;
    return undefined;
  }

  completionObligation(): RequirementReviewCompletionObligation | undefined {
    if (!this.pending) return undefined;
    if (!this.pending.freshSourceEvidenceReady) {
      return {
        kind: 'final-source-read',
        blocker: `独立需求审查未完成：缺少最终源码 read_file 复核（${this.pending.changedSourcePaths.join('、')}）。`,
      };
    }
    if (!this.pending.decision) {
      return {
        kind: 'review-settlement',
        blocker: '独立需求审查未完成：最终源码已读取，但隔离审查者尚未形成结论。',
      };
    }
    if (this.pending.decision.status === 'passed') return undefined;
    if (this.pending.decision.status === 'failed') {
      return {
        kind: 'source-repair',
        blocker: `独立需求审查未通过：${this.pending.decision.explanation}`,
      };
    }
    return {
      kind: 'review-evidence',
      blocker: `独立需求审查证据不足：${this.pending.decision.explanation}`,
    };
  }

  completionBlocker(): string | undefined {
    return this.completionObligation()?.blocker;
  }

  recoverNoToolCompletion(consecutiveRound: number): RequirementReviewNoToolRecovery | undefined {
    const feedback = this.beforeNoToolCompletion();
    if (!feedback) return undefined;
    if (consecutiveRound >= 3) {
      return {
        kind: 'stop',
        reason: `独立需求审查连续 ${consecutiveRound} 轮未推进，但模型没有执行任何工具调用。`,
      };
    }
    return {
      kind: 'retry',
      feedback: consecutiveRound === 2
        ? `${feedback}\n\n【系统反馈】审查状态仍未改变，且本轮工具调用数为 0。下一回复请调用必要的真实工具补齐缺失证据，不要只说明准备做什么。`
        : feedback,
    };
  }
}

function uniqueContextPaths(
  paths: readonly string[],
  sourcePaths: readonly string[],
): string[] {
  const unique: string[] = [];
  for (const candidate of paths) {
    if (sourcePaths.some(sourcePath => sameWorkspacePath(candidate, sourcePath))) continue;
    if (!unique.some(existing => sameWorkspacePath(candidate, existing))) unique.push(candidate);
  }
  return unique;
}

function renderBlockingDecision(decision: RequirementReviewDecision): string {
  const primaryFinding = selectPrimaryFinding(decision.findings);
  const findings = decision.findings.map((finding, index) => [
    `${index + 1}. [P${finding.priority}] ${finding.title} (${finding.path}:${finding.line})`,
    `需求 ${finding.requirementId}：${finding.requirement}`,
    `实际行为：${finding.observedBehavior}`,
    `期望行为：${finding.expectedBehavior}`,
    `可复现反例：${finding.counterexample}`,
  ].join('\n'));
  return [
    '【独立需求审查：未通过】',
    decision.explanation,
    ...findings,
    '不要从头重做完整任务；把本轮全部 finding 作为一个有界修复队列，先把最高优先级 counterexample 转成最小本地 probe、精确源码检查或等价的针对性验证。',
    primaryFinding
      ? `优先验证反例：${primaryFinding.counterexample}`
      : undefined,
    '核实其余 finding，并围绕共同责任边界合并修复相邻状态流、边界值和同类入口；不要只改当前一行，也不要处理首条后就停止。',
    '全部成立的反例都取得针对性验证后，再运行项目既有验证作为大 case 回归。',
    '必须根据上述独立结论修复生产源码并重新运行项目验证；不要修改受保护测试，也不要仅用解释否定审查结果。',
  ].filter(Boolean).join('\n');
}

function selectPrimaryFinding(findings: readonly RequirementReviewFinding[]): RequirementReviewFinding | undefined {
  return findings.find(finding => finding.priority <= 2) ?? findings[0];
}

function renderValidationPendingReviewPause(
  changedSourcePaths: readonly string[],
  reviewSourcePaths: readonly string[],
  qualityGate: AgenticHistoryQualityGate | undefined,
): string {
  const paths = changedSourcePaths.length > 0 ? changedSourcePaths : reviewSourcePaths;
  return [
    '【系统反馈：暂停独立需求审查】',
    qualityGate
      ? `最新源码变更尚未通过自动验证：${qualityGate.summary}`
      : '最新源码变更尚未取得通过的自动验证证据。',
    paths.length ? `涉及源码：${paths.join('、')}。` : '',
    '当前优先级是恢复可编译/可运行状态，不要继续只读需求审查或反复 read_file 同一坏源码。',
    '下一轮先针对首个可复现的编译、测试或运行错误做最小修复验证，并从真实错误证据定位受影响的源码边界。',
    '通过项目验证后，DevSeek 会重新触发独立需求审查。',
  ].filter(Boolean).join('\n');
}

function renderIndeterminateDecision(
  decision: RequirementReviewDecision,
  pending: PendingRequirementReview,
  canRetry: boolean,
): string {
  return [
    '【独立需求审查：证据不足】',
    decision.explanation,
    canRetry
      ? [
          '这是审查器输出或证据链未形成可用结论，不是可执行源码缺陷。',
          `下一轮只允许用 read_file 重新读取最终源码以重试审查：${pending.reviewSourcePaths.join('、')}。`,
          '不要为了通过审查盲目修改生产源码，也不要仅用解释否定审查结果。',
        ].join('\n')
      : [
          '隔离审查连续未形成可用结构化结论，当前状态应作为审查器阻塞处理。',
          '不要继续盲目修改生产源码；请保留已通过的项目验证证据并报告阻塞原因。',
        ].join('\n'),
  ].join('\n');
}

function sameWorkspacePath(left: string, right: string): boolean {
  const a = normalizeWorkspacePath(left);
  const b = normalizeWorkspacePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizeWorkspacePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
