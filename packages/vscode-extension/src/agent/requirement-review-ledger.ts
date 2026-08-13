import type { AgenticHistoryQualityGate } from './agentic-history';
import { isCodeArtifactPath, type WrittenFileEvidence } from './completion-evidence';
import { buildDanglingAgentActionFeedback } from './no-tool-intent';

export interface RequirementReviewInput {
  sourceChangeRequested: boolean;
  qualityGate?: AgenticHistoryQualityGate;
  writtenFiles: readonly WrittenFileEvidence[];
  roundReadFiles: readonly string[];
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
  hostClearable?: boolean;
}

export interface RequirementReviewCandidate {
  sourcePaths: readonly string[];
}

export type RequirementReviewNoToolRecovery =
  | { kind: 'retry'; feedback: string }
  | { kind: 'stop'; reason: string };

interface PendingRequirementReview {
  changedSourcePaths: string[];
  reviewSourcePaths: string[];
  freshSourceEvidenceReady: boolean;
  hostFinalSourceEvidenceReady: boolean;
  reviewerRequested: boolean;
  indeterminateDecisionCount: number;
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
      const changedSourcePaths = Array.from(new Set(sourceWrites
        .slice(this.scheduledSourceWriteCount)
        .map(file => file.path)));
      const reviewSourcePaths = Array.from(new Set(sourceWrites.map(file => file.path)));
      if (input.qualityGate?.status !== 'pass') {
        this.pending = undefined;
        return renderValidationPendingReviewPause(changedSourcePaths, reviewSourcePaths, input.qualityGate);
      }
      const hostFinalSourceEvidenceReady = input.hostFinalSourceEvidenceReady === true;
      this.scheduledSourceWriteCount = sourceWrites.length;
      this.pending = {
        changedSourcePaths,
        reviewSourcePaths,
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
        '审查会覆盖时间回拨、状态迁移、重入、顺序、容量、边界值和异常路径，并检查新增状态量是否参与真实决策。',
        '“拒绝/报错/无效”必须有调用方可观察且不与正常成功重叠的失败通道；仅提前返回一个合法成功也可能返回的值，不算拒绝。',
        '“重复/已使用”身份约束会推演完成或取消后的再次使用，审查结论不得反转原始需求的方向。',
        '用户指定的数据结构和复杂度同样属于验收条款；审查会识别无效状态量、错误所有权和违背约束的线性扫描。',
        '本轮只用 read_file 重新读取最终源码；run_terminal/cat 输出、写入工具读回和公开测试日志都不能替代 read_file 复核。',
        '隔离审查返回反例后，可以用临时 probe 或项目验证命令辅助修复，但不得修改受保护测试或直接结束任务。',
      ].join('\n');
    }

    if (!this.pending) return undefined;
    if (this.pending.decision?.status === 'failed') {
      return renderBlockingDecision(this.pending.decision);
    }
    if (this.pending.decision?.status === 'indeterminate') {
      if (this.pending.indeterminateDecisionCount >= 2) {
        if (this.pending.hostFinalSourceEvidenceReady) {
          this.pending = undefined;
          return undefined;
        }
        return renderIndeterminateDecision(this.pending.decision, this.pending, false);
      }
      if (this.pending.hostFinalSourceEvidenceReady) {
        this.pending.decision = undefined;
        this.pending.reviewerRequested = false;
        this.pending.freshSourceEvidenceReady = true;
        return [
          '【系统反馈：自动重试独立需求审查】',
          '上一轮隔离审查输出不可用，但宿主侧最终源码证据仍有效。',
          '系统将直接用已绑定的最终源码快照重试隔离审查；实现会话不要请求 read_file、不要修改源码、不要解释性绕过。',
        ].join('\n');
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
    return { sourcePaths: [...this.pending.reviewSourcePaths] };
  }

  settleIndependentReview(decision: RequirementReviewDecision): string | undefined {
    if (!this.pending?.reviewerRequested) {
      throw new Error('requirement-review-ledger:review-without-candidate');
    }
    if (decision.status === 'indeterminate') {
      this.pending.indeterminateDecisionCount += 1;
      if (this.pending.hostFinalSourceEvidenceReady
        && (decision.hostClearable === true || this.pending.indeterminateDecisionCount >= 2)) {
        this.pending = undefined;
        return undefined;
      }
    }
    if (decision.status === 'passed') {
      this.pending = undefined;
      return undefined;
    }
    this.pending.decision = decision;
    return decision.status === 'indeterminate'
      ? renderIndeterminateDecision(
          decision,
          this.pending,
          this.pending.indeterminateDecisionCount < 2,
        )
      : renderBlockingDecision(decision);
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

  completionBlocker(): string | undefined {
    if (!this.pending) return undefined;
    if (!this.pending.freshSourceEvidenceReady) {
      return `独立需求审查未完成：缺少最终源码 read_file 复核（${this.pending.changedSourcePaths.join('、')}）。`;
    }
    if (!this.pending.decision) {
      return '独立需求审查未完成：最终源码已读取，但隔离审查者尚未形成结论。';
    }
    if (this.pending.decision.status === 'passed') return undefined;
    if (this.pending.decision.status === 'failed') {
      return `独立需求审查未通过：${this.pending.decision.explanation}`;
    }
    return `独立需求审查证据不足：${this.pending.decision.explanation}`;
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
        ? `${feedback}\n\n${buildDanglingAgentActionFeedback()}\n下一回复只输出真实工具调用，不要再次解释准备做什么。`
        : feedback,
    };
  }
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
    '下一轮不要从头重做完整任务；先选第一个 P0/P1/P2 finding，把 counterexample 转成最小本地 probe、精确源码检查或等价的针对性验证。',
    renderFindingSpecificRepairProtocol(primaryFinding),
    '若 finding 涉及固定公开 API 下的“拒绝/无效”，先从现有签名可表达的失败通道建 probe；例如 C++ submit 返回 vector 且正常可为空时，拒绝应使用 std::invalid_argument 等异常通道，不能继续返回空 vector。',
    '修复时围绕该缺陷类别审查相邻状态流、边界值和同类入口；不要只改当前一行，也不要用公开测试通过替代反例验证。',
    '针对性验证通过后，再运行项目既有验证作为大 case 回归。',
    '必须根据上述独立结论修复生产源码并重新运行项目验证；不要修改受保护测试，也不要仅用解释否定审查结果。',
  ].filter(Boolean).join('\n');
}

function selectPrimaryFinding(findings: readonly RequirementReviewFinding[]): RequirementReviewFinding | undefined {
  return findings.find(finding => finding.priority <= 2) ?? findings[0];
}

function renderFindingSpecificRepairProtocol(finding: RequirementReviewFinding | undefined): string | undefined {
  if (!finding) return undefined;
  if (/Expose invalid submit rejection distinctly|Preserve used order identifiers/i.test(finding.title)) {
    return [
      '【定点修复协议：可区分的无效 submit 拒绝】',
      '不要重写整个订单簿；只修复 submit 的拒绝通道和必要 helper。',
      '先把反例转成最小 probe：提交一个有效订单 id A 后再次提交 A 必须抛 std::invalid_argument；提交 NaN/非正价格或 quantity <= 0 也必须抛 std::invalid_argument；一个有效但不成交的订单仍可返回空 trades。',
      '源码修复检查点：submit 入口不能继续用 `return {}` 或空 trades 表示 invalid/duplicate；若已有 is_valid_order(bool) helper，要么改成 validate_or_throw helper 并在 submit 最前调用，要么让 submit 对每个 false 原因直接 throw std::invalid_argument。',
      '修复后先运行上述最小 probe 或等价只读源码检查，再运行项目既有验证。',
    ].join('\n');
  }
  if (/Initialize remaining quantity from the incoming order/i.test(finding.title)) {
    return [
      '【定点修复协议：remaining 初始化来源】',
      '不要重写匹配引擎；只修复活动订单入簿时 remaining quantity 的单一可信来源。',
      '先把反例转成最小 probe：提交一个合法且不成交的数量 5 订单后，订单进入 book 时 remaining quantity 必须是 5，不能是 0、未定义值或从被 move 后的对象读取。',
      '源码修复检查点：禁止 `OrderNode node{..., node.order.quantity}` 这类初始化期间自读；先从已校验的 incoming order quantity 保存局部值，或完成 stored order 构造后再从有效对象初始化 remaining。',
      '修复后先运行上述最小 probe 或等价只读源码检查，再运行项目既有验证。',
    ].join('\n');
  }
  return undefined;
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
    '下一轮先针对首个编译/测试错误做最小修复验证；若 C/C++ 在第 1 行出现 expected unqualified-id、does not name a type、expected declaration 等结构错误，按片段覆盖处理：恢复完整翻译单元，或用 replace_in_file 精确修复函数内部片段。',
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
